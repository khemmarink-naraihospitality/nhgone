from fastapi import APIRouter, Depends, HTTPException, Query, Body
from app.deps import get_current_active_user
from app.services.sync_service import sync_service
from app.services.encryption import encryption_service
from typing import Optional
from datetime import datetime, timezone

router = APIRouter(prefix="/resources", tags=["Resources"], dependencies=[Depends(get_current_active_user)])

@router.get("/live")
async def get_live_resources(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    property_name: Optional[str] = Query(None)
):
    """
    Fetch live resources (rooms/spaces) from MEWS API.
    """
    try:
        transformed = await sync_service.get_mapped_resources(
            property_name=property_name,
            start_date=start_date,
            end_date=end_date
        )
        return {"status": "success", "data": transformed}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync-manual")
async def sync_manual_resources(payload: dict = Body(...)):
    try:
        property_name = payload.get("property")
        resources_data = payload.get("data", [])
        start_date = payload.get("start_date")

        property_id = None
        try:
            prop_res = sync_service.supabase.table("property_api_settings").select("id").ilike("property_name", f"%{property_name}%").execute()
            if prop_res.data:
                property_id = prop_res.data[0].get("id")
        except Exception as e:
            print(f"Logging fetch error (resources): {str(e)}")

        now_iso = datetime.now(timezone.utc).isoformat()
        report_date = start_date.split("T")[0] if start_date else None

        batch = []
        for r in resources_data:
            mews_id = r.get("Identifier")
            if not mews_id:
                continue
            batch.append({
                "mews_id": mews_id,
                "property": property_name,
                "data": encryption_service.encrypt_data(r),
                "synced_at": now_iso,
                "report_date": report_date
            })

        inserted = 0
        if batch:
            chunk_size = 300
            for i in range(0, len(batch), chunk_size):
                chunk = batch[i:i + chunk_size]
                sync_service.supabase.table("resources_sync").upsert(chunk, on_conflict="mews_id").execute()
            inserted = len(batch)

            try:
                log_payload = {
                    "property": property_name,
                    "status": "success",
                    "message": f"Manual Resource Import for {report_date or 'Selection'}",
                    "records_synced": inserted,
                    "target_table": "Resources",
                    "sync_type": "manual"
                }
                if property_id:
                    log_payload["property_id"] = property_id
                sync_service.supabase.table("sync_logs").insert(log_payload).execute()
            except Exception as e:
                print(f"Logging insert error (resources): {str(e)}")

        return {"status": "success", "inserted": inserted}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Manual resource sync failed: {str(e)}")

@router.get("/managed")
async def get_managed_resources(
    property: str = None,
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None)
):
    try:
        if not sync_service.supabase:
            raise Exception("Supabase not initialized")

        query = sync_service.supabase.table("resources_sync").select("data, synced_at, report_date").order("synced_at", desc=True)
        if property and property != "All" and property != "null":
            query = query.eq("property", property)

        if start_date:
            report_date = start_date.split("T")[0]
            query = query.gte("report_date", report_date)

        if end_date:
            report_date_end = end_date.split("T")[0]
            query = query.lte("report_date", report_date_end)

        query = query.limit(2000)
        res = query.execute()
        data = []
        for r in res.data:
            item = encryption_service.decrypt_data(r["data"])
            item["Import Date"] = r["synced_at"]
            item["report_date"] = r.get("report_date")
            data.append(item)

        return {"status": "success", "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/managed")
async def delete_saved_resources(payload: dict):
    try:
        if not sync_service.supabase:
            raise Exception("Supabase not initialized")
        ids = payload.get("mews_ids", [])
        if not ids:
            return {"status": "success", "deleted": 0}
        sync_service.supabase.table("resources_sync").delete().in_("mews_id", ids).execute()
        return {"status": "success", "deleted": len(ids)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
