from fastapi import APIRouter, HTTPException, Query
from app.services.sync_service import sync_service
from typing import Optional

router = APIRouter(prefix="/rr3", tags=["RR3"])

@router.get("/cards")
async def get_rr3_cards(
    property_name: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    try:
        data = await sync_service.get_rr3_cards(
            property_name=property_name,
            start_date=start_date,
            end_date=end_date,
        )
        return {"status": "success", "data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
