from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.services.sync_service import sync_service

router = APIRouter(prefix="/tm30", tags=["TM30"])


@router.get("/report")
async def get_report(
    property_name: str = Query(...),
    date: str = Query(..., description="YYYY-MM-DD, the property's own calendar day"),
):
    """Live: build the TM30 foreign-arrival notification straight from MEWS."""
    try:
        report = await sync_service.get_tm30_report(property_name, date)
        return {"status": "success", "data": report}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export")
async def export_report(
    property_name: str = Query(...),
    date: str = Query(...),
):
    """Download the TM30 notification as .xlsx for one day (see sync_service.get_tm30_export)."""
    try:
        content, filename = await sync_service.get_tm30_export(property_name, date)
        return Response(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
