import json
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Body

from app.services.sync_service import sync_service
from app.services.encryption import encryption_service

router = APIRouter(prefix="/bcp", tags=["BCP"])

# Snapshots kept per property, pruned on every capture. Captures run every 5
# minutes, so 12 = 1 hour of history (reduced from the original 576/48h to
# cut Supabase disk usage - see project_bcp_disk_usage memory for the sizing
# that drove this call).
SNAPSHOTS_KEPT = 12


@router.get("/live")
async def get_live_snapshot(property_name: str = Query(...)):
    """Build a fresh snapshot straight from MEWS without storing it - used as
    the UI's fallback when nothing has been captured yet (and for testing).
    Useless once MEWS is actually down; the stored snapshots are the BCP."""
    try:
        snapshot = await sync_service.get_bcp_snapshot(property_name)
        return {"status": "success", "data": snapshot}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def capture_snapshot(property_name: str) -> str:
    """Builds + stores one snapshot, prunes history to SNAPSHOTS_KEPT, and
    returns the captured_utc timestamp."""
    snapshot = await sync_service.get_bcp_snapshot(property_name)
    captured = snapshot["captured_utc"]
    sync_service.supabase.table("bcp_snapshots").insert({
        "property": property_name,
        "captured_at": captured,
        "data": {"blob": encryption_service.encrypt(json.dumps(snapshot))},
    }).execute()

    # Prune: keep only the newest SNAPSHOTS_KEPT rows for this property.
    old = sync_service.supabase.table("bcp_snapshots") \
        .select("id") \
        .eq("property", property_name) \
        .order("captured_at", desc=True) \
        .range(SNAPSHOTS_KEPT, SNAPSHOTS_KEPT + 200) \
        .execute()
    if old.data:
        sync_service.supabase.table("bcp_snapshots").delete().in_(
            "id", [r["id"] for r in old.data]).execute()
    return captured


async def capture_all_bcp_snapshots():
    """Every-5-minutes job: capture a snapshot for every sync-enabled
    property. Successes are silent (a row per property per cycle would
    drown the Activity Log); failures are logged there so they surface.

    Locks per property via the same sync_locks mechanism daily_auto_sync
    uses (acquire/release_sync_lock), so an overrunning capture - or a
    concurrent full data sync for that property - can't overlap with the
    next 5-minute tick; that property is just skipped this cycle and
    retried on the next one.
    """
    try:
        props = sync_service.supabase.table("property_api_settings") \
            .select("id, property_name").eq("sync_enabled", True).execute()
    except Exception as e:
        print(f"BCP capture: failed to list properties: {e}")
        return
    for p in props.data or []:
        prop_id = p.get("id")
        try:
            lock_acquired = sync_service.supabase.rpc("acquire_sync_lock", {
                "target_property_id": prop_id,
                "timeout_mins": 4,
            }).execute().data
            if not lock_acquired:
                continue  # a sync or another capture is already in flight for this property
        except Exception as lock_err:
            print(f"BCP capture: lock error for {p['property_name']}: {lock_err}")
            continue
        try:
            await capture_snapshot(p["property_name"])
        except Exception as e:
            print(f"BCP capture failed for {p['property_name']}: {e}")
            try:
                sync_service.supabase.table("sync_logs").insert({
                    "property": p["property_name"],
                    "property_id": prop_id,
                    "status": "error",
                    "message": f"BCP snapshot failed: {str(e)[:300]}",
                    "records_synced": 0,
                    "target_table": "BCP",
                    "sync_type": "auto",
                }).execute()
            except Exception:
                pass
        finally:
            try:
                sync_service.supabase.rpc("release_sync_lock", {"target_property_id": prop_id}).execute()
            except Exception:
                pass


@router.get("/auto-capture")
async def trigger_auto_capture(background_tasks: BackgroundTasks):
    """Dedicated Vercel Cron entry point (every 5 minutes) for BCP snapshots -
    separate from /sync/auto so this can run on its own fast cadence without
    dragging the main data sync and retry-failed-syncs jobs along with it."""
    background_tasks.add_task(capture_all_bcp_snapshots)
    return {"status": "accepted"}


@router.post("/capture")
async def capture_now(payload: dict = Body(...)):
    """Manual "Capture Now" from the BCP page."""
    property_name = payload.get("property_name")
    if not property_name:
        raise HTTPException(status_code=400, detail="property_name is required")
    try:
        captured = await capture_snapshot(property_name)
        return {"status": "success", "captured_at": captured}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/snapshots")
async def list_snapshots(property_name: str = Query(...)):
    """The stored snapshot history (newest first) for the picker."""
    try:
        res = sync_service.supabase.table("bcp_snapshots") \
            .select("id, captured_at") \
            .eq("property", property_name) \
            .order("captured_at", desc=True) \
            .limit(SNAPSHOTS_KEPT) \
            .execute()
        return {"status": "success", "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/snapshot")
async def get_snapshot(id: str = Query(...)):
    try:
        res = sync_service.supabase.table("bcp_snapshots").select("data, captured_at").eq("id", id).limit(1).execute()
        if not res.data:
            return {"status": "success", "data": None}
        blob = (res.data[0].get("data") or {}).get("blob", "")
        snapshot = json.loads(encryption_service.decrypt(blob))
        return {"status": "success", "data": snapshot}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reg-card")
async def save_reg_card(payload: dict = Body(...)):
    """
    Persists a signed Reg Card (guest details + the on-screen SignaturePad
    capture) from the Reservations tab's Reg Card modal. Unlike Check In/
    Check Out/Chg Room/Room Status - which only mimic an action MEWS would
    otherwise record, so they stay purely local and get flagged red as
    "not synced" - a signed Reg Card is new data our own system is creating
    from scratch. There's nothing to reconcile against MEWS, so it's fine
    (and the whole point) to actually store it: it's the front desk's own
    durable proof of who signed while MEWS was down.
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    property_name = payload.get("property_name")
    if not property_name:
        raise HTTPException(status_code=400, detail="property_name is required")

    record = {
        "guest": payload.get("guest", ""),
        "nationality": payload.get("nationality", ""),
        "room": payload.get("room", ""),
        "category": payload.get("category", ""),
        "check_in": payload.get("check_in", ""),
        "check_out": payload.get("check_out", ""),
        "adults": payload.get("adults", 0),
        "children": payload.get("children", 0),
        "signature_data_url": payload.get("signature_data_url", ""),
    }
    try:
        sync_service.supabase.table("bcp_reg_cards").insert({
            "property": property_name,
            "reservation_number": payload.get("reservation_number"),
            "data": {"blob": encryption_service.encrypt(json.dumps(record))},
        }).execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reg-card")
async def get_reg_card(property_name: str = Query(...), reservation_number: str = Query(...)):
    """
    The most recently saved Reg Card for a reservation, if any - so reopening
    it (e.g. Save, Close, then Reg Card again later) restores the guest's
    signature and details instead of starting blank, since save_reg_card
    above was write-only and never had a matching read.
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        res = sync_service.supabase.table("bcp_reg_cards") \
            .select("data, created_at") \
            .eq("property", property_name) \
            .eq("reservation_number", reservation_number) \
            .order("created_at", desc=True) \
            .limit(1) \
            .execute()
        if not res.data:
            return {"status": "success", "data": None}
        blob = (res.data[0].get("data") or {}).get("blob", "")
        record = json.loads(encryption_service.decrypt(blob))
        return {"status": "success", "data": record}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _action_log_row_to_json(row: dict) -> dict:
    blob = (row.get("data") or {}).get("blob", "")
    fields = json.loads(encryption_service.decrypt(blob)) if blob else {}
    return {
        "id": row["id"],
        "at": row["created_at"],
        "checked": bool(row.get("checked")),
        **fields,
    }


@router.get("/action-logs")
async def list_action_logs(property_name: str = Query(...), report_date: str = Query(...)):
    """
    Reservations/Rooms/Action Logs tabs' shared audit trail (Check In/Out,
    Chg Room, Room Status, Reg Card Saved). Previously kept in localStorage
    only - durable in Supabase now, per feedback that it must never be lost
    to a device change or a cleared browser, unlike bcp_snapshots (which is
    deliberately pruned - this table is not).
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        res = sync_service.supabase.table("bcp_action_logs") \
            .select("id, checked, data, created_at") \
            .eq("property", property_name) \
            .eq("report_date", report_date) \
            .order("created_at", desc=True) \
            .execute()
        return {"status": "success", "data": [_action_log_row_to_json(r) for r in (res.data or [])]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/action-logs")
async def create_action_log(payload: dict = Body(...)):
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    property_name = payload.get("property_name")
    report_date = payload.get("report_date")
    if not property_name or not report_date:
        raise HTTPException(status_code=400, detail="property_name and report_date are required")

    fields = {
        "reservationNumber": payload.get("reservation_number"),
        "guest": payload.get("guest", ""),
        "room": payload.get("room", ""),
        "action": payload.get("action", ""),
        "detail": payload.get("detail", ""),
    }
    try:
        res = sync_service.supabase.table("bcp_action_logs").insert({
            "property": property_name,
            "report_date": report_date,
            "checked": False,
            "data": {"blob": encryption_service.encrypt(json.dumps(fields))},
        }).execute()
        return {"status": "success", "data": _action_log_row_to_json(res.data[0])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/action-logs/toggle")
async def toggle_action_log(payload: dict = Body(...)):
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    log_id = payload.get("id")
    checked = payload.get("checked")
    if not log_id or checked is None:
        raise HTTPException(status_code=400, detail="id and checked are required")
    try:
        sync_service.supabase.table("bcp_action_logs").update({"checked": checked}).eq("id", log_id).execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
