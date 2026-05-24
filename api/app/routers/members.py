from fastapi import APIRouter, HTTPException, Query
from app.services.mews_client import mews_client
from app.services.sync_service import sync_service
from app.services.encryption import encryption_service
from typing import List, Optional

router = APIRouter(prefix="/members", tags=["Members"])

@router.get("/live")
async def get_live_members(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    property_name: Optional[str] = Query(None)
):
    """
    Fetch live members (customers) from MEWS API.
    """
    try:
        transformed = await sync_service.get_mapped_members(
            property_name=property_name,
            start_date=start_date,
            end_date=end_date
        )
        return {"status": "success", "data": transformed}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync-manual")
async def sync_manual_members(payload: dict):
    try:
        property_name = payload.get("property")
        members_data = payload.get("data", [])
        start_date = payload.get("start_date")
        
        if not sync_service.supabase:
            raise Exception("Supabase not initialized")
            
        # 1. Fetch property_id for logging
        prop_res = sync_service.supabase.table("property_api_settings").select("id").eq("property_name", property_name).single().execute()
        property_id = prop_res.data.get("id") if prop_res.data else None
            
        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()
        
        report_date = None
        if start_date:
            report_date = start_date.split("T")[0]
        
        batch = []
        for m in members_data:
            mews_id = m.get("Identifier")
            if not mews_id: continue
            
            batch.append({
                "mews_id": mews_id,
                "property": property_name,
                "data": encryption_service.encrypt_data(m),
                "synced_at": now_iso,
                "report_date": report_date
            })
            
        if batch:
            sync_service.supabase.table("members_sync").upsert(batch).execute()
            
            # 2. Record in Log Import (sync_logs)
            if property_id:
                sync_service.supabase.table("sync_logs").insert({
                    "property_id": property_id,
                    "status": "success",
                    "message": f"Manual Member Import for {report_date}",
                    "records_synced": len(batch),
                    "sync_type": "manual"
                }).execute()
                
        return {"status": "success", "inserted": len(batch)}
    except Exception as e:
        print(f"Manual member sync error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/managed")
async def get_managed_members(
    property: str = None,
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None)
):
    try:
        if not sync_service.supabase:
            raise Exception("Supabase not initialized")
            
        query = sync_service.supabase.table("members_sync").select("data, synced_at").order("synced_at", desc=True)
        if property and property != "All" and property != "null":
            query = query.eq("property", property)
            
        if start_date:
            report_date = start_date.split("T")[0]
            query = query.gte("report_date", report_date)
            
        if end_date:
            report_date_end = end_date.split("T")[0]
            query = query.lte("report_date", report_date_end)
            
        res = query.execute()
        data = []
        for r in res.data:
            item = encryption_service.decrypt_data(r["data"])
            item["Import Date"] = r["synced_at"]
            data.append(item)
            
        return {"status": "success", "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/managed")
async def delete_saved_members(payload: dict):
    try:
        if not sync_service.supabase:
            raise Exception("Supabase not initialized")
        ids = payload.get("mews_ids", [])
        if not ids: return {"status": "success", "deleted": 0}
        sync_service.supabase.table("members_sync").delete().in_("mews_id", ids).execute()
        return {"status": "success", "deleted": len(ids)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync")
async def sync_member_legacy(data: dict):
    # Keeping old sync for compatibility if needed, but redirects to members table
    try:
        if not sync_service.supabase:
            raise Exception("Supabase not initialized")
        encrypted_data = encryption_service.encrypt_data(data)
        res = sync_service.supabase.table("members").upsert(encrypted_data, on_conflict="mews_id").execute()
        return {"status": "success", "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
