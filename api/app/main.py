from fastapi import FastAPI, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from app.config import settings
from app.services.mews_client import mews_client
from app.routers import reservations, members, payments, admin, bills, resources, rr3, st_files, bcp
from app.services.sync_service import sync_service
from app.services.encryption import encryption_service
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from zoneinfo import ZoneInfo
import os
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
# BCP snapshot responses (the whole ±7-day Timeline as one JSON blob) run into
# the multiple megabytes for busier properties - JSON compresses extremely
# well (routinely 80-90% smaller), so gzipping every response over 500 bytes
# cuts that transfer time proportionally with zero frontend changes (browsers
# request/decode gzip automatically). Applies to every route, not just BCP,
# so any other large JSON response benefits the same way.
app.add_middleware(GZipMiddleware, minimum_size=500)

app.include_router(reservations.router)
app.include_router(members.router)
app.include_router(payments.router)
app.include_router(admin.router)
app.include_router(bills.router)
app.include_router(resources.router)
app.include_router(rr3.router)
app.include_router(st_files.router)
app.include_router(bcp.router)

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
    label = {"retry": "Retry", "manual": "Manual"}.get(sync_type, "Auto")
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
        return True
    except Exception as e:
        err = str(e)[:1000]
        _log_sync(prop, prop_id, "Reservations", "error", 0, f"{label} Sync Failed: {err}", sync_type)
        print(f"Error syncing reservations for {prop}: {e}")
        return False

async def _sync_members(prop, prop_id, now_iso, report_date, sync_type="auto"):
    label = {"retry": "Retry", "manual": "Manual"}.get(sync_type, "Auto")
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
        return True
    except Exception as e:
        err = str(e)[:1000]
        _log_sync(prop, prop_id, "Customers", "error", 0, f"{label} Sync Failed: {err}", sync_type)
        print(f"Error syncing members for {prop}: {e}")
        return False

async def _sync_payments(prop, prop_id, now_iso, report_date, sync_type="auto"):
    label = {"retry": "Retry", "manual": "Manual"}.get(sync_type, "Auto")
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
        return True
    except Exception as e:
        err = str(e)[:1000]
        _log_sync(prop, prop_id, "Payments", "error", 0, f"{label} Sync Failed: {err}", sync_type)
        print(f"Error syncing payments for {prop}: {e}")
        return False

async def _sync_resources(prop, prop_id, now_iso, report_date, sync_type="auto"):
    label = {"retry": "Retry", "manual": "Manual"}.get(sync_type, "Auto")
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
        return True
    except Exception as e:
        err = str(e)[:1000]
        _log_sync(prop, prop_id, "Resources", "error", 0, f"{label} Sync Failed: {err}", sync_type)
        print(f"Error syncing resources for {prop}: {e}")
        return False

async def _sync_bills(prop, prop_id, now_iso, report_date, sync_type="auto"):
    label = {"retry": "Retry", "manual": "Manual"}.get(sync_type, "Auto")
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
        return True
    except Exception as e:
        err = str(e)[:1000]
        _log_sync(prop, prop_id, "Bills", "error", 0, f"{label} Sync Failed: {err}", sync_type)
        print(f"Error syncing bills for {prop}: {e}")
        return False

async def _sync_st_files_for_property(prop, prop_id, date_str, sync_type="auto"):
    """Not one of the five _TARGET_TABLE_SYNC_FN tables (different schedule
    - see daily_auto_sync_st_files below - and a different source table,
    st_files_sync) - kept as its own function rather than folded into that
    dict so it isn't accidentally picked up by daily_auto_sync/
    retry_failed_syncs/retry_scheduled_syncs's per-table loops."""
    label = {"retry": "Retry", "manual": "Manual"}.get(sync_type, "Auto")
    try:
        await st_files.sync_st_files_day(prop, date_str)
        _log_sync(prop, prop_id, "ST Files", "success", 1, f"{label} ST Files Sync: {date_str}", sync_type)
        return True
    except Exception as e:
        err = str(e)[:1000]
        _log_sync(prop, prop_id, "ST Files", "error", 0, f"{label} ST Files Sync Failed: {err}", sync_type)
        print(f"Error syncing ST Files for {prop}: {e}")
        return False

_TARGET_TABLE_SYNC_FN = {
    "Reservations": (_sync_reservations, "sync_reservations"),
    "Customers": (_sync_members, "sync_members"),
    "Payments": (_sync_payments, "sync_payments"),
    "Resources": (_sync_resources, "sync_resources"),
    "Bills": (_sync_bills, "sync_bills"),
}

async def daily_auto_sync(force_all: bool = False, match_hour_only: bool = False):
    """
    Automated job to fetch and store Mews reservations.
    Locally (persistent process, ticked every minute by the APScheduler set up
    in start_scheduler) this matches a property's sync_hour AND sync_minute
    exactly, so testing "sync in 2 minutes" works as expected. On Vercel
    (match_hour_only=True, passed by the /sync/auto route below) minute-level
    precision isn't achievable or meaningful - the Cron entry in vercel.json
    only fires once an hour and isn't guaranteed to land exactly on :00 (in
    practice it's landed as late as :01-:02), so matching is by hour alone.
    """
    now = datetime.now(ZoneInfo("Asia/Bangkok"))
    current_hour = now.hour
    current_minute = now.minute

    print(f"[{now.isoformat()}] Checking for scheduled syncs at {current_hour:02d}:{current_minute:02d} (force_all={force_all}, match_hour_only={match_hour_only})...")

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
            if match_hour_only:
                query = query.eq("sync_hour", current_hour)
            else:
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

async def daily_auto_sync_st_files(match_hour_only: bool = False):
    """
    ST Files' own auto-import schedule (Admin > Sync's "ST Files Auto
    Import" section, st_files_sync_enabled/st_files_sync_hour/
    st_files_sync_minute on property_api_settings) - deliberately separate
    from the 5-table daily_auto_sync above rather than a 6th entry in
    _TARGET_TABLE_SYNC_FN, since a property may well want this on a
    different clock than its main data sync (or not at all). Always syncs
    TODAY's Bangkok date (not yesterday, unlike the main sync) - matches
    what the manual Import To Data Mart button on /st-files fetches by
    default, and what the report is actually for (today's occupancy).

    Same match_hour_only split as daily_auto_sync: exact minute match
    locally (per-minute tick), hour-only in production (Vercel's cron is
    hourly and not guaranteed to land on :00 - see daily_auto_sync's own
    docstring for why).
    """
    now = datetime.now(ZoneInfo("Asia/Bangkok"))
    if not sync_service.supabase:
        return

    try:
        query = sync_service.supabase.table("property_api_settings") \
            .select("id, property_name, st_files_sync_hour, st_files_sync_minute") \
            .eq("st_files_sync_enabled", True)
        if match_hour_only:
            query = query.eq("st_files_sync_hour", now.hour)
        else:
            query = query.eq("st_files_sync_hour", now.hour).eq("st_files_sync_minute", now.minute)
        items = query.execute().data or []
    except Exception as e:
        # Swallows a missing-column error gracefully (e.g. the migration
        # adding these 3 columns hasn't been run yet) rather than taking
        # down this whole background task.
        print(f"Error in daily_auto_sync_st_files (fetching properties): {str(e)}")
        return

    if not items:
        return

    print(f"[{now.isoformat()}] ST Files auto-import: {len(items)} propert(y/ies) scheduled...")
    today_str = now.date().isoformat()

    for p in items:
        prop, prop_id = p["property_name"], p["id"]
        try:
            lock_acquired = sync_service.supabase.rpc("acquire_sync_lock", {
                "target_property_id": prop_id, "timeout_mins": 15
            }).execute().data
            if not lock_acquired:
                print(f"Skipping ST Files auto-import for {prop}: sync lock busy.")
                continue
        except Exception as lock_err:
            print(f"ST Files auto-import lock error for {prop}: {lock_err}")
            continue

        try:
            await _sync_st_files_for_property(prop, prop_id, today_str)
        finally:
            try:
                sync_service.supabase.rpc("release_sync_lock", {"target_property_id": prop_id}).execute()
            except Exception:
                pass

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

# Whole-hour offsets after a property's own sync_hour, not minutes - Vercel's
# hourly cron (see daily_auto_sync's docstring) can only ever land on an
# hour boundary in production, so a sub-hour offset would silently never
# fire there. Two offsets = the "2 more times" a scheduled sync gets
# retried if it didn't come in cleanly.
_SCHEDULED_RETRY_OFFSET_HOURS = [1, 2]

async def retry_scheduled_syncs():
    """
    Per-property equivalent of retry_failed_syncs above, but tied to that
    property's OWN sync_hour instead of a fixed 09:00 - fires at sync_hour+1
    and sync_hour+2 (Bangkok time) and, for each of that property's enabled
    tables, retries it if today's latest sync_logs row is still "error" OR
    there's no row at all yet for today (the scheduled run never fired at
    all - e.g. a cold start/outage at that exact minute, not just a logged
    failure). Already-succeeded tables are left untouched.

    No dedup logic needed here: every sync_* function this calls upserts on
    mews_id (see CLAUDE.md's Chunked upsert pattern), so re-running a table
    that already succeeded - or retrying the same table 3 times over - can
    never produce duplicate rows, only redundant re-upserts of the same ones.
    """
    now = datetime.now(ZoneInfo("Asia/Bangkok"))
    if not sync_service.supabase:
        return

    try:
        props_res = sync_service.supabase.table("property_api_settings") \
            .select("id, property_name, sync_hour, sync_minute, sync_reservations, sync_members, sync_payments, sync_bills, sync_resources") \
            .eq("sync_enabled", True).execute()
    except Exception as e:
        print(f"Error in retry_scheduled_syncs (fetching properties): {str(e)}")
        return

    # match_hour_only mirrors daily_auto_sync's own local-vs-Vercel split:
    # in production (hourly cron) only the hour can line up reliably, so
    # minute is ignored there; locally (per-minute tick) it's matched too,
    # otherwise every minute within the target hour would re-trigger this.
    match_hour_only = bool(os.environ.get("VERCEL"))
    due = []
    for prop_settings in props_res.data or []:
        sched_hour = prop_settings.get("sync_hour")
        sched_minute = prop_settings.get("sync_minute")
        if sched_hour is None:
            continue
        for offset in _SCHEDULED_RETRY_OFFSET_HOURS:
            hour_matches = now.hour == (sched_hour + offset) % 24
            minute_matches = match_hour_only or sched_minute is None or now.minute == sched_minute
            if hour_matches and minute_matches:
                due.append(prop_settings)
                break

    if not due:
        return

    print(f"[{now.isoformat()}] Scheduled-sync retry check: {len(due)} propert(y/ies) due for a retry pass...")

    today_start_utc = now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    yesterday_bkk = now - timedelta(days=1)
    report_date = yesterday_bkk.date().isoformat()
    now_iso = now.astimezone(timezone.utc).isoformat()

    for prop_settings in due:
        prop = prop_settings["property_name"]
        prop_id = prop_settings["id"]

        try:
            logs_res = sync_service.supabase.table("sync_logs") \
                .select("target_table, status, created_at") \
                .eq("property_id", prop_id) \
                .gte("created_at", today_start_utc) \
                .order("created_at", desc=True) \
                .execute()
        except Exception as e:
            print(f"Scheduled retry check failed to read sync_logs for {prop}: {e}")
            continue

        latest_by_table = {}
        for row in logs_res.data or []:
            t = row.get("target_table")
            if t not in latest_by_table:
                latest_by_table[t] = row

        enabled_tables = [t for t, (_fn, flag) in _TARGET_TABLE_SYNC_FN.items() if prop_settings.get(flag, True)]
        to_retry = [
            t for t in enabled_tables
            if t not in latest_by_table or latest_by_table[t].get("status") == "error"
        ]

        if not to_retry:
            continue

        print(f"[{now.isoformat()}] Scheduled retry: {prop} still missing/failing {to_retry}, retrying...")

        try:
            lock_acquired = sync_service.supabase.rpc("acquire_sync_lock", {
                "target_property_id": prop_id, "timeout_mins": 15
            }).execute().data
            if not lock_acquired:
                print(f"Scheduled retry skipped for {prop}: sync lock busy.")
                continue
        except Exception as lock_err:
            print(f"Scheduled retry lock error for {prop}: {lock_err}")
            continue

        try:
            for target in to_retry:
                fn, _flag = _TARGET_TABLE_SYNC_FN[target]
                await fn(prop, prop_id, now_iso, report_date, sync_type="retry")
        except Exception as e:
            print(f"Error during scheduled retry for {prop}: {str(e)}")
        finally:
            try:
                sync_service.supabase.rpc("release_sync_lock", {"target_property_id": prop_id}).execute()
            except Exception:
                pass

@app.on_event("startup")
async def start_scheduler():
    # Vercel sets this env var in every serverless invocation - previously
    # this check was missing, so this "local dev only" per-minute scheduler
    # was ALSO starting fresh on every Vercel cold start (any request, not
    # just /sync/auto), each instance immediately ticking for whatever
    # arbitrary wall-clock minute the cold start happened to land on. That's
    # why auto-sync was unreliable in production: daily_auto_sync's minute-
    # exact matching almost never matched a property's sync_minute unless a
    # cold start happened to land exactly on :00, in which case it also
    # raced/duplicated with the real Vercel Cron hitting /sync/auto below.
    if os.environ.get("VERCEL"):
        print("Running on Vercel - skipping local per-minute scheduler (Vercel Cron -> /sync/auto is the production trigger).")
        return

    if not sync_service.supabase:
        print("[CRITICAL] Cannot start scheduler: Supabase credentials missing or invalid.")
        return

    # Run the check job every minute (local development only, guarded above)
    scheduler.add_job(daily_auto_sync, 'cron', second=0)
    # Same per-minute cadence; retry_failed_syncs self-gates to only do work
    # when the Bangkok hour is 9, so this just gives it a chance to fire.
    scheduler.add_job(retry_failed_syncs, 'cron', second=0)
    # Same idea, gated per-property to sync_hour+1/+2 instead of a fixed hour.
    scheduler.add_job(retry_scheduled_syncs, 'cron', second=0)
    # ST Files' own independent schedule (st_files_sync_hour/minute).
    scheduler.add_job(daily_auto_sync_st_files, 'cron', second=0)
    # BCP snapshots every 5 minutes (in production this rides its own
    # dedicated Vercel Cron entry -> /bcp/auto-capture instead).
    scheduler.add_job(bcp.capture_all_bcp_snapshots, 'cron', minute='*/5')
    scheduler.start()
    print("Scheduler initialized (Local environment only).")

@app.get("/sync/auto")
async def trigger_auto_sync(force: bool = Query(False), background_tasks: BackgroundTasks = None):
    """
    Endpoint to trigger the automated sync job.
    Designed to be called by Vercel Cron or GitHub Actions.
    If force=False (default), it respects the sync_hour/sync_minute in the database
    (match_hour_only=True since Vercel's cron only fires once an hour and isn't
    guaranteed to land exactly on :00 - see daily_auto_sync's docstring).
    Runs in the background so the response returns immediately.
    """
    background_tasks.add_task(daily_auto_sync, force_all=force, match_hour_only=True)
    # Vercel's hourly cron is this endpoint's only production trigger, so the
    # 09:00 retry check piggybacks here too (see retry_failed_syncs' own
    # hour==9 guard) instead of needing a second vercel.json cron entry.
    background_tasks.add_task(retry_failed_syncs)
    # Same piggyback, gated per-property to sync_hour+1/+2 instead.
    background_tasks.add_task(retry_scheduled_syncs)
    # ST Files' own independent schedule.
    background_tasks.add_task(daily_auto_sync_st_files, match_hour_only=True)
    # BCP snapshots have their own dedicated 5-minute cron (/bcp/auto-capture)
    # - deliberately NOT piggybacked here anymore, since this endpoint's own
    # cron only fires hourly and match_hour_only's same-hour tolerance would
    # otherwise re-trigger a full daily_auto_sync multiple times an hour if
    # this endpoint were invoked more often just to feed BCP.
    return {"status": "accepted", "message": f"Sync job started in background (force={force})"}

@app.post("/sync/property")
async def sync_property_now(payload: dict):
    """
    Manual "Import Latest" trigger from the Dashboard's per-property import
    status card - re-runs exactly what the scheduled daily_auto_sync would
    have done for this one property (its enabled sync_* tables, report_date
    = yesterday Bangkok), tagged sync_type="manual" so it's distinguishable
    in the Activity Log from the automatic run it's covering for. Runs
    synchronously (not backgrounded like /sync/auto) so the button can show
    a real success/failure result instead of firing and hoping.
    """
    property_name = payload.get("property_name")
    if not property_name:
        return {"status": "error", "message": "property_name is required"}
    if not sync_service.supabase:
        return {"status": "error", "message": "Supabase not connected"}

    prop_res = sync_service.supabase.table("property_api_settings") \
        .select("id, sync_enabled, sync_reservations, sync_members, sync_payments, sync_resources, sync_bills") \
        .eq("property_name", property_name).limit(1).execute()
    if not prop_res.data:
        return {"status": "error", "message": f"Unknown property: {property_name}"}
    prop_settings = prop_res.data[0]
    prop_id = prop_settings["id"]
    if prop_settings.get("sync_enabled") is False:
        return {"status": "error", "message": f"Sync is disabled for {property_name}"}

    try:
        lock_acquired = sync_service.supabase.rpc("acquire_sync_lock", {
            "target_property_id": prop_id, "timeout_mins": 15,
        }).execute().data
    except Exception as e:
        return {"status": "error", "message": f"Lock error: {str(e)}"}
    if not lock_acquired:
        return {"status": "error", "message": "A sync is already in progress for this property. Try again shortly."}

    try:
        now = datetime.now(ZoneInfo("Asia/Bangkok"))
        report_date = (now - timedelta(days=1)).date().isoformat()
        now_iso = now.astimezone(timezone.utc).isoformat()

        synced_tables = []
        failed_tables = []
        for target, (fn, flag) in _TARGET_TABLE_SYNC_FN.items():
            if prop_settings.get(flag) is not False:
                ok = await fn(property_name, prop_id, now_iso, report_date, sync_type="manual")
                (synced_tables if ok else failed_tables).append(target)
        if failed_tables and not synced_tables:
            return {"status": "error", "message": f"Import failed: {', '.join(failed_tables)}", "failed": failed_tables}
        if failed_tables:
            return {"status": "partial", "synced": synced_tables, "failed": failed_tables}
        return {"status": "success", "synced": synced_tables}
    finally:
        try:
            sync_service.supabase.rpc("release_sync_lock", {"target_property_id": prop_id}).execute()
        except Exception:
            pass

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "NHGOne"}

@app.get("/stats")
async def get_stats(properties: str = None):
    """
    Get summary stats from Supabase sync tables. `properties` is an optional
    comma-separated list of property names - the frontend passes this
    whenever the signed-in user's role is property-restricted
    (role_permissions.restricted_properties, see src/lib/allowedProperties.ts)
    so the dashboard's totals only ever reflect properties that role can
    actually see, not a portfolio-wide count. Omitted entirely for an
    unrestricted role, matching getAllowedProperties() already resolving to
    "every property" in that case.
    """
    try:
        if not sync_service.supabase:
            return {"status": "error", "message": "Supabase not connected"}

        property_list = [p.strip() for p in properties.split(",") if p.strip()] if properties else None

        def scoped_count(table: str, id_column: str) -> int:
            query = sync_service.supabase.table(table).select(id_column, count="exact")
            if property_list:
                query = query.in_("property", property_list)
            return query.execute().count or 0

        # Use sync tables which are actually populated
        res_count = scoped_count("reservations_sync", "mews_id")
        mem_count = scoped_count("members_sync", "mews_id")
        pay_count = scoped_count("payments", "id")

        return {
            "status": "success",
            "data": {
                "reservations": res_count,
                "members": mem_count,
                "payments": pay_count
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
