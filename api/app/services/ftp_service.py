from __future__ import annotations

import ftplib
import io
import logging

from app.config import get_supabase_client
from app.services.encryption import encryption_service

logger = logging.getLogger(__name__)

# Single global row (Admin > Sync > FTP Upload) - one plain-FTP destination
# shared by every property; each property's own export is already
# disambiguated by its Property Code + report-type filename (e.g.
# MS_ST_20260808.csv / MS_RV_20260808.csv, from sync_service.
# get_st_report_export/get_rv_export), so one destination folder is enough
# for all of them. upload_st_files/upload_rv_files (the card's checkboxes)
# independently control which report type(s) actually get uploaded - see
# sync_service.send_ftp_upload.
FTP_SETTINGS_TABLE = "ftp_settings"
DEFAULT_FTP_PORT = 21
DEFAULT_FTP_UPLOAD_HOUR = 4
DEFAULT_FTP_UPLOAD_MINUTE = 0


def _defaults() -> dict:
    return {
        "id": None,
        "host": "",
        "port": DEFAULT_FTP_PORT,
        "username": "",
        "password": "",
        "remote_path": "",
        "enabled": False,
        "upload_hour": DEFAULT_FTP_UPLOAD_HOUR,
        "upload_minute": DEFAULT_FTP_UPLOAD_MINUTE,
        "upload_st_files": True,
        "upload_rv_files": False,
        "last_sent_date": None,
    }


def get_ftp_settings() -> dict:
    """
    Fetch the single global FTP settings row, password decrypted. This is
    only ever called server-side to actually connect - admin.py's GET route
    strips the password before returning it to the frontend, same as SMTP's.
    Falls back to defaults (enabled=False) if no row has been saved yet, or
    the table doesn't exist (migration not run).
    """
    supabase = get_supabase_client()
    if not supabase:
        return _defaults()
    try:
        res = supabase.table(FTP_SETTINGS_TABLE).select("*").limit(1).execute()
    except Exception as e:
        logger.warning(f"ftp_settings lookup failed, using defaults: {e}")
        return _defaults()
    if not res.data:
        return _defaults()
    row = res.data[0]
    password = row.get("password")
    return {
        "id": row.get("id"),
        "host": row.get("host") or "",
        "port": row.get("port") or DEFAULT_FTP_PORT,
        "username": row.get("username") or "",
        "password": encryption_service.decrypt(password) if password else "",
        "remote_path": row.get("remote_path") or "",
        "enabled": bool(row.get("enabled")),
        "upload_hour": row["upload_hour"] if row.get("upload_hour") is not None else DEFAULT_FTP_UPLOAD_HOUR,
        "upload_minute": row["upload_minute"] if row.get("upload_minute") is not None else DEFAULT_FTP_UPLOAD_MINUTE,
        "upload_st_files": bool(row["upload_st_files"]) if row.get("upload_st_files") is not None else True,
        "upload_rv_files": bool(row.get("upload_rv_files")),
        "last_sent_date": row.get("last_sent_date"),
    }


def upload_files(settings_row: dict, files: list) -> dict:
    """
    Connects once (plain FTP - see Admin > Sync's own note on why not
    FTPS/SFTP), then STORs every (filename, bytes) pair into
    settings_row['remote_path']. One file failing (e.g. permission denied)
    doesn't abort the rest - each is tried independently.

    Returns {"uploaded": [filenames...], "failed": [(filename, error)...]},
    plus "connection_error" if the connect/login/cwd step itself failed
    (in which case every file is reported failed for that reason).
    """
    try:
        ftp = ftplib.FTP()
        ftp.connect(settings_row["host"], settings_row["port"], timeout=30)
        ftp.login(settings_row["username"], settings_row["password"])
        if settings_row.get("remote_path"):
            ftp.cwd(settings_row["remote_path"])
    except Exception as e:
        return {
            "uploaded": [],
            "failed": [(filename, str(e)) for filename, _ in files],
            "connection_error": str(e),
        }

    uploaded, failed = [], []
    for filename, data in files:
        try:
            ftp.storbinary(f"STOR {filename}", io.BytesIO(data))
            uploaded.append(filename)
        except Exception as e:
            failed.append((filename, str(e)))

    try:
        ftp.quit()
    except Exception:
        pass

    return {"uploaded": uploaded, "failed": failed}
