"""Peak-period stop-sale threshold overrides - Revenue > Occupancy By Type
Calendar. See api/sql/stop_sale_periods.sql for the table shape and why
writes are PIN-checked here (not just gated in the browser)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from app.config import get_supabase_client

logger = logging.getLogger(__name__)

TABLE = "stop_sale_periods"


def _missing_table(error: Exception) -> bool:
    message = str(error).lower()
    return TABLE in message and ("does not exist" in message or "not find the table" in message)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_periods(property_name: str) -> list:
    """Every saved period for this property, earliest start first. Degrades
    to an empty list if the table hasn't been created yet or the read
    fails - the calendar then simply falls back to the single global
    threshold for every night, exactly as it did before this feature
    existed. A guest-facing read, so failures are logged, not raised."""
    supabase = get_supabase_client()
    if not supabase:
        return []
    try:
        res = (
            supabase.table(TABLE)
            .select("*")
            .eq("property_name", property_name)
            .order("start_date")
            .execute()
        )
        return res.data or []
    except Exception as e:
        if not _missing_table(e):
            logger.warning(f"stop_sale_periods lookup failed for {property_name}: {e}")
        return []


def add_period(
    property_name: str,
    start_date: str,
    end_date: str,
    threshold: int,
    label: Optional[str],
    actor: Optional[str],
) -> dict:
    supabase = get_supabase_client()
    payload = {
        "property_name": property_name,
        "start_date": start_date,
        "end_date": end_date,
        "threshold": threshold,
        "label": (label or "").strip() or None,
        "created_by": actor,
        "updated_by": actor,
    }
    result = supabase.table(TABLE).insert(payload).execute()
    return result.data[0]


def update_period(period_id: str, fields: dict, actor: Optional[str]) -> dict:
    supabase = get_supabase_client()
    payload = {k: v for k, v in fields.items() if v is not None}
    payload["updated_at"] = _now()
    payload["updated_by"] = actor
    result = supabase.table(TABLE).update(payload).eq("id", period_id).execute()
    if not result.data:
        raise ValueError("That period no longer exists.")
    return result.data[0]


def delete_period(period_id: str) -> None:
    supabase = get_supabase_client()
    supabase.table(TABLE).delete().eq("id", period_id).execute()
