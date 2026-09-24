"""Which room-type categories the stop-sale chart (and, since 24-Sep-2026,
the Stop Sale Alert email) watches for a property - Revenue > Occupancy By
Type Calendar's Room Types filter. See api/sql/stop_sale_watched_categories.sql
for the table shape and why writes are PIN-checked here."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from app.config import get_supabase_client

logger = logging.getLogger(__name__)

TABLE = "stop_sale_watched_categories"


def _missing_table(error: Exception) -> bool:
    message = str(error).lower()
    return TABLE in message and ("does not exist" in message or "not find the table" in message)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_watched(property_name: str) -> Optional[list]:
    """The saved category id list for this property, or None for "watch
    everything" - whether that's because nothing has been saved, the table
    doesn't exist yet, or the read failed. A guest-facing read (the
    calendar), so failures are logged, not raised, and degrade to the same
    "everything" behaviour the feature had before this table existed."""
    supabase = get_supabase_client()
    if not supabase:
        return None
    try:
        res = (
            supabase.table(TABLE)
            .select("categories")
            .eq("property_name", property_name)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None
        return res.data[0].get("categories")
    except Exception as e:
        if not _missing_table(e):
            logger.warning(f"stop_sale_watched_categories lookup failed for {property_name}: {e}")
        return None


def save_watched(property_name: str, categories: Optional[list], actor: Optional[str]) -> dict:
    """categories=None resets to "watch everything" (deletes the row rather
    than storing a literal null, so a property that has never customised
    this reads identically to one that customised it back to "everything").
    categories=[] is a real, distinct "watch nothing", stored as-is."""
    supabase = get_supabase_client()
    if categories is None:
        supabase.table(TABLE).delete().eq("property_name", property_name).execute()
        return {"property_name": property_name, "categories": None}
    payload = {
        "property_name": property_name,
        "categories": categories,
        "updated_at": _now(),
        "updated_by": actor,
    }
    result = supabase.table(TABLE).upsert(payload, on_conflict="property_name").execute()
    return result.data[0]
