from fastapi import APIRouter, HTTPException, Query
from app.services.sync_service import sync_service
from typing import Optional

router = APIRouter(prefix="/bills", tags=["Bills"])

@router.get("/live")
async def get_live_bills(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    property_name: Optional[str] = Query(None)
):
    try:
        data = await sync_service.get_mapped_bills(
            property_name=property_name,
            start_date=start_date,
            end_date=end_date
        )
        return {"status": "success", "data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{bill_id}/invoice")
async def get_bill_invoice(bill_id: str, property_name: Optional[str] = Query(None)):
    try:
        data = await sync_service.get_bill_invoice(property_name=property_name, bill_id=bill_id)
        return {"status": "success", "data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
