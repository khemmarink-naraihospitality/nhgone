import calendar
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel

from app.services import revenue_settings_service
from app.services.sync_service import sync_service

router = APIRouter(prefix="/occupancy", tags=["Occupancy"])


class VerifyStopSalePinRequest(BaseModel):
    pin: str

# How many whole months forward of the snapshot's own month each capture
# covers. 12 = through the same month next year (e.g. a 21-Aug-2026 capture
# spans 01-Aug-2026 to 31-Aug-2027), which is what the Occupancy By Type
# Calendar draws: complete month blocks, no half-month at either end.
SNAPSHOT_MONTHS_FORWARD = 12


def snapshot_range(date_str: str) -> tuple:
    """The (first night, last night) a snapshot taken on date_str covers.

    Anchored to whole months rather than to the capture date itself: the
    calendar and the occupancy grid are both read a month at a time, and a
    snapshot starting on the 21st left the first month's days 1-20 blank -
    the figures for those nights exist in MEWS, they just weren't being
    asked for. Occupancy is forward-looking, so it still reaches a year
    ahead; it just starts at the top of the current month instead of
    partway through it."""
    day = datetime.strptime(date_str, "%Y-%m-%d").date()
    start = day.replace(day=1)
    months = start.month - 1 + SNAPSHOT_MONTHS_FORWARD
    end_month = date(start.year + months // 12, months % 12 + 1, 1)
    end = end_month.replace(day=calendar.monthrange(end_month.year, end_month.month)[1])
    return start, end

# Snapshots kept per property, pruned by the daily auto-import - the same
# newest-N-per-property mechanism BCP uses. Two captures a day (08:00 and
# 13:00 Asia/Bangkok, see main.daily_auto_sync_occupancy) x 6 kept = 3 days
# of history, down from the old 7 days at one capture a day. Counting rows
# rather than measuring dates on purpose: if a capture is ever missed, a
# date cutoff would leave the property with less history to compare
# against, where newest-6 always holds six real snapshots.
#
# Pruning deliberately does NOT happen inside sync_occupancy_day, so the
# manual "Import To Data Mart" button can pull an older date up for a
# one-off comparison without it being deleted the moment it lands. The next
# scheduled run tidies it away.
SNAPSHOTS_KEPT = 6


def prune_occupancy_snapshots(property_name: str) -> int:
    """Drops everything past the newest SNAPSHOTS_KEPT for one property.
    Returns how many rows went. Never raises - retention tidying must not
    fail a capture that already succeeded.

    Ordered by synced_at, not report_date: two captures the same day (08:00
    and 13:00) share a report_date, and synced_at is the only column that
    still tells them apart in the right order."""
    try:
        old = sync_service.supabase.table("occupancy_sync") \
            .select("id") \
            .eq("property", property_name) \
            .order("synced_at", desc=True) \
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
    """Fetches + inserts one occupancy snapshot into occupancy_sync - shared
    by the manual Import button and the scheduled daily auto-import in
    main.py, so the two can't drift apart. Raises on failure; callers
    log/count it.

    Always a plain insert, never an upsert: occupancy_sync now takes TWO
    captures a day (08:00 and 13:00 Asia/Bangkok), so report_date alone no
    longer identifies a unique row (see api/sql/occupancy_two_captures_daily.sql,
    which drops the old UNIQUE(property, report_date) constraint an upsert
    depended on). Every capture - scheduled or a manual re-import of the
    same date - is its own row now; pruning by synced_at (see
    prune_occupancy_snapshots) is what keeps the table from growing
    unbounded, not a same-day overwrite.

    Stored as plain jsonb, not a Fernet blob like st_files_sync: the payload
    is category names and integer counts, with no guest PII in it, and the
    table's RLS (enabled, no policies) already keeps it to the service role.

    The Rate report rides along in the same row under a "rate" key rather
    than getting its own table/row: it's the same property, the same
    date, the same "what did the pace look like this morning" question,
    just priced instead of counted. A snapshot captured before the Rate
    tab existed simply has no "rate" key - get_managed/the frontend both
    already treat that as "not captured yet", the same way they treat any
    other missing field on an older row."""
    start, end = snapshot_range(date_str)
    occupancy_report = await sync_service.get_occupancy_report(
        property_name, start.isoformat(), end.isoformat())
    rate_report = await sync_service.get_rate_report(
        property_name, start.isoformat(), end.isoformat())
    combined = {**occupancy_report, "rate": rate_report}
    sync_service.supabase.table("occupancy_sync").insert({
        "property": property_name,
        "report_date": date_str,
        "data": combined,
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }).execute()


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


@router.get("/rate")
async def get_rate(
    property_name: str = Query(...),
    start_date: str = Query(..., description="YYYY-MM-DD, first night"),
    end_date: str = Query(..., description="YYYY-MM-DD, last night (inclusive)"),
):
    """Live from MEWS - the Rate tab's MEWS mode. A separate endpoint from
    /report rather than a combined one so switching to the Occupancy tab
    never waits on a rate fetch nobody asked for, and vice versa; the
    frontend fires both in parallel when it actually wants both ready."""
    try:
        report = await sync_service.get_rate_report(property_name, start_date, end_date)
        return {"status": "success", "data": report}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rate report failed: {str(e)}")


@router.get("/managed")
async def get_managed(
    property_name: str = Query(...),
    id: int = Query(None, description="Snapshot row id - preferred, addresses one exact capture"),
    date: str = Query(None, description="Snapshot date, YYYY-MM-DD - legacy, returns that date's newest capture"),
):
    """One stored snapshot - the page's NHG mode. Returns the outlook exactly
    as it stood on the morning it was captured, which is the whole point:
    comparing today's pace against last week's is impossible if the only
    available answer is always the live one.

    `id` addresses one exact row and is what the frontend's own Snapshot
    Date dropdown sends (see GET /list, which hands out each row's id) - it
    has to, now that a date alone doesn't identify a unique snapshot: two
    captures a day (08:00 and 13:00) share the same report_date. `date`
    survives as a fallback for anything that only has a calendar date to
    give (it resolves to that date's newest capture), but is no longer
    precise enough to pick between two same-day snapshots."""
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    if id is None and not date:
        raise HTTPException(status_code=400, detail="id or date is required")
    try:
        query = sync_service.supabase.table("occupancy_sync").select("data, synced_at").eq("property", property_name)
        query = query.eq("id", id) if id is not None else query.eq("report_date", date).order("synced_at", desc=True)
        res = query.limit(1).execute()
        if not res.data:
            where = f"id {id}" if id is not None else f"on {date}"
            raise HTTPException(
                status_code=404,
                detail=f"No imported snapshot for {property_name} {where} yet - switch MODE to MEWS, or use \"Import To Data Mart\" first.")
        payload = dict(res.data[0]["data"] or {})
        payload["_synced_at"] = res.data[0].get("synced_at")
        return {"status": "success", "data": payload}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not read the stored snapshot: {str(e)}")


@router.get("/list")
async def get_list(property_name: str = Query(...)):
    """Snapshot history for the property - one row per actual capture (up to
    two a day now, see main.daily_auto_sync_occupancy), each carrying its own
    id so GET /managed can address it precisely, and what its total
    occupancy looked like on its own first night."""
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        res = sync_service.supabase.table("occupancy_sync").select(
            "id, report_date, data, synced_at").eq("property", property_name).order(
            "synced_at", desc=True).limit(400).execute()
        rows = []
        for r in res.data or []:
            d = r.get("data") or {}
            total = (d.get("total") or {}).get("percent") or []
            rows.append({
                "id": r["id"],
                "date": r["report_date"],
                "synced_at": r.get("synced_at"),
                "nights": len(d.get("dates") or []),
                "categories": len(d.get("categories") or []),
                "first_night_percent": total[0] if total else None,
            })
        return {"status": "success", "data": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not list snapshots: {str(e)}")


@router.post("/verify-stop-sale-pin")
async def verify_stop_sale_pin(request: VerifyStopSalePinRequest):
    """Checked before the Occupancy By Type Calendar lets anyone edit the
    Stop-Sale threshold - see Admin > Revenue Settings for the PIN itself.
    Verified server-side rather than compared in the browser: the correct
    value would otherwise sit in the shipped JS bundle for anyone to read,
    which would defeat the point of gating the field at all."""
    ok = revenue_settings_service.verify_stop_sale_pin(request.pin)
    return {"status": "success", "data": {"ok": ok}}


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
