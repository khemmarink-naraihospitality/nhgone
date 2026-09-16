"""Check-in form field configuration - edited at Admin Console > Kiosks >
Check In Form.

One row per property in `checkin_form_settings` (not per kiosk device: guests
fill out the same form regardless of which physical terminal they use).
Nothing reads this yet - the ported /kiosk/registration screen still uses its
own fixed field set. This is the configuration surface going in first, the
same order the Kiosks page itself shipped in.
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
