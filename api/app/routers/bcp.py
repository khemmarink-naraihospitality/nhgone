import base64
import gzip
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Body

from app.services.sync_service import sync_service
from app.services.encryption import encryption_service

router = APIRouter(prefix="/bcp", tags=["BCP"])

# Snapshots kept per property, pruned on every capture. Captures run every 5
# minutes, so 12 = 1 hour of history (reduced from the original 576/48h to
# cut Supabase disk usage - see project_bcp_disk_usage memory for the sizing
# that drove this call).
SNAPSHOTS_KEPT = 12


def _encode_snapshot_blob(snapshot: dict) -> dict:
    """Gzip the JSON before encrypting it - a whole ±7-day Timeline with every
    reservation's guests/orderItems/notes/payments embedded runs into several
    MB for busier properties (measured up to ~3.4MB decoded), and JSON
    compresses 80-90% smaller. Cuts the Supabase row size and the time to
    fetch/decrypt it back on every "Load Snapshot". The "gzip" flag lets the
    still-current 1-hour history from before this change (uncompressed)
    keep decoding correctly - see _decode_snapshot_blob - without needing a
    migration; it prunes itself out within an hour regardless.
    """
    compressed = gzip.compress(json.dumps(snapshot).encode("utf-8"))
    encoded = base64.b64encode(compressed).decode("ascii")
    return {"blob": encryption_service.encrypt(encoded), "gzip": True}


def _decode_snapshot_blob(data: Optional[dict]) -> dict:
    blob = (data or {}).get("blob", "")
    decrypted = encryption_service.decrypt(blob)
    if (data or {}).get("gzip"):
        decrypted = gzip.decompress(base64.b64decode(decrypted)).decode("utf-8")
    return json.loads(decrypted)


@router.get("/live")
async def get_live_snapshot(property_name: str = Query(...)):
    """Build a fresh snapshot straight from MEWS without storing it - used as
    the UI's fallback when nothing has been captured yet (and for testing).
    Useless once MEWS is actually down; the stored snapshots are the BCP."""
    try:
        snapshot = await sync_service.get_bcp_snapshot(property_name)
        return {"status": "success", "data": snapshot}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _floor_to_5min(dt: datetime) -> str:
    floored = dt.replace(minute=(dt.minute // 5) * 5, second=0, microsecond=0)
    return floored.strftime("%Y-%m-%dT%H:%M:%SZ")


async def capture_snapshot(property_name: str, captured_at_override: Optional[str] = None) -> str:
    """Builds + stores one snapshot, prunes history to SNAPSHOTS_KEPT, and
    returns the captured_utc timestamp.

    captured_at_override lets the automatic 5-minute cron (see
    capture_all_bcp_snapshots below) stamp every property captured in the
    same cycle with one shared, floored-to-5-minutes timestamp instead of
    each property's own actual completion time. Left unset (as the manual
    "Capture Now" button does), the real completion time is used, which is
    correct there since a manual click isn't part of the interval schedule.
    """
    snapshot = await sync_service.get_bcp_snapshot(property_name)
    # MEWS is confirmed reachable at this point - flush any note added
    # through our own system while it wasn't (see sync_pending_reservation_notes;
    # the one field BCP writes back to MEWS automatically, strictly as an
    # addition, never an edit/delete).
    await sync_service.sync_pending_reservation_notes(property_name)
    captured = captured_at_override or snapshot["captured_utc"]
    snapshot["captured_utc"] = captured
    sync_service.supabase.table("bcp_snapshots").insert({
        "property": property_name,
        "captured_at": captured,
        "data": _encode_snapshot_blob(snapshot),
    }).execute()

    # Prune: keep only the newest SNAPSHOTS_KEPT rows for this property.
    old = sync_service.supabase.table("bcp_snapshots") \
        .select("id") \
        .eq("property", property_name) \
        .order("captured_at", desc=True) \
        .range(SNAPSHOTS_KEPT, SNAPSHOTS_KEPT + 200) \
        .execute()
    if old.data:
        sync_service.supabase.table("bcp_snapshots").delete().in_(
            "id", [r["id"] for r in old.data]).execute()
    return captured


async def capture_all_bcp_snapshots():
    """Every-5-minutes job: capture a snapshot for every sync-enabled
    property. Successes are silent (a row per property per cycle would
    drown the Activity Log); failures are logged there so they surface.

    Locks per property via the same sync_locks mechanism daily_auto_sync
    uses (acquire/release_sync_lock), so an overrunning capture - or a
    concurrent full data sync for that property - can't overlap with the
    next 5-minute tick; that property is just skipped this cycle and
    retried on the next one.

    Properties are captured sequentially, each with its own real MEWS API
    round-trips, so by the time this loop reaches the last property its
    actual completion time can be a couple of minutes past when the cycle
    started - stamping captured_at with each one's own completion time (as
    this used to) landed on odd minutes like :01/:06 instead of :00/:05, and
    scattered property-to-property within the same logical cycle. Computing
    one shared, floored-to-5-minutes timestamp up front and passing it to
    every capture_snapshot call in this cycle fixes both.
    """
    try:
        props = sync_service.supabase.table("property_api_settings") \
            .select("id, property_name").eq("sync_enabled", True).execute()
    except Exception as e:
        print(f"BCP capture: failed to list properties: {e}")
        return
    cycle_captured_at = _floor_to_5min(datetime.now(timezone.utc))
    for p in props.data or []:
        prop_id = p.get("id")
        try:
            lock_acquired = sync_service.supabase.rpc("acquire_sync_lock", {
                "target_property_id": prop_id,
                "timeout_mins": 4,
            }).execute().data
            if not lock_acquired:
                continue  # a sync or another capture is already in flight for this property
        except Exception as lock_err:
            print(f"BCP capture: lock error for {p['property_name']}: {lock_err}")
            continue
        try:
            await capture_snapshot(p["property_name"], captured_at_override=cycle_captured_at)
        except Exception as e:
            print(f"BCP capture failed for {p['property_name']}: {e}")
            try:
                sync_service.supabase.table("sync_logs").insert({
                    "property": p["property_name"],
                    "property_id": prop_id,
                    "status": "error",
                    "message": f"BCP snapshot failed: {str(e)[:300]}",
                    "records_synced": 0,
                    "target_table": "BCP",
                    "sync_type": "auto",
                }).execute()
            except Exception:
                pass
        finally:
            try:
                sync_service.supabase.rpc("release_sync_lock", {"target_property_id": prop_id}).execute()
            except Exception:
                pass


@router.get("/auto-capture")
async def trigger_auto_capture(background_tasks: BackgroundTasks):
    """Dedicated Vercel Cron entry point (every 5 minutes) for BCP snapshots -
    separate from /sync/auto so this can run on its own fast cadence without
    dragging the main data sync and retry-failed-syncs jobs along with it."""
    background_tasks.add_task(capture_all_bcp_snapshots)
    return {"status": "accepted"}


@router.post("/capture")
async def capture_now(payload: dict = Body(...)):
    """Manual "Capture Now" from the BCP page."""
    property_name = payload.get("property_name")
    if not property_name:
        raise HTTPException(status_code=400, detail="property_name is required")
    try:
        captured = await capture_snapshot(property_name)
        return {"status": "success", "captured_at": captured}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/snapshots")
async def list_snapshots(property_name: str = Query(...)):
    """The stored snapshot history (newest first) for the picker."""
    try:
        res = sync_service.supabase.table("bcp_snapshots") \
            .select("id, captured_at") \
            .eq("property", property_name) \
            .order("captured_at", desc=True) \
            .limit(SNAPSHOTS_KEPT) \
            .execute()
        return {"status": "success", "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/last-capture")
async def get_last_capture(properties: Optional[str] = Query(None)):
    """
    Most recent bcp_snapshots.captured_at across the given properties (an
    optional comma-separated list; every property if omitted) - powers the
    Dashboard's "Business Continuity Plan Health" indicator.

    A dedicated endpoint (service role key, same as every other
    bcp_snapshots access) rather than a direct frontend Supabase query -
    this table has no anon-read policy, since normally only the backend
    ever reads it (it holds whole-blob Fernet-encrypted guest PII). The
    browser querying it directly with the anon key silently returns zero
    rows rather than an error, the same RLS pitfall already documented for
    role_permissions/profiles elsewhere in this codebase.
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        property_list = [p.strip() for p in properties.split(",") if p.strip()] if properties else None
        query = sync_service.supabase.table("bcp_snapshots").select("captured_at").order("captured_at", desc=True).limit(1)
        if property_list:
            query = query.in_("property", property_list)
        res = query.execute()
        return {"status": "success", "captured_at": res.data[0]["captured_at"] if res.data else None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/snapshot")
async def get_snapshot(id: str = Query(...)):
    try:
        res = sync_service.supabase.table("bcp_snapshots").select("data, captured_at").eq("id", id).limit(1).execute()
        if not res.data:
            return {"status": "success", "data": None}
        snapshot = _decode_snapshot_blob(res.data[0].get("data"))
        return {"status": "success", "data": snapshot}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reg-card")
async def save_reg_card(payload: dict = Body(...)):
    """
    Persists a signed Reg Card (guest details + the on-screen SignaturePad
    capture) from the Reservations tab's Reg Card modal. Unlike Check In/
    Check Out - which only mimic an action MEWS would otherwise record, so
    they stay purely local and get flagged red as "not synced" - a signed
    Reg Card is new data our own system is creating from scratch. There's
    nothing to reconcile against MEWS, so it's fine (and the whole point) to
    actually store it: it's the front desk's own durable proof of who signed
    while MEWS was down. Room Status and Chg Room also persist their current
    value now (see room-status/room-changes below) - only Check In/Check Out
    remain pure audit-trail-only with no visible effect on the displayed data.
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    property_name = payload.get("property_name")
    if not property_name:
        raise HTTPException(status_code=400, detail="property_name is required")

    record = {
        "guest": payload.get("guest", ""),
        "nationality": payload.get("nationality", ""),
        "room": payload.get("room", ""),
        "category": payload.get("category", ""),
        "check_in": payload.get("check_in", ""),
        "check_out": payload.get("check_out", ""),
        "adults": payload.get("adults", 0),
        "children": payload.get("children", 0),
        "signature_data_url": payload.get("signature_data_url", ""),
        # Required front-desk-entered field - MEWS's customer profile often
        # has no Occupation at all, and the printed form used to fall back to
        # a fabricated default ("นักธุรกิจ") in that case; now it's whatever
        # was actually typed in (pre-filled from MEWS when present).
        "occupation": payload.get("occupation", ""),
        # Pre-filled from MEWS's customer profile when present, same as
        # Occupation, but not required - marketing_consent is a separate
        # opt-in checkbox next to it, defaulting False (never assumed).
        "email": payload.get("email", ""),
        "marketing_consent": bool(payload.get("marketing_consent", False)),
        # ร.ร.๓ sections 1/2 (Place of Departure / Next Destination) - filled
        # in on the Reg Card screen before the guest signs so they're on the
        # printed form itself instead of left blank for hand-writing.
        "departure_option": payload.get("departure_option", "current"),
        "departure_detail": payload.get("departure_detail", ""),
        "destination_option": payload.get("destination_option", "current"),
        "destination_detail": payload.get("destination_detail", ""),
    }
    try:
        sync_service.supabase.table("bcp_reg_cards").insert({
            "property": property_name,
            "reservation_number": payload.get("reservation_number"),
            # A reservation can have multiple guests (Owner + companions),
            # each with their own signed card sharing the same stay - keyed
            # by mews_customer_id alongside reservation_number so one
            # guest's save/read never clobbers another's. Nullable for
            # backward compatibility with rows saved before this existed.
            "mews_customer_id": payload.get("mews_customer_id"),
            "data": {"blob": encryption_service.encrypt(json.dumps(record))},
        }).execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reg-card")
async def get_reg_card(property_name: str = Query(...), reservation_number: str = Query(...), mews_customer_id: Optional[str] = Query(None)):
    """
    The most recently saved Reg Card for one guest on a reservation, if any -
    so reopening it (e.g. Save, Close, then Reg Card again later) restores
    that guest's signature and details instead of starting blank, since
    save_reg_card above was write-only and never had a matching read.
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        query = sync_service.supabase.table("bcp_reg_cards") \
            .select("data, created_at") \
            .eq("property", property_name) \
            .eq("reservation_number", reservation_number)
        if mews_customer_id:
            query = query.eq("mews_customer_id", mews_customer_id)
        res = query.order("created_at", desc=True).limit(1).execute()
        if not res.data:
            return {"status": "success", "data": None}
        blob = (res.data[0].get("data") or {}).get("blob", "")
        record = json.loads(encryption_service.decrypt(blob))
        return {"status": "success", "data": record}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/room-status")
async def get_room_status_overrides(property_name: str = Query(...)):
    """
    Housekeeping status per room (Inspected/Clean/Dirty/OutOfService/
    OutOfOrder), set from the Rooms (HK) tab. Was localStorage-only, keyed by
    property+date, so it was invisible on another device and silently reset
    every midnight - a room's physical condition isn't a "per day" concept,
    so this is keyed by (property, room) only and just holds whatever the
    latest status is, permanently, until changed again. reason is only ever
    non-null for OutOfService/OutOfOrder (see the frontend's required-reason
    modal) and is cleared whenever the room moves to any other status.
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        res = sync_service.supabase.table("bcp_room_status_overrides") \
            .select("room, status, reason") \
            .eq("property", property_name) \
            .execute()
        return {"status": "success", "data": {r["room"]: {"status": r["status"], "reason": r.get("reason")} for r in (res.data or [])}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/room-status")
async def set_room_status_override(payload: dict = Body(...)):
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    property_name = payload.get("property_name")
    room = payload.get("room")
    new_status = payload.get("status")
    if not property_name or not room or not new_status:
        raise HTTPException(status_code=400, detail="property_name, room, and status are required")
    try:
        sync_service.supabase.table("bcp_room_status_overrides").upsert({
            "property": property_name,
            "room": room,
            "status": new_status,
            "reason": payload.get("reason"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="property,room").execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/room-changes")
async def get_room_change_overrides(property_name: str = Query(...)):
    """
    Which room a reservation is currently actually in, per the front desk's
    own Chg Room actions - MEWS is down, so this can't be written back there,
    but leaving it as an audit-trail-only Action Log entry meant the
    Reservations table kept showing the stale pre-change room with no visible
    indication anything had moved. Keyed by (property, reservation_number),
    holding the latest room permanently until changed again (or the
    reservation naturally ages out of the snapshot window).
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        res = sync_service.supabase.table("bcp_room_changes") \
            .select("reservation_number, new_room") \
            .eq("property", property_name) \
            .execute()
        return {"status": "success", "data": {r["reservation_number"]: r["new_room"] for r in (res.data or [])}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/room-changes")
async def set_room_change_override(payload: dict = Body(...)):
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    property_name = payload.get("property_name")
    reservation_number = payload.get("reservation_number")
    new_room = payload.get("new_room")
    if not property_name or not reservation_number or not new_room:
        raise HTTPException(status_code=400, detail="property_name, reservation_number, and new_room are required")
    try:
        sync_service.supabase.table("bcp_room_changes").upsert({
            "property": property_name,
            "reservation_number": reservation_number,
            "new_room": new_room,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="property,reservation_number").execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/room-numbers")
async def get_room_number_overrides(property_name: str = Query(...)):
    """
    Display-only room number override, applied wherever a room number is
    shown to the user (Timeline, Rooms (HK), Reservations, Reg Card, etc.).
    Deliberately separate from room-changes/room-status above: the ORIGINAL
    MEWS room number keeps being used as the key for every other override
    (status, reason, chg-room, action-log matching) - renaming a room's
    display label here can never orphan or break those lookups, since
    nothing else is keyed by the renamed value.
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        res = sync_service.supabase.table("bcp_room_number_overrides") \
            .select("room, display_number") \
            .eq("property", property_name) \
            .execute()
        return {"status": "success", "data": {r["room"]: r["display_number"] for r in (res.data or [])}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/room-numbers")
async def set_room_number_override(payload: dict = Body(...)):
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    property_name = payload.get("property_name")
    room = payload.get("room")
    display_number = payload.get("display_number")
    if not property_name or not room or not display_number:
        raise HTTPException(status_code=400, detail="property_name, room, and display_number are required")
    try:
        sync_service.supabase.table("bcp_room_number_overrides").upsert({
            "property": property_name,
            "room": room,
            "display_number": display_number,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="property,room").execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/arrival-overrides")
async def get_arrival_overrides(property_name: str = Query(...)):
    """
    Front desk's own Arrival/Departure correction from the Manage > Properties
    tab, since MEWS is down and can't be edited there directly. Keyed by
    (property, reservation_number), holding the latest check_in/check_out
    permanently until changed again - same shape as room-changes above.
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        res = sync_service.supabase.table("bcp_arrival_overrides") \
            .select("reservation_number, check_in, check_out, reason") \
            .eq("property", property_name) \
            .execute()
        return {
            "status": "success",
            "data": {
                r["reservation_number"]: {"check_in": r.get("check_in"), "check_out": r.get("check_out"), "reason": r.get("reason")}
                for r in (res.data or [])
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/arrival-overrides")
async def set_arrival_override(payload: dict = Body(...)):
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    property_name = payload.get("property_name")
    reservation_number = payload.get("reservation_number")
    check_in = payload.get("check_in")
    check_out = payload.get("check_out")
    reason = payload.get("reason")
    if not property_name or not reservation_number or not reason or not (check_in and check_out):
        raise HTTPException(status_code=400, detail="property_name, reservation_number, check_in, check_out, and reason are required")
    try:
        sync_service.supabase.table("bcp_arrival_overrides").upsert({
            "property": property_name,
            "reservation_number": reservation_number,
            "check_in": check_in,
            "check_out": check_out,
            "reason": reason,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="property,reservation_number").execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/room-type-overrides")
async def get_room_type_overrides(property_name: str = Query(...)):
    """
    Front desk's own Room Type (requested category) correction from the
    Manage > Properties tab - same reasoning and shape as arrival-overrides
    above, keyed by (property, reservation_number).
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        res = sync_service.supabase.table("bcp_room_type_overrides") \
            .select("reservation_number, category, reason") \
            .eq("property", property_name) \
            .execute()
        return {
            "status": "success",
            "data": {r["reservation_number"]: {"category": r["category"], "reason": r.get("reason")} for r in (res.data or [])},
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/room-type-overrides")
async def set_room_type_override(payload: dict = Body(...)):
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    property_name = payload.get("property_name")
    reservation_number = payload.get("reservation_number")
    category = payload.get("category")
    reason = payload.get("reason")
    if not property_name or not reservation_number or not category or not reason:
        raise HTTPException(status_code=400, detail="property_name, reservation_number, category, and reason are required")
    try:
        sync_service.supabase.table("bcp_room_type_overrides").upsert({
            "property": property_name,
            "reservation_number": reservation_number,
            "category": category,
            "reason": reason,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="property,reservation_number").execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/billing-overrides")
async def get_billing_overrides(property_name: str = Query(...)):
    """
    Whether the front desk's own Process Payment (Manage > Billing tab) has
    been used on a reservation - presence alone means "processed", same
    one-way semantics as MEWS's own Process payment once a bill is actually
    settled (there's no un-process action here either). Keyed by
    (property, reservation_number).
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        res = sync_service.supabase.table("bcp_billing_overrides") \
            .select("reservation_number, note, processed_at") \
            .eq("property", property_name) \
            .execute()
        return {
            "status": "success",
            "data": {r["reservation_number"]: {"note": r.get("note"), "processedAt": r.get("processed_at")} for r in (res.data or [])},
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/billing-overrides")
async def set_billing_override(payload: dict = Body(...)):
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    property_name = payload.get("property_name")
    reservation_number = payload.get("reservation_number")
    if not property_name or not reservation_number:
        raise HTTPException(status_code=400, detail="property_name and reservation_number are required")
    try:
        sync_service.supabase.table("bcp_billing_overrides").upsert({
            "property": property_name,
            "reservation_number": reservation_number,
            "note": payload.get("note"),
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="property,reservation_number").execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/room-lock-overrides")
async def get_room_lock_overrides(property_name: str = Query(...)):
    """
    Whether front desk has locally flipped a reservation's room-assignment
    lock while MEWS is unreachable (never pushed to MEWS itself - see
    effectiveRoomLocked in bcp/page.tsx, which overrides the raw snapshot's
    room_locked with the latest value here). Keyed by (property,
    reservation_number).
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        res = sync_service.supabase.table("bcp_room_lock_overrides") \
            .select("reservation_number, locked") \
            .eq("property", property_name) \
            .execute()
        return {
            "status": "success",
            "data": {r["reservation_number"]: r["locked"] for r in (res.data or [])},
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/room-lock-overrides")
async def set_room_lock_override(payload: dict = Body(...)):
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    property_name = payload.get("property_name")
    reservation_number = payload.get("reservation_number")
    locked = payload.get("locked")
    if not property_name or not reservation_number or not isinstance(locked, bool):
        raise HTTPException(status_code=400, detail="property_name, reservation_number and locked (bool) are required")
    try:
        sync_service.supabase.table("bcp_room_lock_overrides").upsert({
            "property": property_name,
            "reservation_number": reservation_number,
            "locked": locked,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="property,reservation_number").execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reservation-notes")
async def get_reservation_notes(property_name: str = Query(...), reservation_number: str = Query(...)):
    """
    Notes added to a reservation through our own system while MEWS may be
    down - permanent (never pruned, unlike bcp_snapshots), shown merged
    alongside MEWS's own serviceOrderNotes on the frontend. synced_to_mews
    reflects whether sync_pending_reservation_notes has already pushed this
    one into MEWS for real (see that function for the one-way, add-only
    write-back this table exists to queue).
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        res = sync_service.supabase.table("bcp_reservation_notes") \
            .select("id, text, created_at, created_by, synced_to_mews") \
            .eq("property", property_name) \
            .eq("reservation_number", reservation_number) \
            .order("created_at", desc=True) \
            .execute()
        return {"status": "success", "data": res.data or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reservation-notes")
async def add_reservation_note(payload: dict = Body(...)):
    """
    Adds a note permanently to our own system (separate from bcp_snapshots)
    and queues it (synced_to_mews defaults False) to be written into MEWS
    itself the next time a capture for this property succeeds - see
    sync_pending_reservation_notes. This is the one BCP field that pushes
    back to MEWS automatically, per explicit instruction, and only ever as
    an addition - never an edit or delete of anything already in MEWS.
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    property_name = payload.get("property_name")
    reservation_number = payload.get("reservation_number")
    mews_reservation_id = payload.get("mews_reservation_id")
    text = (payload.get("text") or "").strip()
    if not property_name or not reservation_number or not mews_reservation_id or not text:
        raise HTTPException(status_code=400, detail="property_name, reservation_number, mews_reservation_id, and text are required")
    try:
        res = sync_service.supabase.table("bcp_reservation_notes").insert({
            "property": property_name,
            "reservation_number": reservation_number,
            "mews_reservation_id": mews_reservation_id,
            "text": text,
            "created_by": payload.get("user_email"),
        }).execute()
        return {"status": "success", "data": res.data[0] if res.data else None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/guest-overrides")
async def get_guest_overrides(property_name: str = Query(...), reservation_number: str = Query(...)):
    """
    Local corrections to a reservation's guest list - editing a guest's
    profile (name, nationality, passport, etc.), adding a walk-in guest MEWS
    never had, or removing one from the displayed list - captured while
    there's no live MEWS connection to actually change any of this. Permanent
    (never pruned, unlike bcp_snapshots), keyed by (property, reservation_number,
    guest_key): guest_key is the guest's own mews_customer_id for an edit/
    removal of an existing MEWS guest, or a client-generated "local-..." id
    for a guest added here that has no MEWS record at all.
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        res = sync_service.supabase.table("bcp_guest_overrides") \
            .select("guest_key, removed, data") \
            .eq("property", property_name) \
            .eq("reservation_number", reservation_number) \
            .execute()
        rows = []
        for row in res.data or []:
            blob = (row.get("data") or {}).get("blob", "")
            guest = json.loads(encryption_service.decrypt(blob)) if blob else {}
            rows.append({"guest_key": row["guest_key"], "removed": bool(row.get("removed")), "data": guest})
        return {"status": "success", "data": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/guest-overrides")
async def save_guest_override(payload: dict = Body(...)):
    """
    Upserts one guest override - editing an existing guest's profile fields,
    adding a brand new guest, or marking one removed all go through this same
    endpoint (removed is just a flag, so "un-removing" is possible by saving
    again with removed: false, though the UI doesn't currently expose that).
    data is whatever GuestIdentity-shaped fields the front desk has for this
    guest - stored as the guest's full current profile, not a diff against
    MEWS, so a later read never needs to re-merge it against the snapshot.
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    property_name = payload.get("property_name")
    reservation_number = payload.get("reservation_number")
    guest_key = payload.get("guest_key")
    if not property_name or not reservation_number or not guest_key:
        raise HTTPException(status_code=400, detail="property_name, reservation_number, and guest_key are required")
    try:
        sync_service.supabase.table("bcp_guest_overrides").upsert({
            "property": property_name,
            "reservation_number": reservation_number,
            "guest_key": guest_key,
            "removed": bool(payload.get("removed", False)),
            "data": {"blob": encryption_service.encrypt(json.dumps(payload.get("data") or {}))},
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="property,reservation_number,guest_key").execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _action_log_row_to_json(row: dict) -> dict:
    blob = (row.get("data") or {}).get("blob", "")
    fields = json.loads(encryption_service.decrypt(blob)) if blob else {}
    return {
        "id": row["id"],
        "at": row["created_at"],
        "checked": bool(row.get("checked")),
        "archived": bool(row.get("archived")),
        **fields,
    }


@router.get("/action-logs")
async def list_action_logs(property_name: str = Query(...), report_date: Optional[str] = Query(None)):
    """
    Reservations/Rooms/Action Logs tabs' shared audit trail (Check In/Out,
    Chg Room, Room Status, Reg Card Saved). Previously kept in localStorage
    only - durable in Supabase now, per feedback that it must never be lost
    to a device change or a cleared browser, unlike bcp_snapshots (which is
    deliberately pruned - this table is not).

    report_date used to be required, scoping every query to a single day -
    but that just made yesterday's entries look lost the moment the date
    rolled over, when they were sitting in the table the whole time. Now
    optional and unused by the frontend: every entry for the property comes
    back, permanently, since an unresolved (not yet re-keyed into MEWS)
    action shouldn't stop being flagged just because a day passed.
    """
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    try:
        query = sync_service.supabase.table("bcp_action_logs") \
            .select("id, checked, archived, data, created_at") \
            .eq("property", property_name)
        if report_date:
            query = query.eq("report_date", report_date)
        res = query.order("created_at", desc=True).execute()
        return {"status": "success", "data": [_action_log_row_to_json(r) for r in (res.data or [])]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/action-logs")
async def create_action_log(payload: dict = Body(...)):
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    property_name = payload.get("property_name")
    report_date = payload.get("report_date")
    if not property_name or not report_date:
        raise HTTPException(status_code=400, detail="property_name and report_date are required")

    fields = {
        "reservationNumber": payload.get("reservation_number"),
        "guest": payload.get("guest", ""),
        "room": payload.get("room", ""),
        "action": payload.get("action", ""),
        "detail": payload.get("detail", ""),
        "reason": payload.get("reason"),
        "userEmail": payload.get("user_email", ""),
        # Frozen copies of the reservation + matched guest profile as they
        # stood at the moment of this action, so the Action Log Detail page
        # can show full Reservation Detail/Guest Profile permanently, even
        # after the booking changes or ages out of the live Timeline window.
        # Nested objects are fine - the whole `fields` dict is one encrypted
        # JSON blob already, no schema needed for either.
        "reservationSnapshot": payload.get("reservation_snapshot"),
        "guestProfileSnapshot": payload.get("guest_profile_snapshot"),
    }
    try:
        res = sync_service.supabase.table("bcp_action_logs").insert({
            "property": property_name,
            "report_date": report_date,
            "checked": False,
            "data": {"blob": encryption_service.encrypt(json.dumps(fields))},
        }).execute()
        return {"status": "success", "data": _action_log_row_to_json(res.data[0])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/action-logs/toggle")
async def toggle_action_log(payload: dict = Body(...)):
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    log_id = payload.get("id")
    checked = payload.get("checked")
    if not log_id or checked is None:
        raise HTTPException(status_code=400, detail="id and checked are required")
    try:
        sync_service.supabase.table("bcp_action_logs").update({"checked": checked}).eq("id", log_id).execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/action-logs/archive")
async def archive_action_logs(payload: dict = Body(...)):
    """Bulk archive/unarchive - the Action Logs tab's row-select checkboxes
    move many rows into (or back out of) the Archive table below in one
    click rather than one request per row. Archiving never deletes
    anything, just hides a row from the main table (still fully visible,
    searchable and restorable in the Archive table) - this is a
    decluttering view, not a way to lose history."""
    if not sync_service.supabase:
        raise HTTPException(status_code=503, detail="Supabase not initialized")
    ids = payload.get("ids")
    archived = payload.get("archived")
    if not ids or not isinstance(ids, list) or archived is None:
        raise HTTPException(status_code=400, detail="ids (non-empty list) and archived are required")
    try:
        sync_service.supabase.table("bcp_action_logs").update({"archived": archived}).in_("id", ids).execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
