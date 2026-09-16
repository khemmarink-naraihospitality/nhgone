"""Kiosk configuration - the back-office settings behind the /kiosk screens.

Edited at Admin Console > Kiosks, stored in `kiosk_settings` (one row per
kiosk; a property can have several). Everything goes through this router with
the service role rather than straight from the browser, because the row holds
`pin_code`, which unlocks the settings screen on a terminal standing in a
public lobby - see the RLS note in api/sql/kiosk_settings.sql.

Nothing reads these settings yet: the kiosk screens themselves are still the
ported prototype running on mock data. This is the configuration surface going
in first, not a half-wired feature.
"""

import logging
import secrets
import time
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.config import get_supabase_client
from app.services.storage_buckets import ensure_public_bucket

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
