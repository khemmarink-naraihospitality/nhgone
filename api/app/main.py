from fastapi import FastAPI, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from app.config import settings
from app.services.mews_client import mews_client
from app.routers import reservations, members, payments, admin, auth, bills, resources, rr3, st_files, bcp, rv, rr4, tm30
from app.services.sync_service import sync_service
from app.services.encryption import encryption_service
from app.services.email_service import email_service
from app.services import ftp_service
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from zoneinfo import ZoneInfo
import asyncio
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
app.include_router(auth.router)
app.include_router(bills.router)
app.include_router(resources.router)
app.include_router(rr3.router)
app.include_router(st_files.router)
app.include_router(rv.router)
app.include_router(bcp.router)
app.include_router(rr4.router)
app.include_router(tm30.router)

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

async def _sync_rr4_tm30_for_property(prop, prop_id, date_str, sync_type="auto"):
    """RR4 and TM30 are captured together in one row (see
    rr4.sync_rr4_tm30_day) since they share a single MEWS call. Same shape as
    _sync_st_files_for_property above - its own function, on its own
    schedule, deliberately outside _TARGET_TABLE_SYNC_FN's per-table loops."""
    label = {"retry": "Retry", "manual": "Manual"}.get(sync_type, "Auto")
    try:
        await rr4.sync_rr4_tm30_day(prop, date_str)
        _log_sync(prop, prop_id, "RR4/TM30", "success", 1, f"{label} RR4/TM30 Sync: {date_str}", sync_type)
        return True
    except Exception as e:
        err = str(e)[:1000]
        _log_sync(prop, prop_id, "RR4/TM30", "error", 0, f"{label} RR4/TM30 Sync Failed: {err}", sync_type)
        print(f"Error syncing RR4/TM30 for {prop}: {e}")
        return False

async def _sync_rv_for_property(prop, prop_id, date_str, sync_type="auto"):
    """RV (Revenue Files) daily import for one (property, date) - same shape
    as _sync_st_files_for_property and _sync_rr4_tm30_for_property: its own
    function, on its own schedule, deliberately outside _TARGET_TABLE_SYNC_FN's
    per-table loops so retry_failed_syncs' 09:00 pass (which only covers the
    5 Data Mart tables) doesn't try to include it. retry_scheduled_syncs
    handles RV retries, same as ST Files / RR4/TM30."""
    label = {"retry": "Retry", "manual": "Manual"}.get(sync_type, "Auto")
    try:
        await rv.sync_rv_day(prop, date_str)
        _log_sync(prop, prop_id, "RV Files", "success", 1, f"{label} RV Files Sync: {date_str}", sync_type)
        return True
    except Exception as e:
        err = str(e)[:1000]
        _log_sync(prop, prop_id, "RV Files", "error", 0, f"{label} RV Files Sync Failed: {err}", sync_type)
        print(f"Error syncing RV Files for {prop}: {e}")
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
    (match_hour_only=True, passed by the /sync/auto route below) exact-minute
    precision isn't achievable - the Cron entry in vercel.json fires every 5
    minutes (moved from hourly because a single hourly tick wasn't reliable -
    it went missing for hours at a stretch during a burst of production
    deployments) rather than being guaranteed to land on any particular
    minute (observed landing ~1 minute after the 5-minute grid), so matching
    requires the hour to match exactly but only the configured minute or
    later within it - never before the configured time, but the tick that
    actually catches it may run a few minutes late. Since up to 12 ticks now
    land within the same matching hour, last_daily_sync_date below is what
    stops the same property being re-synced on every remaining one of them
    once the first successful tick catches it.
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
        today_str = now.date().isoformat()

        # 1. Fetch properties that are enabled
        query = sync_service.supabase.table("property_api_settings") \
            .select("id, property_name, sync_hour, sync_minute, sync_reservations, sync_members, sync_payments, sync_bills, sync_resources, last_daily_sync_date") \
            .eq("sync_enabled", True)

        if not force_all:
            if match_hour_only:
                # >= rather than == : Vercel's 5-minute cron doesn't land on
                # any particular minute (observed landing 1 minute after the
                # 5-minute grid, e.g. :01/:06/:11), so waiting for an exact
                # match would only ever catch a property whose configured
                # minute happened to line up with that offset. This still
                # can't fire before the configured time, just up to ~5
                # minutes after it - and stays within the same hour, so it
                # won't fire hours late either.
                query = query.eq("sync_hour", current_hour).lte("sync_minute", current_minute)
            else:
                query = query.eq("sync_hour", current_hour).eq("sync_minute", current_minute)

        props_res = query.execute()
        sync_items = props_res.data

        if not sync_items:
            return

        # last_daily_sync_date is a same-day dedup guard, not a concurrency
        # lock (acquire_sync_lock only blocks overlapping runs - it releases
        # the moment a run finishes, so without this a property would get
        # re-synced on every remaining tick within its matching hour once
        # /sync/auto moved from hourly to every 5 minutes for cron-reliability
        # reasons - see vercel.json). force_all (the manual "Sync Now" button)
        # deliberately ignores it, same as it already bypasses the hour match.
        if not force_all:
            sync_items = [p for p in sync_items if p.get("last_daily_sync_date") != today_str]
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
                if not force_all:
                    try:
                        sync_service.supabase.table("property_api_settings").update(
                            {"last_daily_sync_date": today_str}
                        ).eq("id", prop_id).execute()
                    except Exception as mark_err:
                        print(f"Failed to record last_daily_sync_date for {prop}: {mark_err}")

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
    YESTERDAY's Bangkok date, matching /st-files' own manual default
    (getYesterday() in the frontend) and MEWS's own native "Availability &
    occupancy report" export schedule (confirmed against a real property's
    Export Schedule config: "Previous day", 00:00-00:00, run at 01:30) -
    capturing "today" instead (as this used to) grabs an in-progress day
    only hours old at the default 02:00 run time, before that day's
    check-outs/check-ins have actually happened, making the numbers wrong.

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
            .select("id, property_name, st_files_sync_hour, st_files_sync_minute, st_files_sync_last_date") \
            .eq("st_files_sync_enabled", True)
        if match_hour_only:
            # >= not == : see daily_auto_sync's own comment on why - Vercel's
            # 5-minute cron doesn't land on any particular minute.
            query = query.eq("st_files_sync_hour", now.hour).lte("st_files_sync_minute", now.minute)
        else:
            query = query.eq("st_files_sync_hour", now.hour).eq("st_files_sync_minute", now.minute)
        items = query.execute().data or []
    except Exception as e:
        # Swallows a missing-column error gracefully (e.g. the migration
        # adding these 3 columns hasn't been run yet) rather than taking
        # down this whole background task.
        print(f"Error in daily_auto_sync_st_files (fetching properties): {str(e)}")
        return

    # Same-day dedup guard, not a concurrency lock - see daily_auto_sync's
    # own last_daily_sync_date comment for why this is needed now that
    # /sync/auto fires every 5 minutes instead of hourly.
    today_str = now.date().isoformat()
    items = [p for p in items if p.get("st_files_sync_last_date") != today_str]
    if not items:
        return

    print(f"[{now.isoformat()}] ST Files auto-import: {len(items)} propert(y/ies) scheduled...")
    report_date_str = (now.date() - timedelta(days=1)).isoformat()

    async def import_one(p) -> bool:
        """False only when the lock was unavailable - i.e. worth retrying.
        A genuine sync failure is logged by _sync_st_files_for_property and
        counts as handled."""
        prop, prop_id = p["property_name"], p["id"]
        try:
            lock_acquired = sync_service.supabase.rpc("acquire_sync_lock", {
                "target_property_id": prop_id, "timeout_mins": 15
            }).execute().data
        except Exception as lock_err:
            print(f"ST Files auto-import lock error for {prop}: {lock_err}")
            return False
        if not lock_acquired:
            print(f"ST Files auto-import for {prop}: sync lock busy.")
            return False

        try:
            await _sync_st_files_for_property(prop, prop_id, report_date_str)
        finally:
            try:
                sync_service.supabase.rpc("release_sync_lock", {"target_property_id": prop_id}).execute()
            except Exception:
                pass
            try:
                sync_service.supabase.table("property_api_settings").update(
                    {"st_files_sync_last_date": today_str}
                ).eq("id", prop_id).execute()
            except Exception as mark_err:
                print(f"Failed to record st_files_sync_last_date for {prop}: {mark_err}")
        return True

    # The every-5-minute BCP capture takes this same per-property lock, so a
    # property whose capture overlaps this tick used to be skipped for the
    # whole day - and silently, a busy lock being a bare `continue` that
    # logged nothing (Lub d Koh Samui Chaweng Beach lost 2026-08-06 this way).
    # Retry those once the others are done, by which point BCP has long since
    # released it, and log an error if it's somehow still held so a real miss
    # shows up in the Activity Log instead of vanishing.
    deferred = []
    for p in items:
        if not await import_one(p):
            deferred.append(p)

    if deferred:
        await asyncio.sleep(20)
        for p in deferred:
            if not await import_one(p):
                _log_sync(p["property_name"], p["id"], "ST Files", "error", 0,
                          f"Auto ST Files Sync Failed: sync lock still busy for {report_date_str}", "auto")

async def daily_auto_sync_rr4_tm30(match_hour_only: bool = False):
    """
    RR4/TM30's own auto-import schedule (Admin > Sync's "RR4/TM30 Auto
    Import" section, rr4_tm30_sync_enabled/rr4_tm30_sync_hour/
    rr4_tm30_sync_minute on property_api_settings) - a third independent
    clock alongside the 5-table daily_auto_sync and ST Files, for the same
    reason ST Files got its own: a property may want the government filings
    captured at a different time than its data sync, or not at all.

    Always syncs YESTERDAY's date in the property's own timezone, matching
    both /rr4-tm30's manual default (getYesterday() in the frontend) and ST
    Files' reasoning: at the default 02:00 run time "today" is an
    in-progress day only hours old, before that day's check-ins have
    actually happened.

    Same match_hour_only split as daily_auto_sync/daily_auto_sync_st_files:
    exact minute match locally (per-minute tick), hour-only in production
    (Vercel's cron is hourly and not guaranteed to land on :00).
    """
    now = datetime.now(ZoneInfo("Asia/Bangkok"))
    if not sync_service.supabase:
        return

    try:
        query = sync_service.supabase.table("property_api_settings") \
            .select("id, property_name, rr4_tm30_sync_hour, rr4_tm30_sync_minute, rr4_tm30_sync_last_date") \
            .eq("rr4_tm30_sync_enabled", True)
        if match_hour_only:
            # >= not == : see daily_auto_sync's own comment on why - Vercel's
            # 5-minute cron doesn't land on any particular minute.
            query = query.eq("rr4_tm30_sync_hour", now.hour).lte("rr4_tm30_sync_minute", now.minute)
        else:
            query = query.eq("rr4_tm30_sync_hour", now.hour).eq("rr4_tm30_sync_minute", now.minute)
        items = query.execute().data or []
    except Exception as e:
        # Swallows a missing-column error gracefully (e.g. the migration
        # adding these 3 columns hasn't been run yet) rather than taking
        # down this whole background task.
        print(f"Error in daily_auto_sync_rr4_tm30 (fetching properties): {str(e)}")
        return

    # Same-day dedup guard, not a concurrency lock - see daily_auto_sync's
    # own last_daily_sync_date comment for why this is needed now that
    # /sync/auto fires every 5 minutes instead of hourly.
    today_str = now.date().isoformat()
    items = [p for p in items if p.get("rr4_tm30_sync_last_date") != today_str]
    if not items:
        return

    print(f"[{now.isoformat()}] RR4/TM30 auto-import: {len(items)} propert(y/ies) scheduled...")
    report_date_str = (now.date() - timedelta(days=1)).isoformat()

    async def import_one(p) -> bool:
        """False only when the lock was unavailable - i.e. worth retrying.
        A genuine sync failure is logged by _sync_rr4_tm30_for_property and
        counts as handled."""
        prop, prop_id = p["property_name"], p["id"]
        try:
            lock_acquired = sync_service.supabase.rpc("acquire_sync_lock", {
                "target_property_id": prop_id, "timeout_mins": 15
            }).execute().data
        except Exception as lock_err:
            print(f"RR4/TM30 auto-import lock error for {prop}: {lock_err}")
            return False
        if not lock_acquired:
            print(f"RR4/TM30 auto-import for {prop}: sync lock busy.")
            return False

        try:
            await _sync_rr4_tm30_for_property(prop, prop_id, report_date_str)
        finally:
            try:
                sync_service.supabase.rpc("release_sync_lock", {"target_property_id": prop_id}).execute()
            except Exception:
                pass
            try:
                sync_service.supabase.table("property_api_settings").update(
                    {"rr4_tm30_sync_last_date": today_str}
                ).eq("id", prop_id).execute()
            except Exception as mark_err:
                print(f"Failed to record rr4_tm30_sync_last_date for {prop}: {mark_err}")
        return True

    # Same deferred-retry pass daily_auto_sync_st_files uses: the every-5-minute
    # BCP capture takes this same per-property lock, so a property whose capture
    # overlaps this tick would otherwise be silently skipped for the whole day.
    deferred = []
    for p in items:
        if not await import_one(p):
            deferred.append(p)

    if deferred:
        await asyncio.sleep(20)
        for p in deferred:
            if not await import_one(p):
                _log_sync(p["property_name"], p["id"], "RR4/TM30", "error", 0,
                          f"Auto RR4/TM30 Sync Failed: sync lock still busy for {report_date_str}", "auto")

async def daily_auto_sync_rv(match_hour_only: bool = False):
    """
    RV Files' own auto-import schedule (Admin > Sync's "RV Files Auto Import"
    section, rv_sync_enabled/rv_sync_hour/rv_sync_minute on
    property_api_settings) - a fourth independent clock alongside the
    5-table daily_auto_sync, ST Files, and RR4/TM30, for the same reason
    the others each got their own: a property may want the revenue journal
    captured at a different time than its data sync, or not at all.

    Always syncs YESTERDAY's Bangkok date, matching /rv's own manual default
    and the same reasoning as ST Files / RR4/TM30: at any sensible run time
    "today" is an in-progress day before that day's check-outs have happened,
    making the revenue numbers incomplete.

    Same match_hour_only split as the other three: exact minute match locally
    (per-minute APScheduler tick), hour-only in production (Vercel's cron is
    hourly and not guaranteed to land on :00).
    """
    now = datetime.now(ZoneInfo("Asia/Bangkok"))
    if not sync_service.supabase:
        return

    try:
        query = sync_service.supabase.table("property_api_settings") \
            .select("id, property_name, rv_sync_hour, rv_sync_minute, rv_sync_last_date") \
            .eq("rv_sync_enabled", True)
        if match_hour_only:
            # >= not == : see daily_auto_sync's own comment on why - Vercel's
            # 5-minute cron doesn't land on any particular minute.
            query = query.eq("rv_sync_hour", now.hour).lte("rv_sync_minute", now.minute)
        else:
            query = query.eq("rv_sync_hour", now.hour).eq("rv_sync_minute", now.minute)
        items = query.execute().data or []
    except Exception as e:
        # Swallows a missing-column error gracefully (e.g. the migration
        # adding these 3 columns hasn't been run yet) rather than taking
        # down this whole background task.
        print(f"Error in daily_auto_sync_rv (fetching properties): {str(e)}")
        return

    # Same-day dedup guard, not a concurrency lock - see daily_auto_sync's
    # own last_daily_sync_date comment for why this is needed now that
    # /sync/auto fires every 5 minutes instead of hourly.
    today_str = now.date().isoformat()
    items = [p for p in items if p.get("rv_sync_last_date") != today_str]
    if not items:
        return

    print(f"[{now.isoformat()}] RV Files auto-import: {len(items)} propert(y/ies) scheduled...")
    report_date_str = (now.date() - timedelta(days=1)).isoformat()

    async def import_one(p) -> bool:
        """False only when the lock was unavailable - i.e. worth retrying.
        A genuine sync failure is logged by _sync_rv_for_property and
        counts as handled."""
        prop, prop_id = p["property_name"], p["id"]
        try:
            lock_acquired = sync_service.supabase.rpc("acquire_sync_lock", {
                "target_property_id": prop_id, "timeout_mins": 15
            }).execute().data
        except Exception as lock_err:
            print(f"RV Files auto-import lock error for {prop}: {lock_err}")
            return False
        if not lock_acquired:
            print(f"RV Files auto-import for {prop}: sync lock busy.")
            return False

        try:
            await _sync_rv_for_property(prop, prop_id, report_date_str)
        finally:
            try:
                sync_service.supabase.rpc("release_sync_lock", {"target_property_id": prop_id}).execute()
            except Exception:
                pass
            try:
                sync_service.supabase.table("property_api_settings").update(
                    {"rv_sync_last_date": today_str}
                ).eq("id", prop_id).execute()
            except Exception as mark_err:
                print(f"Failed to record rv_sync_last_date for {prop}: {mark_err}")
        return True

    # Same deferred-retry pass daily_auto_sync_st_files / daily_auto_sync_rr4_tm30
    # use: the every-5-minute BCP capture takes this same per-property lock,
    # so a property whose capture overlaps this tick would otherwise be
    # silently skipped for the whole day.
    deferred = []
    for p in items:
        if not await import_one(p):
            deferred.append(p)

    if deferred:
        await asyncio.sleep(20)
        for p in deferred:
            if not await import_one(p):
                _log_sync(p["property_name"], p["id"], "RV Files", "error", 0,
                          f"Auto RV Files Sync Failed: sync lock still busy for {report_date_str}", "auto")

async def send_st_files_daily_email(match_hour_only: bool = False):
    """
    Once-daily BUNDLED email (Admin > Templates > ST Files Email) - a
    standing master copy that always attaches EVERY property's CSV,
    independent of which properties have also opted into their own separate
    per-property email (see send_st_files_per_property_emails below).
    Piggybacks the same /sync/auto cron tick daily_auto_sync_st_files above
    uses rather than getting its own dedicated cron entry - unlike BCP's
    5-minute snapshots (see trigger_auto_sync's own note on why BCP needed
    one), a once-a-day send is coarser than the hourly cron already fires,
    so hour-matching here is all the precision this needs.

    last_sent_date (on the same settings row get_st_files_daily_settings
    reads) is the same-day dedup guard - production's hourly cron would
    otherwise resend for every remaining tick within the matching hour.
    """
    now = datetime.now(ZoneInfo("Asia/Bangkok"))
    if not sync_service.supabase:
        return

    try:
        settings_row = email_service.get_st_files_daily_settings()
    except Exception as e:
        print(f"Error in send_st_files_daily_email (loading settings): {str(e)}")
        return

    if not settings_row.get("enabled"):
        return

    today_str = now.date().isoformat()
    if settings_row.get("last_sent_date") == today_str:
        return

    hour_matches = now.hour == settings_row["send_hour"]
    if match_hour_only:
        # hour must match exactly, minute only needs to have been reached -
        # see daily_auto_sync's own comment on why (Vercel's 5-minute cron
        # doesn't land on any particular minute).
        if not (hour_matches and now.minute >= settings_row["send_minute"]):
            return
    elif not (hour_matches and now.minute == settings_row["send_minute"]):
        return

    # The report attached is YESTERDAY's (matching daily_auto_sync_st_files'
    # own capture date - see its docstring), but the dedup marker is keyed
    # on TODAY (today_str, the actual send day) so a repeat cron tick later
    # this same hour is still caught correctly.
    report_date_str = (now.date() - timedelta(days=1)).isoformat()
    try:
        result = await sync_service.send_st_files_bundled_digest(report_date_str, sent_date_str=today_str)
        if result["sent"]:
            print(f"[{now.isoformat()}] ST Files bundled email sent: {len(result['included'])} included, {len(result['skipped'])} skipped.")
        else:
            print(f"[{now.isoformat()}] ST Files bundled email: nothing ready to send yet ({len(result['skipped'])} propert(y/ies) not ready).")
    except Exception as e:
        print(f"Error in send_st_files_daily_email: {str(e)}")

async def send_st_files_per_property_emails(match_hour_only: bool = False):
    """
    Per-property ST Files emails (Admin > Templates > ST Files Email
    (Per-Property)) - each property that has opted in (property_api_
    settings.st_files_email_enabled) gets its own separate email, sent at
    ITS OWN st_files_email_hour/_minute, fully independent of the bundled
    email's schedule above and of every other opted-in property's own time.

    Same match_hour_only split as daily_auto_sync_rv/_rr4_tm30/_st_files:
    exact minute match locally (per-minute APScheduler tick), hour-only in
    production (Vercel's cron is hourly and not guaranteed to land on :00).
    Filtering happens in the query itself (.eq(hour_col, now.hour), same
    pattern those three use) rather than a Python loop over every property.

    st_files_email_last_sent_date is this property's own same-day dedup
    guard (mirrors send_st_files_daily_email's last_sent_date, just kept
    per-property since each property's send time can differ) - without it,
    production's hourly cron would resend for every remaining tick within
    the matching hour.
    """
    now = datetime.now(ZoneInfo("Asia/Bangkok"))
    if not sync_service.supabase:
        return

    try:
        query = sync_service.supabase.table("property_api_settings") \
            .select("id, property_name, st_files_email_hour, st_files_email_minute, st_files_email_last_sent_date") \
            .eq("st_files_email_enabled", True)
        if match_hour_only:
            # >= not == : see daily_auto_sync's own comment on why - Vercel's
            # 5-minute cron doesn't land on any particular minute.
            query = query.eq("st_files_email_hour", now.hour).lte("st_files_email_minute", now.minute)
        else:
            query = query.eq("st_files_email_hour", now.hour).eq("st_files_email_minute", now.minute)
        items = query.execute().data or []
    except Exception as e:
        print(f"Error in send_st_files_per_property_emails (fetching properties): {str(e)}")
        return

    today_str = now.date().isoformat()
    # The report attached is YESTERDAY's, same convention as every other
    # ST Files auto-* job - see daily_auto_sync_st_files' own docstring.
    report_date_str = (now.date() - timedelta(days=1)).isoformat()
    for p in items:
        if p.get("st_files_email_last_sent_date") == today_str:
            continue
        try:
            result = await sync_service.send_st_files_property_email(
                p["property_name"], report_date_str, sent_date_str=today_str)
            if result["sent"]:
                print(f"[{now.isoformat()}] ST Files per-property email sent for {p['property_name']}.")
            else:
                print(f"[{now.isoformat()}] ST Files per-property email for {p['property_name']}: {result['skipped']}")
        except Exception as e:
            print(f"Error in send_st_files_per_property_emails for {p['property_name']}: {str(e)}")

async def send_ftp_upload_job(match_hour_only: bool = False):
    """
    Once-daily plain-FTP upload (Admin > Sync > FTP Upload) of every ready
    property's export CSV(s) to a single shared destination - its own
    configurable upload_hour/minute, independent of the email digest above
    (a separate feature the user asked for explicitly, not piggybacked on
    the same schedule). Which report type(s) get uploaded (ST/RV, or both)
    is decided inside send_ftp_upload via ftp_settings.upload_st_files/
    upload_rv_files - this job itself doesn't care. Same hour-matching/
    dedup pattern as send_st_files_daily_email: hour must match exactly,
    minute only needs to have been reached (not exact - Vercel's 5-minute
    cron doesn't land on any particular minute), last_sent_date on the
    settings row guards against resending on a later tick within the
    matching hour.
    """
    now = datetime.now(ZoneInfo("Asia/Bangkok"))
    if not sync_service.supabase:
        return

    settings_row = ftp_service.get_ftp_settings()
    if not settings_row.get("enabled"):
        return

    today_str = now.date().isoformat()
    if settings_row.get("last_sent_date") == today_str:
        return

    hour_matches = now.hour == settings_row["upload_hour"]
    if match_hour_only:
        # hour must match exactly, minute only needs to have been reached -
        # see daily_auto_sync's own comment on why (Vercel's 5-minute cron
        # doesn't land on any particular minute, so waiting for an exact
        # minute match would only ever catch a lucky coincidence - this was
        # reported live: set to 03:10, actually fired at 03:01).
        if not (hour_matches and now.minute >= settings_row["upload_minute"]):
            return
    elif not (hour_matches and now.minute == settings_row["upload_minute"]):
        return

    # Same reasoning as send_st_files_daily_email: uploads YESTERDAY's report
    # (daily_auto_sync_st_files' own capture date), dedup marker keyed on
    # TODAY (the actual upload day) so a later cron tick this hour is still caught.
    report_date_str = (now.date() - timedelta(days=1)).isoformat()
    try:
        result = await sync_service.send_ftp_upload(report_date_str, sent_date_str=today_str)
        if result["uploaded"]:
            print(f"[{now.isoformat()}] FTP upload done: {len(result['included'])} uploaded, {len(result['skipped'])} skipped.")
        else:
            print(f"[{now.isoformat()}] FTP upload: nothing uploaded ({result.get('reason', 'no properties ready')}).")
    except Exception as e:
        print(f"Error in send_ftp_upload_job: {str(e)}")

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

async def retry_scheduled_syncs():
    """
    Per-property equivalent of retry_failed_syncs above, but tied to each
    property's OWN schedule instead of a fixed 09:00, and for a configurable
    count/spacing instead of a fixed two (Admin > Sync's Retry Policy card,
    backed by sync_retry_settings - see sync_service.get_sync_retry_settings;
    default is 2 retries, 60 minutes apart). Covers ALL THREE of a property's
    independent schedules: the 5-table Data Mart sync (sync_hour/minute),
    ST Files (st_files_sync_hour/minute) and RR4/TM30
    (rr4_tm30_sync_hour/minute) - each of which a property can run on a
    completely different clock, or not at all (see daily_auto_sync_st_files'
    and daily_auto_sync_rr4_tm30's own docstrings). A property can be due for
    any combination of them on a given tick; retries whatever's still "error"
    or has no sync_logs row at all yet for today (the scheduled run never
    fired - e.g. a cold start/outage at that exact minute, not just a logged
    failure). Already-succeeded tables are left untouched.

    Runs on its OWN dedicated Vercel Cron entry (/sync/retry-check,
    */5 * * * * - see vercel.json), separate from the hourly /sync/auto,
    specifically so the interval can be configured in MINUTES and actually
    fire at that granularity: piggybacking on the hourly cron (as this used
    to) could only ever match a whole-hour offset in production. Matching is
    bucketed to 5-minute marks in production (Vercel's cron granularity,
    same as BCP's own auto-capture) and to the minute locally (APScheduler
    ticks every second there) - an interval that isn't a multiple of the
    bucket size still works, it just resolves to the nearest bucket rather
    than firing at the exact minute typed in.

    No dedup logic needed here: every sync_* function this calls upserts on
    mews_id (see CLAUDE.md's Chunked upsert pattern), so re-running a table
    that already succeeded - or retrying the same table 3 times over - can
    never produce duplicate rows, only redundant re-upserts of the same ones.
    """
    now = datetime.now(ZoneInfo("Asia/Bangkok"))
    if not sync_service.supabase:
        return

    retry_settings = await sync_service.get_sync_retry_settings()
    offset_minutes = [
        retry_settings["retry_interval_minutes"] * i
        for i in range(1, retry_settings["retry_count"] + 1)
    ]
    if not offset_minutes:
        return

    try:
        # No top-level enabled filter here (unlike before) since Data Mart
        # and ST Files are checked independently below - a property with
        # Data Mart sync off but ST Files on (or vice versa) still needs to
        # be considered for whichever one it has enabled.
        props_res = sync_service.supabase.table("property_api_settings") \
            .select("id, property_name, sync_enabled, sync_hour, sync_minute, "
                     "sync_reservations, sync_members, sync_payments, sync_bills, sync_resources, "
                     "st_files_sync_enabled, st_files_sync_hour, st_files_sync_minute, "
                     "rr4_tm30_sync_enabled, rr4_tm30_sync_hour, rr4_tm30_sync_minute, "
                     "rv_sync_enabled, rv_sync_hour, rv_sync_minute") \
            .execute()
    except Exception as e:
        print(f"Error in retry_scheduled_syncs (fetching properties): {str(e)}")
        return

    bucket = 5 if os.environ.get("VERCEL") else 1
    now_bucket = ((now.hour * 60 + now.minute) // bucket) * bucket

    def is_due(sched_hour, sched_minute):
        if sched_hour is None:
            return False
        base_minutes = sched_hour * 60 + (sched_minute or 0)
        for offset in offset_minutes:
            target_minutes = (base_minutes + offset) % 1440
            target_bucket = (target_minutes // bucket) * bucket
            if target_bucket == now_bucket:
                return True
        return False

    due = []
    for prop_settings in props_res.data or []:
        due_data_mart = bool(prop_settings.get("sync_enabled")) and is_due(
            prop_settings.get("sync_hour"), prop_settings.get("sync_minute"))
        due_st_files = bool(prop_settings.get("st_files_sync_enabled")) and is_due(
            prop_settings.get("st_files_sync_hour"), prop_settings.get("st_files_sync_minute"))
        due_rr4_tm30 = bool(prop_settings.get("rr4_tm30_sync_enabled")) and is_due(
            prop_settings.get("rr4_tm30_sync_hour"), prop_settings.get("rr4_tm30_sync_minute"))
        due_rv = bool(prop_settings.get("rv_sync_enabled")) and is_due(
            prop_settings.get("rv_sync_hour"), prop_settings.get("rv_sync_minute"))
        if due_data_mart or due_st_files or due_rr4_tm30 or due_rv:
            due.append((prop_settings, due_data_mart, due_st_files, due_rr4_tm30, due_rv))

    if not due:
        return

    print(f"[{now.isoformat()}] Scheduled-sync retry check: {len(due)} propert(y/ies) due for a retry pass...")

    today_start_utc = now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    yesterday_bkk = now - timedelta(days=1)
    report_date = yesterday_bkk.date().isoformat()
    now_iso = now.astimezone(timezone.utc).isoformat()

    for prop_settings, due_data_mart, due_st_files, due_rr4_tm30, due_rv in due:
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

        to_retry = []
        if due_data_mart:
            enabled_tables = [t for t, (_fn, flag) in _TARGET_TABLE_SYNC_FN.items() if prop_settings.get(flag, True)]
            to_retry = [
                t for t in enabled_tables
                if t not in latest_by_table or latest_by_table[t].get("status") == "error"
            ]

        retry_st_files = due_st_files and (
            "ST Files" not in latest_by_table or latest_by_table["ST Files"].get("status") == "error"
        )
        retry_rr4_tm30 = due_rr4_tm30 and (
            "RR4/TM30" not in latest_by_table or latest_by_table["RR4/TM30"].get("status") == "error"
        )
        retry_rv = due_rv and (
            "RV Files" not in latest_by_table or latest_by_table["RV Files"].get("status") == "error"
        )

        if not to_retry and not retry_st_files and not retry_rr4_tm30 and not retry_rv:
            continue

        labels = to_retry + (["ST Files"] if retry_st_files else []) + (["RR4/TM30"] if retry_rr4_tm30 else []) + (["RV Files"] if retry_rv else [])
        print(f"[{now.isoformat()}] Scheduled retry: {prop} still missing/failing {labels}, retrying...")

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
            if retry_st_files:
                await _sync_st_files_for_property(prop, prop_id, report_date, sync_type="retry")
            if retry_rr4_tm30:
                await _sync_rr4_tm30_for_property(prop, prop_id, report_date, sync_type="retry")
            if retry_rv:
                await _sync_rv_for_property(prop, prop_id, report_date, sync_type="retry")
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
    # Same idea, gated per-property to its own sync time + configurable offsets.
    # In production this instead runs on its own dedicated cron - see
    # /sync/retry-check - since Vercel doesn't have a persistent process for
    # APScheduler to tick every second the way local dev does.
    scheduler.add_job(retry_scheduled_syncs, 'cron', second=0)
    # ST Files' own independent schedule (st_files_sync_hour/minute).
    scheduler.add_job(daily_auto_sync_st_files, 'cron', second=0)
    # RR4/TM30's own independent schedule (rr4_tm30_sync_hour/minute).
    scheduler.add_job(daily_auto_sync_rr4_tm30, 'cron', second=0)
    # RV Files' own independent schedule (rv_sync_hour/rv_sync_minute).
    scheduler.add_job(daily_auto_sync_rv, 'cron', second=0)
    # ST Files daily email digest (bundled) - own configurable send_hour/minute.
    scheduler.add_job(send_st_files_daily_email, 'cron', second=0)
    # ST Files per-property emails - each opted-in property's own send time.
    scheduler.add_job(send_st_files_per_property_emails, 'cron', second=0)
    # Daily FTP upload (ST and/or RV, per ftp_settings' checkboxes) - own
    # separate configurable upload_hour/minute.
    scheduler.add_job(send_ftp_upload_job, 'cron', second=0)
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
    # retry_scheduled_syncs deliberately NOT piggybacked here anymore - it has
    # its own dedicated 5-minute cron (/sync/retry-check) so its interval can
    # be configured in minutes and actually fire at that granularity; see its
    # own docstring for why the hourly tick here couldn't support that.
    # ST Files' own independent schedule.
    background_tasks.add_task(daily_auto_sync_st_files, match_hour_only=True)
    # RR4/TM30's own independent schedule (rr4_tm30_sync_hour/minute).
    background_tasks.add_task(daily_auto_sync_rr4_tm30, match_hour_only=True)
    # RV Files' own independent schedule (rv_sync_hour/rv_sync_minute).
    background_tasks.add_task(daily_auto_sync_rv, match_hour_only=True)
    # ST Files daily email digest (bundled) - own configurable send_hour/minute.
    background_tasks.add_task(send_st_files_daily_email, match_hour_only=True)
    # ST Files per-property emails - each opted-in property's own send time.
    background_tasks.add_task(send_st_files_per_property_emails, match_hour_only=True)
    # Daily FTP upload (ST and/or RV, per ftp_settings' checkboxes) - own
    # separate configurable upload_hour/minute.
    background_tasks.add_task(send_ftp_upload_job, match_hour_only=True)
    # BCP snapshots have their own dedicated 5-minute cron (/bcp/auto-capture)
    # - deliberately NOT piggybacked here anymore, since this endpoint's own
    # cron only fires hourly and match_hour_only's same-hour tolerance would
    # otherwise re-trigger a full daily_auto_sync multiple times an hour if
    # this endpoint were invoked more often just to feed BCP.
    return {"status": "accepted", "message": f"Sync job started in background (force={force})"}

@app.get("/sync/retry-check")
async def trigger_retry_check(background_tasks: BackgroundTasks = None):
    """
    Dedicated 5-minute Vercel Cron entry (vercel.json) for
    retry_scheduled_syncs - split out from the hourly /sync/auto so the
    Retry Policy's interval (Admin > Sync) can be configured in minutes and
    actually resolve at that granularity in production. See
    retry_scheduled_syncs' own docstring for the full reasoning.
    """
    background_tasks.add_task(retry_scheduled_syncs)
    return {"status": "accepted"}

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
