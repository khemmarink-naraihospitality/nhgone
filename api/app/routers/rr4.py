import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, Body
from fastapi.responses import Response

from app.services.sync_service import sync_service
from app.services.encryption import encryption_service

router = APIRouter(prefix="/rr4", tags=["RR4"])


async def sync_rr4_tm30_day(property_name: str, date_str: str) -> None:
    """Fetches + upserts one (property, date) RR4 AND TM30 report pair into
    rr4_tm30_sync - shared by the manual Import To Data Mart button below and
    the scheduled daily auto-import in main.py, so the two can't drift out of
    sync with each other. Raises on failure; callers log/count it.

    Both reports are stored in ONE row because they're built from the same
    single reservations/getAll call (see sync_service._rr4_tm30_fetch_day) -
    keeping them together halves the MEWS API cost versus syncing each
    separately, and they always describe the same day anyway.

    Whole payload Fernet-encrypted as a single blob like st_files_sync: the
    rows carry guest PII (names, passport/ID numbers, birth dates, phone
    numbers) nested inside a list, which per-field encryption can't reach."""
    rr4 = await sync_service.get_rr4_report(property_name, date_str)
    tm30 = await sync_service.get_tm30_report(property_name, date_str)
    payload = {"rr4": rr4, "tm30": tm30}
    sync_service.supabase.table("rr4_tm30_sync").upsert({
        "property": property_name,
        "report_date": date_str,
        "data": {"blob": encryption_service.encrypt(json.dumps(payload))},
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="property,report_date").execute()


def read_managed_day(property_name: str, date_str: str) -> dict:
    """Decrypts one stored (property, date) row back into {"rr4": ..., "tm30":
    ...}, or None if that day was never imported. Shared by /rr4/managed and
    /tm30/managed so both read the exact same stored blob."""
    if not sync_service.supabase:
        raise Exception("Supabase not initialized")
    res = sync_service.supabase.table("rr4_tm30_sync").select("data, synced_at").eq(
        "property", property_name).eq("report_date", date_str).limit(1).execute()
    if not res.data:
        return None
    row = res.data[0]
    blob = (row.get("data") or {}).get("blob", "")
    payload = json.loads(encryption_service.decrypt(blob))
    payload["_synced_at"] = row.get("synced_at")
    return payload


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


@router.get("/managed")
async def get_managed(
    property_name: str = Query(...),
    date: str = Query(...),
):
    """Database mode: return the cached RR4 report for one (property, date)."""
    try:
        payload = read_managed_day(property_name, date)
        if not payload:
            return {"status": "success", "data": None}
        report = payload.get("rr4") or {}
        report["_synced_at"] = payload.get("_synced_at")
        return {"status": "success", "data": report}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync-manual")
async def sync_manual(payload: dict = Body(...)):
    """Import-to-Data-Mart: computes the RR4+TM30 pair for every day in the
    range and upserts one encrypted row per (property, report_date)."""
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
            print(f"Logging fetch error (rr4/tm30): {str(e)}")

        inserted = 0
        errors = []
        day = start
        while day <= end:
            date_str = day.strftime("%Y-%m-%d")
            try:
                await sync_rr4_tm30_day(property_name, date_str)
                inserted += 1
            except Exception as e:
                errors.append(f"{date_str}: {str(e)[:200]}")
            day += timedelta(days=1)

        try:
            log_payload = {
                "property": property_name,
                "status": "success" if not errors else ("partial" if inserted else "error"),
                "message": f"Manual RR4/TM30 import {start_date}..{end_date}" + (f" ({len(errors)} failed)" if errors else ""),
                "records_synced": inserted,
                "target_table": "RR4/TM30",
                "sync_type": "manual",
            }
            if property_id:
                log_payload["property_id"] = property_id
            sync_service.supabase.table("sync_logs").insert(log_payload).execute()
        except Exception as e:
            print(f"Logging insert error (rr4/tm30): {str(e)}")

        return {"status": "success", "inserted": inserted, "errors": errors}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Manual RR4/TM30 sync failed: {str(e)}")


@router.get("/list")
async def get_list(property_name: str = Query(...)):
    """One summary row per day already imported for this property, newest
    first - backs the RR4 & TM30 Files table's history."""
    try:
        if not sync_service.supabase:
            raise Exception("Supabase not initialized")
        res = sync_service.supabase.table("rr4_tm30_sync").select("report_date, data, synced_at").eq(
            "property", property_name).order("report_date", desc=True).limit(120).execute()
        rows = []
        for row in res.data or []:
            try:
                payload = json.loads(encryption_service.decrypt((row.get("data") or {}).get("blob", "")))
            except Exception:
                # A row that won't decrypt (e.g. written under a rotated key)
                # still shows its date rather than breaking the whole list.
                payload = {}
            rows.append({
                "date": row.get("report_date"),
                "rr4_rows": len((payload.get("rr4") or {}).get("rows", [])),
                "tm30_rows": len((payload.get("tm30") or {}).get("rows", [])),
                "synced_at": row.get("synced_at"),
            })
        return {"status": "success", "data": rows}
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
