import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Body

from app.services.sync_service import sync_service
from app.services.encryption import encryption_service

router = APIRouter(prefix="/st-files", tags=["ST Files"])


@router.get("/report")
async def get_report(
    property_name: str = Query(...),
    date: str = Query(..., description="YYYY-MM-DD, Asia/Bangkok calendar day"),
):
    """Live mode: build the full 8-tab ST Files report straight from MEWS."""
    try:
        report = await sync_service.get_st_files_report(property_name, date)
        return {"status": "success", "data": report}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync-manual")
async def sync_manual(payload: dict = Body(...)):
    """
    Import-to-Data-Mart: computes the report for every day in the range and
    upserts one encrypted row per (property, report_date) into st_files_sync.
    The whole report is Fernet-encrypted as a single blob (customers/arrivals
    carry guest PII and the structure is nested, so per-field encryption like
    the flat *_sync tables use wouldn't reach it).
    """
    try:
        property_name = payload.get("property_name")
        start_date = payload.get("start_date")  # YYYY-MM-DD
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
            print(f"Logging fetch error (st_files): {str(e)}")

        now_iso = datetime.now(timezone.utc).isoformat()
        inserted = 0
        errors = []
        day = start
        while day <= end:
            date_str = day.strftime("%Y-%m-%d")
            try:
                report = await sync_service.get_st_files_report(property_name, date_str)
                sync_service.supabase.table("st_files_sync").upsert({
                    "property": property_name,
                    "report_date": date_str,
                    "data": {"blob": encryption_service.encrypt(json.dumps(report))},
                    "synced_at": now_iso,
                }, on_conflict="property,report_date").execute()
                inserted += 1
            except Exception as e:
                errors.append(f"{date_str}: {str(e)[:200]}")
            day += timedelta(days=1)

        try:
            log_payload = {
                "property": property_name,
                "status": "success" if not errors else ("partial" if inserted else "error"),
                "message": f"Manual ST Files import {start_date}..{end_date}" + (f" ({len(errors)} failed)" if errors else ""),
                "records_synced": inserted,
                "target_table": "ST Files",
                "sync_type": "manual",
            }
            if property_id:
                log_payload["property_id"] = property_id
            sync_service.supabase.table("sync_logs").insert(log_payload).execute()
        except Exception as e:
            print(f"Logging insert error (st_files): {str(e)}")

        return {"status": "success", "inserted": inserted, "errors": errors}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Manual ST Files sync failed: {str(e)}")


@router.get("/managed")
async def get_managed(
    property_name: str = Query(...),
    date: str = Query(...),
):
    """Database mode: return the cached report for one (property, date)."""
    try:
        if not sync_service.supabase:
            raise Exception("Supabase not initialized")
        res = sync_service.supabase.table("st_files_sync").select("data, synced_at").eq(
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
