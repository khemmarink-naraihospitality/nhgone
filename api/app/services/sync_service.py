from supabase import create_client, Client
from app.config import settings
import logging
import re
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import asyncio
from app.services.mews_client import mews_client
from app.services.encryption import encryption_service

logger = logging.getLogger(__name__)

_THAI_NUM = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"]
_THAI_UNIT = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"]


def _read_thai_digits(num_str: str) -> str:
    num_str = num_str.lstrip("0")
    if not num_str:
        return ""
    n = len(num_str)
    result = ""
    for i, ch in enumerate(num_str):
        digit = int(ch)
        pos = n - i - 1
        if digit == 0:
            continue
        if pos == 0 and digit == 1 and n > 1:
            result += "เอ็ด"
        elif pos == 1 and digit == 2:
            result += "ยี่สิบ"
        elif pos == 1 and digit == 1:
            result += "สิบ"
        else:
            result += _THAI_NUM[digit] + _THAI_UNIT[pos]
    return result


def bahttext(amount) -> str:
    """Convert a numeric amount to Thai baht text, e.g. 1250.50 -> 'หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์'."""
    try:
        amount = float(amount or 0)
    except (TypeError, ValueError):
        amount = 0.0
    amount = round(abs(amount) + 1e-9, 2)
    baht = int(amount)
    satang = int(round((amount - baht) * 100))

    if baht == 0:
        baht_words = "ศูนย์"
    else:
        groups = []
        s = str(baht)
        while s:
            groups.insert(0, s[-6:])
            s = s[:-6]
        pieces = []
        for idx, g in enumerate(groups):
            words = _read_thai_digits(g)
            if words:
                scale_ups = len(groups) - idx - 1
                pieces.append(words + "ล้าน" * scale_ups)
        baht_words = "".join(pieces)

    result = baht_words + "บาท"
    if satang == 0:
        result += "ถ้วน"
    else:
        result += _read_thai_digits(str(satang)) + "สตางค์"
    return result


# RR3 (ร.ร.๓ Thai Hotel Act lodger registration card) support - ported from the
# user's existing, proven Google Apps Script rather than re-derived from docs.
_RR3_COUNTRY_MAP = {
    "TH": "Thailand", "SA": "Saudi Arabia", "IN": "India", "US": "United States",
    "GB": "United Kingdom", "CN": "China", "JP": "Japan", "DE": "Germany",
    "FR": "France", "KR": "South Korea", "AE": "United Arab Emirates", "RU": "Russia",
    "SG": "Singapore", "MY": "Malaysia", "ID": "Indonesia", "VN": "Vietnam",
    "PH": "Philippines", "CH": "Switzerland", "IT": "Italy", "ES": "Spain",
    "BR": "Brazil", "CA": "Canada", "AU": "Australia", "ZA": "South Africa",
}

_RR3_PROPERTY_THAI_NAMES = {
    "Lub d Bangkok Chinatown": "หลับดี แบงค็อก เยาวราช",
    "Lub d Bangkok Siam": "หลับดี แบงค็อก สยาม",
    "Lub d Koh Samui Chaweng Beach": "หลับดี เกาะสมุย หาดเฉวง",
    "Lub d Koh Tao Tanote Bay": "หลับดี เกาะเต่า อ่าวโตนด",
    "Lub d Philippines Makati": "หลับดี มะนิลา มาคาติ",
    "Lub d Phuket Patong": "หลับดี ภูเก็ต ป่าตอง",
    "Lub d Siem Reap": "หลับดี เสียมเรียบ",
    "Marasca Samui": "มาราสก้า สมุย",
}


def _rr3_country_name(code: str) -> str:
    return _RR3_COUNTRY_MAP.get(code, code or "")


_RR3_MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _rr3_format_thai_date(utc_str: str) -> str:
    if not utc_str:
        return ""
    try:
        dt = datetime.fromisoformat(utc_str.replace("Z", "+00:00")).astimezone(ZoneInfo("Asia/Bangkok"))
        # dd/mmm/yyyy (e.g. 28/Jul/2026) - a fixed abbreviation list instead of
        # strftime("%b") avoids the month name depending on the server's locale.
        return f"{dt.day:02d}/{_RR3_MONTH_ABBR[dt.month - 1]}/{dt.year}"
    except Exception:
        return ""


def _rr3_format_thai_time(utc_str: str) -> str:
    if not utc_str:
        return ""
    try:
        dt = datetime.fromisoformat(utc_str.replace("Z", "+00:00")).astimezone(ZoneInfo("Asia/Bangkok"))
        return dt.strftime("%H:%M")
    except Exception:
        return ""


class SyncService:
    def __init__(self):
        # We need the SERVICE_ROLE_KEY to bypass RLS for sync operations
        # If not provided, we fall back to the anon key (might fail RLS)
        self.url = settings.SUPABASE_URL
        self.key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
        if self.url and self.key:
            self.supabase: Client = create_client(self.url, self.key)
        else:
            self.supabase = None
            logger.warning("Supabase credentials missing. Sync will not work.")

    async def sync_reservation(self, data: dict):
        if not self.supabase:
            raise Exception("Supabase client not initialized")
        
        # Upsert pattern preserving NHGOne notes
        # We use a POST request via supabase client
        try:
            res = self.supabase.table("reservations").upsert(
                data,
                on_conflict="mews_id"
            ).execute()
            return res.data
        except Exception as e:
            logger.error(f"Sync error: {e}")
            raise e

    async def get_mapped_reservations(self, property_name: str, start_date: str = None, end_date: str = None, cursor: str = None, chunk_limit: int = None):
        """
        Fetch live reservations and map them to the 58 columns Mews Reservation Report.
        Shared between API router and background sync job.
        """
        try:
            if not start_date or not end_date:
                # Default to Yesterday 00:01:00 to 23:59:59 (Asia/Bangkok time), exported as UTC for Mews API
                bkk_tz = ZoneInfo("Asia/Bangkok")
                now_bkk = datetime.now(bkk_tz)
                yesterday_bkk = now_bkk - timedelta(days=1)
                
                if not start_date:
                    start_dt = yesterday_bkk.replace(hour=0, minute=0, second=0, microsecond=0)
                    start_date = start_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                if not end_date:
                    end_dt = yesterday_bkk.replace(hour=23, minute=59, second=59, microsecond=999999)
                    end_date = end_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

            chunk_size = 500
            
            all_reservations = []
            current_cursor = cursor
            chunks_fetched = 0

            while True:
                payload = {
                    "CollidingUtc": {"StartUtc": start_date, "EndUtc": end_date},
                    "States": ["Canceled", "Started", "Processed", "Confirmed", "Inquired", "Optional"],
                    "Limitation": {"Count": chunk_size}
                }
                if current_cursor:
                    payload["Limitation"]["Cursor"] = current_cursor

                # 1. Fetch Reservations
                response_data = await mews_client.post("/api/connector/v1/reservations/getAll/2023-06-06", payload, property_name=property_name)
                reservations_chunk = response_data.get("Reservations", [])
                current_cursor = response_data.get("Cursor")
                
                all_reservations.extend(reservations_chunk)
                chunks_fetched += 1
                
                if not current_cursor or not reservations_chunk or (chunk_limit and chunks_fetched >= chunk_limit):
                    break

            reservations = all_reservations
            return_cursor = current_cursor

            if not reservations:
                return {"data": [], "cursor": None}

            # 2. Collect unique IDs for relations
            account_ids = {r.get("AccountId") for r in reservations if r.get("AccountId")}
            booker_ids = {r.get("BookerId") for r in reservations if r.get("BookerId")}
            customer_ids = list(account_ids.union(booker_ids))
            
            company_ids = {r.get("CompanyId") for r in reservations if r.get("CompanyId")}
            ta_ids = {r.get("TravelAgencyId") for r in reservations if r.get("TravelAgencyId")}
            all_company_ids = list(company_ids.union(ta_ids))
            
            resource_ids = list({r.get("AssignedResourceId") for r in reservations if r.get("AssignedResourceId")})
            category_ids = list({r.get("RequestedCategoryId") for r in reservations if r.get("RequestedCategoryId")})
            rate_ids = list({r.get("RateId") for r in reservations if r.get("RateId")})
            group_ids = list({r.get("ReservationGroupId") for r in reservations if r.get("ReservationGroupId")})

            # 3. Fetch Relations Concurrently
            async def fetch_entity(endpoint, payload_key, ids, response_key):
                if not ids: return {}
                try:
                    res = await mews_client.post(endpoint, {payload_key: ids[:200]}, property_name=property_name)
                    return {item["Id"]: item for item in res.get(response_key, [])}
                except Exception as e:
                    logger.error(f"Failed to fetch {endpoint}: {e}")
                    return {}

            customers_dict, companies_dict, resources_dict, categories_dict, rates_dict, groups_dict = await asyncio.gather(
                fetch_entity("/api/connector/v1/customers/getAll", "CustomerIds", customer_ids, "Customers"),
                # companies/getAll filters by "Ids", not "CompanyIds" - the
                # latter is silently accepted but ignored, so it was
                # returning an arbitrary/unfiltered batch of companies
                # instead of the ones actually requested (confirmed live:
                # asking for one specific TravelAgencyId came back with 10
                # unrelated companies, none matching).
                fetch_entity("/api/connector/v1/companies/getAll", "Ids", all_company_ids, "Companies"),
                fetch_entity("/api/connector/v1/resources/getAll", "ResourceIds", resource_ids, "Resources"),
                fetch_entity("/api/connector/v1/resourceCategories/getAll", "ResourceCategoryIds", category_ids, "ResourceCategories"),
                fetch_entity("/api/connector/v1/rates/getAll", "RateIds", rate_ids, "Rates"),
                fetch_entity("/api/connector/v1/reservationGroups/getAll", "ReservationGroupIds", group_ids, "ReservationGroups")
            )

            mapped_data = []

            def get_date(utc_str):
                if not utc_str: return ""
                return utc_str.replace("T", " ")[:19]

            for res_item in reservations:
                c = customers_dict.get(res_item.get("AccountId"), {})
                b = customers_dict.get(res_item.get("BookerId"), {})
                res = resources_dict.get(res_item.get("AssignedResourceId"), {})
                cat = categories_dict.get(res_item.get("RequestedCategoryId"), {})
                comp = companies_dict.get(res_item.get("CompanyId"), {})
                ta = companies_dict.get(res_item.get("TravelAgencyId"), {})
                grp = groups_dict.get(res_item.get("ReservationGroupId"), {})
                rate = rates_dict.get(res_item.get("RateId"), {})

                start = res_item.get("StartUtc")
                end = res_item.get("EndUtc")
                nights = ""
                if start and end:
                    try:
                        s_date = datetime.fromisoformat(start.replace("Z", "+00:00"))
                        e_date = datetime.fromisoformat(end.replace("Z", "+00:00"))
                        nights = (e_date - s_date).days
                    except:
                        pass
                        
                p_counts = res_item.get("PersonCounts") or []
                total_persons = sum(pc.get("Count", 0) for pc in p_counts)

                row = {
                    "Number": res_item.get("Number", ""),
                    "Status": {"Started": "Checked in", "Processed": "Checked out"}.get(res_item.get("State"), res_item.get("State", "")),
                    "Arrival": get_date(res_item.get("StartUtc")),
                    "Departure": get_date(res_item.get("EndUtc")),
                    "Last name": c.get("LastName", ""),
                    "First name": c.get("FirstName", ""),
                    "Email": c.get("Email", ""),
                    "Telephone": c.get("Phone", ""),
                    "Group name": grp.get("Name", ""),
                    "Address": c.get("Address", {}).get("Line1", "") if isinstance(c.get("Address"), dict) else "",
                    "Customer nationality": c.get("NationalityCode", ""),
                    "Send marketing emails": "", 
                    "Booker": f'{b.get("FirstName", "")} {b.get("LastName", "")}'.strip(),
                    "Creator": res_item.get("CreatorProfileId", ""),
                    "Created": get_date(res_item.get("CreatedUtc")),
                    "Release": get_date(res_item.get("ReleasedUtc")),
                    "Confirmed": get_date(res_item.get("UpdatedUtc")), 
                    "Canceled": get_date(res_item.get("CancelledUtc")),
                    "Count (nights)": nights,
                    "Person count": total_persons,
                    "Count (bed, nightly)": "",
                    "Requested category": cat.get("Name", ""),
                    "Space category": "", 
                    "Space number": res.get("Name", ""),
                    "Origin": res_item.get("Origin", ""),
                    "Channel manager ID": res_item.get("ChannelManagerId", ""),
                    "Group channel manager ID": "",
                    "Group channel confirmation number": "",
                    "Travel agency confirmation number": "",
                    "Segment": res_item.get("BusinessSegmentId", ""),
                    "Rate": rate.get("Name", ""),
                    "Voucher": res_item.get("VoucherId", ""),
                    "Products": "",
                    "Company": comp.get("Name", ""),
                    "Travel agency": ta.get("Name", ""),
                    "Average rate (nightly)": "",
                    "Total amount": res_item.get("RequestedPaymentAmount", {}).get("Value", "") if isinstance(res_item.get("RequestedPaymentAmount"), dict) else "",
                    "Canceled cost": "",
                    "Commission": "",
                    "Customer cost": "",
                    "Balance of companions": "",
                    "Payment card type": "",
                    "Payment card number": "",
                    "Expiration": "",
                    "Automatic payment": "",
                    "Bills": "",
                    "Cancellation reason": res_item.get("CancellationReason", ""),
                    "Notes": res_item.get("Notes", ""),
                    "Customer notes": "", 
                    "Customer classifications": "",
                    "Pricing classification": "",
                    "Booking purpose": "",
                    "Reservation source": res_item.get("Origin", ""),
                    "Identifier": res_item.get("Id", ""),
                    "Company Identifier": res_item.get("CompanyId", ""),
                    "Travel agency Identifier": res_item.get("TravelAgencyId", ""),
                    "Reservation origin details": res_item.get("OriginDetails", ""),
                    "Restoration reason": ""
                }
                mapped_data.append(row)

            return {
                "data": mapped_data,
                "cursor": return_cursor
            }
        except Exception as e:
            logger.error(f"Error mapping reservations for {property_name}: {str(e)}")
            raise e

    async def get_mapped_members(self, property_name: str, start_date: str = None, end_date: str = None):
        """
        Fetch members (customers) directly from MEWS customers/getAll API
        using UpdatedUtc date range filter.
        """
        try:
            if not start_date or not end_date:
                # Default to Yesterday 00:01:00 to 23:59:59 (Asia/Bangkok time), exported as UTC for Mews API
                bkk_tz = ZoneInfo("Asia/Bangkok")
                now_bkk = datetime.now(bkk_tz)
                yesterday_bkk = now_bkk - timedelta(days=1)
                
                if not start_date:
                    start_dt = yesterday_bkk.replace(hour=0, minute=0, second=0, microsecond=0)
                    start_date = start_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                if not end_date:
                    end_dt = yesterday_bkk.replace(hour=23, minute=59, second=59, microsecond=999999)
                    end_date = end_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

            # Fetch customers directly using UpdatedUtc date filter with pagination
            all_customers = []
            current_cursor = None
            chunk_size = 500

            while True:
                cust_payload = {
                    "UpdatedUtc": {
                        "StartUtc": start_date,
                        "EndUtc": end_date
                    },
                    "Extent": {
                        "Customers": True,
                        "Documents": False,
                        "Addresses": False
                    },
                    "ActivityStates": ["Active"],
                    "Limitation": {"Count": chunk_size}
                }
                if current_cursor:
                    cust_payload["Limitation"]["Cursor"] = current_cursor

                cust_res = await mews_client.post(
                    "/api/connector/v1/customers/getAll",
                    cust_payload,
                    property_name=property_name
                )
                chunk = cust_res.get("Customers", [])
                current_cursor = cust_res.get("Cursor")
                all_customers.extend(chunk)

                if not current_cursor or not chunk:
                    break

            mapped_members = []
            for cust in all_customers:
                mapped_members.append({
                    "Number": cust.get("Number", ""),
                    "Title": cust.get("Title", ""),
                    "Last Name": cust.get("LastName", ""),
                    "First Name": cust.get("FirstName", ""),
                    "Second Last Name": cust.get("SecondLastName", ""),
                    "Nationality": cust.get("NationalityCode", ""),
                    "Preferred Language": cust.get("PreferredLanguageCode", ""),
                    "Language": cust.get("LanguageCode", ""),
                    "Birth Date": cust.get("BirthDate", ""),
                    "Birth Place": cust.get("BirthPlace", ""),
                    "Occupation": cust.get("Occupation", ""),
                    "Email": cust.get("Email", ""),
                    "Phone": cust.get("Phone", ""),
                    "Tax ID": cust.get("TaxIdentificationNumber", ""),
                    "Loyalty Code": cust.get("LoyaltyCode", ""),
                    "Accounting Code": cust.get("AccountingCode", ""),
                    "Billing Code": cust.get("BillingCode", ""),
                    "Car Registration": cust.get("CarRegistrationNumber", ""),
                    "Dietary": cust.get("DietaryRequirements", ""),
                    "Notes": cust.get("Notes", ""),
                    "Created": cust.get("CreatedUtc", ""),
                    "Updated": cust.get("UpdatedUtc", ""),
                    "Active": cust.get("IsActive", True),
                    "Classifications": ", ".join(cust.get("Classifications", [])) if cust.get("Classifications") else "",
                    "Options": ", ".join(cust.get("Options", [])) if cust.get("Options") else "",
                    "Identifier": cust.get("Id", ""),
                    "mews_id": cust.get("Id", "")  # Keep for compatibility
                })

            return mapped_members
        except Exception as e:
            logger.error(f"Error mapping members for {property_name}: {str(e)}")
            raise e

    async def get_mapped_resources(self, property_name: str, start_date: str = None, end_date: str = None):
        """
        Fetch resources (rooms/spaces) directly from MEWS resources/getAll API
        using UpdatedUtc date range filter, same pattern as get_mapped_members.
        """
        try:
            if not start_date or not end_date:
                bkk_tz = ZoneInfo("Asia/Bangkok")
                now_bkk = datetime.now(bkk_tz)
                yesterday_bkk = now_bkk - timedelta(days=1)

                if not start_date:
                    start_dt = yesterday_bkk.replace(hour=0, minute=0, second=0, microsecond=0)
                    start_date = start_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                if not end_date:
                    end_dt = yesterday_bkk.replace(hour=23, minute=59, second=59, microsecond=999999)
                    end_date = end_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

            all_resources = []
            current_cursor = None
            chunk_size = 500

            while True:
                res_payload = {
                    "UpdatedUtc": {
                        "StartUtc": start_date,
                        "EndUtc": end_date
                    },
                    "Extent": {"Resources": True},
                    "Limitation": {"Count": chunk_size}
                }
                if current_cursor:
                    res_payload["Limitation"]["Cursor"] = current_cursor

                res_res = await mews_client.post(
                    "/api/connector/v1/resources/getAll",
                    res_payload,
                    property_name=property_name
                )
                chunk = res_res.get("Resources", [])
                current_cursor = res_res.get("Cursor")
                all_resources.extend(chunk)

                if not current_cursor or not chunk:
                    break

            mapped_resources = []
            for res in all_resources:
                data_obj = res.get("Data") or {}
                mapped_resources.append({
                    "Name": res.get("Name", ""),
                    "State": res.get("State", ""),
                    "Active": res.get("IsActive", True),
                    "Parent Resource Id": res.get("ParentResourceId", ""),
                    "Floor Number": data_obj.get("FloorNumber", ""),
                    "Location Notes": data_obj.get("LocationNotes", ""),
                    "Created": res.get("CreatedUtc", ""),
                    "Updated": res.get("UpdatedUtc", ""),
                    "Identifier": res.get("Id", ""),
                    "mews_id": res.get("Id", "")
                })

            return mapped_resources
        except Exception as e:
            logger.error(f"Error mapping resources for {property_name}: {str(e)}")
            raise e

    async def get_mapped_payments(self, property_name: str, start_date: str = None, end_date: str = None):
        """
        Fetch payments (with Cursor pagination) and map all columns.
        """
        try:
            if not start_date or not end_date:
                bkk_tz = ZoneInfo("Asia/Bangkok")
                now_bkk = datetime.now(bkk_tz)
                yesterday_bkk = now_bkk - timedelta(days=1)

                if not start_date:
                    start_dt = yesterday_bkk.replace(hour=0, minute=0, second=0, microsecond=0)
                    start_date = start_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                if not end_date:
                    end_dt = yesterday_bkk.replace(hour=23, minute=59, second=59, microsecond=999999)
                    end_date = end_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

            chunk_size = 1000
            all_payments = []
            current_cursor = None

            while True:
                payload = {
                    "CreatedUtc": {
                        "StartUtc": start_date,
                        "EndUtc": end_date
                    },
                    "Limitation": {"Count": chunk_size}
                }
                if current_cursor:
                    payload["Limitation"]["Cursor"] = current_cursor

                response = await mews_client.post("/api/connector/v1/payments/getAll", payload, property_name=property_name)
                chunk = response.get("Payments", [])
                current_cursor = response.get("Cursor")
                all_payments.extend(chunk)

                if not current_cursor or not chunk:
                    break

            mapped_payments = []
            for pay in all_payments:
                amount = pay.get("Amount") or {}
                orig = pay.get("OriginalAmount") or {}
                mapped_payments.append({
                    "mews_id": pay["Id"],
                    "Amount": amount.get("GrossValue", amount.get("NetValue")),
                    "Currency": amount.get("Currency"),
                    "Original Amount": orig.get("GrossValue", orig.get("NetValue")),
                    "Status": pay.get("State"),
                    "Type": pay.get("Type"),
                    "Kind": pay.get("Kind"),
                    "Number": pay.get("Number"),
                    "Processed At": pay.get("CreatedUtc"),
                    "Charged At": pay.get("ChargedUtc"),
                    "Identifier": pay.get("Identifier") or pay.get("Id"),
                    "Receipt Identifier": pay.get("ReceiptIdentifier"),
                    "Bill Id": pay.get("BillId"),
                    "Account Id": pay.get("AccountId"),
                    "Notes": pay.get("Notes"),
                })
            return mapped_payments
        except Exception as e:
            logger.error(f"Error mapping payments for {property_name}: {str(e)}")
            raise e

    @staticmethod
    def _split_date_windows(start_date: str, end_date: str, max_days: int = 89):
        """
        MEWS date-range filters (IssuedUtc, CreatedUtc, etc.) are capped at ~3 months per call.
        Split a wider range into consecutive windows so callers can loop over them.
        """
        start_dt = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        windows = []
        cur = start_dt
        while cur < end_dt:
            window_end = min(cur + timedelta(days=max_days), end_dt)
            windows.append((
                cur.strftime("%Y-%m-%dT%H:%M:%SZ"),
                window_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            ))
            cur = window_end
        return windows or [(start_date, end_date)]

    @staticmethod
    def _extract_owner_name(owner_data: dict) -> str:
        wrapper = owner_data or {}
        owner = wrapper.get("Value") or {}
        if wrapper.get("Discriminator") == "BillCompanyData":
            return owner.get("Name") or ""
        return " ".join(filter(None, [
            owner.get("TitlePrefix"), owner.get("FirstName"),
            owner.get("SecondLastName"), owner.get("LastName")
        ]))

    @staticmethod
    def _extract_owner_address(owner_data: dict) -> dict:
        """
        Shared by get_mapped_bills_with_items (archived for the Data Mart) and
        get_bill_invoice (live print path) so a cached bill has everything
        needed to print without re-fetching from MEWS.
        """
        wrapper = owner_data or {}
        owner = wrapper.get("Value") or {}
        address = owner.get("Address") or {}
        legal = owner.get("LegalIdentifiers") or {}
        tax_id = legal.get("TaxIdentifier") or owner.get("TaxIdentifier") or ""
        address_lines = [l for l in [
            address.get("Line1"),
            address.get("Line2"),
            ", ".join(filter(None, [address.get("City"), address.get("SubdivisionCode")])),
            address.get("CountryCode"),
        ] if l]
        return {
            "address_lines": address_lines,
            "post_code": address.get("PostalCode") or "",
            "tax_id": tax_id,
        }

    async def get_mapped_bills_with_items(self, property_name: str, start_date: str = None, end_date: str = None):
        """
        Full Bill + Order Item archive for the Data Mart (unlike get_mapped_bills,
        which is header-only for the fast list view). For each bill in the date
        range, fetches its order items in bulk via BillIds (chunked to <=1000 ids
        per MEWS's limit) rather than one-by-one, to avoid N+1 calls across what
        can be thousands of bills for a wide date range.
        """
        try:
            if not start_date or not end_date:
                bkk_tz = ZoneInfo("Asia/Bangkok")
                now_bkk = datetime.now(bkk_tz)
                yesterday_bkk = now_bkk - timedelta(days=1)
                if not start_date:
                    start_dt = yesterday_bkk.replace(hour=0, minute=0, second=0, microsecond=0)
                    start_date = start_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                if not end_date:
                    end_dt = yesterday_bkk.replace(hour=23, minute=59, second=59, microsecond=999999)
                    end_date = end_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

            all_bills = []
            for window_start, window_end in self._split_date_windows(start_date, end_date):
                current_cursor = None
                while True:
                    payload = {
                        "IssuedUtc": {"StartUtc": window_start, "EndUtc": window_end},
                        "Limitation": {"Count": 1000}
                    }
                    if current_cursor:
                        payload["Limitation"]["Cursor"] = current_cursor

                    response = await mews_client.post("/api/connector/v1/bills/getAll", payload, property_name=property_name)
                    chunk = response.get("Bills", [])
                    current_cursor = response.get("Cursor")
                    all_bills.extend(chunk)

                    if not current_cursor or not chunk:
                        break

            order_items_by_bill = {}
            bill_ids = [b.get("Id") for b in all_bills if b.get("Id")]
            for i in range(0, len(bill_ids), 1000):
                id_batch = bill_ids[i:i + 1000]
                current_cursor = None
                while True:
                    item_payload = {"BillIds": id_batch, "Limitation": {"Count": 1000}}
                    if current_cursor:
                        item_payload["Limitation"]["Cursor"] = current_cursor

                    item_res = await mews_client.post("/api/connector/v1/orderItems/getAll", item_payload, property_name=property_name)
                    item_chunk = item_res.get("OrderItems", [])
                    current_cursor = item_res.get("Cursor")

                    for item in item_chunk:
                        bill_id_ref = item.get("BillId")
                        if not bill_id_ref:
                            continue
                        amt = item.get("Amount") or {}
                        order_items_by_bill.setdefault(bill_id_ref, []).append({
                            "Name": item.get("BillingName") or item.get("Type") or "",
                            "Type": item.get("Type"),
                            "Amount": amt.get("GrossValue"),
                            "Net Amount": amt.get("NetValue"),
                            "Currency": amt.get("Currency"),
                            # Per-tax-rate breakdown ([{Code, Value}]) so invoices can
                            # split VAT 7% from Provincial Tax 1% instead of lumping
                            # them into one blended rate.
                            "Tax Values": amt.get("TaxValues") or [],
                        })

                    if not current_cursor or not item_chunk:
                        break

            mapped = []
            for b in all_bills:
                bill_id = b.get("Id")
                owner_address = self._extract_owner_address(b.get("OwnerData"))
                mapped.append({
                    "mews_id": bill_id,
                    "Number": b.get("Number"),
                    "Type": b.get("Type"),
                    "State": b.get("State"),
                    "Owner Name": self._extract_owner_name(b.get("OwnerData")),
                    "Address Lines": owner_address["address_lines"],
                    "Post Code": owner_address["post_code"],
                    "Tax Id": owner_address["tax_id"],
                    "Issued At": b.get("IssuedUtc"),
                    "Due At": b.get("DueUtc"),
                    "Paid At": b.get("PaidUtc"),
                    "Notes": b.get("Notes"),
                    "Order Items": order_items_by_bill.get(bill_id, []),
                })
            return mapped
        except Exception as e:
            logger.error(f"Error mapping bills with items for {property_name}: {str(e)}")
            raise e

    async def get_bill_invoice(self, property_name: str, bill_id: str):
        """
        Build the full itemized invoice payload for a single bill: header, guest/company
        address, line items (order items), computed VAT/subtotal/total, Thai baht-text,
        and a best-effort payment-method match — shaped to populate the
        "FullTAXInvoice LubdKohTao-TP" template placeholders.

        Checks bills_sync (Data Mart) first: a backfilled bill already has the
        header/owner/order-items, so this skips the two heaviest live MEWS calls
        (bills/getAll, orderItems/getAll) for anything already synced - only
        payment method is always fetched live, since the payments Data Mart table
        doesn't store a queryable Bill Id. Falls back to a full live fetch if the
        bill isn't cached, or the cached row predates the Address/Tax Id fields.
        """
        try:
            cached = None
            if self.supabase:
                try:
                    cache_res = self.supabase.table("bills_sync").select("data").eq("mews_id", bill_id).limit(1).execute()
                    if cache_res.data:
                        cached = encryption_service.decrypt_data(cache_res.data[0]["data"])
                except Exception as cache_err:
                    logger.warning(f"bills_sync cache lookup failed for {bill_id}: {cache_err}")

            rows = []
            if cached and "Address Lines" in cached and "Order Items" in cached:
                owner_name = cached.get("Owner Name") or ""
                address_lines = cached.get("Address Lines") or []
                post_code = cached.get("Post Code") or ""
                tax_id = cached.get("Tax Id") or ""
                number = cached.get("Number")
                bill_type = cached.get("Type")
                state = cached.get("State")
                issued_at = cached.get("Issued At")
                due_at = cached.get("Due At")
                for it in cached.get("Order Items") or []:
                    gross = it.get("Amount") or 0
                    net = it.get("Net Amount") or 0
                    rows.append({"name": it.get("Name") or "Item", "gross": gross, "net": net, "tax": gross - net,
                                 "tax_values": it.get("Tax Values") or []})
            else:
                bill_res = await mews_client.post(
                    "/api/connector/v1/bills/getAll",
                    {"BillIds": [bill_id], "Limitation": {"Count": 1}},
                    property_name=property_name
                )
                bills = bill_res.get("Bills", [])
                if not bills:
                    raise Exception("Bill not found")
                bill = bills[0]

                items = []
                current_cursor = None
                while True:
                    payload = {"BillIds": [bill_id], "Limitation": {"Count": 1000}}
                    if current_cursor:
                        payload["Limitation"]["Cursor"] = current_cursor
                    item_res = await mews_client.post("/api/connector/v1/orderItems/getAll", payload, property_name=property_name)
                    chunk = item_res.get("OrderItems", [])
                    current_cursor = item_res.get("Cursor")
                    items.extend(chunk)
                    if not current_cursor or not chunk:
                        break

                owner_wrapper = bill.get("OwnerData") or {}
                owner_name = self._extract_owner_name(owner_wrapper)
                owner_address = self._extract_owner_address(owner_wrapper)
                address_lines = owner_address["address_lines"]
                post_code = owner_address["post_code"]
                tax_id = owner_address["tax_id"]
                number = bill.get("Number")
                bill_type = bill.get("Type")
                state = bill.get("State")
                issued_at = bill.get("IssuedUtc")
                due_at = bill.get("DueUtc")

                for it in items:
                    amt = it.get("Amount") or {}
                    gross = amt.get("GrossValue") or 0
                    net = amt.get("NetValue") or 0
                    rows.append({
                        "name": it.get("BillingName") or it.get("Type") or "Item",
                        "gross": gross,
                        "net": net,
                        "tax": gross - net,
                        "tax_values": amt.get("TaxValues") or [],
                    })

            pay_res = await mews_client.post(
                "/api/connector/v1/payments/getAll",
                {"BillIds": [bill_id], "Limitation": {"Count": 100}},
                property_name=property_name
            )
            payments = pay_res.get("Payments", [])

            computed = self._compute_invoice_amounts(rows, payments)

            return {
                "mews_id": bill_id,
                "number": number,
                "type": bill_type,
                "state": state,
                "issued_at": issued_at,
                "due_at": due_at,
                "owner_name": owner_name,
                "address_lines": address_lines,
                "post_code": post_code,
                "tax_id": tax_id,
                **computed,
            }
        except Exception as e:
            logger.error(f"Error building bill invoice for {bill_id}: {str(e)}")
            raise e

    @staticmethod
    def _split_item_taxes(row: dict) -> tuple:
        """
        Returns (vat, other_tax) for one order-item row. Thai invoices must show
        VAT at its statutory 7% - MEWS items on room revenue also carry a 1%
        Provincial Tax, and lumping both into "VAT" yields a bogus blended rate
        (e.g. 7.64%). Prefers the item's MEWS TaxValues breakdown; older
        bills_sync rows predate "Tax Values", so those fall back to assuming the
        portion above 7% of net is the provincial tax.
        """
        net = row.get("net") or 0
        tax = row.get("tax") or 0
        tax_values = row.get("tax_values") or []
        if tax_values and net:
            # A tax entry well below the 7% band (e.g. 1% provincial) is "other";
            # vat is the remainder so the pair always reconciles with gross - net.
            other = sum((tv.get("Value") or 0) for tv in tax_values
                        if ((tv.get("Value") or 0) / net) < 0.055)
            return tax - other, other
        if net and (tax / net) > 0.075:
            vat = net * 0.07
            return vat, tax - vat
        return tax, 0.0

    @staticmethod
    def _compute_invoice_amounts(rows: list, payments: list) -> dict:
        """
        Shared by get_bill_invoice (single) and get_bill_invoices_batch (batch):
        turns raw order-item rows + payment records into the invoice's computed
        fields (5-row line items with >5 bundled into "Other charges", VAT 7% /
        Provincial Tax 1% breakdown, Thai baht-text, and a best-effort
        payment-method match).
        """
        rows = list(rows)
        for r in rows:
            r["vat_part"], r["other_part"] = SyncService._split_item_taxes(r)
        if len(rows) > 5:
            head, tail = rows[:4], rows[4:]
            rows = head + [{
                "name": f"Other charges ({len(tail)} items)",
                "gross": sum(r["gross"] for r in tail),
                "net": sum(r["net"] for r in tail),
                "tax": sum(r["tax"] for r in tail),
                "vat_part": sum(r["vat_part"] for r in tail),
                "other_part": sum(r["other_part"] for r in tail),
            }]

        sub_total = round(sum(r["net"] for r in rows), 2)
        total_tax = sum(r["tax"] for r in rows)
        provincial_tax = round(sum(r["other_part"] for r in rows), 2)
        # Total first, then VAT as the remainder, so rounding can never leave
        # SubTotal + VAT + Provincial != Total on the printed invoice.
        net_amount = round(sub_total + total_tax, 2)
        vat_total = round(net_amount - sub_total - provincial_tax, 2)
        # Thai statutory VAT - fixed label, not back-computed from the amounts.
        vat_rate_pct = 7

        line_items = []
        for i in range(5):
            if i < len(rows):
                # Mirror MEWS's per-item tax sub-line: items carrying provincial
                # tax say so in the description (amount column stays gross).
                desc = rows[i]["name"]
                if rows[i]["other_part"] > 0.005:
                    desc = f"{desc} (Provincial Tax 1%: {rows[i]['other_part']:,.2f})"
                line_items.append({"no": i + 1, "description": desc, "amount": round(rows[i]["gross"], 2)})
            else:
                line_items.append({"no": "", "description": "", "amount": ""})

        method = {"cash": False, "card": False, "bank_transfer": False, "cheque": False}
        bank_transfer_ref = ""
        bank_transfer_date = ""
        cheque = {"bank_name": "", "branch": "", "number": "", "date": ""}
        for p in payments:
            ptype = (p.get("Type") or "").lower()
            pkind = (p.get("Kind") or "").lower()
            if "cash" in ptype or "cash" in pkind:
                method["cash"] = True
            elif "card" in ptype or "card" in pkind:
                method["card"] = True
            elif "transfer" in ptype or "transfer" in pkind:
                method["bank_transfer"] = True
                bank_transfer_ref = p.get("Identifier") or ""
                bank_transfer_date = p.get("ChargedUtc") or p.get("CreatedUtc") or ""
            elif "cheque" in ptype or "check" in ptype or "cheque" in pkind:
                method["cheque"] = True
                cheque["number"] = p.get("Number") or ""
                cheque["date"] = p.get("ChargedUtc") or ""

        return {
            "line_items": line_items,
            "sub_total": sub_total,
            "vat_rate_pct": vat_rate_pct,
            "vat": vat_total,
            "provincial_tax_rate_pct": 1,
            "provincial_tax": provincial_tax,
            "net_amount": net_amount,
            "baht_text": bahttext(net_amount),
            "payment_method": method,
            "bank_transfer_ref": bank_transfer_ref,
            "bank_transfer_date": bank_transfer_date,
            "cheque": cheque,
        }

    @staticmethod
    def compute_bill_totals(order_items: list) -> dict:
        """
        Net/VAT/Total for the Bill Generator list view (a lightweight summary,
        not the full itemized invoice) - reuses _compute_invoice_amounts' same
        VAT-7%/Provincial-Tax-1% split so these numbers always agree with what
        print-bill would show for the same bill. "Net Amount" is the pre-tax
        subtotal and "Total Amount" is the grand total, matching the labels
        _compute_invoice_amounts itself uses for sub_total/net_amount (a naming
        holdover from the Thai invoice template, where "Net Amount" labels the
        subtotal row and the token <<NetAmount>> is actually the grand total).
        """
        rows = []
        for it in order_items or []:
            gross = it.get("Amount") or 0
            net = it.get("Net Amount") or 0
            rows.append({
                "name": it.get("Name") or "Item", "gross": gross, "net": net, "tax": gross - net,
                "tax_values": it.get("Tax Values") or [],
            })
        computed = SyncService._compute_invoice_amounts(rows, [])
        return {
            "Net Amount": computed["sub_total"],
            "VAT": computed["vat"],
            "Total Amount": computed["net_amount"],
        }

    async def get_bill_invoices_batch(self, property_name: str, bill_ids: list) -> dict:
        """
        Same invoice-building logic as get_bill_invoice, but for many bills at
        once: one bills_sync cache lookup (IN query) instead of N, one live
        bills/getAll + orderItems/getAll pair for whatever isn't cached (BillIds
        batch, matching get_mapped_bills_with_items's pattern) instead of N live
        pairs, and one payments/getAll call for the whole batch instead of N -
        this is what makes multi-print meaningfully faster than printing each
        bill individually through get_bill_invoice in a loop.

        Returns {bill_id: invoice_dict} for every bill that was found; ids that
        don't exist or fail to resolve are simply omitted from the result.
        """
        try:
            seen = set()
            bill_ids = [b for b in bill_ids if b and not (b in seen or seen.add(b))]
            if not bill_ids:
                return {}

            headers = {}

            if self.supabase:
                try:
                    cache_res = self.supabase.table("bills_sync").select("mews_id, data").in_("mews_id", bill_ids).execute()
                    for r in cache_res.data or []:
                        decrypted = encryption_service.decrypt_data(r["data"])
                        if "Address Lines" not in decrypted or "Order Items" not in decrypted:
                            continue
                        rows = []
                        for it in decrypted.get("Order Items") or []:
                            gross = it.get("Amount") or 0
                            net = it.get("Net Amount") or 0
                            rows.append({"name": it.get("Name") or "Item", "gross": gross, "net": net, "tax": gross - net,
                                         "tax_values": it.get("Tax Values") or []})
                        headers[r["mews_id"]] = {
                            "owner_name": decrypted.get("Owner Name") or "",
                            "address_lines": decrypted.get("Address Lines") or [],
                            "post_code": decrypted.get("Post Code") or "",
                            "tax_id": decrypted.get("Tax Id") or "",
                            "number": decrypted.get("Number"),
                            "type": decrypted.get("Type"),
                            "state": decrypted.get("State"),
                            "issued_at": decrypted.get("Issued At"),
                            "due_at": decrypted.get("Due At"),
                            "rows": rows,
                        }
                except Exception as cache_err:
                    logger.warning(f"bills_sync batch cache lookup failed: {cache_err}")

            missing_ids = [b for b in bill_ids if b not in headers]
            if missing_ids:
                bills_by_id = {}
                for i in range(0, len(missing_ids), 1000):
                    id_batch = missing_ids[i:i + 1000]
                    current_cursor = None
                    while True:
                        payload = {"BillIds": id_batch, "Limitation": {"Count": 1000}}
                        if current_cursor:
                            payload["Limitation"]["Cursor"] = current_cursor
                        res = await mews_client.post("/api/connector/v1/bills/getAll", payload, property_name=property_name)
                        chunk = res.get("Bills", [])
                        current_cursor = res.get("Cursor")
                        for b in chunk:
                            bills_by_id[b.get("Id")] = b
                        if not current_cursor or not chunk:
                            break

                items_by_bill = {}
                for i in range(0, len(missing_ids), 1000):
                    id_batch = missing_ids[i:i + 1000]
                    current_cursor = None
                    while True:
                        payload = {"BillIds": id_batch, "Limitation": {"Count": 1000}}
                        if current_cursor:
                            payload["Limitation"]["Cursor"] = current_cursor
                        res = await mews_client.post("/api/connector/v1/orderItems/getAll", payload, property_name=property_name)
                        chunk = res.get("OrderItems", [])
                        current_cursor = res.get("Cursor")
                        for item in chunk:
                            bref = item.get("BillId")
                            if not bref:
                                continue
                            amt = item.get("Amount") or {}
                            gross = amt.get("GrossValue") or 0
                            net = amt.get("NetValue") or 0
                            items_by_bill.setdefault(bref, []).append({
                                "name": item.get("BillingName") or item.get("Type") or "Item",
                                "gross": gross,
                                "net": net,
                                "tax": gross - net,
                                "tax_values": amt.get("TaxValues") or [],
                            })
                        if not current_cursor or not chunk:
                            break

                for bid, bill in bills_by_id.items():
                    owner_wrapper = bill.get("OwnerData") or {}
                    owner_address = self._extract_owner_address(owner_wrapper)
                    headers[bid] = {
                        "owner_name": self._extract_owner_name(owner_wrapper),
                        "address_lines": owner_address["address_lines"],
                        "post_code": owner_address["post_code"],
                        "tax_id": owner_address["tax_id"],
                        "number": bill.get("Number"),
                        "type": bill.get("Type"),
                        "state": bill.get("State"),
                        "issued_at": bill.get("IssuedUtc"),
                        "due_at": bill.get("DueUtc"),
                        "rows": items_by_bill.get(bid, []),
                    }

            found_ids = [b for b in bill_ids if b in headers]
            if not found_ids:
                return {}

            payments_by_bill = {}
            for i in range(0, len(found_ids), 1000):
                id_batch = found_ids[i:i + 1000]
                current_cursor = None
                while True:
                    payload = {"BillIds": id_batch, "Limitation": {"Count": 1000}}
                    if current_cursor:
                        payload["Limitation"]["Cursor"] = current_cursor
                    res = await mews_client.post("/api/connector/v1/payments/getAll", payload, property_name=property_name)
                    chunk = res.get("Payments", [])
                    current_cursor = res.get("Cursor")
                    for p in chunk:
                        bref = p.get("BillId")
                        if bref:
                            payments_by_bill.setdefault(bref, []).append(p)
                    if not current_cursor or not chunk:
                        break

            results = {}
            for bid in found_ids:
                h = headers[bid]
                computed = self._compute_invoice_amounts(h["rows"], payments_by_bill.get(bid, []))
                results[bid] = {
                    "mews_id": bid,
                    "number": h["number"],
                    "type": h["type"],
                    "state": h["state"],
                    "issued_at": h["issued_at"],
                    "due_at": h["due_at"],
                    "owner_name": h["owner_name"],
                    "address_lines": h["address_lines"],
                    "post_code": h["post_code"],
                    "tax_id": h["tax_id"],
                    **computed,
                }
            return results
        except Exception as e:
            logger.error(f"Error building batch bill invoices for {property_name}: {str(e)}")
            raise e

    async def get_bill_pdf(self, property_name: str, bill_id: str, pdf_template: str = None,
                            print_reason: str = None, bill_print_event_id: str = None):
        """
        Calls MEWS bills/getPdf to get MEWS's own generated PDF for a bill (as an
        alternative to our custom Thai tax invoice template). Per MEWS docs, the
        response is either the ready PDF (Discriminator "BillPdfFile") or a pending
        event (Discriminator "BillPrintEvent") that should be retried with the same
        BillPrintEventId to avoid consuming additional print-event quota. We retry
        briefly server-side; if still pending after that, we hand the event id back
        to the caller so a later request can resume it.
        """
        try:
            payload: dict = {"BillId": bill_id}
            if pdf_template:
                payload["PdfTemplate"] = pdf_template
            if print_reason:
                payload["PrintReason"] = print_reason

            max_attempts = 4
            wait_seconds = 2
            event_id = bill_print_event_id

            for attempt in range(max_attempts):
                if event_id:
                    payload["BillPrintEventId"] = event_id

                response = await mews_client.post("/api/connector/v1/bills/getPdf", payload, property_name=property_name)
                result = response.get("Result") or {}
                discriminator = result.get("Discriminator")
                value = result.get("Value") or {}

                if discriminator == "BillPdfFile":
                    return {"ready": True, "base64": value.get("Base64Data")}

                event_id = value.get("BillPrintEventId") or event_id
                if attempt < max_attempts - 1:
                    await asyncio.sleep(wait_seconds)

            return {"ready": False, "event_id": event_id}
        except Exception as e:
            logger.error(f"Error fetching bill PDF for {bill_id}: {str(e)}")
            raise e

    async def get_rr3_cards(self, property_name: str, start_date: str = None, end_date: str = None):
        """
        Builds Thai Hotel Act RR3 (ร.ร.๓) lodger registration cards by joining
        Reservations + Customers + Resources for a date range - a direct port of
        the user's existing, proven Google Apps Script: same request shape (the
        older, un-versioned reservations/getAll with top-level StartUtc/EndUtc +
        Extent, CustomerId/CompanionIds fields - deliberately NOT the newer
        /getAll/2023-06-06 + AccountId shape get_mapped_reservations uses, since
        that variant doesn't support Extent-embedded Customers/Resources), same
        client-side re-filter by StartUtc, and same field fallback logic.
        """
        try:
            if not start_date or not end_date:
                now_utc = datetime.now(timezone.utc)
                yesterday_utc = now_utc - timedelta(days=1)
                if not start_date:
                    start_date = yesterday_utc.strftime("%Y-%m-%dT00:00:00Z")
                if not end_date:
                    end_date = now_utc.strftime("%Y-%m-%dT23:59:59Z")

            payload = {
                "StartUtc": start_date,
                "EndUtc": end_date,
                "Extent": {"Reservations": True, "Customers": True, "Resources": True}
            }
            response = await mews_client.post("/api/connector/v1/reservations/getAll", payload, property_name=property_name)

            wanted_start = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
            wanted_end = datetime.fromisoformat(end_date.replace("Z", "+00:00"))

            def in_range(res):
                start_utc = res.get("StartUtc")
                if not start_utc:
                    return False
                try:
                    t = datetime.fromisoformat(start_utc.replace("Z", "+00:00"))
                except Exception:
                    return False
                return wanted_start <= t <= wanted_end

            reservations = [r for r in response.get("Reservations", []) if in_range(r)]
            customers_map = {c["Id"]: c for c in response.get("Customers", []) if c.get("Id")}
            resources_map = {r["Id"]: r for r in response.get("Resources", []) if r.get("Id")}

            hotel_name = _RR3_PROPERTY_THAI_NAMES.get(property_name, property_name)

            cards = []
            for reservation in reservations:
                companion_ids = reservation.get("CompanionIds") or []
                guest_ids = companion_ids if companion_ids else (
                    [reservation["CustomerId"]] if reservation.get("CustomerId") else []
                )

                for guest_id in guest_ids:
                    customer = customers_map.get(guest_id)
                    if not customer:
                        continue

                    room_number = ""
                    assigned_resource_id = reservation.get("AssignedResourceId")
                    if assigned_resource_id and assigned_resource_id in resources_map:
                        room_number = resources_map[assigned_resource_id].get("Name", "")

                    address = customer.get("Address") or {}
                    line1 = (address.get("Line1") or "").strip()
                    line2 = (address.get("Line2") or "").strip()
                    if line1 or line2:
                        parts = [address.get("Line1"), address.get("Line2"), address.get("City"),
                                 address.get("PostalCode"), address.get("CountryCode")]
                        address_details = " ".join(p for p in parts if p)
                    elif (customer.get("BirthPlace") or "").strip():
                        address_details = customer.get("BirthPlace")
                    else:
                        address_details = _rr3_country_name(customer.get("NationalityCode"))

                    identity_card_value = ""
                    identity_card = customer.get("IdentityCard")
                    identity_cards = customer.get("IdentityCards")
                    if isinstance(identity_card, dict):
                        identity_card_value = identity_card.get("Number", "")
                    elif isinstance(identity_cards, list) and identity_cards:
                        identity_card_value = identity_cards[0].get("Number", "")

                    passport = customer.get("Passport") or {}
                    occupation = customer.get("Occupation") or "นักธุรกิจ"
                    first_name = customer.get("FirstName", "")
                    last_name = customer.get("LastName", "")

                    cards.append({
                        "CardId": f"{reservation.get('Number', '')}::{guest_id}",
                        "ReservationsNumber": reservation.get("Number", ""),
                        "HotelName": hotel_name,
                        "FirstName": first_name,
                        "LastName": last_name,
                        "RoomNumber": room_number,
                        "CheckIn": _rr3_format_thai_date(reservation.get("StartUtc")),
                        "CheckInTime": _rr3_format_thai_time(reservation.get("StartUtc")),
                        "CheckOut": _rr3_format_thai_date(reservation.get("EndUtc")),
                        "CheckOutTime": _rr3_format_thai_time(reservation.get("EndUtc")),
                        "PassportNumber": passport.get("Number", ""),
                        "IdentityCardNumber": identity_card_value,
                        "NationalityCode": customer.get("NationalityCode", ""),
                        "NationalityName": _rr3_country_name(customer.get("NationalityCode")),
                        "AddressDetails": address_details,
                        "Telephone": customer.get("Phone", ""),
                        "Email": customer.get("Email", ""),
                        "Occupation": occupation,
                        "AlienBook": customer.get("IdentityDocumentSupportNumber", ""),
                        "GuestSign": f"{first_name} {last_name}".strip(),
                        "Departure": "",
                        "Destination": "",
                    })

            return cards
        except Exception as e:
            logger.error(f"Error building RR3 cards for {property_name}: {str(e)}")
            raise e

    # ST Files report only counts these category types, matching the source
    # Google Sheet's "Space types: Room, Bed" parameter (verified: Chinatown's
    # Room+Bed categories sum to exactly the sheet's 176 total; Dorm-as-a-whole
    # and Apartment categories are what the sheet excludes).
    _ST_FILES_SPACE_TYPES = ("Room", "Bed")

    async def get_st_files_report(self, property_name: str, date: str):
        """
        Builds the daily "ST Files" occupancy/availability report for one
        property + one Bangkok calendar date, replicating the user's manual
        Google Sheet (tabs: Spaces / Occupied / House uses / Out of order /
        Availability / Customers / Arrivals / Departures).

        `date` is YYYY-MM-DD interpreted as an Asia/Bangkok calendar day.
        All MEWS aggregate numbers come per resource category; the category
        list itself requires the Resource Categories permission on the
        property's Connector token (403s cleanly if MEWS hasn't enabled it).
        """
        bkk = ZoneInfo("Asia/Bangkok")
        day = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=bkk)
        day_start_utc = day.astimezone(timezone.utc)
        day_end_utc = (day + timedelta(days=1)).astimezone(timezone.utc)
        start_iso = day_start_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
        end_iso = day_end_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

        # 1. Resolve the bookable (accommodation) service
        services_res = await mews_client.post(
            "/api/connector/v1/services/getAll",
            {"Limitation": {"Count": 100}},
            property_name=property_name,
        )
        stay = next(
            (s for s in services_res.get("Services", [])
             if (s.get("Data") or {}).get("Discriminator") == "Bookable"),
            None,
        )
        if not stay:
            raise Exception(f"No bookable (accommodation) service found for {property_name}")
        service_id = stay["Id"]

        # 2. Categories (names/short codes/types) - requires ServiceIds filter
        cats_res = await mews_client.post(
            "/api/connector/v1/resourceCategories/getAll",
            {"ServiceIds": [service_id], "Limitation": {"Count": 200}},
            property_name=property_name,
        )
        categories = {}
        for c in cats_res.get("ResourceCategories", []):
            if not c.get("IsActive", True):
                continue
            names = c.get("Names") or {}
            shorts = c.get("ShortNames") or {}
            categories[c["Id"]] = {
                "category_id": c["Id"],
                "short_name": shorts.get("en-US") or shorts.get("en-GB") or next(iter(shorts.values()), ""),
                "name": names.get("en-US") or names.get("en-GB") or next(iter(names.values()), ""),
                "type": c.get("Type", ""),
                "capacity": c.get("Capacity"),
                "ordering": c.get("Ordering", 0),
                "in_report": c.get("Type") in self._ST_FILES_SPACE_TYPES,
            }

        def category_rows(count_by_cat_id):
            rows = []
            for cat_id, cat in categories.items():
                if not cat["in_report"]:
                    continue
                rows.append({
                    "short_name": cat["short_name"],
                    "name": cat["name"],
                    "type": cat["type"],
                    "count": count_by_cat_id.get(cat_id, 0),
                    "_ordering": cat["ordering"],
                })
            rows.sort(key=lambda r: r.pop("_ordering"))
            return rows

        # 3. Availability metrics for the day (2024-01-22 version): occupied /
        #    house use / out of order / active per category
        avail_res = await mews_client.post(
            "/api/connector/v1/services/getAvailability/2024-01-22",
            {
                "ServiceId": service_id,
                "FirstTimeUnitStartUtc": start_iso,
                "LastTimeUnitStartUtc": start_iso,
                "Metrics": ["Occupied", "HouseUse", "OutOfOrderBlocks", "ActiveResources"],
            },
            property_name=property_name,
        )
        metric = {"Occupied": {}, "HouseUse": {}, "OutOfOrderBlocks": {}, "ActiveResources": {}}
        for entry in avail_res.get("ResourceCategoryAvailabilities", []):
            for m in metric:
                values = (entry.get("Metrics") or {}).get(m) or [0]
                metric[m][entry["ResourceCategoryId"]] = values[0]

        # 4. Availability (free-to-sell) from the legacy endpoint - MEWS's own
        #    precomputed number, safer than deriving it from raw metrics
        legacy_res = await mews_client.post(
            "/api/connector/v1/services/getAvailability",
            {
                "ServiceId": service_id,
                "FirstTimeUnitStartUtc": start_iso,
                "LastTimeUnitStartUtc": start_iso,
            },
            property_name=property_name,
        )
        availability_by_cat = {}
        for entry in legacy_res.get("CategoryAvailabilities", []):
            values = entry.get("Availabilities") or [0]
            availability_by_cat[entry.get("CategoryId")] = values[0]

        # 5. Resource blocks colliding with the day (named OOO/House-use rows)
        blocks_res = await mews_client.post(
            "/api/connector/v1/resourceBlocks/getAll",
            {"CollidingUtc": {"StartUtc": start_iso, "EndUtc": end_iso}, "Limitation": {"Count": 500}},
            property_name=property_name,
        )
        blocks = [b for b in blocks_res.get("ResourceBlocks", []) if b.get("IsActive", True)]

        # 6. Reservations colliding with the day + their customers/resources
        #    (same un-versioned Extent-join call get_rr3_cards uses)
        resv_res = await mews_client.post(
            "/api/connector/v1/reservations/getAll",
            {
                "StartUtc": start_iso,
                "EndUtc": end_iso,
                "Extent": {"Reservations": True, "Customers": True, "Resources": True},
            },
            property_name=property_name,
        )
        reservations = resv_res.get("Reservations", [])
        customers_map = {c["Id"]: c for c in resv_res.get("Customers", []) if c.get("Id")}
        resources_map = {r["Id"]: r for r in resv_res.get("Resources", []) if r.get("Id")}

        # Room names for block rows come from the same Resources extent; any
        # blocked room without a reservation that day won't be in the map, so
        # fall back to one resources/getAll only if a block's room is unknown.
        block_resource_ids = {b.get("AssignedResourceId") for b in blocks if b.get("AssignedResourceId")}
        if block_resource_ids - set(resources_map.keys()):
            all_res = await mews_client.post(
                "/api/connector/v1/resources/getAll",
                {"Extent": {"Resources": True}, "Limitation": {"Count": 1000}},
                property_name=property_name,
            )
            for r in all_res.get("Resources", []):
                if r.get("Id"):
                    resources_map.setdefault(r["Id"], r)

        def block_rows(block_type):
            rows = []
            for b in blocks:
                if b.get("Type") != block_type:
                    continue
                room = resources_map.get(b.get("AssignedResourceId"), {})
                rows.append({
                    "room": room.get("Name", ""),
                    "name": b.get("Name", ""),
                    "notes": b.get("Notes") or "",
                    "start_utc": b.get("StartUtc", ""),
                    "end_utc": b.get("EndUtc", ""),
                })
            rows.sort(key=lambda r: r["room"])
            return rows

        def in_window(ts):
            if not ts:
                return False
            try:
                t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except Exception:
                return False
            return day_start_utc <= t < day_end_utc

        active_states = {"Confirmed", "Started", "Processed", "Optional"}

        def reservation_row(res):
            customer = customers_map.get(res.get("CustomerId"), {})
            room = resources_map.get(res.get("AssignedResourceId"), {})
            cat = categories.get(res.get("RequestedCategoryId"), {})
            return {
                "number": res.get("Number", ""),
                "guest": f"{customer.get('FirstName', '')} {customer.get('LastName', '')}".strip(),
                "nationality": customer.get("NationalityCode", ""),
                "room": room.get("Name", ""),
                "category": cat.get("short_name") or cat.get("name", ""),
                "check_in": res.get("StartUtc", ""),
                "check_out": res.get("EndUtc", ""),
                "state": res.get("State", ""),
                "adults": res.get("AdultCount", 0),
                "children": res.get("ChildCount", 0),
            }

        arrivals, departures = [], []
        day_customer_ids = set()
        for res in reservations:
            if res.get("State") not in active_states:
                continue
            if in_window(res.get("StartUtc")):
                arrivals.append(reservation_row(res))
            if in_window(res.get("EndUtc")):
                departures.append(reservation_row(res))
            for cid in ([res.get("CustomerId")] + (res.get("CompanionIds") or [])):
                if cid:
                    day_customer_ids.add(cid)

        customers = []
        for cid in day_customer_ids:
            c = customers_map.get(cid)
            if not c:
                continue
            customers.append({
                "name": f"{c.get('FirstName', '')} {c.get('LastName', '')}".strip(),
                "nationality": c.get("NationalityCode", ""),
                "email": c.get("Email", ""),
                "phone": c.get("Phone", ""),
            })
        customers.sort(key=lambda c: c["name"])
        arrivals.sort(key=lambda r: r["room"] or "zzz")
        departures.sort(key=lambda r: r["room"] or "zzz")

        spaces = category_rows(metric["ActiveResources"])
        report = {
            "parameters": {
                "property": property_name,
                "service": stay.get("Name", ""),
                "date": date,
                "space_types": list(self._ST_FILES_SPACE_TYPES),
                "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            "spaces": spaces,
            "occupied": category_rows(metric["Occupied"]),
            "house_use": category_rows(metric["HouseUse"]),
            "house_use_blocks": block_rows("InternalUse"),
            "out_of_order": category_rows(metric["OutOfOrderBlocks"]),
            "out_of_order_blocks": block_rows("OutOfOrder"),
            "availability": category_rows(availability_by_cat),
            "customers": customers,
            "arrivals": arrivals,
            "departures": departures,
        }
        return report

    # BCP timeline window: how far back/forward from "today" the reservations
    # grid covers. Wide enough to show most stays without blowing up capture
    # time or the encrypted snapshot's payload size.
    _BCP_WINDOW_DAYS_BACK = 7
    _BCP_WINDOW_DAYS_FORWARD = 7

    async def get_bcp_snapshot(self, property_name: str):
        """
        Builds the BCP (Business Continuity Plan) snapshot for one property,
        captured every 5 minutes: a MEWS-style reservation timeline (rooms x
        dates, today -7 to today +7) for the front desk to keep working from
        on paper if MEWS goes down, plus today's (Asia/Bangkok) customer
        profiles (tagged Arrival/In-house/Departure) and payments.

        Reservation-level notes come from serviceOrderNotes/getAll, which not
        every Connector token has enabled - that part degrades gracefully to
        empty notes rather than failing the snapshot.
        """
        bkk = ZoneInfo("Asia/Bangkok")
        now_bkk = datetime.now(bkk)
        day = now_bkk.replace(hour=0, minute=0, second=0, microsecond=0)
        day_start_utc = day.astimezone(timezone.utc)
        day_end_utc = (day + timedelta(days=1)).astimezone(timezone.utc)
        start_iso = day_start_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
        end_iso = day_end_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

        window_start = day - timedelta(days=self._BCP_WINDOW_DAYS_BACK)
        window_end = day + timedelta(days=self._BCP_WINDOW_DAYS_FORWARD + 1)  # +1: exclusive end
        window_start_iso = window_start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        window_end_iso = window_end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        resv_res = await mews_client.post(
            "/api/connector/v1/reservations/getAll",
            {
                "StartUtc": window_start_iso,
                "EndUtc": window_end_iso,
                "Extent": {"Reservations": True, "Customers": True, "Resources": True},
            },
            property_name=property_name,
        )
        reservations = [r for r in resv_res.get("Reservations", []) if r.get("State") != "Canceled"]
        customers_map = {c["Id"]: c for c in resv_res.get("Customers", []) if c.get("Id")}
        resources_map = {r["Id"]: r for r in resv_res.get("Resources", []) if r.get("Id")}

        def in_window(ts):
            if not ts:
                return False
            try:
                t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except Exception:
                return False
            return day_start_utc <= t < day_end_utc

        # Today-specific subsets - used only for the customer Arrival/In-house/
        # Departure tags below, not for the timeline itself (which shows the
        # whole window).
        arrival_rs = [r for r in reservations if in_window(r.get("StartUtc"))]
        departure_rs = [r for r in reservations if in_window(r.get("EndUtc"))]
        inhouse_rs = [r for r in reservations if r.get("State") == "Started" and not in_window(r.get("EndUtc"))]

        # Product order items for every reservation in the window (breakfast
        # add-ons etc.) - any bar on the timeline can be clicked, not just
        # today's arrivals, so every reservation needs this fetched.
        items_by_reservation: dict = {}
        # Rate (room-charge) vs Items (product) net-value sums per reservation,
        # for the detail panel's Rate/Items/Total/Avg breakdown - MEWS's own
        # UI derives these from order items too (RequestedPaymentAmount on
        # the reservation itself is never populated in this property's data,
        # confirmed live), bucketed by the item's Type since NightRebate/
        # ProductOrderRebate need to net against their own category. Each
        # bucket also keeps its individual line items (date+amount for Rate,
        # name+amount for Items) for the panel's expand-to-see-detail rows.
        rate_amount_by_reservation: dict = {}
        items_amount_by_reservation: dict = {}
        rate_lines_by_reservation: dict = {}
        item_lines_by_reservation: dict = {}
        gross_amount_by_reservation: dict = {}
        currency_by_reservation: dict = {}
        all_res_ids = [r["Id"] for r in reservations]
        for i in range(0, len(all_res_ids), 100):
            chunk = all_res_ids[i:i + 100]
            try:
                oi_res = await mews_client.post(
                    "/api/connector/v1/orderItems/getAll",
                    {"ServiceOrderIds": chunk, "Limitation": {"Count": 1000}},
                    property_name=property_name,
                )
                for item in oi_res.get("OrderItems", []):
                    if item.get("AccountingState") == "Canceled":
                        continue
                    order_id = item.get("ServiceOrderId")
                    item_type = item.get("Type")
                    item_amount = item.get("Amount") or {}
                    net = item_amount.get("NetValue") or 0
                    currency = item_amount.get("Currency")
                    if currency:
                        currency_by_reservation.setdefault(order_id, currency)
                    # Gross sum mirrors the same Rate+Items type set as the net
                    # total below (excludes "Additional"-revenue-type items),
                    # so Total amount and Total amount (Gross) describe the
                    # same underlying charges, just tax-exclusive vs inclusive.
                    if item_type in ("SpaceOrder", "NightRebate", "ProductOrder", "ProductOrderRebate"):
                        gross_amount_by_reservation[order_id] = gross_amount_by_reservation.get(order_id, 0) + (item_amount.get("GrossValue") or 0)
                    if item_type in ("SpaceOrder", "NightRebate"):
                        rate_amount_by_reservation[order_id] = rate_amount_by_reservation.get(order_id, 0) + net
                        start_utc = item.get("StartUtc")
                        if start_utc:
                            night_label = datetime.fromisoformat(start_utc.replace("Z", "+00:00")) \
                                .astimezone(ZoneInfo("Asia/Bangkok")).strftime("%d/%m")
                        else:
                            night_label = item.get("BillingName") or "Night"
                        rate_lines_by_reservation.setdefault(order_id, []).append({"label": night_label, "amount": net, "_start": start_utc or ""})
                    elif item_type in ("ProductOrder", "ProductOrderRebate"):
                        items_amount_by_reservation[order_id] = items_amount_by_reservation.get(order_id, 0) + net
                        product_label = item.get("BillingName") or item.get("Name") or "Product"
                        item_lines_by_reservation.setdefault(order_id, []).append({"label": product_label, "amount": net, "_start": item.get("StartUtc") or ""})

                    if item_type != "ProductOrder":
                        continue
                    label = item.get("BillingName") or item.get("Name") or "Product"
                    count = item.get("UnitCount") or 1
                    items_by_reservation.setdefault(order_id, []).append(
                        f"{count}x {label}" if count != 1 else label
                    )
            except Exception as e:
                logger.warning(f"BCP order items fetch failed for {property_name}: {e}")

        # orderItems/getAll doesn't return items in chronological order per
        # reservation (confirmed live: a 3-night stay came back as
        # 26/07, 25/07, 27/07) - sort each reservation's lines by the
        # underlying StartUtc, then drop the sort-only field.
        for lines_by_reservation in (rate_lines_by_reservation, item_lines_by_reservation):
            for lines in lines_by_reservation.values():
                lines.sort(key=lambda x: x["_start"])
                for line in lines:
                    del line["_start"]

        # Reservation-level notes (separate endpoint; permission-dependent)
        notes_by_reservation: dict = {}
        for i in range(0, len(all_res_ids), 100):
            chunk = all_res_ids[i:i + 100]
            try:
                notes_res = await mews_client.post(
                    "/api/connector/v1/serviceOrderNotes/getAll",
                    {"ServiceOrderIds": chunk, "Limitation": {"Count": 1000}},
                    property_name=property_name,
                )
                for note in notes_res.get("ServiceOrderNotes", []):
                    text = (note.get("Text") or "").strip()
                    if text:
                        # The field is OrderId, not ServiceOrderId despite the
                        # endpoint's own name - confirmed against a live
                        # response. Getting this wrong silently drops every
                        # note (they all bucket under the None key and never
                        # match a real reservation Id).
                        notes_by_reservation.setdefault(note.get("OrderId"), []).append({
                            "text": text,
                            "type": note.get("Type", ""),
                            "created_utc": note.get("CreatedUtc", ""),
                        })
            except Exception:
                break  # endpoint not enabled for this token - skip quietly
        # MEWS's own Notes panel lists newest first.
        for notes_list in notes_by_reservation.values():
            notes_list.sort(key=lambda n: n["created_utc"], reverse=True)

        # Extra lookups for the "Manage" detail view (group name, requested
        # category, rate, company/travel agency) - IDs deduplicated across
        # the whole widened window so this stays a handful of calls per
        # property/hour, not one per reservation. Note: the Reservation
        # object's field is `GroupId` (confirmed against a live response),
        # not `ReservationGroupId` as get_mapped_reservations assumes -
        # that's a separate pre-existing bug in that method, left alone here
        # since it's out of scope for this change.
        group_ids = list({r.get("GroupId") for r in reservations if r.get("GroupId")})
        rate_ids = list({r.get("RateId") for r in reservations if r.get("RateId")})
        company_ids = {r.get("CompanyId") for r in reservations if r.get("CompanyId")}
        ta_ids = {r.get("TravelAgencyId") for r in reservations if r.get("TravelAgencyId")}
        all_company_ids = list(company_ids | ta_ids)
        segment_ids = list({r.get("BusinessSegmentId") for r in reservations if r.get("BusinessSegmentId")})

        async def fetch_entity(endpoint, payload_key, ids, response_key):
            if not ids:
                return {}
            try:
                # Limitation is required by some of these endpoints (e.g.
                # reservationGroups/getAll rejects its absence with a 400
                # "Invalid Limitation") even when filtering by an explicit Id
                # list - include it unconditionally rather than special-casing.
                res = await mews_client.post(
                    endpoint,
                    {payload_key: ids[:200], "Limitation": {"Count": 200}},
                    property_name=property_name,
                )
                return {item["Id"]: item for item in res.get(response_key, [])}
            except Exception as e:
                logger.warning(f"BCP {response_key} lookup failed for {property_name}: {e}")
                return {}

        groups_dict, rates_dict, companies_dict, segments_dict = await asyncio.gather(
            fetch_entity("/api/connector/v1/reservationGroups/getAll", "ReservationGroupIds", group_ids, "ReservationGroups"),
            fetch_entity("/api/connector/v1/rates/getAll", "RateIds", rate_ids, "Rates"),
            # companies/getAll filters by "Ids", not "CompanyIds" (confirmed
            # against MEWS docs) - see the comment on the other fetch_entity
            # call to this same endpoint above in this file.
            fetch_entity("/api/connector/v1/companies/getAll", "Ids", all_company_ids, "Companies"),
            fetch_entity("/api/connector/v1/businessSegments/getAll", "BusinessSegmentIds", segment_ids, "BusinessSegments"),
        )

        # Resource categories (+ per-room assignment) - needed for both the
        # reservation detail's "Requested category" and, unconditionally, for
        # grouping/ordering the Timeline's room rows (e.g. "The Duo | King"
        # spanning every room of that type, whether or not it currently has a
        # reservation in this window). Same ServiceIds quirk
        # get_st_files_report already works around - resolve the bookable
        # service first. Retries once on any failure (a transient MEWS
        # error/rate-limit here doesn't just lose category names - it also
        # wipes category_ordering, which silently collapses the Timeline's
        # whole group order back to an arbitrary/wrong one instead of
        # matching MEWS - confirmed against a real production capture where
        # a single failed cycle put "LADIES TRIBE HIDEOUT" ahead of "The Duo
        # | King" instead of the reverse). Still degrades to
        # empty/ungrouped after a second failure, or if the token lacks the
        # Resource Categories permission.
        categories_dict: dict = {}      # category_id -> localized name
        category_short_names: dict = {}  # category_id -> short code (e.g. "TNK"), may be empty
        category_ordering: dict = {}    # category_id -> MEWS's own display-order integer
        resource_category_id: dict = {}  # resource_id -> category_id
        stay_service_name: str = ""
        for attempt in range(2):
            categories_dict.clear()
            category_short_names.clear()
            category_ordering.clear()
            resource_category_id.clear()
            stay_service_name = ""
            try:
                services_res = await mews_client.post(
                    "/api/connector/v1/services/getAll",
                    {"Limitation": {"Count": 100}},
                    property_name=property_name,
                )
                stay_service = next(
                    (s for s in services_res.get("Services", [])
                     if (s.get("Data") or {}).get("Discriminator") == "Bookable"),
                    None,
                )
                if stay_service:
                    stay_service_name = stay_service.get("Name", "")
                    cats_res = await mews_client.post(
                        "/api/connector/v1/resourceCategories/getAll",
                        {"ServiceIds": [stay_service["Id"]], "Limitation": {"Count": 200}},
                        property_name=property_name,
                    )
                    for c in cats_res.get("ResourceCategories", []):
                        names = c.get("Names") or {}
                        shorts = c.get("ShortNames") or {}
                        categories_dict[c["Id"]] = names.get("en-US") or names.get("en-GB") or next(iter(names.values()), "")
                        category_short_names[c["Id"]] = shorts.get("en-US") or shorts.get("en-GB") or next(iter(shorts.values()), "")
                        category_ordering[c["Id"]] = c.get("Ordering", 0)

                    all_cat_ids = list(categories_dict.keys())
                    if all_cat_ids:
                        assign_res = await mews_client.post(
                            "/api/connector/v1/resourceCategoryAssignments/getAll",
                            {"ResourceCategoryIds": all_cat_ids, "Limitation": {"Count": 1000}},
                            property_name=property_name,
                        )
                        for a in assign_res.get("ResourceCategoryAssignments", []):
                            if a.get("IsActive", True):
                                resource_category_id[a["ResourceId"]] = a["CategoryId"]
                break  # success - no need to retry
            except Exception as e:
                if attempt == 0:
                    logger.warning(f"BCP resource categories lookup failed for {property_name}, retrying once: {e}")
                    await asyncio.sleep(1)
                    continue
                logger.warning(f"BCP resource categories lookup failed for {property_name}: {e}")

        # MEWS's Reservation.Origin is a combined string like "CommanderInPerson"
        # (Origin enum + CommanderOrigin sub-enum concatenated - confirmed
        # against a live response, not split into two fields as the public
        # docs describe). Reconstructs MEWS's own full label ("Mews Operations
        # In person") from the documented enum value lists.
        #
        # Channel-manager (OTA) bookings get a richer, different Origin format
        # entirely - confirmed against a live Agoda-via-SiteMinder reservation:
        # "SiteMinder 1750892592: AGO-1750892592-01" is
        # f"{ChannelManager} {ChannelNumber}: {ChannelManagerNumber}", not the
        # generic prefix+suffix split used for Commander/Distributor/etc.
        #
        # "Reservation source" prefers OriginDetails when MEWS populates it
        # (it did for that same Agoda reservation - "TravelBundle, Agoda"),
        # falling back to the derived suffix/channel-manager name otherwise -
        # confirmed against the walk-in reservation, whose OriginDetails was
        # null but still showed a "Reservation source" ("In person").
        _ORIGIN_PREFIX_LABELS = {
            "Distributor": "Booking Engine",
            "ChannelManager": "Channel Manager",
            "Commander": "Mews Operations",
            "Import": "Import",
            "Connector": "Connector API",
            "Navigator": "Guest Services",
        }

        def format_origin(res: dict):
            raw = res.get("Origin") or ""
            origin_details = (res.get("OriginDetails") or "").strip()
            if not raw:
                return "", origin_details

            if raw.startswith("ChannelManager"):
                cm = res.get("ChannelManager")
                cn = res.get("ChannelNumber")
                cmn = res.get("ChannelManagerNumber")
                if cm and cn and cmn:
                    return f"{cm} {cn}: {cmn}", (origin_details or cm)

            for prefix, label in _ORIGIN_PREFIX_LABELS.items():
                if raw.startswith(prefix):
                    suffix = raw[len(prefix):]
                    if not suffix:
                        return label, origin_details
                    words = re.findall(r"[A-Z][a-z]*", suffix)
                    if not words:
                        return label, (origin_details or suffix)
                    source = words[0] + ("" if len(words) == 1 else " " + " ".join(w.lower() for w in words[1:]))
                    return f"{label} {source}", (origin_details or source)
            return raw, (origin_details or raw)

        def extract_guest_identity(c):
            """
            MEWS Customer -> the guest-identity fields the Reg Card/RR3 form
            and the Guest Profile page need. Shared by the primary guest
            (CustomerId) and each companion (CompanionIds) below - same
            extraction either way, just applied to a different Customer
            record, so a reservation's companions get full profiles too
            instead of just a bare name.

            occupation/address_details are the RAW MEWS values only (empty
            if MEWS has none) - the Guest Profile page shows exactly this,
            and must never show anything MEWS didn't actually provide. The
            Reg Card/RR3 print form's own print-safe defaults ("นักธุรกิจ"
            for a blank occupation, nationality as a last-resort address so
            the government form field isn't literally empty) are applied
            separately, only at Reg Card token-build time in the frontend
            (buildRegCardTokens) - never baked in here, or the Guest Profile
            page would show fabricated data as if MEWS provided it.
            """
            identity_card_value = ""
            identity_card = c.get("IdentityCard")
            identity_cards = c.get("IdentityCards")
            if isinstance(identity_card, dict):
                identity_card_value = identity_card.get("Number", "")
            elif isinstance(identity_cards, list) and identity_cards:
                identity_card_value = identity_cards[0].get("Number", "")
            passport = c.get("Passport") or {}
            cust_address = c.get("Address") or {}
            addr_line1 = (cust_address.get("Line1") or "").strip()
            addr_line2 = (cust_address.get("Line2") or "").strip()
            if addr_line1 or addr_line2:
                addr_parts = [cust_address.get("Line1"), cust_address.get("Line2"), cust_address.get("City"),
                              cust_address.get("PostalCode"), cust_address.get("CountryCode")]
                address_details = " ".join(p for p in addr_parts if p)
            elif (c.get("BirthPlace") or "").strip():
                address_details = c.get("BirthPlace")
            else:
                address_details = ""
            return {
                "name": f"{c.get('FirstName', '')} {c.get('LastName', '')}".strip(),
                "nationality": c.get("NationalityCode", ""),
                "nationality_name": _rr3_country_name(c.get("NationalityCode")),
                "email": c.get("Email", ""),
                "phone": c.get("Phone", ""),
                "identity_card_number": identity_card_value,
                "passport_number": passport.get("Number", ""),
                "occupation": c.get("Occupation", ""),
                "address_details": address_details,
                "alien_book": c.get("IdentityDocumentSupportNumber", ""),
            }

        def reservation_row(res):
            customer = customers_map.get(res.get("CustomerId"), {})
            room = resources_map.get(res.get("AssignedResourceId"), {})
            group = groups_dict.get(res.get("GroupId"), {})
            category_name = categories_dict.get(res.get("RequestedCategoryId"), "")
            rate = rates_dict.get(res.get("RateId"), {})
            company = companies_dict.get(res.get("CompanyId"), {})
            travel_agency = companies_dict.get(res.get("TravelAgencyId"), {})
            segment = segments_dict.get(res.get("BusinessSegmentId"), {})
            res_id = res.get("Id")
            requested_amount = res.get("RequestedPaymentAmount") or {}
            rate_amount = rate_amount_by_reservation.get(res_id, 0)
            items_amount = items_amount_by_reservation.get(res_id, 0)
            origin_label, reservation_source = format_origin(res)

            # Same customer-profile extraction as get_rr3_cards - the Extent
            # here already includes Customers:True, so this is just reading
            # more fields off data already fetched for the Timeline, not an
            # extra live call. Captured into the snapshot at capture time, so
            # it's still there for the Reg Card even once MEWS is down.
            guest_identity = extract_guest_identity(customer)

            # Additional named guests on the same reservation (MEWS attaches
            # them via CompanionIds, alongside the primary CustomerId/"Owner"
            # surfaced as `guest` below) - already in customers_map since the
            # Extent's Customers:True includes them (used below to build the
            # Arrival/In-house/Departure customer list), just never resolved
            # to full profiles on the reservation itself before, so a
            # reservation with more than 1 adult/child only ever showed its
            # Owner.
            companions = [
                extract_guest_identity(customers_map[cid])
                for cid in (res.get("CompanionIds") or [])
                if customers_map.get(cid)
            ]

            return {
                "number": res.get("Number", ""),
                "guest": guest_identity["name"],
                "nationality": guest_identity["nationality"],
                "nationality_name": guest_identity["nationality_name"],
                "email": guest_identity["email"],
                "phone": guest_identity["phone"],
                "identity_card_number": guest_identity["identity_card_number"],
                "passport_number": guest_identity["passport_number"],
                "occupation": guest_identity["occupation"],
                "address_details": guest_identity["address_details"],
                "alien_book": guest_identity["alien_book"],
                "room": room.get("Name", ""),
                "check_in": res.get("StartUtc", ""),
                "check_out": res.get("EndUtc", ""),
                "state": res.get("State", ""),
                "adults": res.get("AdultCount", 0),
                "children": res.get("ChildCount", 0),
                "companions": companions,
                "products": items_by_reservation.get(res_id, []),
                "notes": notes_by_reservation.get(res_id, []),
                "group_name": group.get("Name", ""),
                "category": category_name,
                "rate": rate.get("Name", ""),
                "company": company.get("Name", ""),
                "travel_agency": travel_agency.get("Name", ""),
                # ChannelNumber is the OTA/channel's own booking reference,
                # e.g. Agoda's own confirmation number for the stay - not
                # MEWS's own "Number" - confirmed against a live Agoda
                # reservation matching this exactly.
                "travel_agency_confirmation_number": res.get("ChannelNumber", ""),
                "rate_amount": rate_amount,
                "items_amount": items_amount,
                "rate_lines": rate_lines_by_reservation.get(res_id, []),
                "item_lines": item_lines_by_reservation.get(res_id, []),
                "total_amount": rate_amount + items_amount,
                "total_amount_gross": gross_amount_by_reservation.get(res_id, 0),
                # RequestedPaymentAmount is what MEWS's own "To be paid" reflects
                # (a specific payment request, not a running balance) - confirmed
                # against a live reservation with no requested amount, whose
                # "To be paid" reads 0 despite a nonzero accrued total above.
                "to_be_paid": requested_amount.get("Value") or 0,
                "currency": currency_by_reservation.get(res_id, ""),
                "service": stay_service_name,
                "segment": segment.get("Name", ""),
                "origin": origin_label,
                "reservation_source": reservation_source,
                "purpose": res.get("Purpose", ""),
                "created_utc": res.get("CreatedUtc", ""),
                # MEWS shows this as a padlock toggle next to the room number
                # (locked = this exact room is guaranteed; unlocked = MEWS
                # may still reassign the room before check-in) - read-only
                # here, same as everything else in BCP.
                "room_locked": bool(res.get("AssignedResourceLocked")),
            }

        def sort_key(row):
            return row["room"] or "zzz"

        # The whole window's reservations, flat - this is what the frontend's
        # Timeline positions as bars across room rows x date columns.
        timeline_reservations = sorted((reservation_row(r) for r in reservations), key=sort_key)

        # Customer profiles for everyone attached to today's reservations,
        # tagged by how they relate to today (arrival/departure/in-house).
        def guest_ids(res_list):
            ids = set()
            for r in res_list:
                for cid in [r.get("CustomerId")] + (r.get("CompanionIds") or []):
                    if cid:
                        ids.add(cid)
            return ids

        arrival_guests = guest_ids(arrival_rs)
        departure_guests = guest_ids(departure_rs)
        inhouse_guests = guest_ids(inhouse_rs)
        customers = []
        for cid in arrival_guests | departure_guests | inhouse_guests:
            c = customers_map.get(cid)
            if not c:
                continue
            tags = []
            if cid in arrival_guests:
                tags.append("Arrival")
            if cid in inhouse_guests:
                tags.append("In-house")
            if cid in departure_guests:
                tags.append("Departure")
            customers.append({
                "name": f"{c.get('FirstName', '')} {c.get('LastName', '')}".strip(),
                "tags": tags,
                "nationality": c.get("NationalityCode", ""),
                "email": c.get("Email", ""),
                "phone": c.get("Phone", ""),
                "notes": (c.get("Notes") or "").strip(),
            })
        customers.sort(key=lambda c: c["name"])

        # Today's payments
        payments = []
        try:
            pay_res = await mews_client.post(
                "/api/connector/v1/payments/getAll",
                {"CreatedUtc": {"StartUtc": start_iso, "EndUtc": end_iso}, "Limitation": {"Count": 1000}},
                property_name=property_name,
            )
            res_number_by_id = {r["Id"]: r.get("Number", "") for r in reservations}
            for p in pay_res.get("Payments", []):
                amount = p.get("Amount") or {}
                customer = customers_map.get(p.get("AccountId"), {})
                payments.append({
                    "created": p.get("CreatedUtc", ""),
                    "type": p.get("Type", ""),
                    "state": p.get("State", ""),
                    "amount": amount.get("GrossValue", 0),
                    "currency": amount.get("Currency", ""),
                    "guest": f"{customer.get('FirstName', '')} {customer.get('LastName', '')}".strip(),
                    "reservation": res_number_by_id.get(p.get("ReservationId"), ""),
                    "notes": (p.get("Notes") or "").strip(),
                })
            payments.sort(key=lambda x: x["created"], reverse=True)
        except Exception as e:
            logger.warning(f"BCP payments fetch failed for {property_name}: {e}")

        # Room list (the Timeline's Y-axis): every active resource + today's
        # housekeeping state. Who's in/arriving/departing each room is now
        # derived client-side from `reservations` (the whole window), not
        # computed here - the timeline bars already show that.
        #
        # MEWS sells some physical spaces multiple ways - e.g. room 210 as a
        # whole-dorm buyout ("TRIBE HIDEOUT - ALL YOURS!") AND its individual
        # beds 211-219 as their own bookable category ("1 BED IN OUR TRIBE
        # HIDEOUT") - and nests the beds directly under the parent room in
        # its own Timeline regardless of the beds' different category.
        # Mirror that here: top-level (parentless) resources are grouped/
        # sorted by their own category as before, but a resource with a
        # ParentResourceId is nested immediately after its parent instead of
        # sorting into its own category's slot. `group_category`
        # carries the category used for the vertical group-label span (the
        # parent's, for children) separately from `category` (the room's own
        # true category, still used for its Room Properties/tooltip) so a
        # family of parent+children reads as one section even though the
        # children's real category differs.
        all_rooms_res = await mews_client.post(
            "/api/connector/v1/resources/getAll",
            {"Extent": {"Resources": True}, "Limitation": {"Count": 1000}},
            property_name=property_name,
        )
        raw_resources = []
        for r in all_rooms_res.get("Resources", []):
            if not r.get("IsActive", True):
                continue
            data_val = (r.get("Data") or {}).get("Value") or {}
            cat_id = resource_category_id.get(r["Id"])
            raw_resources.append({
                "id": r["Id"],
                "parent_id": r.get("ParentResourceId") or "",
                "room": r.get("Name", ""),
                "floor": data_val.get("FloorNumber", ""),
                "state": r.get("State", ""),
                "category": categories_dict.get(cat_id, ""),
                "category_short": category_short_names.get(cat_id, ""),
                "category_ordering": category_ordering.get(cat_id, 0),
            })

        by_id = {res["id"]: res for res in raw_resources}
        children_by_parent: dict = {}
        top_level = []
        for res in raw_resources:
            # An orphaned child (parent inactive/missing from this list)
            # falls back to top-level so it doesn't silently vanish.
            if res["parent_id"] and res["parent_id"] in by_id:
                children_by_parent.setdefault(res["parent_id"], []).append(res)
            else:
                top_level.append(res)

        def room_sort_key(res):
            name = res["room"]
            return (int(name), name) if name.isdigit() else (float("inf"), name)

        for kids in children_by_parent.values():
            kids.sort(key=room_sort_key)
        # Group order follows MEWS's own resourceCategories.Ordering field
        # (confirmed against a real property: alphabetical grouping put
        # unrelated categories first and buried "The Duo | King" mid-list,
        # while Ordering reproduces MEWS's actual on-screen sequence).
        # Ordering ties (MEWS sometimes assigns the same number to a few
        # categories) fall back to the category name, then numeric room
        # order, so the result is still fully deterministic.
        top_level.sort(key=lambda res: (
            1 if not res["category"] else 0,
            res["category_ordering"],
            res["category"],
            room_sort_key(res),
        ))

        def to_room_row(res, parent_room_name, group_category, group_category_short, is_child):
            return {
                "room": res["room"],
                "floor": res["floor"],
                "state": res["state"],
                "category": res["category"],
                "category_short": res["category_short"],
                "parent_room": parent_room_name,
                "service": stay_service_name,
                "group_category": group_category,
                "group_category_short": group_category_short,
                "is_child": is_child,
            }

        rooms = []
        for parent in top_level:
            rooms.append(to_room_row(parent, "", parent["category"], parent["category_short"], False))
            for child in children_by_parent.get(parent["id"], []):
                rooms.append(to_room_row(child, parent["room"], parent["category"], parent["category_short"], True))

        return {
            "property": property_name,
            "date": day.strftime("%Y-%m-%d"),
            "captured_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "window": {
                "start": window_start.strftime("%Y-%m-%d"),
                "end": (window_end - timedelta(days=1)).strftime("%Y-%m-%d"),  # last inclusive day
            },
            "counts": {
                "customers": len(customers),
                "payments": len(payments),
                "rooms": len(rooms),
            },
            "rooms": rooms,
            "reservations": timeline_reservations,
            "customers": customers,
            "payments": payments,
        }

sync_service = SyncService()
