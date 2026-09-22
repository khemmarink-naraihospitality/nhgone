"""Kiosk configuration and today's check-in list for the /kiosk screens.

Configuration is edited at Admin Console > Kiosks, stored in `kiosk_settings`
(one row per kiosk; a property can have several). Everything goes through this
router with the service role rather than straight from the browser, because the
row holds `pin_code`, which unlocks the settings screen on a terminal standing
in a public lobby - see the RLS note in api/sql/kiosk_settings.sql.

The check-in list (`/arrivals`) is a per-minute mirror of MEWS's own arrivals
in `kiosk_reservations_sync`, kept current by main.auto_sync_kiosk_arrivals -
see sync_kiosk_arrivals below.
"""

import json
import logging
import secrets
import time
import uuid
from datetime import datetime, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Body, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.config import get_supabase_client
# The property's Check In Form config, resolved the same way the kiosk screen
# resolves it - see add_kiosk_guest.
from app.routers.checkin_form import (
    KIOSK_PROFILE_FIELDS,
    document_settings as checkin_document_settings,
    effective_state as checkin_effective_state,
    field_label as checkin_field_label,
    load_fields as load_checkin_fields,
)
from app.services.encryption import encryption_service
from app.services.storage_buckets import ensure_public_bucket
from app.services.sync_service import sync_service

router = APIRouter(prefix="/kiosks", tags=["Kiosks"])
logger = logging.getLogger(__name__)

KIOSK_IMAGE_BUCKET = "kiosk-images"
_IMAGE_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
_IMAGE_MAX_BYTES = 5 * 1024 * 1024
_TABLE_HINT = "run api/sql/kiosk_settings.sql in the Supabase SQL Editor first"


class KioskCreate(BaseModel):
    property_name: str
    name: str
    actor: Optional[str] = None


class KioskUpdate(BaseModel):
    name: Optional[str] = None
    theme: Optional[str] = None
    default_language: Optional[str] = None
    key_cutter: Optional[str] = None
    key_issuing: Optional[str] = None
    payment_method: Optional[str] = None
    payment_terminal: Optional[str] = None
    options_enabled: Optional[List[str]] = None
    checkin_grace_hours: Optional[int] = None
    checkin_grace_minutes: Optional[int] = None
    early_checkin_fee: Optional[str] = None
    checkout_grace_hours: Optional[int] = None
    checkout_grace_minutes: Optional[int] = None
    reservation_lookup: Optional[str] = None
    take_key_instructions: Optional[str] = None
    cut_key_instructions: Optional[str] = None
    thank_you_message: Optional[str] = None
    contact_instructions: Optional[str] = None
    checkout_instructions: Optional[str] = None
    cut_key_video_url: Optional[str] = None
    screen_saver_video_url: Optional[str] = None
    actor: Optional[str] = None


def _missing_table(error: Exception) -> bool:
    """Whether this failure is "the migration hasn't been run"."""
    message = str(error).lower()
    return "kiosk_settings" in message and ("does not exist" in message or "not find the table" in message)


def _guard(error: Exception) -> HTTPException:
    if _missing_table(error):
        return HTTPException(status_code=400, detail=f"The kiosk_settings table doesn't exist yet - {_TABLE_HINT}")
    return HTTPException(status_code=500, detail=str(error))


def _clamp(value, low: int, high: int, default: int = 0) -> int:
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# Everything the terminal is allowed to know about itself. pin_code is the
# one field deliberately left out: it unlocks the settings screen on a device
# standing in a public lobby, and this endpoint answers that very device.
_GUEST_SAFE_FIELDS = (
    "id", "property_name", "name", "theme", "default_language",
    "payment_method", "options_enabled",
    "checkin_grace_hours", "checkin_grace_minutes",
    "checkout_grace_hours", "checkout_grace_minutes",
    "early_checkin_fee", "reservation_lookup",
    "take_key_instructions", "cut_key_instructions", "thank_you_message",
    "contact_instructions", "checkout_instructions",
    "cut_key_video_url", "screen_saver_video_url", "images",
)


@router.get("/config")
async def kiosk_config(property_name: str = Query(...), kiosk_id: Optional[str] = Query(None)):
    """The configuration a check-in terminal actually runs on.

    Declared before any /{kiosk_id} route so "config" is never mistaken for
    an id. Returns `data: null` rather than a 404 when the property has no
    kiosk configured - the screens then fall back to their built-in defaults,
    which is the right outcome for a terminal nobody has set up yet.

    A property can have several kiosks. Without device pairing (removed - see
    the kiosk layout's own note) a terminal picks the property's first kiosk
    by name; `?kiosk=<id>` in the URL points a specific terminal at a
    specific one.
    """
    try:
        query = get_supabase_client().table("kiosk_settings").select(",".join(_GUEST_SAFE_FIELDS))
        query = query.eq("id", kiosk_id) if kiosk_id else query.eq("property_name", property_name)
        result = query.order("name").limit(1).execute()
        return {"status": "success", "data": (result.data or [None])[0]}
    except Exception as e:
        raise _guard(e)


ARRIVALS_TABLE = "kiosk_reservations_sync"
_ARRIVALS_HINT = "run api/sql/kiosk_reservations_sync.sql in the Supabase SQL Editor first"
_ARRIVALS_UPSERT_CHUNK = 200


def _arrivals_guard(error: Exception) -> HTTPException:
    if isinstance(error, HTTPException):
        return error
    message = str(error).lower()
    if ARRIVALS_TABLE in message and ("does not exist" in message or "not find the table" in message):
        return HTTPException(status_code=400, detail=f"The {ARRIVALS_TABLE} table doesn't exist yet - {_ARRIVALS_HINT}")
    return HTTPException(status_code=500, detail=str(error))


def _arrivals_enabled(property_name: str) -> bool:
    """property_api_settings.kiosk_arrivals_sync_enabled. False, not an error,
    before the SQL adding that column has been run."""
    try:
        res = get_supabase_client().table("property_api_settings").select(
            "kiosk_arrivals_sync_enabled").eq("property_name", property_name).limit(1).execute()
    except Exception:
        return False
    return bool(res.data and res.data[0].get("kiosk_arrivals_sync_enabled"))


async def sync_kiosk_arrivals(property_name: str) -> int:
    """Mirror one property's arrivals for today into kiosk_reservations_sync.

    Shared by the per-minute schedule (main.auto_sync_kiosk_arrivals) and
    POST /arrivals/sync, so the two can never disagree about what the mirror
    holds. Returns how many reservations MEWS answered with.

    Every row this run writes is stamped with a `synced_at` later than the
    moment the run started, so "today's rows stamped before this run began"
    is exactly the set MEWS no longer returns - a reservation moved to
    another day, or one that stopped existing. Deleting by that stamp rather
    than by "not in this run's ids" also keeps two overlapping runs safe:
    an older run can never delete what a newer one has just written.

    A MEWS or write failure raises before anything is deleted, so a bad
    minute leaves the last good list in place instead of emptying the kiosk.
    """
    run_started = _now()
    report = await sync_service.get_kiosk_arrivals(property_name)
    synced_at = _now()
    rows = [{
        "mews_id": r["id"],
        "property_name": property_name,
        "arrival_date": report["arrival_date"],
        "time_zone": report["time_zone"],
        "number": r["number"],
        "state": r["state"],
        "scheduled_start_utc": r["scheduled_start_utc"],
        "scheduled_end_utc": r["scheduled_end_utc"],
        "person_count": r["person_count"],
        "room_category": r["room_category"],
        "guest_name": encryption_service.encrypt(r["guest_name"]),
        "guest_email": encryption_service.encrypt(r["guest_email"]),
        "mews_updated_utc": r["mews_updated_utc"],
        "synced_at": synced_at,
    } for r in report["reservations"]]

    table = get_supabase_client().table
    for i in range(0, len(rows), _ARRIVALS_UPSERT_CHUNK):
        chunk = rows[i:i + _ARRIVALS_UPSERT_CHUNK]
        try:
            table(ARRIVALS_TABLE).upsert(chunk, on_conflict="mews_id").execute()
        except Exception as e:
            if "timeout" not in str(e).lower():
                raise
            half = _ARRIVALS_UPSERT_CHUNK // 2
            for j in range(0, len(chunk), half):
                table(ARRIVALS_TABLE).upsert(chunk[j:j + half], on_conflict="mews_id").execute()

    table(ARRIVALS_TABLE).delete().eq("property_name", property_name).eq(
        "arrival_date", report["arrival_date"]).lt("synced_at", run_started).execute()
    table(ARRIVALS_TABLE).delete().eq("property_name", property_name).lt(
        "arrival_date", report["arrival_date"]).execute()
    return len(rows)


def _arrival_fields(row: dict, include_contact: bool = False) -> dict:
    fields = {
        "id": row["mews_id"],
        "number": row.get("number") or "",
        "state": row.get("state") or "",
        "guest_name": encryption_service.decrypt(row.get("guest_name") or ""),
        "person_count": row.get("person_count") or 0,
        "scheduled_start_utc": row.get("scheduled_start_utc"),
        "scheduled_end_utc": row.get("scheduled_end_utc"),
        "time_zone": row.get("time_zone"),
        "room_category": row.get("room_category") or "",
    }
    if include_contact:
        fields["guest_email"] = encryption_service.decrypt(row.get("guest_email") or "")
    return fields


def _number_key(number: Optional[str]) -> int:
    return int(number) if number and number.isdigit() else 0


@router.get("/arrivals")
async def kiosk_arrivals(property_name: str = Query(...), include_all: bool = Query(False)):
    """The check-in list a terminal shows: today's Confirmed arrivals, newest
    reservation number first - the order MEWS's own kiosk lists them in.

    `include_all` is the search screen's "Show all reservations" switch
    (off by default): every one of today's arrivals in whatever state MEWS
    holds - checked in, canceled and so on - each carrying its `state` so
    the screen can label it and keep it from being picked for check-in.

    Reads the per-minute mirror, never MEWS: a lobby full of guests tapping
    the screen must not turn into a MEWS request per tap. "Today" is taken in
    the property's own timezone from the rows themselves, so if the schedule
    ever stops, yesterday's leftovers still don't show up as today's guests.

    No email here on purpose: the list is on screen for anyone standing at
    the terminal, and an address is only needed once a guest has picked their
    own reservation (GET /arrivals/{reservation_id}).
    """
    if not _arrivals_enabled(property_name):
        return {"status": "success", "enabled": False, "data": []}
    try:
        rows = get_supabase_client().table(ARRIVALS_TABLE).select("*").eq(
            "property_name", property_name).execute().data or []
    except Exception as e:
        raise _arrivals_guard(e)

    if rows:
        today = datetime.now(ZoneInfo(rows[0].get("time_zone") or "Asia/Bangkok")).date().isoformat()
        rows = [
            r for r in rows
            if r.get("arrival_date") == today and (include_all or r.get("state") == "Confirmed")
        ]
    rows.sort(key=lambda r: _number_key(r.get("number")), reverse=True)
    return {"status": "success", "enabled": True, "data": [_arrival_fields(r) for r in rows]}


@router.post("/arrivals/sync")
async def sync_kiosk_arrivals_now(property_name: str = Query(...)):
    """Refresh the mirror now instead of waiting for the next minute. Refused
    for a property the schedule doesn't cover: rows nothing keeps current
    would quietly go stale on a guest-facing screen."""
    if not _arrivals_enabled(property_name):
        raise HTTPException(
            status_code=400,
            detail=f"Kiosk arrivals sync isn't enabled for {property_name} "
                   "(property_api_settings.kiosk_arrivals_sync_enabled).")
    try:
        count = await sync_kiosk_arrivals(property_name)
    except Exception as e:
        raise _arrivals_guard(e)
    return {"status": "success", "records_synced": count}


@router.get("/arrivals/{reservation_id}")
async def kiosk_arrival(reservation_id: str, property_name: str = Query(...)):
    """One reservation for the confirm/registration screens, including the
    guest's email and its "Included" list. Returned in whatever state it's
    now in - the screen tells a guest their booking can't be checked in here
    rather than pretending it doesn't exist.

    The base fields come from the per-minute mirror; "included" is one live
    MEWS call on top (get_kiosk_included_items) - a single reservation looked
    up on demand, not the whole lobby polling every 30s, so a live call here
    doesn't scale the way it would in GET /arrivals. Best-effort: a MEWS
    hiccup drops the list to empty rather than failing the whole screen.
    """
    try:
        res = get_supabase_client().table(ARRIVALS_TABLE).select("*").eq(
            "mews_id", reservation_id).eq("property_name", property_name).limit(1).execute()
    except Exception as e:
        raise _arrivals_guard(e)
    if not res.data:
        raise HTTPException(status_code=404, detail="That reservation isn't in today's arrivals.")

    fields = _arrival_fields(res.data[0], include_contact=True)
    try:
        fields["included"] = await sync_service.get_kiosk_included_items(property_name, reservation_id)
    except Exception as e:
        logger.warning(f"Kiosk included-items fetch failed for {reservation_id}: {e}")
        fields["included"] = []
    return {"status": "success", "data": fields}


REG_CARDS_TABLE = "kiosk_reg_cards"
EXTRA_GUESTS_TABLE = "kiosk_extra_guests"
_REGISTRATION_HINT = "run api/sql/kiosk_registration.sql in the Supabase SQL Editor first"


def _is_storage_missing(error: Exception) -> bool:
    """True when the error is just api/sql/kiosk_registration.sql not having
    been run yet - one of its two tables not existing - as opposed to a real
    failure."""
    message = str(error).lower()
    return ("kiosk_reg_cards" in message or "kiosk_extra_guests" in message) and (
        "does not exist" in message or "not find the table" in message
    )


def _registration_guard(error: Exception) -> HTTPException:
    if isinstance(error, HTTPException):
        return error
    if _is_storage_missing(error):
        return HTTPException(status_code=400, detail=f"Registration storage isn't set up yet - {_REGISTRATION_HINT}")
    return HTTPException(status_code=500, detail=str(error))


def _blob(record: dict) -> dict:
    return {"blob": encryption_service.encrypt(json.dumps(record))}


def _unblob(row: dict) -> dict:
    try:
        return json.loads(encryption_service.decrypt((row.get("data") or {}).get("blob", "")))
    except Exception:
        return {}


# What the kiosk collects about a guest added at the terminal - the same
# fields MEWS's own kiosk asks for on its Add guest form (verified against
# screenshots of it, 17-Sep-2026). Stored in the guest's encrypted blob in
# kiosk_extra_guests: these are passport numbers and home addresses. The
# document is kept in MEWS's own customer shape (Number / Issuance /
# Expiration / IssuingCountryCode / IssuingCity, one object per document
# type), so that if customers/add is ever enabled for our token the record
# can be replayed into MEWS without translation.
_PROFILE_TEXT_FIELDS = (
    "first_name", "last_name", "nationality", "telephone", "occupation", "email",
    "address_line1", "address_line2", "city", "postal_code", "country",
    "document_number", "issue_date", "issuing_country", "issuing_city", "expiration_date",
)
_DOCUMENT_TYPES = ("passport", "identity_card", "drivers_license")


def _clean_profile(payload: dict) -> dict:
    profile = {f: (str(payload.get(f) or "")).strip() for f in _PROFILE_TEXT_FIELDS}
    doc_type = (payload.get("document_type") or "passport").strip()
    profile["document_type"] = doc_type if doc_type in _DOCUMENT_TYPES else "passport"
    # Only an identity card carries an issuing city on MEWS's form.
    if profile["document_type"] != "identity_card":
        profile["issuing_city"] = ""
    return profile


async def _reservation_guests(property_name: str, reservation_id: str) -> tuple:
    """(reservation number, [guests]) for one reservation, straight from MEWS.

    The owner first, then every companion MEWS lists - the same
    CustomerId/CompanionIds pair get_rr3_cards reads, so the kiosk's guest
    list and the ร.ร.๓ cards can never disagree about who is on the booking.
    """
    from app.services.mews_client import mews_client

    res = await mews_client.post(
        "/api/connector/v1/reservations/getAll",
        {"ReservationIds": [reservation_id], "Extent": {"Reservations": True, "Customers": True}},
        property_name=property_name,
    )
    reservations = res.get("Reservations", [])
    if not reservations:
        return None, []
    reservation = reservations[0]
    customers = {c["Id"]: c for c in res.get("Customers", []) if c.get("Id")}

    owner_id = reservation.get("CustomerId") or reservation.get("OwnerId")
    ordered = [owner_id] if owner_id else []
    for cid in reservation.get("CompanionIds") or []:
        if cid and cid not in ordered:
            ordered.append(cid)

    guests = []
    for cid in ordered:
        c = customers.get(cid) or {}
        guest = {
            "guest_key": cid,
            "first_name": c.get("FirstName") or "",
            "last_name": c.get("LastName") or "",
            "email": c.get("Email") or "",
            "is_owner": cid == owner_id,
            "source": "mews",
        }
        # The owner's home address, for the "Use address" card on an added
        # guest's form - MEWS's own kiosk offers exactly that, since people
        # travelling together usually share one. The owner's only: nobody
        # else's address has any reason to be on a lobby screen.
        if cid == owner_id:
            addr = c.get("Address") or {}
            guest["address"] = {
                "address_line1": addr.get("Line1") or "",
                "address_line2": "" if (addr.get("Line2") or "").strip() in ("", "-") else addr["Line2"],
                "city": addr.get("City") or "",
                "postal_code": addr.get("PostalCode") or "",
                "country": addr.get("CountryCode") or "",
            }
        guests.append(guest)
    return reservation.get("Number"), guests


@router.get("/registration")
async def kiosk_registration(property_name: str = Query(...), reservation_id: str = Query(...)):
    """Everyone on a reservation, and which of them has already signed.

    MEWS's own occupants first (owner + companions), then anyone added at the
    terminal. A kiosk-added guest exists only here: `customers/add` and
    `reservations/addCompanion` both answer 401 for our Connector token, so
    there is nowhere in MEWS to put them until that scope is enabled - see
    api/sql/kiosk_registration.sql for the measurement.
    """
    try:
        number, guests = await _reservation_guests(property_name, reservation_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not read the reservation from MEWS: {e}")
    if number is None:
        raise HTTPException(status_code=404, detail="That reservation isn't in MEWS any more.")

    # The owner and companions above came from MEWS and are real whether or
    # not the kiosk's own tables exist. So a missing table - the SQL not run
    # yet - costs only what those tables hold (terminal-added guests, who has
    # signed), never the whole list: storage_ready tells the screen to say it
    # can't SAVE yet, rather than that the reservation couldn't be loaded.
    # Any other failure is still a real error.
    supabase = get_supabase_client()
    storage_ready = True
    extra, signed = [], []
    try:
        extra = supabase.table(EXTRA_GUESTS_TABLE).select("*").eq(
            "property", property_name).eq("reservation_number", number).order("created_at").execute().data or []
        signed = supabase.table(REG_CARDS_TABLE).select("guest_key, created_at").eq(
            "property", property_name).eq("reservation_number", number).execute().data or []
    except Exception as e:
        if not _is_storage_missing(e):
            raise _registration_guard(e)
        storage_ready = False
        extra, signed = [], []

    for row in extra:
        record = _unblob(row)
        guests.append({
            "guest_key": row.get("guest_key"),
            "first_name": record.get("first_name") or "",
            "last_name": record.get("last_name") or "",
            "email": record.get("email") or "",
            "is_owner": False,
            "source": "kiosk",
            # So re-opening a guest already entered refills their form rather
            # than presenting it blank.
            "profile": _clean_profile(record),
        })

    signed_at = {}
    for row in signed:
        key = row.get("guest_key")
        if key and row.get("created_at", "") > signed_at.get(key, ""):
            signed_at[key] = row["created_at"]
    for g in guests:
        g["signed_at"] = signed_at.get(g["guest_key"])

    return {"status": "success", "reservation_number": number, "data": guests,
            "storage_ready": storage_ready}


@router.post("/registration/guests")
async def add_kiosk_guest(payload: dict = Body(...)):
    """Add a guest at the terminal, or update one already added.

    Stored here, not in MEWS - see kiosk_registration's docstring for why
    that is a permission wall rather than a choice. The whole profile the
    form collects goes into the guest's encrypted blob (see
    _PROFILE_TEXT_FIELDS). Passing the guest_key of a guest already added
    updates that guest in place; omitting it creates a new one.

    WHICH fields are required is the property's own Check In Form (Admin
    Console > Kiosks > Check In Form), resolved here exactly as the screen
    resolves it - so the stars a guest saw and the rule enforced on the way
    in can't drift apart. A field the property set Hidden is BLANKED rather
    than merely unchecked: a property that chose not to collect an occupation
    should not end up with one stored because a client posted it anyway.

    A guest added at the terminal is never the reservation owner, so the
    "Other adults" column is the one that applies.
    """
    property_name = (payload.get("property_name") or "").strip()
    reservation_number = (payload.get("reservation_number") or "").strip()
    if not property_name or not reservation_number:
        raise HTTPException(status_code=400, detail="property_name and reservation_number are required.")

    fields = load_checkin_fields(property_name)
    profile = _clean_profile(payload)

    required = []
    for field, (category, key) in KIOSK_PROFILE_FIELDS.items():
        state = checkin_effective_state(fields, category, key, "other_adults")
        if state == "Hidden":
            profile[field] = ""
        elif state == "Required":
            required.append(field)

    doc_visibility, doc_allowed = checkin_document_settings(fields)
    if doc_visibility == "Hidden":
        for field in ("document_number", "issue_date", "issuing_country", "issuing_city", "expiration_date"):
            profile[field] = ""
    else:
        if doc_visibility == "Required":
            required.append("document_number")
        # A type the property doesn't accept is not a type this guest picked
        # on the screen - it falls back to the first one that is offered.
        if profile["document_type"] not in doc_allowed:
            profile["document_type"] = doc_allowed[0]
            if profile["document_type"] != "identity_card":
                profile["issuing_city"] = ""

    missing = [checkin_field_label(field) for field in required if not profile[field]]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required: {', '.join(missing)}.")

    guest_key = (payload.get("guest_key") or "").strip()
    if guest_key and not guest_key.startswith("kiosk:"):
        raise HTTPException(status_code=400, detail="Only a guest added at this terminal can be edited here.")
    if not guest_key:
        guest_key = f"kiosk:{uuid.uuid4()}"

    try:
        get_supabase_client().table(EXTRA_GUESTS_TABLE).upsert({
            "property": property_name,
            "reservation_number": reservation_number,
            "guest_key": guest_key,
            "data": _blob(profile),
        }, on_conflict="property,reservation_number,guest_key").execute()
    except Exception as e:
        raise _registration_guard(e)
    return {"status": "success", "guest_key": guest_key}


@router.post("/registration/attach-rr3")
async def attach_rr3_card(payload: dict = Body(...)):
    """Freeze a signed ร.ร.๓ card and attach it to the guest's MEWS profile.

    Two separate things, in this order, because they fail differently:

    1. **Freeze** the card's own field values onto the guest's reg-card row
       (`kiosk_reg_cards.data.rr3_card`). RR3 is otherwise rebuilt LIVE from
       MEWS every time it is viewed, so a profile edited days later reprints
       a different document from the one the guest put their name to. The
       signature attests to the facts that were on the screen, so those facts
       are kept. Only the field values are stored, never the rendered image -
       the card re-renders from them identically, and an A4 PNG per guest is
       what turned bcp_snapshots into the biggest table in the database.

    2. **Attach** the rendered PNG to the guest's Mews customer profile
       (`customers/addFile`). Best-effort and always last: MEWS refusing the
       file is not a reason to lose the frozen card or to tell a guest their
       check-in failed.

    A guest ADDED at the terminal has no Mews profile to attach to yet
    (`guest_key` is our own `kiosk:<uuid>`, not a CustomerId) - their card is
    frozen and the upload is reported as skipped, not failed. Creating those
    profiles with `customers/add` is its own piece of work.
    """
    property_name = (payload.get("property_name") or "").strip()
    reservation_number = (payload.get("reservation_number") or "").strip()
    guest_key = (payload.get("guest_key") or "").strip()
    image = payload.get("image_data_url") or ""
    card = payload.get("card") or {}
    if not property_name or not reservation_number or not guest_key:
        raise HTTPException(status_code=400, detail="property_name, reservation_number and guest_key are required.")

    supabase = get_supabase_client()

    # --- 1. freeze, onto the newest reg-card row for this guest -------------
    frozen = False
    try:
        rows = supabase.table(REG_CARDS_TABLE).select("id, data").eq(
            "property", property_name).eq("reservation_number", reservation_number).eq(
            "guest_key", guest_key).order("created_at", desc=True).limit(1).execute().data or []
        if rows:
            record = _unblob(rows[0])
            # The card carries the guest's own name, passport/ID number and
            # address, so it goes back through the same whole-blob encryption
            # the signature already uses rather than beside it in the clear.
            record["rr3_card"] = card
            supabase.table(REG_CARDS_TABLE).update({"data": _blob(record)}).eq("id", rows[0]["id"]).execute()
            frozen = True
    except Exception as e:
        if not _is_storage_missing(e):
            raise _registration_guard(e)

    # --- 2. attach to the MEWS customer profile ----------------------------
    # A kiosk-added guest's key is our own id, not a Mews CustomerId.
    customer_id = "" if guest_key.startswith("kiosk:") else guest_key
    if not customer_id:
        return {"status": "success", "frozen": frozen, "mews_file": "skipped-no-mews-profile"}
    if not image.startswith("data:image/"):
        return {"status": "success", "frozen": frozen, "mews_file": "skipped-no-image"}

    header, _, base64_data = image.partition(",")
    mime = header[5:].split(";")[0] or "image/png"
    extension = {"image/png": "png", "image/jpeg": "jpg"}.get(mime, "png")
    name = f"RR3_{reservation_number}_{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.{extension}"

    from app.services.mews_client import mews_client
    try:
        res = await mews_client.post(
            "/api/connector/v1/customers/addFile",
            {"CustomerId": customer_id, "Name": name, "MimeType": mime, "Data": base64_data},
            property_name=property_name,
        )
        return {"status": "success", "frozen": frozen, "mews_file": "attached",
                "file_id": (res or {}).get("Id"), "file_name": name}
    except Exception as e:
        logger.warning(f"RR3 not attached to the MEWS profile for {reservation_number}/{guest_key}: {e}")
        return {"status": "success", "frozen": frozen, "mews_file": "failed"}


@router.get("/countries")
async def kiosk_countries():
    """Every country code the kiosk's nationality / country / issuing-country
    pickers offer: exactly _RR3_COUNTRY_MAP's set, which is the set the RR3,
    RR4 and TM30 registers translate - so nothing picked here can be a code
    those forms don't understand. English names come along as a fallback;
    the screen shows each in the guest's own language (Intl.DisplayNames)."""
    from app.services.sync_service import _RR3_COUNTRY_MAP

    return {"status": "success",
            "data": [{"code": code, "name": name}
                     for code, name in sorted(_RR3_COUNTRY_MAP.items(), key=lambda kv: kv[1])]}


@router.delete("/registration/guests")
async def delete_kiosk_guest(property_name: str = Query(...), reservation_number: str = Query(...),
                             guest_key: str = Query(...)):
    """Remove a guest added at the terminal, and the card they signed.

    Only ever a kiosk-added guest: MEWS's own occupants can't be deleted from
    here (deleteCompanion is 401), and the reservation owner is not removable
    at all - they are who the booking belongs to.
    """
    if not guest_key.startswith("kiosk:"):
        raise HTTPException(
            status_code=400,
            detail="Only a guest added at this terminal can be removed here. "
                   "A guest on the MEWS booking has to be changed in MEWS.")
    supabase = get_supabase_client()
    try:
        supabase.table(EXTRA_GUESTS_TABLE).delete().eq("property", property_name).eq(
            "reservation_number", reservation_number).eq("guest_key", guest_key).execute()
        supabase.table(REG_CARDS_TABLE).delete().eq("property", property_name).eq(
            "reservation_number", reservation_number).eq("guest_key", guest_key).execute()
    except Exception as e:
        raise _registration_guard(e)
    return {"status": "success"}


@router.post("/registration/sign")
async def sign_kiosk_registration(payload: dict = Body(...)):
    """Store one guest's signed registration card.

    The signature is a PNG data URL from the same SignaturePad the BCP Reg
    Card uses, and `sync_service.get_rr3_cards` merges it onto that guest's
    ร.ร.๓ card - so signing here is what puts the signature on the statutory
    form, exactly as a signature captured at the front desk does.

    Best-effort, after the row is safely stored: a short note goes back onto
    the MEWS reservation (serviceOrderNotes/add - the one write our token is
    allowed; the Connector API has no attachment endpoint at all), so someone
    looking at the booking in MEWS can see a card was signed and where it
    lives. A MEWS failure here never loses the signature.
    """
    property_name = (payload.get("property_name") or "").strip()
    reservation_number = (payload.get("reservation_number") or "").strip()
    guest_key = (payload.get("guest_key") or "").strip()
    signature = payload.get("signature_data_url") or ""
    if not property_name or not reservation_number or not guest_key:
        raise HTTPException(status_code=400, detail="property_name, reservation_number and guest_key are required.")
    if not signature.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="A signature is required.")

    record = {
        "first_name": (payload.get("first_name") or "").strip(),
        "last_name": (payload.get("last_name") or "").strip(),
        "email": (payload.get("email") or "").strip(),
        "marketing_consent": bool(payload.get("marketing_consent", False)),
        "terms_accepted": bool(payload.get("terms_accepted", False)),
        "signature_data_url": signature,
        "signed_via": "kiosk",
    }
    try:
        get_supabase_client().table(REG_CARDS_TABLE).insert({
            "property": property_name,
            "reservation_number": reservation_number,
            "guest_key": guest_key,
            "data": _blob(record),
        }).execute()
    except Exception as e:
        raise _registration_guard(e)

    note = None
    reservation_id = (payload.get("reservation_id") or "").strip()
    if reservation_id:
        from app.services.mews_client import mews_client
        guest_name = f"{record['first_name']} {record['last_name']}".strip() or "Guest"
        try:
            await mews_client.post(
                "/api/connector/v1/serviceOrderNotes/add",
                {"ServiceOrderNotes": [{
                    "ServiceOrderId": reservation_id,
                    "Type": "General",
                    "Value": f"Registration card signed at the self check-in kiosk by {guest_name} "
                             f"({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC). "
                             f"The signed ร.ร.๓ card is held in NHGOne.",
                }]},
                property_name=property_name,
            )
            note = "written"
        except Exception as e:
            # The card is already stored; MEWS not taking the note is not a
            # reason to tell the guest their check-in failed.
            logger.warning(f"Kiosk registration note not written to MEWS for {reservation_number}: {e}")
            note = "failed"

    return {"status": "success", "mews_note": note}


@router.get("")
async def list_kiosks(property_name: Optional[str] = Query(None)):
    """Every kiosk, or just one property's. Ordered by name so the list on
    screen doesn't reshuffle itself between saves."""
    try:
        query = get_supabase_client().table("kiosk_settings").select("*")
        if property_name:
            query = query.eq("property_name", property_name)
        result = query.order("name").execute()
        return {"status": "success", "data": result.data or []}
    except Exception as e:
        raise _guard(e)


@router.post("")
async def create_kiosk(request: KioskCreate):
    """Create a kiosk with the defaults the table declares. The PIN is minted
    here rather than typed: it is a device unlock code, and letting someone
    pick it invites 000000."""
    name = (request.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="A kiosk name is required.")
    if not (request.property_name or "").strip():
        raise HTTPException(status_code=400, detail="A property is required.")

    row = {
        "property_name": request.property_name.strip(),
        "name": name,
        # secrets, not random: this unlocks a terminal in a public lobby.
        "pin_code": secrets.token_hex(3).upper(),
        "created_by": request.actor,
        "updated_by": request.actor,
    }
    try:
        result = get_supabase_client().table("kiosk_settings").insert(row).execute()
        return {"status": "success", "data": (result.data or [None])[0]}
    except Exception as e:
        raise _guard(e)


@router.put("/{kiosk_id}")
async def update_kiosk(kiosk_id: str, request: KioskUpdate):
    """Save the form. Only fields actually sent are written, so a future field
    added to the page can't blank out one this build doesn't know about."""
    payload = request.model_dump(exclude_unset=True)
    actor = payload.pop("actor", None)

    if "name" in payload:
        payload["name"] = (payload["name"] or "").strip()
        if not payload["name"]:
            raise HTTPException(status_code=400, detail="A kiosk name is required.")

    # Grace periods are minutes-past-the-hour, not free integers - a typo of
    # 900 minutes would otherwise be stored and silently mean 15 hours.
    for field, high in (
        ("checkin_grace_hours", 240),
        ("checkout_grace_hours", 240),
        ("checkin_grace_minutes", 59),
        ("checkout_grace_minutes", 59),
    ):
        if field in payload:
            payload[field] = _clamp(payload[field], 0, high)

    payload["updated_at"] = _now()
    payload["updated_by"] = actor

    try:
        result = get_supabase_client().table("kiosk_settings").update(payload).eq("id", kiosk_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="That kiosk no longer exists.")
        return {"status": "success", "data": result.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise _guard(e)


@router.delete("/{kiosk_id}")
async def delete_kiosk(kiosk_id: str):
    """Delete a kiosk and its stored images - an image nothing points at is
    just a file nobody can ever reach again."""
    supabase = get_supabase_client()
    try:
        existing = supabase.table("kiosk_settings").select("images").eq("id", kiosk_id).execute()
    except Exception as e:
        raise _guard(e)

    paths = [
        image.get("path")
        for row in (existing.data or [])
        for image in (row.get("images") or [])
        if image.get("path")
    ]
    if paths:
        try:
            supabase.storage.from_(KIOSK_IMAGE_BUCKET).remove(paths)
        except Exception as e:
            # A leftover file is untidy; refusing the delete over it is worse.
            logger.warning(f"Could not remove images for kiosk {kiosk_id}: {e}")

    try:
        supabase.table("kiosk_settings").delete().eq("id", kiosk_id).execute()
        return {"status": "success", "message": "Kiosk deleted"}
    except Exception as e:
        raise _guard(e)


@router.post("/{kiosk_id}/image")
async def add_kiosk_image(kiosk_id: str, file: UploadFile = File(...), actor: Optional[str] = Form(None)):
    """Append one image to a kiosk's gallery."""
    extension = _IMAGE_TYPES.get((file.content_type or "").lower())
    if not extension:
        raise HTTPException(status_code=400, detail="Please choose a PNG, JPG, WebP or GIF image.")

    content = await file.read()
    if len(content) > _IMAGE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Image must be 5 MB or smaller.")

    supabase = get_supabase_client()
    try:
        existing = supabase.table("kiosk_settings").select("images").eq("id", kiosk_id).execute()
    except Exception as e:
        raise _guard(e)
    if not existing.data:
        raise HTTPException(status_code=404, detail="That kiosk no longer exists.")
    images = existing.data[0].get("images") or []

    # A new name per upload rather than one fixed name: public objects are
    # served through a CDN, and an overwritten file keeps serving the old
    # picture until that cache expires.
    path = f"{kiosk_id}/{int(time.time() * 1000)}.{extension}"
    storage = supabase.storage

    def _put() -> None:
        storage.from_(KIOSK_IMAGE_BUCKET).upload(
            path, content,
            {"content-type": file.content_type, "cache-control": "31536000", "upsert": "false"})

    try:
        _put()
    except Exception as e:
        if "bucket not found" not in str(e).lower():
            raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
        if not ensure_public_bucket(storage, KIOSK_IMAGE_BUCKET, _IMAGE_MAX_BYTES, _IMAGE_TYPES):
            raise HTTPException(
                status_code=500,
                detail="The kiosk-images storage bucket is missing and could not be created automatically.")
        try:
            _put()
        except Exception as retry_error:
            raise HTTPException(status_code=500, detail=f"Upload failed: {retry_error}")

    url = storage.from_(KIOSK_IMAGE_BUCKET).get_public_url(path)
    images = images + [{"url": url, "path": path}]
    try:
        supabase.table("kiosk_settings").update(
            {"images": images, "updated_at": _now(), "updated_by": actor}
        ).eq("id", kiosk_id).execute()
    except Exception as e:
        # Don't leave a file behind that no row points at.
        try:
            storage.from_(KIOSK_IMAGE_BUCKET).remove([path])
        except Exception:
            pass
        raise _guard(e)

    return {"status": "success", "data": {"images": images}}


@router.delete("/{kiosk_id}/image")
async def remove_kiosk_image(kiosk_id: str, path: str = Query(...), actor: Optional[str] = Query(None)):
    """Remove one image from a kiosk's gallery, addressed by its stored path."""
    supabase = get_supabase_client()
    try:
        existing = supabase.table("kiosk_settings").select("images").eq("id", kiosk_id).execute()
    except Exception as e:
        raise _guard(e)
    if not existing.data:
        raise HTTPException(status_code=404, detail="That kiosk no longer exists.")

    images = [img for img in (existing.data[0].get("images") or []) if img.get("path") != path]
    try:
        supabase.storage.from_(KIOSK_IMAGE_BUCKET).remove([path])
    except Exception as e:
        # The row is the source of truth for what the kiosk shows; a file left
        # in the bucket is invisible once nothing links to it.
        logger.warning(f"Could not remove {path} from {KIOSK_IMAGE_BUCKET}: {e}")

    try:
        supabase.table("kiosk_settings").update(
            {"images": images, "updated_at": _now(), "updated_by": actor}
        ).eq("id", kiosk_id).execute()
    except Exception as e:
        raise _guard(e)

    return {"status": "success", "data": {"images": images}}
