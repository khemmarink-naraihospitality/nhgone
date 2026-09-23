"""Check-in form field configuration - edited at Admin Console > Kiosks >
Check In Form.

One row per property in `checkin_form_settings` (not per kiosk device: guests
fill out the same form regardless of which physical terminal they use).

/kiosk/registration obeys this configuration, and so does the endpoint that
saves what it collects (kiosks.add_kiosk_guest, through the resolvers at the
bottom of this file). The browser's copy of the same rules is
`src/lib/checkinFormFields.ts`; the two hold the same defaults and have to be
kept in step - the whole point of resolving it on both sides is that a field
a property chose not to collect can't arrive filled in from a client that
skipped the screen.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.config import get_supabase_client

router = APIRouter(prefix="/checkin-form", tags=["Check-in Form"])

_TABLE_HINT = "run api/sql/checkin_form_settings.sql in the Supabase SQL Editor first"


class CheckinFormUpdate(BaseModel):
    fields: dict
    other_adults_enabled: bool
    children_enabled: bool
    actor: Optional[str] = None


def _missing_table(error: Exception) -> bool:
    message = str(error).lower()
    return "checkin_form_settings" in message and ("does not exist" in message or "not find the table" in message)


def _guard(error: Exception) -> HTTPException:
    if _missing_table(error):
        return HTTPException(status_code=400, detail=f"The checkin_form_settings table doesn't exist yet - {_TABLE_HINT}")
    return HTTPException(status_code=500, detail=str(error))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("")
async def get_checkin_form(property_name: str = Query(...)):
    """This property's saved form config, or a fresh-defaults shape if it has
    never been saved - the editor always has something to render rather than
    needing its own "no row yet" branch."""
    try:
        result = (
            get_supabase_client()
            .table("checkin_form_settings")
            .select("*")
            .eq("property_name", property_name)
            .execute()
        )
    except Exception as e:
        raise _guard(e)

    if result.data:
        return {"status": "success", "data": result.data[0]}
    return {
        "status": "success",
        "data": {
            "id": None,
            "property_name": property_name,
            "fields": {},
            "other_adults_enabled": True,
            "children_enabled": True,
            "created_at": None,
            "created_by": None,
            "updated_at": None,
            "updated_by": None,
        },
    }


@router.put("")
async def save_checkin_form(property_name: str = Query(...), request: CheckinFormUpdate = ...):
    """Upsert on property_name - the editor never knows its own row id ahead
    of the first save, so it always addresses this by property instead."""
    supabase = get_supabase_client()
    payload = {
        "property_name": property_name,
        "fields": request.fields,
        "other_adults_enabled": request.other_adults_enabled,
        "children_enabled": request.children_enabled,
        "updated_at": _now(),
        "updated_by": request.actor,
    }
    try:
        existing = (
            supabase.table("checkin_form_settings")
            .select("id")
            .eq("property_name", property_name)
            .execute()
        )
        if existing.data:
            result = (
                supabase.table("checkin_form_settings")
                .update(payload)
                .eq("property_name", property_name)
                .execute()
            )
        else:
            payload["created_by"] = request.actor
            result = supabase.table("checkin_form_settings").insert(payload).execute()
        return {"status": "success", "data": result.data[0]}
    except Exception as e:
        raise _guard(e)


# ---------------------------------------------------------------------------
# Resolving the configuration - the server-side half of
# src/lib/checkinFormFields.ts. Only what the KIOSK can actually collect is
# mirrored here: the rest of that table is stored and unread on both sides,
# because the terminal has no control to ask it.
# ---------------------------------------------------------------------------

_STATES = ("Required", "Optional", "Hidden")

# Which cell of the Check In Form table governs each field of the kiosk's own
# guest profile. The two naming schemes differ (`address_line1` here,
# `address_line_1` in the table, which copies MEWS's own label) - mirrors
# PROFILE_FIELD_SOURCE in GuestProfileForm.tsx.
KIOSK_PROFILE_FIELDS = {
    "first_name": ("general", "first_name"),
    "last_name": ("general", "last_name"),
    "nationality": ("general", "nationality"),
    "telephone": ("general", "telephone"),
    "occupation": ("general", "occupation"),
    "email": ("general", "email"),
    "address_line1": ("address", "address_line_1"),
    "city": ("address", "city"),
    "postal_code": ("address", "postal_code"),
    "country": ("address", "country"),
}

# What a name reads as in the "Missing required" message - the label the form
# itself shows, so the error names the box the guest is looking at.
_FIELD_LABELS = {
    "first_name": "given names", "last_name": "last name", "nationality": "nationality",
    "telephone": "telephone", "occupation": "occupation", "email": "email",
    "address_line1": "address line 1",
    "city": "city", "postal_code": "postal code", "country": "country",
    "document_number": "document number",
}

# MEWS's own default state per field, plus the kiosk's own reading of
# "Default" where MEWS shows none - mirrors FIELD_CATEGORIES' `default` /
# `kioskDefault`. A field absent from this map defaults to Optional.
_FIELD_DEFAULT = {
    ("general", "first_name"): "Required",
    ("general", "nationality"): "Required",
    ("general", "telephone"): "Optional",
    ("general", "occupation"): "Hidden",
    ("general", "signature"): "Required",
}

# The cells MEWS renders as fixed text rather than a dropdown - they win over
# anything saved, exactly as they do in the editor.
_FIELD_LOCKED = {
    ("general", "last_name"): {"owner": "Required", "other_adults": "Required", "children": "Required"},
    ("general", "relation_to_other_guests"): {"owner": "Hidden"},
}

_DEFAULT_DOCUMENT_TYPE = "passport_id_license"
_DEFAULT_DOCUMENT_VISIBILITY = "Hidden"
_DOCUMENTS_ALLOWED = {
    "passport_id_license": ("passport", "identity_card", "drivers_license"),
    "passport_id": ("passport", "identity_card"),
    "passport": ("passport",),
    "id_card": ("identity_card",),
    "driver_license": ("drivers_license",),
}


def load_fields(property_name: str) -> dict:
    """This property's saved `fields` blob, or `{}`.

    Degrades to `{}` rather than raising for a property that has never been
    configured AND for a database that doesn't have the table yet - `{}`
    resolves every field to MEWS's own default, which is a working form. A
    guest standing at a terminal must not be turned away because nobody has
    opened the Check In Form page.
    """
    try:
        result = (
            get_supabase_client()
            .table("checkin_form_settings")
            .select("fields")
            .eq("property_name", property_name)
            .execute()
        )
    except Exception:
        return {}
    if not result.data:
        return {}
    return result.data[0].get("fields") or {}


def effective_state(fields: dict, category: str, key: str, guest_type: str = "other_adults") -> str:
    """Required / Optional / Hidden for one cell - locked, then the saved
    choice, then the default, then Optional. Same order as effectiveState()
    in src/lib/checkinFormFields.ts."""
    locked = (_FIELD_LOCKED.get((category, key)) or {}).get(guest_type)
    if locked in _STATES:
        return locked
    saved = ((fields or {}).get(category) or {}).get(f"{key}.{guest_type}")
    if saved in _STATES:
        return saved
    return _FIELD_DEFAULT.get((category, key), "Optional")


def document_settings(fields: dict) -> tuple:
    """(visibility, allowed document types) for the Documents tab, which has
    no guest-type split of its own."""
    visibility = ((fields or {}).get("documents") or {}).get("visibility")
    if visibility not in _STATES:
        visibility = _DEFAULT_DOCUMENT_VISIBILITY
    doc_type = ((fields or {}).get("documents") or {}).get("type")
    allowed = _DOCUMENTS_ALLOWED.get(doc_type, _DOCUMENTS_ALLOWED[_DEFAULT_DOCUMENT_TYPE])
    return visibility, allowed


def field_label(field: str) -> str:
    return _FIELD_LABELS.get(field, field.replace("_", " "))
