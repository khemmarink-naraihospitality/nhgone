from fastapi import APIRouter, HTTPException, Query
from app.services.mews_client import mews_client
from app.services.sync_service import sync_service
from app.services.encryption import encryption_service
from typing import List, Optional

router = APIRouter(prefix="/payments", tags=["Payments"])

@router.get("/live")
async def get_live_payments(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    property_name: Optional[str] = Query(None)
):
    try:
        payload = {
            "Limitation": {"Count": 100}
        }
        
        if start_date and end_date:
            payload["CreatedUtc"] = {
                "StartUtc": start_date,
                "EndUtc": end_date
            }
            
        response = await mews_client.post("/api/connector/v1/payments/getAll", payload, property_name=property_name)
        
        transformed = []
        for pay in response.get("Payments", []):
            transformed.append({
                "mews_id": pay["Id"],
                "amount": pay.get("Amount", {}).get("Value"),
                "currency": pay.get("Amount", {}).get("Currency"),
                "status": pay.get("State"),
                "processed_at": pay.get("CreatedUtc")
            })
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
