from fastapi import FastAPI, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.services.mews_client import mews_client
from app.routers import reservations, members, payments, admin
from app.services.sync_service import sync_service
from app.services.encryption import encryption_service
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from zoneinfo import ZoneInfo
import traceback
from datetime import datetime, timedelta

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
            .select("id, property_name, sync_hour, sync_minute") \
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
        
        # Helper to avoid statement timeouts
        async def chunked_upsert(table_name, items, on_conflict, chunk_size=200):
            total = len(items)
            for i in range(0, total, chunk_size):
                chunk = items[i:i+chunk_size]
                try:
                    sync_service.supabase.table(table_name).upsert(chunk, on_conflict=on_conflict).execute()
                except Exception as e:
                    print(f"Error in chunked_upsert ({table_name}, {i}-{i+chunk_size}): {str(e)}")
                    # If it's a timeout, we might want to retry with smaller chunk or stop
                    if "timeout" in str(e).lower():
                        # Try once more with smaller chunk
                        mini_chunk_size = chunk_size // 2
                        for j in range(0, len(chunk), mini_chunk_size):
                            sync_service.supabase.table(table_name).upsert(chunk[j:j+mini_chunk_size], on_conflict=on_conflict).execute()
                    else:
                        raise e

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
                from datetime import timezone
                now_iso = now.astimezone(timezone.utc).isoformat()

                def _log(target, status, count, msg):
                    try:
                        sync_service.supabase.table("sync_logs").insert({
                            "property": prop,
                            "property_id": prop_id,
                            "target_table": target,
                            "sync_type": "auto",
                            "status": status,
                            "records_synced": count,
                            "message": msg,
                        }).execute()
                    except Exception as log_err:
                        print(f"Log insert failed ({target}): {log_err}")

                # --- A. Sync Reservations ---
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
                    _log("Reservations", "success", len(res_batch), f"Auto Sync: {len(res_batch)} records")
                    print(f"Reservations synced: {len(res_batch)} for {prop}")
                except Exception as e:
                    err = str(e)[:1000]
                    _log("Reservations", "error", 0, f"Auto Sync Failed: {err}")
                    print(f"Error syncing reservations for {prop}: {e}")

                # --- B. Sync Members ---
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
                    _log("Customers", "success", len(mem_batch), f"Auto Sync: {len(mem_batch)} records")
                    print(f"Members synced: {len(mem_batch)} for {prop}")
                except Exception as e:
                    err = str(e)[:1000]
                    _log("Customers", "error", 0, f"Auto Sync Failed: {err}")
                    print(f"Error syncing members for {prop}: {e}")

                # --- C. Sync Payments ---
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
                    _log("Payments", "success", len(pay_batch), f"Auto Sync: {len(pay_batch)} records")
                    print(f"Payments synced: {len(pay_batch)} for {prop}")
                except Exception as e:
                    err = str(e)[:1000]
                    _log("Payments", "error", 0, f"Auto Sync Failed: {err}")
                    print(f"Error syncing payments for {prop}: {e}")

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

@app.on_event("startup")
async def start_scheduler():
    if not sync_service.supabase:
        print("[CRITICAL] Cannot start scheduler: Supabase credentials missing or invalid.")
        return

    # Run the check job every minute (Note: This only works in local development)
    scheduler.add_job(daily_auto_sync, 'cron', second=0)
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
