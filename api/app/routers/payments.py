from fastapi import APIRouter, Depends, Body, HTTPException, Query
from app.deps import get_current_active_user
from app.services.sync_service import sync_service
from app.services.encryption import encryption_service
from typing import Optional
from datetime import datetime, timezone

router = APIRouter(prefix="/payments", tags=["Payments"], dependencies=[Depends(get_current_active_user)])

@router.get("/live")
async def get_live_payments(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    property_name: Optional[str] = Query(None)
):
    try:
        transformed = await sync_service.get_mapped_payments(
            property_name=property_name,
            start_date=start_date,
            end_date=end_date
        )
        return {"status": "success", "data": transformed}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync")
async def sync_payment(data: dict):
    try:
        if not sync_service.supabase:
            raise Exception("Supabase not initialized")
        encrypted_data = encryption_service.encrypt_data(data)
        res = sync_service.supabase.table("payments").upsert(encrypted_data, on_conflict="mews_id").execute()
        return {"status": "success", "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync-manual")
async def sync_manual_payments(payload: dict = Body(...)):
    try:
        property_name = payload.get("property")
        payments_data = payload.get("data", [])
        start_date = payload.get("start_date")

        property_id = None
        try:
            prop_res = sync_service.supabase.table("property_api_settings").select("id").ilike("property_name", f"%{property_name}%").execute()
            if prop_res.data:
                property_id = prop_res.data[0].get("id")
        except Exception as e:
            print(f"Logging fetch error (payments): {str(e)}")

        now_iso = datetime.now(timezone.utc).isoformat()
        report_date = start_date.split("T")[0] if start_date else None

        batch = []
        for p in payments_data:
            mews_id = p.get("mews_id")
            if not mews_id:
                continue
            batch.append({
                "mews_id": mews_id,
                "property": property_name,
                "amount": p.get("Amount"),
                "currency": p.get("Currency"),
                "status": p.get("Status"),
                "processed_at": p.get("Processed At"),
                "created_at": now_iso,
            })

        inserted = 0
        if batch:
            chunk_size = 300
            for i in range(0, len(batch), chunk_size):
                sync_service.supabase.table("payments").upsert(
                    batch[i:i + chunk_size], on_conflict="mews_id"
                ).execute()
            inserted = len(batch)

            try:
                log_payload = {
                    "property": property_name,
                    "status": "success",
                    "message": f"Manual Import for {report_date or 'Selection'}",
                    "records_synced": inserted,
                    "target_table": "Payments",
                    "sync_type": "manual",
                }
                if property_id:
                    log_payload["property_id"] = property_id
                sync_service.supabase.table("sync_logs").insert(log_payload).execute()
            except Exception as e:
                print(f"Logging insert error (payments): {str(e)}")

        return {"status": "success", "inserted": inserted}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Manual payment sync failed: {str(e)}")

@router.get("/managed")
async def get_managed_payments(
    property: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None)
):
    try:
        if not sync_service.supabase:
            raise Exception("Supabase not initialized")
            
        query = sync_service.supabase.table("payments").select("*").order("processed_at", desc=True).limit(2000)
        
        if property and property != "All" and property != "null":
            query = query.eq("property", property)
            
        if start_date:
            if "T" in start_date and not start_date.endswith("Z"):
                start_date = f"{start_date}:00Z"
            query = query.gte("processed_at", start_date)
            
        if end_date:
            if "T" in end_date and not end_date.endswith("Z"):
                end_date = f"{end_date}:00Z"
            query = query.lte("processed_at", end_date)
            
        res = query.execute()
        
        decrypted_data = []
        for row in res.data:
            item = encryption_service.decrypt_data(row)
            # Inject synced_at/created_at if needed for chart
            if "created_at" in row:
                item["synced_at"] = row["created_at"]
            decrypted_data.append(item)
            
        return {"status": "success", "data": decrypted_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
