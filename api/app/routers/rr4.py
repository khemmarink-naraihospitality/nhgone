from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.services.sync_service import sync_service

router = APIRouter(prefix="/rr4", tags=["RR4"])


@router.get("/report")
async def get_report(
    property_name: str = Query(...),
    date: str = Query(..., description="YYYY-MM-DD, the property's own calendar day"),
):
    """Live: build the RR4 (ร.ร.๔) hotel guest register straight from MEWS."""
    try:
        report = await sync_service.get_rr4_report(property_name, date)
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
    """Download the RR4 register as .xlsx for one day (see sync_service.get_rr4_export)."""
    try:
        content, filename = await sync_service.get_rr4_export(property_name, date)
        return Response(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
