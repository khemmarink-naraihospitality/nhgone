"""Revenue stop-sale watch - what crossed the line since the last snapshot.

/revenue's Occupancy By Type Calendar already draws this: a night at or above
the stop-sale threshold counts as stopped for travel agents, and it takes TWO
snapshots to tell a genuinely NEW stop from one that was already there
yesterday - "re-open" is by definition a change too. This mail answers the
same question without anyone opening the page: which room type, on which
night, crossed into stop-sale or came back out of it since the previous
capture.

Reads occupancy_sync only - no MEWS calls, so it costs nothing and can never
disagree with the calendar about a night the calendar hasn't got. The two
newest snapshots per property ARE the comparison, which means this mail is
only ever as fresh as the 08:00 occupancy import that feeds it
(main.daily_auto_sync_occupancy) - hence its own default send time an hour
after that one.

Recipients, send time, subject and body live in Admin > Email Template >
System Email, like every other scheduled mail here - see
email_service.STOP_SALE_TEMPLATE_KEY. What this module hands the template is
the two finished tables, so an edit to the wording can never produce an
all-clear with no comparison behind it.
"""
from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from app.config import get_supabase_client
from app.services.email_service import STOP_SALE_TEMPLATE_KEY, email_service

logger = logging.getLogger(__name__)

# Mirrors DEFAULT_STOP_SELL_THRESHOLD in src/app/revenue/page.tsx. The
# on-screen field is per-session and never persisted - it is PIN-gated
# precisely because changing it changes the business definition of a stop
# sale - so there is no "the user's current threshold" for this mail to read.
# It reports against the same 90% every calendar opens on, and names that
# number in the body rather than leaving a reader to assume it.
DEFAULT_THRESHOLD = 90

# How many individual nights the detail table lists. A normal morning
# produces a handful; a property whose whole forward book straddles the
# threshold could produce hundreds, and a mail that long stops being read.
# Whatever is dropped is stated in the mail - a silent truncation would read
# exactly like a quiet day.
MAX_DETAIL_ROWS = 300

TARGET_TABLE = "Stop Sale Alert"

_NEW_STOP = "new_stop"
_REOPEN = "reopen"


# --------------------------------------------------------------- comparison

def _properties() -> list:
    supabase = get_supabase_client()
    if not supabase:
        return []
    res = supabase.table("property_api_settings").select("property_name") \
        .order("property_name").execute()
    return [r["property_name"] for r in (res.data or []) if r.get("property_name")]


def _two_newest(property_name: str) -> list:
    """The property's two newest occupancy snapshots, newest first - the same
    pair /revenue diffs against each other (see its baseline effect: the
    stored snapshot immediately before the one on screen)."""
    supabase = get_supabase_client()
    res = supabase.table("occupancy_sync").select("report_date, data, synced_at") \
        .eq("property", property_name).order("report_date", desc=True).limit(2).execute()
    return res.data or []


def _cat_id(category: dict) -> str:
    """Same identity the calendar uses for a row - MEWS's short name where
    there is one, the full name otherwise."""
    return category.get("short_name") or category.get("name") or ""


def _percent_index(data: dict) -> dict:
    """{(category id, date): occupancy %} for one snapshot. Keyed by DATE
    rather than by column index: consecutive snapshots start at their own
    month's 1st and run a year forward, so the same night sits at a
    different index in each of them."""
    dates = data.get("dates") or []
    out = {}
    for c in data.get("categories") or []:
        cid = _cat_id(c)
        percent = c.get("percent") or []
        for i, day in enumerate(dates):
            if i < len(percent):
                out[(cid, day)] = percent[i]
    return out


def _changes(current: dict, baseline: dict, threshold: float) -> list:
    """Every night whose stop-sale state flipped between the two snapshots."""
    was = _percent_index(baseline)
    dates = current.get("dates") or []
    names = {}
    out = []
    for c in current.get("categories") or []:
        cid = _cat_id(c)
        names[cid] = c.get("name") or cid
        percent = c.get("percent") or []
        for i, day in enumerate(dates):
            if i >= len(percent):
                break
            key = (cid, day)
            # A night the previous snapshot never reached (it ended a month
            # earlier), or a category it didn't have at all, cannot be called
            # NEW - there is no earlier position for it to have changed from.
            if key not in was:
                continue
            now_pct, prev_pct = percent[i], was[key]
            # A missing figure on either side is a gap in the data, not an
            # event. The calendar treats a missing value as "not stopped",
            # which draws a missing today against a stopped yesterday as a
            # re-open; for an alert that would be a false one, so both sides
            # have to be real numbers here.
            if now_pct is None or prev_pct is None:
                continue
            now_stopped = now_pct >= threshold
            was_stopped = prev_pct >= threshold
            if now_stopped == was_stopped:
                continue
            out.append({
                "kind": _NEW_STOP if now_stopped else _REOPEN,
                "category": cid,
                "category_name": names[cid],
                "date": day,
                "was": prev_pct,
                "now": now_pct,
            })
    out.sort(key=lambda r: (r["date"], r["category"]))
    return out


def build_alert(threshold: float = None) -> dict:
    """Diff every property's two newest occupancy snapshots.

    status is "ok" as soon as ONE property has a pair to compare. Zero
    changes across all of them is a real answer - a daily all-clear is the
    point of a watch - but a report built from no comparable property at all
    is not, and is what status "no_data" exists to stop from being sent.
    """
    threshold = DEFAULT_THRESHOLD if threshold is None else threshold
    properties, comparable, latest = [], 0, None
    total_new = total_reopen = 0

    for prop in _properties():
        row = {"property": prop, "status": "no_snapshot", "current_date": None,
               "baseline_date": None, "changes": [], "new_stops": 0, "reopens": 0,
               "note": ""}
        try:
            snaps = _two_newest(prop)
        except Exception as e:
            logger.warning(f"Stop-sale alert: could not read {prop}'s snapshots: {e}")
            row["status"] = "error"
            row["note"] = str(e)[:160]
            properties.append(row)
            continue

        if not snaps:
            row["note"] = "no occupancy snapshot imported yet"
            properties.append(row)
            continue

        row["current_date"] = snaps[0].get("report_date")
        if len(snaps) < 2:
            row["status"] = "no_baseline"
            row["note"] = "only one snapshot so far - nothing to compare against"
            properties.append(row)
            continue

        row["status"] = "ok"
        row["baseline_date"] = snaps[1].get("report_date")
        changes = _changes(snaps[0].get("data") or {}, snaps[1].get("data") or {}, threshold)
        row["changes"] = changes
        row["new_stops"] = sum(1 for c in changes if c["kind"] == _NEW_STOP)
        row["reopens"] = sum(1 for c in changes if c["kind"] == _REOPEN)
        total_new += row["new_stops"]
        total_reopen += row["reopens"]
        comparable += 1
        if row["current_date"] and (latest is None or row["current_date"] > latest):
            latest = row["current_date"]
        properties.append(row)

    return {
        "status": "ok" if comparable else "no_data",
        "threshold": threshold,
        "date": latest,
        "properties": properties,
        "compared": comparable,
        "total_new": total_new,
        "total_reopen": total_reopen,
    }


def subject_summary(result: dict) -> str:
    """One line, usable in the Subject."""
    if result["status"] != "ok":
        return "nothing to compare yet"
    new, re_open = result["total_new"], result["total_reopen"]
    if not new and not re_open:
        return "no new stop sale or re-open"
    parts = []
    if new:
        parts.append(f"{new} new stop sale" + ("s" if new != 1 else ""))
    if re_open:
        parts.append(f"{re_open} re-open" + ("s" if re_open != 1 else ""))
    return ", ".join(parts)


# ---------------------------------------------------------------- rendering

_TD = "padding:6px 10px;border:1px solid #e2e8f0;font-size:13px;"
_TH = "padding:6px 10px;border:1px solid #e2e8f0;font-size:11px;font-weight:700;background:#f8fafc;text-align:left;"
# The calendar's own two colours for these states, so the mail and the page
# read as the same thing: new stop is the red-on-yellow cell, re-open the
# cyan one. Existing stops are deliberately absent from both tables - they
# are not news, and including them would bury the handful of cells that are.
_NEW_STYLE = "background:#fef08a;color:#b91c1c;font-weight:700;"
_REOPEN_STYLE = "background:#cffafe;color:#0e7490;font-weight:700;"
_LABEL = {_NEW_STOP: "New stop sale", _REOPEN: "Re-open"}


def _short(property_name: str) -> str:
    return property_name[6:] if property_name.startswith("Lub d ") else property_name


def _night(date_str: str) -> str:
    """"Fri 02 Oct 2026" - the weekday is half of why a stop matters."""
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d")
    except (ValueError, TypeError):
        return date_str or "—"
    return f"{d.strftime('%a')} {d.day:02d} {d.strftime('%b %Y')}"


def _pct(value) -> str:
    return "—" if value is None else f"{value:.2f}%"


def render_summary_table(result: dict) -> str:
    """One row per property: what it was compared against and how much moved."""
    h = [f'<table style="border-collapse:collapse;width:100%"><tr>'
         f'<th style="{_TH}">Property</th><th style="{_TH}">Snapshot</th>'
         f'<th style="{_TH}">Compared against</th><th style="{_TH}">New stop sales</th>'
         f'<th style="{_TH}">Re-opens</th></tr>']
    for p in result["properties"]:
        if p["status"] != "ok":
            h.append(f'<tr><td style="{_TD}font-weight:600">{_short(p["property"])}</td>'
                     f'<td style="{_TD}color:#94a3b8">{p["current_date"] or "—"}</td>'
                     f'<td style="{_TD}color:#94a3b8" colspan="3">{p["note"]}</td></tr>')
            continue
        new_style = _NEW_STYLE if p["new_stops"] else "color:#94a3b8;"
        re_style = _REOPEN_STYLE if p["reopens"] else "color:#94a3b8;"
        h.append(f'<tr><td style="{_TD}font-weight:600">{_short(p["property"])}</td>'
                 f'<td style="{_TD}">{p["current_date"]}</td>'
                 f'<td style="{_TD}">{p["baseline_date"]}</td>'
                 f'<td style="{_TD}{new_style}">{p["new_stops"]}</td>'
                 f'<td style="{_TD}{re_style}">{p["reopens"]}</td></tr>')
    h.append("</table>")
    return "".join(h)


def render_detail_table(result: dict) -> str:
    """Every changed night, named: which property, which room type, which
    date, and what the occupancy moved from and to."""
    rows = [(p["property"], c) for p in result["properties"] for c in p["changes"]]
    if not rows:
        return ('<p style="margin:0;font-size:14px;color:#166534;background:#dcfce7;'
                'padding:10px 14px;border-radius:6px">No room type crossed the stop-sale '
                'line in either direction since the previous snapshot.</p>')

    shown, dropped = rows[:MAX_DETAIL_ROWS], max(0, len(rows) - MAX_DETAIL_ROWS)
    h = ['<div style="overflow-x:auto">'
         f'<table style="border-collapse:collapse;width:100%"><tr>'
         f'<th style="{_TH}">Property</th><th style="{_TH}">Room Type</th>'
         f'<th style="{_TH}">Night</th><th style="{_TH}">Occupancy</th>'
         f'<th style="{_TH}">Change</th></tr>']
    for prop, c in shown:
        style = _NEW_STYLE if c["kind"] == _NEW_STOP else _REOPEN_STYLE
        h.append(f'<tr><td style="{_TD}white-space:nowrap">{_short(prop)}</td>'
                 f'<td style="{_TD}white-space:nowrap"><b>{c["category"]}</b> '
                 f'<span style="color:#94a3b8">{c["category_name"]}</span></td>'
                 f'<td style="{_TD}white-space:nowrap">{_night(c["date"])}</td>'
                 f'<td style="{_TD}white-space:nowrap">{_pct(c["was"])} → '
                 f'<b>{_pct(c["now"])}</b></td>'
                 f'<td style="{_TD}{style}white-space:nowrap">{_LABEL[c["kind"]]}</td></tr>')
    h.append("</table></div>")
    if dropped:
        h.append(f'<p style="font-size:11px;color:#b45309;margin:6px 0 0">'
                 f'{dropped} further changed night(s) not listed - open the Occupancy By '
                 f'Type Calendar on /revenue for the full picture.</p>')
    return "".join(h)


def render_text(result: dict) -> str:
    """Plain-text form - the email's text/plain part."""
    if result["status"] != "ok":
        return ("No property has two occupancy snapshots yet, so there is nothing to "
                "compare - a stop sale can only be called NEW against an earlier "
                "position.")

    out = ["=" * 72,
           f"Stop Sale & Re-open - changes since the previous snapshot",
           "=" * 72,
           f"Threshold: a night at or above {result['threshold']}% occupancy is stopped "
           f"for travel agents",
           f"{result['total_new']} new stop sale(s), {result['total_reopen']} re-open(s) "
           f"across {result['compared']} propert(y/ies)",
           ""]
    listed = 0
    for p in result["properties"]:
        if p["status"] != "ok":
            out.append(f"{_short(p['property']):<22} - {p['note']}")
            continue
        out.append(f"{_short(p['property']):<22} {p['current_date']} vs {p['baseline_date']}"
                   f"  ->  {p['new_stops']} new, {p['reopens']} re-open")
        for c in p["changes"]:
            # One budget across the whole mail, not per property - the same
            # MAX_DETAIL_ROWS the HTML table spends, so the two parts of the
            # same message can't list different numbers of nights.
            if listed >= MAX_DETAIL_ROWS:
                break
            listed += 1
            out.append(f"    {_LABEL[c['kind']]:<14} {c['category']:<8} {_night(c['date'])}"
                       f"   {_pct(c['was'])} -> {_pct(c['now'])}")
    total = sum(len(p["changes"]) for p in result["properties"])
    if total > listed:
        out.append(f"... {total - listed} further changed night(s) not listed - "
                   f"open the Occupancy By Type Calendar on /revenue for the full picture.")
    return "\n".join(out)


def render_tokens(result: dict) -> dict:
    """Everything the email template can substitute."""
    day = None
    if result.get("date"):
        try:
            day = datetime.strptime(result["date"], "%Y-%m-%d")
        except ValueError:
            day = None
    return {
        "Date": day.strftime("%d/%m/%Y") if day else "—",
        "Threshold": str(result["threshold"]),
        "NewStops": str(result["total_new"]),
        "Reopens": str(result["total_reopen"]),
        "PropertyCount": str(result["compared"]),
        "Summary": subject_summary(result),
        "SummaryTable": render_summary_table(result),
        "DetailTable": render_detail_table(result),
    }


# --------------------------------------------------------------- send path

def send(mark_sent: bool = True, sync_type: str = "auto") -> dict:
    """Build the alert, render it into the Admin template and send it.

    Returns {"sent", "reason", "recipients", "summary"}. The scheduled job and
    the Admin "Send Test Now" button both come through here, so a test send
    and the real one can't disagree about what the mail looks like.

    Unlike the two sheet-verification mails, "nothing changed" IS sent - a
    daily all-clear is the whole point of a watch. What is never sent is a
    mail built from nothing to compare: with no property holding two
    snapshots there is no such thing as a "new" stop, and an all-clear would
    be a lie rather than a quiet day.

    mark_sent=False is what "Send Test Now" passes, so a test can never
    suppress that day's real scheduled send.
    """
    from app.services.sync_service import sync_service

    settings_row = email_service.get_stop_sale_settings()
    recipients = [e.strip() for e in (settings_row["recipients"] or "").split(",") if e.strip()]
    if not recipients:
        reason = "Stop-sale alert has no recipients configured (Admin > Email Template)"
        sync_service._log_sync_row(None, None, TARGET_TABLE, "error", 0, reason, sync_type)
        return {"sent": False, "reason": reason, "recipients": [], "summary": ""}

    result = build_alert()
    summary = subject_summary(result)
    if result["status"] != "ok":
        reason = "no property has two occupancy snapshots to compare yet"
        sync_service._log_sync_row(None, None, TARGET_TABLE, "error", 0, reason, sync_type)
        return {"sent": False, "reason": reason, "recipients": recipients, "summary": summary}

    tokens = render_tokens(result)

    def fill(text: str) -> str:
        for name, value in tokens.items():
            text = text.replace(f"<<{name}>>", value)
        return text

    cc = [e.strip() for e in (settings_row.get("cc") or "").split(",") if e.strip()]
    bcc = [e.strip() for e in (settings_row.get("bcc") or "").split(",") if e.strip()]

    email_service.send_email_with_attachments(
        recipients,
        fill(settings_row["subject"]),
        fill(settings_row["html_template"]),
        attachments=[],
        text_body=render_text(result),
        cc_emails=cc,
        bcc_emails=bcc,
    )

    sync_service._log_sync_row(
        None, None, TARGET_TABLE, "success", result["total_new"] + result["total_reopen"],
        f"{result['date']}: {summary}; sent to {', '.join(recipients)}", sync_type)

    if mark_sent:
        today = datetime.now(ZoneInfo("Asia/Bangkok")).date().isoformat()
        email_service.mark_template_sent(STOP_SALE_TEMPLATE_KEY, settings_row, today)

    return {"sent": True, "reason": "", "recipients": recipients, "summary": summary}
