from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, HTTPException, Query

from app.services.sync_service import sync_service

router = APIRouter(prefix="/occupancy", tags=["Occupancy"])

# How far ahead each daily snapshot reaches. Occupancy is a forward-looking
# number - the point of capturing it every morning is to keep the booking
# pace for the weeks ahead, so a snapshot starts on its own date rather than
# the previous one (which is what ST Files does, that being a closed-day
# report). Two months is one MEWS call either way.
SNAPSHOT_DAYS_FORWARD = 59

# Snapshots kept per property, pruned by the daily auto-import - the same
# newest-N-per-property mechanism BCP uses, sized to a week here. Counting
# rows rather than measuring dates on purpose: if a morning is ever missed,
# a date cutoff would leave the property with fewer than a week of history
# to compare against, where newest-7 still holds seven real snapshots.
#
# Pruning deliberately does NOT happen inside sync_occupancy_day, so the
# manual "Import To Data Mart" button can pull an older date up for a
# one-off comparison without it being deleted the moment it lands. The next
# 08:00 run tidies it away.
SNAPSHOTS_KEPT = 7


def prune_occupancy_snapshots(property_name: str) -> int:
    """Drops everything past the newest SNAPSHOTS_KEPT for one property.
    Returns how many rows went. Never raises - retention tidying must not
    fail a capture that already succeeded."""
    try:
        old = sync_service.supabase.table("occupancy_sync") \
            .select("id") \
            .eq("property", property_name) \
            .order("report_date", desc=True) \
            .range(SNAPSHOTS_KEPT, SNAPSHOTS_KEPT + 200) \
            .execute()
        if not old.data:
            return 0
        ids = [r["id"] for r in old.data]
        sync_service.supabase.table("occupancy_sync").delete().in_("id", ids).execute()
        return len(ids)
    except Exception as e:
        print(f"Occupancy prune failed for {property_name}: {e}")
        return 0


async def sync_occupancy_day(property_name: str, date_str: str) -> None:
    """Fetches + upserts one (property, date) occupancy snapshot into
    occupancy_sync - shared by the manual Import button and the scheduled
    daily auto-import in main.py, so the two can't drift apart. Raises on
    failure; callers log/count it.

    Stored as plain jsonb, not a Fernet blob like st_files_sync: the payload
    is category names and integer counts, with no guest PII in it, and the
    table's RLS (enabled, no policies) already keeps it to the service role."""
    start = datetime.strptime(date_str, "%Y-%m-%d").date()
    end = start + timedelta(days=SNAPSHOT_DAYS_FORWARD)
    report = await sync_service.get_occupancy_report(
        property_name, start.isoformat(), end.isoformat())
    sync_service.supabase.table("occupancy_sync").upsert({
        "property": property_name,
        "report_date": date_str,
        "data": report,
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="property,report_date").execute()


@router.get("/report")
async def get_report(
    property_name: str = Query(...),
    start_date: str = Query(..., description="YYYY-MM-DD, first night"),
    end_date: str = Query(..., description="YYYY-MM-DD, last night (inclusive)"),
):
    """Live from MEWS - the page's MEWS mode."""
    try:
        report = await sync_service.get_occupancy_report(property_name, start_date, end_date)
        return {"status": "success", "data": report}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Occupancy report failed: {str(e)}")


@router.get("/managed")
async def get_managed(
    property_name: str = Query(...),
    date: str = Query(..., description="Snapshot date, YYYY-MM-DD"),
):
    """One stored snapshot - the page's NHG mode. Returns the outlook exactly
    as it stood on the morning it was captured, which is the whole point:
    comparing today's pace against last week's is impossible if the only
    available answer is always the live one."""
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        res = sync_service.supabase.table("occupancy_sync").select("data, synced_at").eq(
            "property", property_name).eq("report_date", date).limit(1).execute()
        if not res.data:
            raise HTTPException(
                status_code=404,
                detail=f"No imported snapshot for {property_name} on {date} yet - switch MODE to MEWS, or use \"Import To Data Mart\" first.")
        payload = dict(res.data[0]["data"] or {})
        payload["_synced_at"] = res.data[0].get("synced_at")
        return {"status": "success", "data": payload}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not read the stored snapshot: {str(e)}")


@router.get("/list")
async def get_list(property_name: str = Query(...)):
    """Snapshot history for the property - which mornings are on file, and
    what each one's total occupancy looked like on its own first night."""
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        res = sync_service.supabase.table("occupancy_sync").select(
            "report_date, data, synced_at").eq("property", property_name).order(
            "report_date", desc=True).limit(400).execute()
        rows = []
        for r in res.data or []:
            d = r.get("data") or {}
            total = (d.get("total") or {}).get("percent") or []
            rows.append({
                "date": r["report_date"],
                "synced_at": r.get("synced_at"),
                "nights": len(d.get("dates") or []),
                "categories": len(d.get("categories") or []),
                "first_night_percent": total[0] if total else None,
            })
        return {"status": "success", "data": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not list snapshots: {str(e)}")


@router.post("/sync-manual")
async def sync_manual(payload: dict = Body(...)):
    """Import To Data Mart: captures a snapshot per day in the range."""
    try:
        property_name = payload.get("property_name")
        start_date = payload.get("start_date")
        end_date = payload.get("end_date") or start_date
        if not property_name or not start_date:
            raise HTTPException(status_code=400, detail="property_name and start_date are required")

        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()
        if end < start:
            raise HTTPException(status_code=400, detail="end_date is before start_date")
        if (end - start).days > 31:
            raise HTTPException(status_code=400, detail="Range too large - import at most a month of snapshots at a time")

        property_id = None
        try:
            prop_res = sync_service.supabase.table("property_api_settings").select("id").ilike(
                "property_name", f"%{property_name}%").execute()
            if prop_res.data:
                property_id = prop_res.data[0].get("id")
        except Exception as e:
            print(f"Logging fetch error (occupancy): {str(e)}")

        inserted, errors = 0, []
        day = start
        while day <= end:
            try:
                await sync_occupancy_day(property_name, day.isoformat())
                inserted += 1
            except Exception as e:
                errors.append(f"{day.isoformat()}: {str(e)[:200]}")
            day += timedelta(days=1)

        try:
            log_payload = {
                "property": property_name,
                "status": "success" if not errors else ("partial" if inserted else "error"),
                "message": f"Manual Occupancy import {start_date}..{end_date}" + (f" ({len(errors)} failed)" if errors else ""),
                "records_synced": inserted,
                "target_table": "Occupancy",
                "sync_type": "manual",
            }
            if property_id:
                log_payload["property_id"] = property_id
            sync_service.supabase.table("sync_logs").insert(log_payload).execute()
        except Exception as e:
            print(f"Logging insert error (occupancy): {str(e)}")

        return {"status": "success", "inserted": inserted, "errors": errors}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Manual occupancy sync failed: {str(e)}")
