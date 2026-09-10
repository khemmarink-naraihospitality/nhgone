from __future__ import annotations

import logging

from app.config import get_supabase_client
from app.services.encryption import encryption_service

logger = logging.getLogger(__name__)

# Single global row (Admin > Revenue Settings) - the PIN gate on editing the
# Stop-Sale threshold on /revenue's Occupancy By Type Calendar. Same
# degrade-to-defaults shape as ftp_service.get_ftp_settings: works before
# anyone has touched Admin, and before api/sql/revenue_settings.sql has even
# been run.
REVENUE_SETTINGS_TABLE = "revenue_settings"
DEFAULT_STOP_SALE_PIN = "2026"


def _defaults() -> dict:
    return {"id": None, "stop_sale_pin": DEFAULT_STOP_SALE_PIN}


def get_revenue_settings() -> dict:
    """Fetch the single global Revenue settings row, PIN decrypted. Only
    ever called server-side - admin.py's GET route reports pin_set instead
    of the real value, same convention as SMTP/FTP's password."""
    supabase = get_supabase_client()
    if not supabase:
        return _defaults()
    try:
        res = supabase.table(REVENUE_SETTINGS_TABLE).select("*").limit(1).execute()
    except Exception as e:
        logger.warning(f"revenue_settings lookup failed, using defaults: {e}")
        return _defaults()
    if not res.data:
        return _defaults()
    row = res.data[0]
    pin = row.get("stop_sale_pin")
    return {
        "id": row.get("id"),
        "stop_sale_pin": encryption_service.decrypt(pin) if pin else DEFAULT_STOP_SALE_PIN,
    }


def verify_stop_sale_pin(attempt: str) -> bool:
    """Whether `attempt` matches the configured Stop-Sale PIN. Checked
    server-side rather than in the browser - the correct value would
    otherwise sit in the shipped JS bundle for anyone to read, which would
    defeat the point of gating the field at all."""
    settings = get_revenue_settings()
    return str(attempt or "").strip() == str(settings["stop_sale_pin"]).strip()
