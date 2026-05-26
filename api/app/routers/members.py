from fastapi import APIRouter, HTTPException, Query, Body
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
async def sync_manual_members(payload: dict = Body(...)):
    try:
        property_name = payload.get("property")
        members_data = payload.get("data", [])
        start_date = payload.get("start_date")
        
        # 1. Fetch property_id for logging (Flexible fetch)
        property_id = None
        try:
            prop_res = sync_service.supabase.table("property_api_settings").select("id").ilike("property_name", f"%{property_name}%").execute()
            if prop_res.data:
                property_id = prop_res.data[0].get("id")
        except Exception as e:
            print(f"Logging fetch error (members): {str(e)}")

        inserted = 0
        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()
        
        report_date = None
        if start_date:
            report_date = start_date.split("T")[0]
        
        # Prepare batch upsert
        batch = []
        for m in members_data:
            mews_id = m.get("Identifier")
            if not mews_id:
                # Use LoyaltyNumber or some other ID if Identifier is missing
                mews_id = m.get("LoyaltyNumber")
                if not mews_id: continue
                
            batch.append({
                "mews_id": mews_id,
                "property": property_name,
                "data": encryption_service.encrypt_data(m),
                "synced_at": now_iso,
                "report_date": report_date
            })
            
        if batch:
            # Chunking to prevent statement timeouts
            chunk_size = 300
            for i in range(0, len(batch), chunk_size):
                chunk = batch[i:i+chunk_size]
                sync_service.supabase.table("members_sync").upsert(chunk, on_conflict="mews_id").execute()
            
            inserted = len(batch)
            
            # 2. Record in Log Import (sync_logs)
            try:
                log_payload = {
                    "property": property_name,
                    "status": "success",
                    "message": f"Manual Member Import for {report_date or 'Selection'}",
                    "records_synced": inserted,
                    "target_table": "Customers",
                    "sync_type": "manual"
                }
                if property_id:
                    log_payload["property_id"] = property_id
                
                sync_service.supabase.table("sync_logs").insert(log_payload).execute()
            except Exception as e:
                print(f"Logging insert error (members): {str(e)}")
                
        return {"status": "success", "inserted": inserted}
    except Exception as e:
        import traceback
        traceback.print_exc()
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
            
        query = sync_service.supabase.table("members_sync").select("data, synced_at, report_date").order("synced_at", desc=True)
        if property and property != "All" and property != "null":
            query = query.eq("property", property)
            
        if start_date:
            report_date = start_date.split("T")[0]
            query = query.gte("report_date", report_date)
            
        if end_date:
            report_date_end = end_date.split("T")[0]
            query = query.lte("report_date", report_date_end)
            
        # Limit to 2000 records to prevent timeout during decryption loop
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
