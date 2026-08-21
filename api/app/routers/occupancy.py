from fastapi import APIRouter, HTTPException, Query

from app.services.sync_service import sync_service

router = APIRouter(prefix="/occupancy", tags=["Occupancy"])


@router.get("/report")
async def get_report(
    property_name: str = Query(...),
    start_date: str = Query(..., description="YYYY-MM-DD, first night"),
    end_date: str = Query(..., description="YYYY-MM-DD, last night (inclusive)"),
):
    """Occupancy % per space category per night across a date range - the
    Occupancy-by-Room-Type page. Live from MEWS every time: unlike ST Files
    this is a forward-looking view (the range usually runs into the future,
    where there is nothing to have imported), so there is no Data Mart
    counterpart to read from."""
    try:
        report = await sync_service.get_occupancy_report(property_name, start_date, end_date)
        return {"status": "success", "data": report}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Occupancy report failed: {str(e)}")
