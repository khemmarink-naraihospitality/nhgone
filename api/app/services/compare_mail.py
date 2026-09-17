"""One send path for every sheet-verification mail.

st_compare_service, rr4_compare_service and rv_compare_service each know how to
build their own comparison and render it; everything after that - reading the
Admin template, substituting its tokens, sending, logging, and marking the day
as sent - is identical, so it lives here once. main.py's scheduled jobs and
admin.py's "Send Test Now" buttons both go through `send()`, which is what
stops a test send and the real one from ever disagreeing about what the mail
looks like.

Deliberately a separate module rather than methods on email_service: the
compare services import sync_service, which imports email_service, so
email_service reaching back for them would be circular. Nothing imports this
one, so it can import everything it needs.
"""
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from app.services import rr4_compare_service, rv_compare_service, st_compare_service
from app.services.email_service import (
    RR4_COMPARE_TEMPLATE_KEY,
    RV_COMPARE_TEMPLATE_KEY,
    ST_COMPARE_TEMPLATE_KEY,
    email_service,
)

logger = logging.getLogger(__name__)

FEEDS = {
    "st": {
        "module": st_compare_service,
        "template_key": ST_COMPARE_TEMPLATE_KEY,
        "settings": "get_st_compare_settings",
        # Every mail logs to Admin > Activity Log under its own target_table,
        # one row per day. That's the point rather than noise for a monitoring
        # feed - unlike the BCP captures, which log only failures because they
        # run every five minutes.
        "target_table": "ST Compare",
        "label": "ST Files",
    },
    "rr4": {
        "module": rr4_compare_service,
        "template_key": RR4_COMPARE_TEMPLATE_KEY,
        "settings": "get_rr4_compare_settings",
        "target_table": "RR4 Compare",
        "label": "RR4/TM30",
    },
    "rv": {
        "module": rv_compare_service,
        "template_key": RV_COMPARE_TEMPLATE_KEY,
        "settings": "get_rv_compare_settings",
        "target_table": "RV Compare",
        "label": "RV Files",
    },
}


def get_settings(kind: str) -> dict:
    return getattr(email_service, FEEDS[kind]["settings"])()


def _summary(kind: str, result: dict) -> str:
    if kind in ("rr4", "rv"):
        return FEEDS[kind]["module"].subject_summary(result)
    if result["status"] != "ok":
        return "not comparable yet"
    matched, total = result["matched_cells"], result["total_cells"]
    return "matches sheet completely" if matched == total else f"{matched}/{total} cells match"


def _last_reported_date(target_table: str) -> str:
    """The sheet date the last SCHEDULED send of this feed reported, or "".

    Read back from sync_logs rather than stored in a column, because every
    scheduled send already logs `"<date>: <summary>; sent to ..."` (see the
    success log at the end of send() - keep the two in step), and the
    verification mails are deliberately removable without SQL. Test sends
    log as sync_type "manual" and are ignored, so a test can never make the
    real report look already sent.
    """
    import re
    from app.services.sync_service import sync_service

    try:
        res = sync_service.supabase.table("sync_logs").select("message").eq(
            "target_table", target_table).eq("status", "success").eq(
            "sync_type", "auto").order("created_at", desc=True).limit(1).execute()
    except Exception as e:
        logger.warning(f"compare mail: could not read last reported date for {target_table}: {e}")
        return ""
    msg = (res.data[0].get("message") if res.data else "") or ""
    m = re.match(r"(\d{4}-\d{2}-\d{2}):", msg)
    return m.group(1) if m else ""


def _st_not_ready(result: dict, last_reported: str) -> str:
    """Why a SCHEDULED ST mail should wait for the next tick, or "" to send.

    Keyed to the SWEEP, never to the clock: whatever send time is configured,
    the mail reports each sheet date exactly once, against that date's
    scheduled sweep. A clock-based check ("the sheets must hold yesterday")
    would break any send time set before that morning's sheet exports - the
    sheets would still legitimately hold the day before, and the mail would
    wait forever.

    - The sheets still hold a date this feed already reported: nothing new
      has been pasted since. Without this the mail would re-send that
      report and mark the day done, swallowing the real one.
    - Some property's own import of the date isn't in yet: the mail would
      count its empty cells as mismatches.

    Returning a reason sends nothing and does not mark the day sent, so the
    next cron tick in the same hour tries again. Only applies to the
    scheduled send: Send Test Now and the CLI still go out as-is.
    """
    date = result.get("date") or ""
    if last_reported and date <= last_reported:
        return (f"ST compare waiting: the sheets still hold {date}, which was already "
                f"reported - the next day's exports aren't pasted yet")
    missing = result.get("missing_imports") or []
    if missing:
        return f"ST compare waiting: NHGOne hasn't imported {date} yet for {', '.join(missing)}"
    return ""


def _st_attachments(result: dict) -> list:
    """One ST export CSV per property for the comparison date - the actual
    file that would be filed, so whoever reads this mail can check the real
    numbers against the sheet without opening the app. Same
    get_st_report_export the ST Files daily digest attaches from (see
    sync_service.send_st_files_bundled_digest) - same file, same filename,
    just triggered by this mail's own schedule instead of that one's.

    Skips (rather than failing the whole send for) any property missing
    st_property_code or with nothing imported for this date - the same two
    conditions get_st_report_export itself raises on - since one property's
    filing gap shouldn't cost every other property's attachment too.
    """
    from app.services.sync_service import sync_service

    out = []
    for prop in st_compare_service.SHEETS:
        try:
            csv_text, filename = sync_service.get_st_report_export(prop, result["date"])
            out.append((filename, csv_text.encode("utf-8")))
        except Exception as e:
            logger.warning(f"ST compare mail: could not attach {prop}'s export: {e}")
    return out


def _rv_attachments(result: dict) -> list:
    """The RV journal of every property that was actually compared, at the
    date its own sheet tab holds - the same file the comparison read, so the
    attachment and the tables can't describe two different journals."""
    from app.services.sync_service import sync_service

    out = []
    for p in result.get("properties") or []:
        if p["status"] != "ok":
            continue
        try:
            text, filename = sync_service.get_rv_export(p["property"], p["date"])
            out.append((filename, text.encode("utf-8")))
        except Exception as e:
            logger.warning(f"RV compare mail: could not attach {p['property']}'s export: {e}")
    return out


async def send(kind: str, mark_sent: bool = True, want_date: str = None,
               sync_type: str = "auto") -> dict:
    """Build the comparison, render it into the Admin template and send it.

    Returns {"sent", "reason", "recipients", "summary"}. A comparison that
    isn't in a usable state (nobody has pasted today's export yet, the sheets
    disagree about the date, nothing imported) sends NOTHING and says why - a
    mail that reads "ตรงกับชีตทั้งหมด" because there was nothing to compare
    is worse than no mail at all.

    mark_sent=False is what the Admin "Send Test Now" buttons pass, so a test
    can never suppress that day's real scheduled send.
    """
    from app.services.sync_service import sync_service

    feed = FEEDS[kind]
    module = feed["module"]
    settings_row = get_settings(kind)

    recipients = [e.strip() for e in (settings_row["recipients"] or "").split(",") if e.strip()]
    if not recipients:
        reason = f"{feed['label']} compare mail has no recipients configured (Admin > Email Template)"
        sync_service._log_sync_row(None, None, feed["target_table"], "error", 0, reason, sync_type)
        return {"sent": False, "reason": reason, "recipients": [], "summary": ""}

    result = await module.build_comparison(want_date)
    summary = _summary(kind, result)
    if result["status"] != "ok":
        reason = module.render_text(result)[:500]
        sync_service._log_sync_row(None, None, feed["target_table"], "error", 0, reason, sync_type)
        return {"sent": False, "reason": reason, "recipients": recipients, "summary": summary}

    # Scheduled ST send only - see _st_not_ready.
    if kind == "st" and mark_sent and not want_date:
        reason = _st_not_ready(result, _last_reported_date(feed["target_table"]))
        if reason:
            sync_service._log_sync_row(None, None, feed["target_table"], "error", 0, reason, sync_type)
            return {"sent": False, "reason": reason, "recipients": recipients, "summary": summary}

    tokens = {**module.render_tokens(result), "Summary": summary}

    def fill(text: str) -> str:
        for name, value in tokens.items():
            text = text.replace(f"<<{name}>>", value)
        return text

    cc = [e.strip() for e in (settings_row.get("cc") or "").split(",") if e.strip()]
    bcc = [e.strip() for e in (settings_row.get("bcc") or "").split(",") if e.strip()]
    # ST and RV attach the per-property export file each mail is verifying
    # against its sheet. RR4/TM30's own filed form is two .xlsx per property
    # rather than one text file, which is a different enough shape (and wasn't
    # asked for) to leave for its own pass.
    if kind == "st":
        attachments = _st_attachments(result)
    elif kind == "rv":
        attachments = _rv_attachments(result)
    else:
        attachments = []

    email_service.send_email_with_attachments(
        recipients,
        fill(settings_row["subject"]),
        fill(settings_row["html_template"]),
        attachments=attachments,
        text_body=module.render_text(result),
        cc_emails=cc,
        bcc_emails=bcc,
    )

    # The leading "<date>:" is load-bearing: _last_reported_date parses it back
    # to know which sheet date a scheduled send has already reported.
    sync_service._log_sync_row(
        None, None, feed["target_table"], "success", 1,
        f"{result['date']}: {summary}; sent to {', '.join(recipients)}", sync_type)

    if mark_sent:
        today = datetime.now(ZoneInfo("Asia/Bangkok")).date().isoformat()
        email_service.mark_template_sent(feed["template_key"], settings_row, today)

    return {"sent": True, "reason": "", "recipients": recipients, "summary": summary}


def due(settings_row: dict, now: datetime, match_hour_only: bool) -> bool:
    """Whether this feed should fire on this tick. Same gate every scheduled
    job in main.py uses: the hour must match exactly, and under Vercel the
    minute only needs to have been reached, because a cron firing is not
    guaranteed to land on the configured minute."""
    if not settings_row.get("enabled"):
        return False
    if settings_row.get("last_sent_date") == now.date().isoformat():
        return False
    if now.hour != settings_row["send_hour"]:
        return False
    return now.minute >= settings_row["send_minute"] if match_hour_only \
        else now.minute == settings_row["send_minute"]
