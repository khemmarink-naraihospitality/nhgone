"""The Stop Sale Chart, server-side - the per-property Stop Sale mail's body
(an HTML table) and its PDF attachment.

The same document properties have historically kept by hand (and that
Revenue > Occupancy By Type Calendar exports as .xlsx / prints as PDF, see
src/lib/stopSaleChartExport.ts): one block per month, room types down the
side, days across, colour-coded X / o. Colours are the export's own values,
so the mail, the attachment, the .xlsx and the page all read as one thing.

Pure functions only - no database access here. stop_sale_alert_service reads
the two snapshots, the Room Types selection and the saved thresholds and
hands them in, which keeps this module importable from anywhere without a
circular import back into the service.

Only months that actually have something on them (an existing stop, a new
stop or a re-open) are included - a snapshot runs twelve months forward, and
the user asked for the months that matter rather than a year of mostly empty
grids (24-Sep-2026).

Cell states follow stop_sale_alert_service._changes' rules, NOT the
calendar's, in the two edge cases where they differ: a night the baseline
never covered (the extra month a new snapshot reaches on the 1st), or a
missing figure on either side, is never called NEW or RE-OPEN - a stopped
night there reads as an existing stop. The calendar paints those as new;
this mail would then show a yellow cell its own change count doesn't include.
"""
from __future__ import annotations

import calendar
import io
from datetime import datetime
from html import escape
from typing import Callable, Optional

NONE, EXISTING, NEW, REOPEN = "none", "existing", "new", "reopen"

MONTH_NAMES = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY",
               "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]

# Mirrors COLOR in src/lib/stopSaleChartExport.ts (ARGB there, #RRGGBB here).
HEADER_BG = "#1F3864"
REPORT_AS_OF_LABEL = "#C00000"
REPORT_AS_OF_BG = "#FFFF00"
MONTH_BAND_BG = "#D9E2F3"
DATE_ROW_BG = "#DCE6F1"
NEW_BG = "#FFFF00"
NEW_TEXT = "#C00000"
REOPEN_BG = "#22D3EE"
REOPEN_TEXT = "#063B4A"
BLACK = "#000000"
GRID = "#808080"
# Days covered by a saved peak period (stop_sale_periods) - the orange the
# hand-kept chart uses on its date row for the high-season stretch.
PEAK_BG = "#F4B183"

DAY_COLS = 31


def _cat_id(category: dict) -> str:
    return category.get("short_name") or category.get("name") or ""


def _state(now_pct, prev_pct, has_prev: bool, threshold: float) -> str:
    now_stopped = now_pct is not None and now_pct >= threshold
    if not has_prev or prev_pct is None or now_pct is None:
        # Nothing to compare against for this night - see the module
        # docstring: a stop reads as existing, never new; no re-open.
        return EXISTING if now_stopped else NONE
    was_stopped = prev_pct >= threshold
    if now_stopped:
        return EXISTING if was_stopped else NEW
    return REOPEN if was_stopped else NONE


def build_chart(property_name: str, current: dict, baseline: Optional[dict],
                report_date: Optional[str], threshold_for: Callable[[str], float],
                watched: Optional[list] = None, peak_periods: Optional[list] = None) -> dict:
    """Everything the two renderers need, from one property's newest snapshot
    (`current`) and the one before it (`baseline`).

    `watched` is the Room Types selection (None = every category, [] = none),
    `threshold_for(date)` the same per-night rule the calendar uses (a saved
    peak period, else that month's saved threshold, else 90), and
    `peak_periods` the saved periods themselves, only used to shade their
    days on the date row.
    """
    dates = current.get("dates") or []
    was = {}
    if baseline:
        b_dates = baseline.get("dates") or []
        for c in baseline.get("categories") or []:
            cid = _cat_id(c)
            pct = c.get("percent") or []
            for i, day in enumerate(b_dates):
                if i < len(pct):
                    was[(cid, day)] = pct[i]

    categories = [c for c in (current.get("categories") or [])
                  if watched is None or _cat_id(c) in watched]

    # Month blocks, in date order, each day-of-month -> index into `dates`.
    blocks, order = {}, []
    for i, day in enumerate(dates):
        try:
            y, m, d = (int(x) for x in day.split("-"))
        except (ValueError, AttributeError):
            continue
        key = f"{y}-{m:02d}"
        if key not in blocks:
            blocks[key] = {"key": key, "label": f"{MONTH_NAMES[m - 1]} {y}",
                           "year": y, "month": m,
                           "days_in_month": calendar.monthrange(y, m)[1],
                           "index": {}}
            order.append(key)
        blocks[key]["index"][d] = i

    periods = peak_periods or []
    months = []
    for key in order:
        b = blocks[key]
        rows, active = [], False
        for c in categories:
            cid = _cat_id(c)
            pct = c.get("percent") or []
            cells = []
            for d in range(1, DAY_COLS + 1):
                i = b["index"].get(d)
                if i is None or d > b["days_in_month"]:
                    cells.append(None)  # not a day of this month / not in the snapshot
                    continue
                day = dates[i]
                now = pct[i] if i < len(pct) else None
                prev_key = (cid, day)
                st = _state(now, was.get(prev_key), prev_key in was, threshold_for(day))
                if st != NONE:
                    active = True
                cells.append(st)
            # The room type's full name ("Comfy With Pool"), as the hand-kept
            # chart reads - the calendar's short code ("COP") is MEWS's handle,
            # not something the front office books by. `cid` still decides
            # membership in `watched`, same as everywhere else.
            rows.append({"label": c.get("name") or cid, "cells": cells})
        if not active:
            continue
        peak_days = set()
        for d in range(1, b["days_in_month"] + 1):
            day = f"{b['year']}-{b['month']:02d}-{d:02d}"
            if any(p.get("start_date") and p.get("end_date")
                   and p["start_date"] <= day <= p["end_date"] for p in periods):
                peak_days.add(d)
        months.append({"key": key, "label": b["label"], "days_in_month": b["days_in_month"],
                       "peak_days": sorted(peak_days), "rows": rows})

    as_of = "—"
    if report_date:
        try:
            as_of = datetime.strptime(report_date, "%Y-%m-%d").strftime("%d/%m/%Y")
        except ValueError:
            as_of = report_date
    return {"property": property_name, "report_as_of": as_of, "months": months}


# ------------------------------------------------------------------ HTML
#
# Kept deliberately compact. A style attribute on every one of ~3,500 cells
# (11 months x 10 room types x 31 days) came to 412 KB for Marasca Samui,
# and Gmail clips any message past ~102 KB behind a "View entire message"
# link - the chart would simply not be in the mail most people read. So the
# grid lines are the classic email-table trick instead of per-cell borders:
# the table's own gray background showing through cellspacing="1" between
# white rows, which every client from Outlook desktop to Gmail renders the
# same way. Cells then carry only what differs (a mark, a highlight).

_FONT = "font-family:Arial,Helvetica,sans-serif;"


def _html_day(state) -> str:
    if state is None:
        return f'<td bgcolor="{BLACK}"></td>'
    if state == EXISTING:
        return "<td><b>X</b></td>"
    if state == NEW:
        return f'<td bgcolor="{NEW_BG}"><b><font color="{NEW_TEXT}">X</font></b></td>'
    if state == REOPEN:
        return f'<td bgcolor="{REOPEN_BG}"><b><font color="{REOPEN_TEXT}">o</font></b></td>'
    return "<td></td>"


def render_chart_html(chart: dict) -> str:
    """Email-safe markup (tables, attributes and a few inline styles) -
    Outlook and Gmail both render it as-is, where an embedded image would
    need hosting or a CID part and is blocked by default in most clients."""
    out = [f'<div style="{_FONT}overflow-x:auto;">']
    out.append(
        f'<table cellpadding="0" cellspacing="0" style="margin:0 0 4px 0;{_FONT}">'
        f'<tr><td bgcolor="{HEADER_BG}" style="color:#ffffff;font-weight:700;font-size:13px;padding:5px 10px;">'
        f'STOP SALE CHART :&nbsp;&nbsp;{escape(chart["property"])}</td></tr></table>'
        f'<table cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;{_FONT}">'
        f'<tr><td style="color:{REPORT_AS_OF_LABEL};font-weight:700;font-size:13px;padding:3px 10px 3px 0;">Report as of :</td>'
        f'<td bgcolor="{REPORT_AS_OF_BG}" style="font-weight:700;font-size:13px;padding:3px 10px;">'
        f'{escape(chart["report_as_of"])}</td></tr></table>')

    if not chart["months"]:
        out.append('<p style="margin:0;font-size:13px;color:#166534;background:#dcfce7;'
                   'padding:10px 14px;border-radius:6px;">No stop sale or re-open in any month '
                   'of the current snapshot.</p></div>')
        return "".join(out)

    any_peak = False
    for m in chart["months"]:
        peak = set(m["peak_days"])
        any_peak = any_peak or bool(peak)
        out.append(f'<table cellpadding="0" cellspacing="1" bgcolor="{GRID}" '
                   f'style="margin:0 0 12px 0;{_FONT}font-size:11px;text-align:center;">')
        out.append(f'<tr bgcolor="{MONTH_BAND_BG}"><td colspan="{DAY_COLS + 1}" '
                   f'style="font-weight:700;font-size:12px;padding:3px 0;">{m["label"]}</td></tr>')
        cells = ['<td width="170">Date</td>']
        for d in range(1, DAY_COLS + 1):
            if d > m["days_in_month"]:
                cells.append(f'<td width="22" bgcolor="{BLACK}"></td>')
            elif d in peak:
                cells.append(f'<td width="22" bgcolor="{PEAK_BG}">{d}</td>')
            else:
                cells.append(f'<td width="22">{d}</td>')
        out.append(f'<tr bgcolor="{DATE_ROW_BG}" height="18" style="font-weight:700;">' + "".join(cells) + "</tr>")
        for row in m["rows"]:
            out.append('<tr bgcolor="#ffffff" height="18"><td align="left" style="padding:1px 6px;">'
                       f'{escape(row["label"])}</td>' + "".join(_html_day(st) for st in row["cells"]) + "</tr>")
        out.append("</table>")

    legend = [
        (f' bgcolor="{NEW_BG}"', f'<b><font color="{NEW_TEXT}">X</font></b>', "New Stop Sales"),
        ("", "<b>X</b>", "Existing Stop Sales"),
        (f' bgcolor="{REOPEN_BG}"', f'<b><font color="{REOPEN_TEXT}">o</font></b>', "Re-open"),
    ]
    if any_peak:
        legend.append((f' bgcolor="{PEAK_BG}"', "", "Peak period (own stop-sale threshold)"))
    out.append(f'<table cellpadding="0" cellspacing="0" style="margin:4px 0 0 0;{_FONT}font-size:12px;">'
               '<tr><td colspan="2" style="font-weight:700;padding:0 0 4px 0;">Remark</td></tr>')
    for attr, mark, text in legend:
        # bgcolor on the cell itself when the state has one, white otherwise
        cell_bg = attr if attr else ' bgcolor="#ffffff"'
        out.append(f'<tr><td style="padding:2px 12px 2px 0;">{text}</td><td>'
                   f'<table cellpadding="0" cellspacing="1" bgcolor="{GRID}"><tr>'
                   f'<td width="22" height="18" align="center"{cell_bg}>{mark}</td>'
                   '</tr></table></td></tr>')
    out.append("</table></div>")
    return "".join(out)


# ------------------------------------------------------------------- PDF

def render_chart_pdf(chart: dict) -> bytes:
    """The same chart as an A4-landscape PDF, one table per month, never split
    across a page break. reportlab's built-in Helvetica - the chart is
    English throughout (property, month and room-type names), and a built-in
    font needs no font file shipped alongside the function."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    c = colors.HexColor
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm,
                            topMargin=10 * mm, bottomMargin=10 * mm,
                            title=f"Stop Sale Chart - {chart['property']}", author="NHGOne")
    # 277 mm of usable landscape width: a label column wide enough for a full
    # room-type name (they run to "1 BED IN OUR TRIBE HIDEOUT (8-SHARED-BEDS)
    # - LADIES"), wrapping onto a second line rather than overflowing, and
    # 31 day columns sharing the rest.
    label_w, day_w, row_h = 60 * mm, 7 * mm, 5.2 * mm
    label_style = ParagraphStyle("label", fontName="Helvetica", fontSize=7.5, leading=8.5)
    story = []

    head = Table([[f"STOP SALE CHART :   {chart['property']}"]], colWidths=[label_w + 10 * day_w],
                 rowHeights=[7 * mm])
    head.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), c(HEADER_BG)),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 11),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    as_of = Table([["Report as of :", chart["report_as_of"]]], colWidths=[28 * mm, 30 * mm],
                  rowHeights=[6 * mm])
    as_of.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, 0), c(REPORT_AS_OF_LABEL)),
        ("BACKGROUND", (1, 0), (1, 0), c(REPORT_AS_OF_BG)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    # reportlab centres a Table narrower than the frame by default; the
    # hand-kept chart has its title block flush left, above the month grids.
    head.hAlign = as_of.hAlign = "LEFT"
    story += [head, Spacer(1, 2 * mm), as_of, Spacer(1, 5 * mm)]

    if not chart["months"]:
        note = Table([["No stop sale or re-open in any month of the current snapshot."]])
        note.setStyle(TableStyle([("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                                  ("FONTSIZE", (0, 0), (-1, -1), 10)]))
        story.append(note)

    any_peak = False
    for m in chart["months"]:
        peak = set(m["peak_days"])
        any_peak = any_peak or bool(peak)
        data = [[m["label"]] + [""] * DAY_COLS,
                ["Date"] + [str(d) if d <= m["days_in_month"] else "" for d in range(1, DAY_COLS + 1)]]
        for row in m["rows"]:
            data.append([Paragraph(escape(row["label"]), label_style)] + [
                "X" if s in (EXISTING, NEW) else "o" if s == REOPEN else "" for s in row["cells"]])
        style = [
            ("SPAN", (0, 0), (-1, 0)),
            ("BACKGROUND", (0, 0), (-1, 0), c(MONTH_BAND_BG)),
            ("BACKGROUND", (0, 1), (-1, 1), c(DATE_ROW_BG)),
            ("FONTNAME", (0, 0), (-1, 1), "Helvetica-Bold"),
            ("FONTNAME", (1, 2), (-1, -1), "Helvetica-Bold"),
            ("FONTNAME", (0, 2), (0, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 7.5),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("ALIGN", (0, 0), (-1, 1), "CENTER"),
            ("ALIGN", (1, 2), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.4, c(GRID)),
            ("TOPPADDING", (0, 0), (-1, 1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, 1), 0),
            ("TOPPADDING", (0, 2), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 2), (-1, -1), 2),
        ]
        for d in range(1, DAY_COLS + 1):
            col = d
            if d > m["days_in_month"]:
                style.append(("BACKGROUND", (col, 1), (col, -1), colors.black))
            elif d in peak:
                style.append(("BACKGROUND", (col, 1), (col, 1), c(PEAK_BG)))
        for r, row in enumerate(m["rows"], start=2):
            for d, s in enumerate(row["cells"], start=1):
                if s is None and d <= m["days_in_month"]:
                    style.append(("BACKGROUND", (d, r), (d, r), colors.black))
                elif s == NEW:
                    style += [("BACKGROUND", (d, r), (d, r), c(NEW_BG)),
                              ("TEXTCOLOR", (d, r), (d, r), c(NEW_TEXT))]
                elif s == REOPEN:
                    style += [("BACKGROUND", (d, r), (d, r), c(REOPEN_BG)),
                              ("TEXTCOLOR", (d, r), (d, r), c(REOPEN_TEXT))]
        # Header rows fixed; room-type rows sized to their label (one line
        # normally, two for the longest names).
        t = Table(data, colWidths=[label_w] + [day_w] * DAY_COLS,
                  rowHeights=[row_h, row_h] + [None] * len(m["rows"]))
        t.setStyle(TableStyle(style))
        story.append(KeepTogether([t, Spacer(1, 4 * mm)]))

    legend_rows = [["Remark", ""], ["New Stop Sales", "X"], ["Existing Stop Sales", "X"], ["Re-open", "o"]]
    if any_peak:
        legend_rows.append(["Peak period (own stop-sale threshold)", ""])
    legend = Table(legend_rows, colWidths=[60 * mm, day_w], rowHeights=[row_h] * len(legend_rows))
    legend_style = [
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTNAME", (0, 0), (0, 0), "Helvetica-Bold"),
        ("FONTNAME", (1, 1), (1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (1, 0), (1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (1, 1), (1, -1), 0.4, c(GRID)),
        ("INNERGRID", (1, 1), (1, -1), 0.4, c(GRID)),
        ("BACKGROUND", (1, 1), (1, 1), c(NEW_BG)),
        ("TEXTCOLOR", (1, 1), (1, 1), c(NEW_TEXT)),
        ("BACKGROUND", (1, 3), (1, 3), c(REOPEN_BG)),
        ("TEXTCOLOR", (1, 3), (1, 3), c(REOPEN_TEXT)),
    ]
    if any_peak:
        legend_style.append(("BACKGROUND", (1, 4), (1, 4), c(PEAK_BG)))
    legend.setStyle(TableStyle(legend_style))
    legend.hAlign = "LEFT"
    story.append(KeepTogether([Spacer(1, 2 * mm), legend]))

    doc.build(story)
    return buf.getvalue()


def pdf_filename(chart: dict) -> str:
    """StopSaleChart_MarascaSamui_25-08-2026.pdf - the same prefix the
    calendar's own Print/PDF uses for its tab title."""
    name = "".join(chart["property"].split())
    return f"StopSaleChart_{name}_{chart['report_as_of'].replace('/', '-')}.pdf"
