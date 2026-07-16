import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Body

from app.services.sync_service import sync_service
from app.services.encryption import encryption_service

router = APIRouter(prefix="/bcp", tags=["BCP"])

# Hourly snapshots kept per property; older ones are pruned on every capture.
SNAPSHOTS_KEPT = 48


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
    """Hourly job: capture a snapshot for every sync-enabled property.
    Successes are silent (a row per property per hour would drown the
    Activity Log); failures are logged there so they surface."""
    try:
        props = sync_service.supabase.table("property_api_settings") \
            .select("id, property_name").eq("sync_enabled", True).execute()
    except Exception as e:
        print(f"BCP capture: failed to list properties: {e}")
        return
    for p in props.data or []:
        try:
            await capture_snapshot(p["property_name"])
        except Exception as e:
            print(f"BCP capture failed for {p['property_name']}: {e}")
            try:
                sync_service.supabase.table("sync_logs").insert({
                    "property": p["property_name"],
                    "property_id": p.get("id"),
                    "status": "error",
                    "message": f"BCP snapshot failed: {str(e)[:300]}",
                    "records_synced": 0,
                    "target_table": "BCP",
                    "sync_type": "auto",
                }).execute()
            except Exception:
                pass


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
