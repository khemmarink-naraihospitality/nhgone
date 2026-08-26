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
    # apply_overrides=False on purpose: rr4_tm30_sync holds MEWS's raw
    # answer, and the manual corrections (rr4_tm30_overrides) are laid over
    # it at every read instead. Storing the corrected version here would let
    # a later reset leave the pre-reset value baked into the blob, and would
    # make "what did MEWS actually say" unanswerable after the fact.
    rr4 = await sync_service.get_rr4_report(property_name, date_str, apply_overrides=False)
    tm30 = await sync_service.get_tm30_report(property_name, date_str, apply_overrides=False)
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
    # Stored raw (see sync_rr4_tm30_day) - the manual corrections belong on
    # top of it, so Database mode and the Edit page show the same register
    # the export produces.
    for kind in ("rr4", "tm30"):
        if isinstance(payload.get(kind), dict):
            sync_service.apply_rr4_tm30_overrides(payload[kind], property_name, date_str, kind)
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


# --- Manual edit overrides -------------------------------------------------
#
# Both kinds live here under /rr4 rather than getting a mirrored set under
# /tm30, matching how this module already works: /rr4/list and
# /rr4/sync-manual both cover the RR4+TM30 pair too, because the pair shares
# one stored row. The `kind` parameter picks which register a call is about.

_EDITABLE_KINDS = ("rr4", "tm30")


def _check_kind(kind: str) -> str:
    kind = (kind or "").lower()
    if kind not in _EDITABLE_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {_EDITABLE_KINDS}")
    return kind


def _overrides_error(e: Exception) -> HTTPException:
    """Reads (and generating) a register degrades silently to "no overrides"
    when the table is missing, so a database that hasn't had the migration
    run still files its files. WRITING is different - silently accepting an
    edit that went nowhere is the worst possible outcome here - so this
    turns the raw "relation does not exist" into something a person can act
    on."""
    text = str(e)
    # PostgREST answers a missing table with PGRST205 / "Could not find the
    # table ... in the schema cache" rather than Postgres's own "relation
    # does not exist" - match both, since which one surfaces depends on
    # whether the request got past the schema cache at all.
    missing = "PGRST205" in text or "Could not find the table" in text or "does not exist" in text
    if missing and sync_service.OVERRIDES_TABLE in text:
        return HTTPException(
            status_code=503,
            detail=(f"The {sync_service.OVERRIDES_TABLE} table has not been created yet - "
                    "run api/sql/rr4_tm30_overrides.sql in the Supabase SQL Editor first. "
                    "Nothing was saved."),
        )
    return HTTPException(status_code=500, detail=text)


@router.get("/edit-columns")
async def get_edit_columns(kind: str = Query("rr4")):
    """The column list the Edit page renders, served from the SAME constants
    the .xlsx export is built from (_RR4_COLUMNS / _TM30_COLUMNS) rather than
    being restated in the frontend - so a column added to the filed form can
    never end up missing from the editor, or vice versa.

    row_no is excluded: it's the register's positional line number, assigned
    after sorting, and editing it would only desynchronise the file from
    itself."""
    kind = _check_kind(kind)
    if kind == "rr4":
        cols = [
            {"key": key, "label_th": label, "field": field_key}
            for key, label, field_key in sync_service._RR4_COLUMNS
            if key != "row_no"
        ]
    else:
        cols = [
            {"key": key, "label_th": label, "field": key}
            for key, label in sync_service._TM30_COLUMNS
        ]
    return {"status": "success", "data": cols}


@router.post("/overrides")
async def save_override(payload: dict = Body(...)):
    """Merge-upsert one row's manual corrections for one (property, date,
    kind). `fields` is a partial {column: value} map - only the columns
    actually edited are sent, and they're merged onto whatever that row
    already had, so two people editing different columns of the same guest
    don't clobber each other.

    A field sent as null is dropped from the row's overrides, reverting that
    one column to MEWS's own value; when the last field goes, the row is
    deleted outright. Note that an empty string is NOT the same thing - some
    columns are legitimately blank on the filed form, so clearing a cell
    records a deliberate blank rather than a revert. The Edit page's Reset
    button uses DELETE below, which reverts a whole row at once."""
    property_name = payload.get("property_name")
    date_str = payload.get("date")
    row_key = payload.get("row_key")
    fields = payload.get("fields")
    kind = _check_kind(payload.get("kind"))
    if not property_name or not date_str or not row_key:
        raise HTTPException(status_code=400, detail="property_name, date and row_key are required")
    if not isinstance(fields, dict) or not fields:
        raise HTTPException(status_code=400, detail="fields must be a non-empty object")
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")

    try:
        existing = sync_service._rr4_tm30_overrides_map(property_name, date_str, kind).get(row_key, {})
        merged = dict(existing)
        for field, value in fields.items():
            if value is None:
                merged.pop(field, None)
            else:
                merged[field] = str(value)

        if not merged:
            sync_service.supabase.table(sync_service.OVERRIDES_TABLE).delete().eq(
                "property", property_name).eq("report_date", date_str).eq(
                "kind", kind).eq("row_key", row_key).execute()
            return {"status": "success", "fields": {}}

        sync_service.supabase.table(sync_service.OVERRIDES_TABLE).upsert({
            "property": property_name,
            "report_date": date_str,
            "kind": kind,
            "row_key": row_key,
            "data": {"blob": encryption_service.encrypt(json.dumps(merged))},
            "updated_by": payload.get("user_email") or "",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="property,report_date,kind,row_key").execute()
        return {"status": "success", "fields": merged}
    except HTTPException:
        raise
    except Exception as e:
        raise _overrides_error(e)


@router.delete("/overrides")
async def delete_override(
    property_name: str = Query(...),
    date: str = Query(...),
    kind: str = Query("rr4"),
    row_key: str = Query(None, description="Omit to reset every edited row for this day"),
):
    """Reset one row back to MEWS's own values, or - with row_key omitted -
    the whole day. Deleting the override is all that's needed: the stored
    rr4_tm30_sync blob was never overwritten, so the original values come
    back on the next read with no re-fetch from MEWS."""
    kind = _check_kind(kind)
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        query = sync_service.supabase.table(sync_service.OVERRIDES_TABLE).delete().eq(
            "property", property_name).eq("report_date", date).eq("kind", kind)
        if row_key:
            query = query.eq("row_key", row_key)
        res = query.execute()
        return {"status": "success", "deleted": len(res.data or [])}
    except Exception as e:
        raise _overrides_error(e)
