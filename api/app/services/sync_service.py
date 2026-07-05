from supabase import create_client, Client
from app.config import settings
import logging
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import asyncio
from app.services.mews_client import mews_client

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
                fetch_entity("/api/connector/v1/companies/getAll", "CompanyIds", all_company_ids, "Companies"),
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

    async def get_mapped_bills(self, property_name: str, start_date: str = None, end_date: str = None):
        """
        Fetch real Bill (invoice/receipt) headers with Cursor pagination, chunked into
        <=3-month IssuedUtc windows. Does NOT include line items (see get_bill_invoice
        for the full itemized detail used when printing a single bill).
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

            mapped = []
            for b in all_bills:
                mapped.append({
                    "mews_id": b.get("Id"),
                    "Number": b.get("Number"),
                    "Type": b.get("Type"),
                    "State": b.get("State"),
                    "Owner Name": self._extract_owner_name(b.get("OwnerData")),
                    "Issued At": b.get("IssuedUtc"),
                    "Due At": b.get("DueUtc"),
                    "Paid At": b.get("PaidUtc"),
                    "Notes": b.get("Notes"),
                })
            return mapped
        except Exception as e:
            logger.error(f"Error mapping bills for {property_name}: {str(e)}")
            raise e

    async def get_bill_invoice(self, property_name: str, bill_id: str):
        """
        Build the full itemized invoice payload for a single bill: header, guest/company
        address, line items (order items), computed VAT/subtotal/total, Thai baht-text,
        and a best-effort payment-method match — shaped to populate the
        "FullTAXInvoice LubdKohTao-TP" template placeholders.
        """
        try:
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

            pay_res = await mews_client.post(
                "/api/connector/v1/payments/getAll",
                {"BillIds": [bill_id], "Limitation": {"Count": 100}},
                property_name=property_name
            )
            payments = pay_res.get("Payments", [])

            owner_wrapper = bill.get("OwnerData") or {}
            owner = owner_wrapper.get("Value") or {}
            owner_name = self._extract_owner_name(owner_wrapper)
            address = owner.get("Address") or {}
            legal = owner.get("LegalIdentifiers") or {}
            tax_id = legal.get("TaxIdentifier") or owner.get("TaxIdentifier") or ""

            address_lines = [l for l in [
                address.get("Line1"),
                address.get("Line2"),
                ", ".join(filter(None, [address.get("City"), address.get("SubdivisionCode")])),
                address.get("CountryCode"),
            ] if l]

            rows = []
            for it in items:
                amt = it.get("Amount") or {}
                gross = amt.get("GrossValue") or 0
                net = amt.get("NetValue") or 0
                rows.append({
                    "name": it.get("BillingName") or it.get("Type") or "Item",
                    "gross": gross,
                    "net": net,
                    "tax": gross - net,
                })

            if len(rows) > 5:
                head, tail = rows[:4], rows[4:]
                rows = head + [{
                    "name": f"Other charges ({len(tail)} items)",
                    "gross": sum(r["gross"] for r in tail),
                    "net": sum(r["net"] for r in tail),
                    "tax": sum(r["tax"] for r in tail),
                }]

            sub_total = sum(r["net"] for r in rows)
            vat_total = sum(r["tax"] for r in rows)
            net_amount = sub_total + vat_total
            vat_rate_pct = round((vat_total / sub_total * 100), 2) if sub_total else 0

            line_items = []
            for i in range(5):
                if i < len(rows):
                    line_items.append({"no": i + 1, "description": rows[i]["name"], "amount": round(rows[i]["gross"], 2)})
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
                "mews_id": bill.get("Id"),
                "number": bill.get("Number"),
                "type": bill.get("Type"),
                "state": bill.get("State"),
                "issued_at": bill.get("IssuedUtc"),
                "due_at": bill.get("DueUtc"),
                "owner_name": owner_name,
                "address_lines": address_lines,
                "post_code": address.get("PostalCode") or "",
                "tax_id": tax_id,
                "line_items": line_items,
                "sub_total": round(sub_total, 2),
                "vat_rate_pct": vat_rate_pct,
                "vat": round(vat_total, 2),
                "net_amount": round(net_amount, 2),
                "baht_text": bahttext(net_amount),
                "payment_method": method,
                "bank_transfer_ref": bank_transfer_ref,
                "bank_transfer_date": bank_transfer_date,
                "cheque": cheque,
            }
        except Exception as e:
            logger.error(f"Error building bill invoice for {bill_id}: {str(e)}")
            raise e

sync_service = SyncService()
