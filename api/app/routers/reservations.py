from fastapi import APIRouter, HTTPException, Query
from app.services.mews_client import mews_client
from app.services.sync_service import sync_service
from app.services.encryption import encryption_service
from app.models.schemas import ReservationsRequest, ReservationsResponse
from typing import List, Optional
from datetime import datetime, timedelta, timezone

router = APIRouter(prefix="/reservations", tags=["Reservations"])

@router.get("/live")
async def get_live_reservations(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    cursor: Optional[str] = Query(None),
    property_name: Optional[str] = Query(None),
    chunk_limit: Optional[int] = Query(1) # Default to 1 to prevent timeouts on Vercel
):
    """
    Fetch live reservations and map them to the 58 columns Mews Reservation Report.
    """
    try:
        result = await sync_service.get_mapped_reservations(
            property_name=property_name,
            start_date=start_date,
            end_date=end_date,
            cursor=cursor,
            chunk_limit=chunk_limit
        )
        return {
            "status": "success",
            "data": result["data"],
            "cursor": result["cursor"]
        }
    except Exception as e:
        print(f"Error fetching reservations: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/managed")
async def get_managed_reservations():
    """
    Fetch all managed reservations from Supabase.
    """
    try:
        if not sync_service.supabase:
            raise Exception("Supabase not initialized")
        
        response = sync_service.supabase.table("reservations").select("*").order("created_at", desc=True).execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync-manual")
async def sync_manual_reservations(payload: dict):
    """
    Manually import fetched reservations into the reservations_sync table.
    """
    try:
        property_name = payload.get("property")
        reservations_data = payload.get("data", [])
        start_date = payload.get("start_date") # New: From frontend
        
        # 1. Fetch property_id for logging (Flexible fetch)
        property_id = None
        try:
            # Use ilike for case-insensitive and flexible matching
            prop_res = sync_service.supabase.table("property_api_settings").select("id").ilike("property_name", f"%{property_name}%").execute()
            if prop_res.data:
                property_id = prop_res.data[0].get("id")
        except Exception as e:
            print(f"Logging fetch error: {str(e)}")
            
        inserted = 0
        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()
        
        report_date = None
        if start_date:
            report_date = start_date.split("T")[0]
        
        # Prepare batch upsert
        batch = []
        for r in reservations_data:
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
            
        if batch:
            sync_service.supabase.table("reservations_sync").upsert(batch).execute()
            inserted = len(batch)
            
            # 2. Record in Log Import (sync_logs)
            try:
                log_payload = {
                    "property": property_name,  # Ensure text name is provided
                    "status": "success",
                    "message": f"Manual Import for {report_date or 'Selection'}",
                    "records_synced": inserted,
                    "sync_type": "manual"
                }
                if property_id:
                    log_payload["property_id"] = property_id
                
                sync_service.supabase.table("sync_logs").insert(log_payload).execute()
            except Exception as e:
                print(f"Logging insert error: {str(e)}")
                
        return {"status": "success", "inserted": inserted}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Manual sync failed: {str(e)}")

@router.get("/saved")
async def get_saved_reservations(
    property: str = None,
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None)
):
    """
    Get synced reservations from Supabase with optional date filtering.
    """
    try:
        if not sync_service.supabase:
            raise Exception("Supabase not initialized")
            
        query = sync_service.supabase.table("reservations_sync").select("data, synced_at").order("synced_at", desc=True)
        
        if property and property != "All" and property != "null":
            query = query.eq("property", property)
            
        if start_date:
            # First try filtering by report_date for exact day matches in Data Mart
            # If the date from frontend is YYYY-MM-DD
            report_date = start_date.split("T")[0]
            query = query.gte("report_date", report_date)
            
        if end_date:
            report_date_end = end_date.split("T")[0]
            query = query.lte("report_date", report_date_end)
            
        # Fallback order: If no report_date exists for older records, it still shows by synced_at
            
        res = query.execute()
        
        # Inject synced_at into the data object for frontend display
        data = []
        for r in res.data:
            item = encryption_service.decrypt_data(r["data"])
            item["Import Date"] = r["synced_at"]
            data.append(item)
            
        return {"status": "success", "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/saved")
async def delete_saved_reservations(payload: dict):
    """
    Delete multiple reservations from the sync table.
    Expects format: {"mews_ids": ["id1", "id2", ...]}
    """
    try:
        if not sync_service.supabase:
            raise Exception("Supabase not initialized")
            
        ids = payload.get("mews_ids", [])
        if not ids:
            return {"status": "success", "deleted": 0}
            
        sync_service.supabase.table("reservations_sync").delete().in_("mews_id", ids).execute()
        return {"status": "success", "deleted": len(ids)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
