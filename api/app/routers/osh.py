"""OSH Checklist - the Occupational Safety & Health inspection form (sidebar:
OSH Checklist > OSH Form / Report / Setting).

Ported from a standalone React prototype that stored everything in the
browser's localStorage and only *pretended* to email the report. Here:

- Settings, drafts and submitted reports live in Supabase (osh_settings,
  osh_drafts, osh_reports - see api/sql/osh_checklist.sql), so they are
  shared rather than stuck in one browser.
- Photos go to the osh-photos storage bucket and items carry a URL, not a
  base64 blob.
- Submitting really emails the report, through the same SMTP settings every
  other system mail uses, to the recipients configured for that property in
  Setting > Email.

The report HTML is rendered in the browser (src/lib/osh/report.ts - the same
function the Report page views it with) and sent along with the submission,
so the emailed report and the on-screen one can never be two different
renderings. Recipients are NOT taken from the request: they are read from
the saved settings here, so a client cannot redirect a report elsewhere.
"""

import base64
import html
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.config import get_supabase_client, settings
from app.services.email_service import email_service
from app.services.storage_buckets import ensure_public_bucket

router = APIRouter(prefix="/osh", tags=["OSH Checklist"])
logger = logging.getLogger(__name__)

SETTINGS_TABLE = "osh_settings"
DRAFTS_TABLE = "osh_drafts"
REPORTS_TABLE = "osh_reports"
PHOTO_BUCKET = "osh-photos"
# Photos arrive already compressed/cropped to 800px by the browser (the
# prototype's own compressImage / cropper), typically 60-150 KB. 3 MB is
# generous headroom, not a target.
PHOTO_MAX_BYTES = 3 * 1024 * 1024
PHOTO_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

SETTING_KEYS = ("properties", "categories", "checklist", "emails", "template")
_TABLE_HINT = "run api/sql/osh_checklist.sql in the Supabase SQL Editor first"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _missing_table(error: Exception) -> bool:
    message = str(error).lower()
    return "osh_" in message and ("does not exist" in message or "not find the table" in message)


def _missing_column(error: Exception, column: str) -> bool:
    """True for either Postgres' own "column X does not exist" (42703) or
    PostgREST's schema-cache miss ("Could not find the 'X' column ...",
    PGRST204 - what Supabase's client actually raises for an insert naming an
    unrecognized column). Used so a submit made before an incremental
    migration (e.g. submitted_by_email, added 24-Sep-2026) degrades to
    inserting without that field rather than failing the whole submission
    over one optional column."""
    message = str(error).lower()
    return column.lower() in message and ("does not exist" in message or "could not find" in message)


def _guard(error: Exception) -> HTTPException:
    if isinstance(error, HTTPException):
        return error
    if _missing_table(error):
        return HTTPException(status_code=400, detail=f"The OSH Checklist tables don't exist yet - {_TABLE_HINT}")
    return HTTPException(status_code=500, detail=str(error))


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

class SettingUpdate(BaseModel):
    value: Any
    actor: Optional[str] = None


@router.get("/settings")
async def get_settings():
    """Every saved setting, keyed. A key that has never been saved comes back
    null and the page falls back to its built-in default - the same
    "localStorage empty -> use the default" the prototype did. A database
    that doesn't have the table yet answers the same way rather than
    failing, so the pages still open before the SQL has run."""
    data = {key: None for key in SETTING_KEYS}
    try:
        res = get_supabase_client().table(SETTINGS_TABLE).select("key, value").execute()
    except Exception as e:
        if _missing_table(e):
            return {"status": "success", "data": data, "storage_ready": False}
        raise _guard(e)
    for row in res.data or []:
        if row.get("key") in data:
            data[row["key"]] = row.get("value")
    return {"status": "success", "data": data, "storage_ready": True}


@router.put("/settings/{key}")
async def save_setting(key: str, request: SettingUpdate):
    if key not in SETTING_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown setting '{key}'.")
    try:
        get_supabase_client().table(SETTINGS_TABLE).upsert(
            {"key": key, "value": request.value, "updated_at": _now(), "updated_by": request.actor},
            on_conflict="key",
        ).execute()
    except Exception as e:
        raise _guard(e)
    return {"status": "success"}


# ---------------------------------------------------------------------------
# Drafts (one per signed-in user)
# ---------------------------------------------------------------------------

class DraftUpdate(BaseModel):
    user_id: str
    header: Optional[dict] = None
    items: Optional[list] = None


@router.get("/draft")
async def get_draft(user_id: str = Query(...)):
    try:
        res = get_supabase_client().table(DRAFTS_TABLE).select("header, items, updated_at").eq(
            "user_id", user_id).limit(1).execute()
    except Exception as e:
        if _missing_table(e):
            return {"status": "success", "data": None}
        raise _guard(e)
    return {"status": "success", "data": (res.data or [None])[0]}


@router.put("/draft")
async def save_draft(request: DraftUpdate):
    """Partial: header and items are saved independently, because the form
    saves its header on every change (as the prototype did) but its items
    only on Save Draft."""
    if not request.user_id:
        raise HTTPException(status_code=400, detail="user_id is required.")
    payload: dict = {"user_id": request.user_id, "updated_at": _now()}
    if request.header is not None:
        payload["header"] = request.header
    if request.items is not None:
        payload["items"] = request.items
    try:
        get_supabase_client().table(DRAFTS_TABLE).upsert(payload, on_conflict="user_id").execute()
    except Exception as e:
        raise _guard(e)
    return {"status": "success"}


@router.delete("/draft")
async def delete_draft(user_id: str = Query(...)):
    try:
        get_supabase_client().table(DRAFTS_TABLE).delete().eq("user_id", user_id).execute()
    except Exception as e:
        if not _missing_table(e):
            raise _guard(e)
    return {"status": "success"}


# ---------------------------------------------------------------------------
# Photos
# ---------------------------------------------------------------------------

class PhotoUpload(BaseModel):
    data_url: str


_DATA_URL = re.compile(r"^data:(image/[a-z+]+);base64,(.+)$", re.DOTALL)


@router.post("/photos")
async def upload_photo(request: PhotoUpload):
    """One checklist photo, already compressed/cropped in the browser.
    Returns its public URL, which is what the item stores."""
    match = _DATA_URL.match(request.data_url or "")
    if not match:
        raise HTTPException(status_code=400, detail="That isn't an image.")
    mime = match.group(1).lower()
    extension = PHOTO_TYPES.get(mime)
    if not extension:
        raise HTTPException(status_code=400, detail="Please choose a JPG, PNG or WebP image.")
    try:
        content = base64.b64decode(match.group(2), validate=False)
    except Exception:
        raise HTTPException(status_code=400, detail="The image could not be read.")
    if len(content) > PHOTO_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Image is too large.")

    # A random name per upload: nothing guessable, and a replaced photo gets
    # a new URL rather than fighting a CDN cache for the old one.
    now = datetime.now(timezone.utc)
    path = f"{now:%Y/%m}/{uuid.uuid4().hex}.{extension}"
    storage = get_supabase_client().storage

    def _put() -> None:
        storage.from_(PHOTO_BUCKET).upload(
            path, content, {"content-type": mime, "cache-control": "31536000", "upsert": "false"})

    try:
        _put()
    except Exception as e:
        if "bucket not found" not in str(e).lower():
            raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
        if not ensure_public_bucket(storage, PHOTO_BUCKET, PHOTO_MAX_BYTES, PHOTO_TYPES):
            raise HTTPException(status_code=500, detail="The osh-photos storage bucket is missing and could not be created.")
        try:
            _put()
        except Exception as retry_error:
            raise HTTPException(status_code=500, detail=f"Upload failed: {retry_error}")

    return {"status": "success", "data": {"url": storage.from_(PHOTO_BUCKET).get_public_url(path)}}


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

class ReportSubmit(BaseModel):
    header: dict
    items: list
    score: int
    report_html: str
    actor: Optional[str] = None
    actor_email: Optional[str] = None


def _recipients(text: str) -> list:
    """"gm@hotel.com, safety@hotel.com" (Setting > Email says "comma
    separated") - semicolons and new lines accepted too, since that is how
    people paste from Outlook."""
    parts = re.split(r"[,;\s]+", text or "")
    return [p.strip() for p in parts if p.strip() and "@" in p]


def _load_setting(key: str):
    try:
        res = get_supabase_client().table(SETTINGS_TABLE).select("value").eq("key", key).limit(1).execute()
    except Exception:
        return None
    return (res.data or [{}])[0].get("value") if res.data else None


def _report_document(title: str, body_html: str) -> str:
    """The report as a standalone page - what the email attaches. Opens in any
    browser, and prints to A4 PDF from there."""
    return (
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\">"
        f"<title>{html.escape(title)}</title>"
        "<link href=\"https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap\" rel=\"stylesheet\">"
        "<style>@page{size:A4;margin:12mm}body{margin:0;background:#fff}"
        "table{page-break-inside:auto}tr{page-break-inside:avoid}</style>"
        f"</head><body>{body_html}</body></html>"
    )


def _send_report_email(report: dict, report_html: str) -> tuple:
    """(status, detail). Never raises - the report is already saved by the
    time this runs, and a mail server being down is not a reason to tell the
    inspector their submission failed."""
    property_name = report["property_name"]
    emails = _load_setting("emails") or {}
    config = emails.get(property_name) if isinstance(emails, dict) else None
    to = _recipients((config or {}).get("recipients", ""))
    if not config or not to:
        return "not_configured", None

    subject = (config.get("subject") or f"[OSH Report] {property_name}").strip()
    body_text = config.get("body") or ""
    link = f"{settings.APP_BASE_URL.rstrip('/')}/osh-checklist/report?id={report['id']}"
    html_body = (
        "<div style=\"font-family:Sarabun,'Segoe UI',Tahoma,sans-serif;font-size:14px;color:#0f172a\">"
        f"<p>{html.escape(body_text).replace(chr(10), '<br>')}</p>"
        "<table style=\"border-collapse:collapse;margin:12px 0;font-size:13px\">"
        f"<tr><td style=\"padding:2px 12px 2px 0;color:#64748b\">Property</td><td><b>{html.escape(property_name)}</b></td></tr>"
        f"<tr><td style=\"padding:2px 12px 2px 0;color:#64748b\">Date</td><td>{html.escape(str(report['header'].get('date') or ''))}</td></tr>"
        f"<tr><td style=\"padding:2px 12px 2px 0;color:#64748b\">Year / Period</td><td>{html.escape(str(report['header'].get('year') or ''))} - {html.escape(str(report['header'].get('period') or ''))}</td></tr>"
        f"<tr><td style=\"padding:2px 12px 2px 0;color:#64748b\">Operator</td><td>{html.escape(str(report['header'].get('operatorName') or ''))}</td></tr>"
        f"<tr><td style=\"padding:2px 12px 2px 0;color:#64748b\">Score</td><td>{int(report.get('score') or 0)}%</td></tr>"
        "</table>"
        f"<p><a href=\"{html.escape(link)}\">View this report in NHGOne</a> - the attached file opens in any "
        "browser and can be printed to PDF from there.</p>"
        "</div>"
    )
    safe_name = re.sub(r"[^A-Za-z0-9]+", "", property_name) or "Property"
    report_day = str(report["header"].get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    filename = f"OSH_Report_{safe_name}_{report_day}.html"
    document = _report_document(f"OSH Report - {property_name}", report_html)
    try:
        email_service.send_email_with_attachments(
            to, subject, html_body, attachments=[(filename, document.encode("utf-8"))])
        return "sent", ", ".join(to)
    except Exception as e:
        logger.warning(f"OSH report {report['id']} saved but not emailed: {e}")
        return "failed", str(e)


@router.get("/reports")
async def list_reports():
    """Every submitted report, newest first. Items are included - the Report
    page's dashboard counts statuses across them - which stays small because
    photos are URLs, not inline images."""
    try:
        res = get_supabase_client().table(REPORTS_TABLE).select("*").order("submitted_at", desc=True).execute()
    except Exception as e:
        if _missing_table(e):
            return {"status": "success", "data": []}
        raise _guard(e)
    return {"status": "success", "data": res.data or []}


@router.get("/reports/{report_id}")
async def get_report(report_id: str):
    try:
        res = get_supabase_client().table(REPORTS_TABLE).select("*").eq("id", report_id).limit(1).execute()
    except Exception as e:
        raise _guard(e)
    if not res.data:
        raise HTTPException(status_code=404, detail="That report no longer exists.")
    return {"status": "success", "data": res.data[0]}


@router.post("/reports")
async def submit_report(request: ReportSubmit):
    header = request.header or {}
    property_name = (header.get("propertyName") or "").strip()
    if not property_name:
        raise HTTPException(status_code=400, detail="Property Name is required.")
    if not header.get("date"):
        raise HTTPException(status_code=400, detail="Date is required.")
    if not (header.get("operatorName") or "").strip():
        raise HTTPException(status_code=400, detail="Operator is required.")

    row = {
        "property_name": property_name,
        "year": str(header.get("year") or ""),
        "period": header.get("period") or "",
        "report_date": header.get("date") or None,
        "operator_name": (header.get("operatorName") or "").strip(),
        "header": header,
        "items": request.items or [],
        "score": max(0, min(100, int(request.score or 0))),
        "submitted_by": request.actor,
        "submitted_by_email": request.actor_email,
    }
    try:
        res = get_supabase_client().table(REPORTS_TABLE).insert(row).execute()
    except Exception as e:
        if _missing_column(e, "submitted_by_email"):
            # The incremental migration hasn't run yet - submit anyway
            # (the report itself matters more than who submitted it), just
            # without that one field.
            row.pop("submitted_by_email", None)
            try:
                res = get_supabase_client().table(REPORTS_TABLE).insert(row).execute()
            except Exception as retry_error:
                raise _guard(retry_error)
        else:
            raise _guard(e)
    report = res.data[0]
    report.setdefault("submitted_by_email", None)

    status, detail = _send_report_email(report, request.report_html or "")
    try:
        get_supabase_client().table(REPORTS_TABLE).update(
            {"email_status": status, "email_detail": detail}).eq("id", report["id"]).execute()
    except Exception:
        pass
    report["email_status"], report["email_detail"] = status, detail
    return {"status": "success", "data": report}
