"""Per-month, persisted Occ% stop-sale thresholds - Revenue > Occupancy By
Type Calendar's on-screen threshold field. See
api/sql/stop_sale_month_thresholds.sql for the table shape and why writes
are PIN-checked here."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from app.config import get_supabase_client

logger = logging.getLogger(__name__)

TABLE = "stop_sale_month_thresholds"


def _missing_table(error: Exception) -> bool:
    message = str(error).lower()
    return TABLE in message and ("does not exist" in message or "not find the table" in message)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_thresholds(property_name: str) -> dict:
    """{"YYYY-MM": threshold} for this property, or {} if nothing has been
    saved yet, the table doesn't exist, or the read failed - the calendar
    then simply falls back to DEFAULT_STOP_SELL_THRESHOLD for every month,
    exactly as before this table existed. A guest-facing read, so failures
    are logged, not raised."""
    supabase = get_supabase_client()
    if not supabase:
        return {}
    try:
        res = (
            supabase.table(TABLE)
            .select("thresholds")
            .eq("property_name", property_name)
            .limit(1)
            .execute()
        )
        if not res.data:
            return {}
        return res.data[0].get("thresholds") or {}
    except Exception as e:
        if not _missing_table(e):
            logger.warning(f"stop_sale_month_thresholds lookup failed for {property_name}: {e}")
        return {}


def save_threshold(property_name: str, month_key: str, threshold: int, actor: Optional[str]) -> dict:
    """Sets one month's value, merged into whatever this property has
    already saved for other months - a read-modify-write rather than the
    frontend having to send its whole known set (which, for a calendar that
    only ever loads a forward-looking window, may not even be all of it)."""
    supabase = get_supabase_client()
    current = get_thresholds(property_name)
    current[month_key] = threshold
    payload = {
        "property_name": property_name,
        "thresholds": current,
        "updated_at": _now(),
        "updated_by": actor,
    }
    result = supabase.table(TABLE).upsert(payload, on_conflict="property_name").execute()
    return result.data[0]
