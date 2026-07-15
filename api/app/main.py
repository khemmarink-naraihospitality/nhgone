from fastapi import FastAPI, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.services.mews_client import mews_client
from app.routers import reservations, members, payments, admin, bills, resources, rr3, st_files
from app.services.sync_service import sync_service
from app.services.encryption import encryption_service
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from zoneinfo import ZoneInfo
import traceback
from datetime import datetime, timedelta, timezone

app = FastAPI(title="NHGOne API")

# Configure scheduler with Asia/Bangkok timezone
scheduler = AsyncIOScheduler(timezone=ZoneInfo("Asia/Bangkok"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(reservations.router)
app.include_router(members.router)
app.include_router(payments.router)
app.include_router(admin.router)
app.include_router(bills.router)
app.include_router(resources.router)
app.include_router(rr3.router)
app.include_router(st_files.router)

# Shared by daily_auto_sync and retry_failed_syncs (below) - avoids Supabase's
# ~60s statement timeout on bulk writes by chunking, with a retry-at-half-size
# fallback if a chunk itself times out. See CLAUDE.md's "Chunked upsert pattern".
async def chunked_upsert(table_name, items, on_conflict, chunk_size=200):
    total = len(items)
    for i in range(0, total, chunk_size):
        chunk = items[i:i+chunk_size]
        try:
            sync_service.supabase.table(table_name).upsert(chunk, on_conflict=on_conflict).execute()
        except Exception as e:
            print(f"Error in chunked_upsert ({table_name}, {i}-{i+chunk_size}): {str(e)}")
            if "timeout" in str(e).lower():
                mini_chunk_size = chunk_size // 2
                for j in range(0, len(chunk), mini_chunk_size):
                    sync_service.supabase.table(table_name).upsert(chunk[j:j+mini_chunk_size], on_conflict=on_conflict).execute()
            else:
                raise e

def _log_sync(prop, prop_id, target, status, count, msg, sync_type="auto"):
    try:
        sync_service.supabase.table("sync_logs").insert({
            "property": prop,
            "property_id": prop_id,
            "target_table": target,
            "sync_type": sync_type,
            "status": status,
            "records_synced": count,
            "message": msg,
        }).execute()
    except Exception as log_err:
        print(f"Log insert failed ({target}): {log_err}")

# The five per-table sync functions below are shared by daily_auto_sync (the
# regular scheduled run) and retry_failed_syncs (a same-day, failed-only
# re-attempt at 09:00 - see below) - each does exactly one table for one
# property and logs its own result, so retry_failed_syncs can call just the
# specific (property, table) pairs that are still failing instead of
# re-running everything.

async def _sync_reservations(prop, prop_id, now_iso, report_date, sync_type="auto"):
    label = "Retry" if sync_type == "retry" else "Auto"
    try:
        res_result = await sync_service.get_mapped_reservations(property_name=prop)
        res_batch = []
        for r in res_result.get("data", []):
            m_id = r.get("Identifier")
            if m_id:
                res_batch.append({
                    "mews_id": m_id,
                    "property": prop,
                    "data": encryption_service.encrypt_data(r),
                    "synced_at": now_iso,
                    "report_date": report_date
                })
        if res_batch:
            await chunked_upsert("reservations_sync", res_batch, on_conflict="mews_id")
        _log_sync(prop, prop_id, "Reservations", "success", len(res_batch), f"{label} Sync: {len(res_batch)} records", sync_type)
        print(f"Reservations synced: {len(res_batch)} for {prop}")
    except Exception as e:
        err = str(e)[:1000]
        _log_sync(prop, prop_id, "Reservations", "error", 0, f"{label} Sync Failed: {err}", sync_type)
        print(f"Error syncing reservations for {prop}: {e}")

async def _sync_members(prop, prop_id, now_iso, report_date, sync_type="auto"):
    label = "Retry" if sync_type == "retry" else "Auto"
    try:
        mem_result = await sync_service.get_mapped_members(property_name=prop)
        mem_batch = []
        for m in mem_result:
            m_id = m.get("Identifier")
            if m_id:
                mem_batch.append({
                    "mews_id": m_id,
                    "property": prop,
                    "data": encryption_service.encrypt_data(m),
                    "synced_at": now_iso,
                    "report_date": report_date
                })
        if mem_batch:
            await chunked_upsert("members_sync", mem_batch, on_conflict="mews_id")
        _log_sync(prop, prop_id, "Customers", "success", len(mem_batch), f"{label} Sync: {len(mem_batch)} records", sync_type)
        print(f"Members synced: {len(mem_batch)} for {prop}")
    except Exception as e:
        err = str(e)[:1000]
        _log_sync(prop, prop_id, "Customers", "error", 0, f"{label} Sync Failed: {err}", sync_type)
        print(f"Error syncing members for {prop}: {e}")

async def _sync_payments(prop, prop_id, now_iso, report_date, sync_type="auto"):
    label = "Retry" if sync_type == "retry" else "Auto"
    try:
        pay_result = await sync_service.get_mapped_payments(property_name=prop)
        pay_batch = []
        for p in pay_result:
            p_id = p.get("mews_id")
            if p_id:
                pay_batch.append({
                    "mews_id": p_id,
                    "property": prop,
                    "amount": p.get("Amount"),
                    "currency": p.get("Currency"),
                    "status": p.get("Status"),
                    "processed_at": p.get("Processed At"),
                    "created_at": now_iso
                })
        if pay_batch:
            await chunked_upsert("payments", pay_batch, on_conflict="mews_id")
        _log_sync(prop, prop_id, "Payments", "success", len(pay_batch), f"{label} Sync: {len(pay_batch)} records", sync_type)
        print(f"Payments synced: {len(pay_batch)} for {prop}")
    except Exception as e:
        err = str(e)[:1000]
        _log_sync(prop, prop_id, "Payments", "error", 0, f"{label} Sync Failed: {err}", sync_type)
        print(f"Error syncing payments for {prop}: {e}")

async def _sync_resources(prop, prop_id, now_iso, report_date, sync_type="auto"):
    label = "Retry" if sync_type == "retry" else "Auto"
    try:
        resrc_result = await sync_service.get_mapped_resources(property_name=prop)
        resrc_batch = []
        for r in resrc_result:
            r_id = r.get("Identifier")
            if r_id:
                resrc_batch.append({
                    "mews_id": r_id,
                    "property": prop,
                    "data": encryption_service.encrypt_data(r),
                    "synced_at": now_iso,
                    "report_date": report_date
                })
        if resrc_batch:
            await chunked_upsert("resources_sync", resrc_batch, on_conflict="mews_id")
        _log_sync(prop, prop_id, "Resources", "success", len(resrc_batch), f"{label} Sync: {len(resrc_batch)} records", sync_type)
        print(f"Resources synced: {len(resrc_batch)} for {prop}")
    except Exception as e:
        err = str(e)[:1000]
        _log_sync(prop, prop_id, "Resources", "error", 0, f"{label} Sync Failed: {err}", sync_type)
        print(f"Error syncing resources for {prop}: {e}")

async def _sync_bills(prop, prop_id, now_iso, report_date, sync_type="auto"):
    label = "Retry" if sync_type == "retry" else "Auto"
    try:
        bill_result = await sync_service.get_mapped_bills_with_items(property_name=prop)
        bill_batch = []
        for b in bill_result:
            b_id = b.get("mews_id")
            if b_id:
                # Per-bill report_date (from the bill's own Issued At) rather than
                # the shared `report_date` param - keeps Data Mart date-range
                # filtering correct even though this runs daily with a "yesterday"
                # window, matching the fix applied to the one-time wide-range backfills.
                issued = b.get("Issued At")
                bill_batch.append({
                    "mews_id": b_id,
                    "property": prop,
                    "data": encryption_service.encrypt_data(b),
                    "synced_at": now_iso,
                    "report_date": issued.split("T")[0] if issued else report_date
                })
        if bill_batch:
            await chunked_upsert("bills_sync", bill_batch, on_conflict="mews_id")
        _log_sync(prop, prop_id, "Bills", "success", len(bill_batch), f"{label} Sync: {len(bill_batch)} records", sync_type)
        print(f"Bills synced: {len(bill_batch)} for {prop}")
    except Exception as e:
        err = str(e)[:1000]
        _log_sync(prop, prop_id, "Bills", "error", 0, f"{label} Sync Failed: {err}", sync_type)
        print(f"Error syncing bills for {prop}: {e}")

_TARGET_TABLE_SYNC_FN = {
    "Reservations": (_sync_reservations, "sync_reservations"),
    "Customers": (_sync_members, "sync_members"),
    "Payments": (_sync_payments, "sync_payments"),
    "Resources": (_sync_resources, "sync_resources"),
    "Bills": (_sync_bills, "sync_bills"),
}

async def daily_auto_sync(force_all: bool = False):
    """
    Automated job to fetch and store Mews reservations.
    Now dynamically checks which properties are scheduled for the current minute.
    """
    now = datetime.now(ZoneInfo("Asia/Bangkok"))
    current_hour = now.hour
    current_minute = now.minute

    print(f"[{now.isoformat()}] Checking for scheduled syncs at {current_hour:02d}:{current_minute:02d} (force_all={force_all})...")

    if not sync_service.supabase:
        print(f"[{now.isoformat()}] [ERROR] Supabase client not initialized. Skipping automated sync.")
        return

    try:
        # Determine report date (Yesterday)
        yesterday_bkk = now - timedelta(days=1)
        report_date = yesterday_bkk.date().isoformat()

        # 1. Fetch properties that are enabled
        query = sync_service.supabase.table("property_api_settings") \
            .select("id, property_name, sync_hour, sync_minute, sync_reservations, sync_members, sync_payments, sync_bills, sync_resources") \
            .eq("sync_enabled", True)

        if not force_all:
            # If current minute is 0, we might be hitting the Vercel hourly cron.
            # In that case, we should sync ALL properties scheduled for this hour to be safe.
            if current_minute == 0:
                query = query.eq("sync_hour", current_hour)
            else:
                # Otherwise, stay precise (for local/frequent scheduler)
                query = query.eq("sync_hour", current_hour).eq("sync_minute", current_minute)

        props_res = query.execute()
        sync_items = props_res.data

        if not sync_items:
            return

        print(f"Found {len(sync_items)} properties scheduled for sync")

        # 2. Sync for each scheduled property
        for prop_settings in sync_items:
            prop = prop_settings["property_name"]
            prop_id = prop_settings["id"]

            # --- Try to Acquire Lock ---
            try:
                lock_acquired = sync_service.supabase.rpc("acquire_sync_lock", {
                    "target_property_id": prop_id,
                    "timeout_mins": 15
                }).execute().data

                if not lock_acquired:
                    print(f"Skipping {prop}: Sync already in progress or recently attempted.")
                    continue
            except Exception as lock_err:
                print(f"Error acquiring lock for {prop}: {lock_err}")
                continue

            try:
                print(f"Starting scheduled sync for property: {prop}")
                now_iso = now.astimezone(timezone.utc).isoformat()

                if prop_settings.get("sync_reservations", True):
                    await _sync_reservations(prop, prop_id, now_iso, report_date)
                if prop_settings.get("sync_members", True):
                    await _sync_members(prop, prop_id, now_iso, report_date)
                if prop_settings.get("sync_payments", True):
                    await _sync_payments(prop, prop_id, now_iso, report_date)
                if prop_settings.get("sync_resources", True):
                    await _sync_resources(prop, prop_id, now_iso, report_date)
                if prop_settings.get("sync_bills", True):
                    await _sync_bills(prop, prop_id, now_iso, report_date)

            except Exception as prop_err:
                print(f"Unexpected error during sync setup for {prop}: {str(prop_err)}")
            finally:
                # --- Release Lock ---
                try:
                    sync_service.supabase.rpc("release_sync_lock", {"target_property_id": prop_id}).execute()
                except:
                    pass

    except Exception as e:
        print(f"Error in automated sync check: {str(e)}")
        traceback.print_exc()

async def retry_failed_syncs():
    """
    Runs once daily at 09:00 Asia/Bangkok. Finds every (property, table) pair
    whose most recent sync_logs entry TODAY is still "error" (a later same-day
    success means it already recovered, so it's excluded) and re-runs just
    that specific table's sync - not the property's other, already-successful
    tables. Piggybacks on the existing hourly trigger (the scheduler below in
    local dev, /sync/auto in production - see trigger_auto_sync) rather than
    needing its own cron entry: it no-ops unless the current Bangkok hour is 9.
    """
    now = datetime.now(ZoneInfo("Asia/Bangkok"))
    if now.hour != 9:
        return

    if not sync_service.supabase:
        return

    print(f"[{now.isoformat()}] Running 09:00 retry-failed-syncs check...")
    try:
        today_start_utc = now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
        logs_res = sync_service.supabase.table("sync_logs") \
            .select("property, property_id, target_table, status, created_at") \
            .gte("created_at", today_start_utc) \
            .order("created_at", desc=True) \
            .execute()

        latest_by_key = {}
        for row in logs_res.data or []:
            key = (row.get("property_id"), row.get("target_table"))
            if key not in latest_by_key:
                latest_by_key[key] = row

        to_retry = [row for row in latest_by_key.values()
                    if row.get("status") == "error" and row.get("target_table") in _TARGET_TABLE_SYNC_FN]

        if not to_retry:
            print(f"[{now.isoformat()}] Retry check: nothing currently failing today.")
            return

        print(f"[{now.isoformat()}] Retry check: {len(to_retry)} still-failing sync(s) found, retrying...")

        yesterday_bkk = now - timedelta(days=1)
        report_date = yesterday_bkk.date().isoformat()
        now_iso = now.astimezone(timezone.utc).isoformat()

        for row in to_retry:
            prop = row["property"]
            prop_id = row.get("property_id")
            target = row["target_table"]
            fn, _enabled_flag = _TARGET_TABLE_SYNC_FN[target]

            try:
                lock_acquired = sync_service.supabase.rpc("acquire_sync_lock", {
                    "target_property_id": prop_id, "timeout_mins": 15
                }).execute().data
                if not lock_acquired:
                    print(f"Retry skipped for {prop}/{target}: sync lock busy.")
                    continue
            except Exception as lock_err:
                print(f"Retry lock error for {prop}/{target}: {lock_err}")
                continue

            try:
                await fn(prop, prop_id, now_iso, report_date, sync_type="retry")
            finally:
                try:
                    sync_service.supabase.rpc("release_sync_lock", {"target_property_id": prop_id}).execute()
                except Exception:
                    pass
    except Exception as e:
        print(f"Error in retry_failed_syncs: {str(e)}")
        traceback.print_exc()

@app.on_event("startup")
async def start_scheduler():
    if not sync_service.supabase:
        print("[CRITICAL] Cannot start scheduler: Supabase credentials missing or invalid.")
        return

    # Run the check job every minute (Note: This only works in local development)
    scheduler.add_job(daily_auto_sync, 'cron', second=0)
    # Same per-minute cadence; retry_failed_syncs self-gates to only do work
    # when the Bangkok hour is 9, so this just gives it a chance to fire.
    scheduler.add_job(retry_failed_syncs, 'cron', second=0)
    scheduler.start()
    print("Scheduler initialized (Local environment only).")

@app.get("/sync/auto")
async def trigger_auto_sync(force: bool = Query(False), background_tasks: BackgroundTasks = None):
    """
    Endpoint to trigger the automated sync job.
    Designed to be called by Vercel Cron or GitHub Actions.
    If force=False (default), it respects the sync_hour/sync_minute in the database.
    Runs in the background so the response returns immediately.
    """
    background_tasks.add_task(daily_auto_sync, force_all=force)
    # Vercel's hourly cron is this endpoint's only production trigger, so the
    # 09:00 retry check piggybacks here too (see retry_failed_syncs' own
    # hour==9 guard) instead of needing a second vercel.json cron entry.
    background_tasks.add_task(retry_failed_syncs)
    return {"status": "accepted", "message": f"Sync job started in background (force={force})"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "NHGOne"}

@app.get("/stats")
async def get_stats():
    """
    Get summary stats from Supabase sync tables.
    """
    try:
        if not sync_service.supabase:
            return {"status": "error", "message": "Supabase not connected"}
        
        # Use sync tables which are actually populated
        res_count = sync_service.supabase.table("reservations_sync").select("mews_id", count="exact").execute().count
        mem_count = sync_service.supabase.table("members_sync").select("mews_id", count="exact").execute().count
        pay_count = sync_service.supabase.table("payments").select("id", count="exact").execute().count
        
        return {
            "status": "success",
            "data": {
                "reservations": res_count or 0,
                "members": mem_count or 0,
                "payments": pay_count or 0
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/")
async def root():
    return {"message": "Welcome to NHGOne API"}

@app.get("/test-mews")
async def test_mews():
    try:
        # Simple call to /api/services/getAll as a smoke test
        # Note: In production environment this might return different services
        response = await mews_client.post("/api/services/getAll", {
            "Limitation": {"Count": 1}
        })
        return {"status": "success", "data": response}
    except Exception as e:
        return {"status": "error", "message": str(e)}
