from supabase import create_client, Client
from app.config import settings
import logging
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import asyncio
from app.services.mews_client import mews_client

logger = logging.getLogger(__name__)

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

sync_service = SyncService()
