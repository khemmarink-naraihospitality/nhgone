import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, Body
from fastapi.responses import PlainTextResponse

from app.services.sync_service import sync_service
from app.services.encryption import encryption_service

router = APIRouter(prefix="/rv", tags=["RV Files"])


async def sync_rv_day(property_name: str, date_str: str) -> None:
    """Fetches + upserts one (property, date) RV report into rv_files_sync -
    shared by the manual Import To Data Mart button below and any scheduled
    import, so the two can't drift apart. Raises on failure; callers log it.

    Stored Fernet-encrypted as a single blob like st_files_sync: the revenue
    lines carry billing descriptions that quote guest and company names
    (e.g. "Room Charge on 06/08/2026"), so per-field encryption wouldn't
    reach them."""
    report = await sync_service.get_rv_report(property_name, date_str)
    sync_service.supabase.table("rv_files_sync").upsert({
        "property": property_name,
        "report_date": date_str,
        "data": {"blob": encryption_service.encrypt(json.dumps(report))},
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="property,report_date").execute()


@router.get("/report")
async def get_report(
    property_name: str = Query(...),
    date: str = Query(..., description="YYYY-MM-DD, the property's own calendar day"),
):
    """Live mode: build the RV revenue/payment report straight from MEWS."""
    try:
        report = await sync_service.get_rv_report(property_name, date)
        return {"status": "success", "data": report}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync-manual")
async def sync_manual(payload: dict = Body(...)):
    """Import-to-Data-Mart: computes the RV report for every day in the range
    and upserts one encrypted row per (property, report_date)."""
    try:
        property_name = payload.get("property_name")
        start_date = payload.get("start_date")
        end_date = payload.get("end_date") or start_date
        if not property_name or not start_date:
            raise HTTPException(status_code=400, detail="property_name and start_date are required")

        start = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date, "%Y-%m-%d")
        if end < start:
            raise HTTPException(status_code=400, detail="end_date is before start_date")
        if (end - start).days > 62:
            raise HTTPException(status_code=400, detail="Range too large - import at most ~2 months at a time")

        property_id = None
        try:
            prop_res = sync_service.supabase.table("property_api_settings").select("id").ilike(
                "property_name", f"%{property_name}%").execute()
            if prop_res.data:
                property_id = prop_res.data[0].get("id")
        except Exception as e:
            print(f"Logging fetch error (rv): {str(e)}")

        inserted = 0
        errors = []
        day = start
        while day <= end:
            date_str = day.strftime("%Y-%m-%d")
            try:
                await sync_rv_day(property_name, date_str)
                inserted += 1
            except Exception as e:
                errors.append(f"{date_str}: {str(e)[:200]}")
            day += timedelta(days=1)

        try:
            log_payload = {
                "property": property_name,
                "status": "success" if not errors else ("partial" if inserted else "error"),
                "message": f"Manual RV import {start_date}..{end_date}" + (f" ({len(errors)} failed)" if errors else ""),
                "records_synced": inserted,
                "target_table": "RV Files",
                "sync_type": "manual",
            }
            if property_id:
                log_payload["property_id"] = property_id
            sync_service.supabase.table("sync_logs").insert(log_payload).execute()
        except Exception as e:
            print(f"Logging insert error (rv): {str(e)}")

        return {"status": "success", "inserted": inserted, "errors": errors}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Manual RV sync failed: {str(e)}")


@router.get("/managed")
async def get_managed(
    property_name: str = Query(...),
    date: str = Query(...),
):
    """Database mode: return the cached RV report for one (property, date)."""
    try:
        if not sync_service.supabase:
            raise Exception("Supabase not initialized")
        res = sync_service.supabase.table("rv_files_sync").select("data, synced_at").eq(
            "property", property_name).eq("report_date", date).limit(1).execute()
        if not res.data:
            return {"status": "success", "data": None}
        row = res.data[0]
        blob = (row.get("data") or {}).get("blob", "")
        report = json.loads(encryption_service.decrypt(blob))
        report["_synced_at"] = row.get("synced_at")
        return {"status": "success", "data": report}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list")
async def get_list(property_name: str = Query(...)):
    """RV List tab - one summary row per day already imported for this
    property, newest first."""
    try:
        rows = await sync_service.get_rv_list(property_name)
        return {"status": "success", "data": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export")
async def export_report(
    property_name: str = Query(...),
    date: str = Query(...),
):
    """Download the pipe-delimited Infor RV journal file for one
    already-imported day (see sync_service.get_rv_export)."""
    try:
        text, filename = sync_service.get_rv_export(property_name, date)
        return PlainTextResponse(text, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
