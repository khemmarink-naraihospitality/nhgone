"""RV Files verification: our stored revenue journal vs the RV Google Sheet,
which holds the PMSRV journal MEWS itself generated for each property.

This module is the comparison and its rendering only. Recipients, send time,
subject and the surrounding design live in Admin > Email Template > RV Files >
Test RV File, and the send path is compare_mail - the same one the ST and
RR4/TM30 checks use, so a test send and the scheduled one cannot disagree.

What the sheet is, and the three things about it that shape this module:

1. ONE workbook with one tab per property, each holding that property's MEWS
   PMSRV file pasted in as text - one journal line per row, the same 41
   pipe-delimited fields get_rv_export writes. There is no total to read the
   way the ST Master tab has one, so the only honest comparison is the lines
   themselves.
2. A description containing a comma can land in two cells, because pasting a
   CSV splits on commas (Patong, 13-Sep-2026: "Card payment (Mastercard ****1293
   Virtual" | " AGODA/#|13092026|..."). The cells are joined back with ","
   before anything is compared, which restores the original line exactly.
3. The sheet and our file write the same posting differently in two places,
   and neither changes what gets posted. Neither is MEWS's own real export:
   MEWS's actual PMSRV file is plain ASCII (confirmed against a real one,
   PT_RV_20260813.csv - see sync_service._ascii_fold) and reads exactly like
   ours; the sheet differs from BOTH because pasting/typing the export into
   Google Sheets is a separate step that visibly changed it.
     - amounts: the sheet holds 1700 and 8594.2 where our file (and MEWS's
       own) writes 1700.00 and 8594.20. Compared as numbers.
     - descriptions: the sheet holds "-1 × Room Adjustment" where our file
       (and MEWS's own) writes "-1 x Room Adjustment" - get_rv_export folds
       every line to 7-bit ASCII on purpose, because one non-ASCII byte makes
       SunSystems reject the whole day's journal (sync_service._ascii_fold).
       Counted as known drift: shown, never flagged.
   Measured 13-Sep-2026 across all 8 properties (947 lines): with those two
   rules every remaining line was identical, down to the field - 28 "×"
   descriptions in the sheet and nothing else.

Each tab is compared at the date its own lines carry (field 4), against our
CACHED import for that date (get_rv_export reads rv_files_sync) - never a live
rebuild. MEWS keeps moving after the file is generated, and a live comparison
reports that movement as our bug.
"""
import html
import io
import logging
import re
from collections import Counter, OrderedDict, defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

import httpx
from openpyxl import load_workbook

logger = logging.getLogger(__name__)

SHEET_ID = "1ExAk9oaZq6ho4nKxo-UHR5gdNdPnMy0adCneRZzL9xs"

# (short label, the sheet's own tab name). Same property order as the ST check.
PROPERTIES = OrderedDict([
    ("Lub d Bangkok Chinatown",       ("Chinatown", "Chinatown")),
    ("Lub d Bangkok Siam",            ("Siam",      "Siam")),
    ("Lub d Koh Samui Chaweng Beach", ("Samui",     "Samui")),
    ("Lub d Koh Tao Tanote Bay",      ("Koh Tao",   "Kohtao")),
    ("Lub d Philippines Makati",      ("Makati",    "Makati")),
    ("Lub d Phuket Patong",           ("Patong",    "Patong")),
    ("Lub d Siem Reap",               ("Siem Reap", "Siemreap")),
    ("Marasca Samui",                 ("Marasca",   "MRCSamui")),
])

# Manila is UTC+8; every other property is UTC+7.
TZ_OFFSET = {"Lub d Philippines Makati": 8}

_FIELD_COUNT = 41
# 0-based positions of the fields read by name - layout in
# sync_service.get_rv_export's docstring.
_GL, _DATE, _DESC, _CURRENCY, _AMOUNT, _BASE_AMOUNT, _DC = 2, 3, 7, 9, 10, 12, 15

# What a reader should call a field when it differs.
_FIELD_NAMES = {
    0: "Journal type", 1: "Journal type", 2: "Account", 3: "Date", 4: "Period",
    5: "Year", 6: "Reference", 7: "Description", 8: "Transaction date",
    9: "Currency", 10: "Amount", 11: "Rate", 12: "Base amount",
    15: "Debit/Credit", 16: "Property code", 17: "Department",
    20: "Analysis 1", 21: "Market segment", 24: "Analysis 5",
}

# How many differing lines table 2 names per property before it summarises
# the rest. The count beside it is always the full one.
_MAX_DETAIL_ROWS = 15

_DRIFT_ASCII = ('Known drift - the Google Sheet holds "×" where our file (and MEWS\'s own '
                'real export) writes "x": get_rv_export folds every line to plain ASCII, '
                "because one non-ASCII character makes SunSystems reject the whole day's "
                "journal")

_DRIFT_PREAUTH = ("Known drift - MEWS's own export marks a card taken as a preauthorization "
                  '("Visa ****3336 Preauthorization") in the slot a virtual card fills with '
                  '" Virtual". The Connector API exposes no such field: creditCards/getAll '
                  "returned only Kind=Terminal and Format Physical/Virtual for all 1,509 cards "
                  "across the 8 properties over 13-19 Sep 2026, and the payment itself reads "
                  'Kind="Payment". Nothing we can read reproduces the word, so the line is '
                  "counted here rather than flagged every day")


def sheet_url() -> str:
    """The URL a person would open by hand - not the /export one fetched below,
    which downloads a file instead of opening the workbook."""
    return f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit"


# ------------------------------------------------------------------ parsing

def _fields(line: str) -> list:
    f = line.split("|")
    return f + [""] * (_FIELD_COUNT - len(f)) if len(f) < _FIELD_COUNT else f


def _amount(value: str) -> str:
    try:
        return f"{Decimal(value.strip()):.2f}"
    except (InvalidOperation, AttributeError):
        return value


def _normalise(line: str) -> tuple:
    f = _fields(line)
    f[_AMOUNT] = _amount(f[_AMOUNT])
    f[_BASE_AMOUNT] = _amount(f[_BASE_AMOUNT])
    return tuple(f)


def _iso(ddmmyyyy: str):
    try:
        return datetime.strptime(ddmmyyyy.strip(), "%d%m%Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def _parse_workbook(content: bytes) -> dict:
    """{property: {"lines", "date", "error"}} for every tab."""
    wb = load_workbook(io.BytesIO(content), data_only=True)
    out = {}
    for prop, (_short, tab) in PROPERTIES.items():
        if tab not in wb.sheetnames:
            out[prop] = {"lines": [], "date": None, "error": f'the sheet has no "{tab}" tab'}
            continue
        lines = []
        for row in wb[tab].iter_rows(values_only=True):
            values = list(row)
            while values and values[-1] in (None, ""):
                values.pop()
            # Rejoined with "," - see the module docstring, point 2. An empty
            # cell BETWEEN two filled ones is kept as "" so ",," survives too.
            line = ",".join("" if v is None else str(v) for v in values)
            if line.startswith("PMSRV"):
                lines.append(line)
        dates = sorted({_fields(line)[_DATE] for line in lines})
        date = _iso(dates[0]) if len(dates) == 1 else None
        error = None
        if not lines:
            error = f'the "{tab}" tab holds no journal lines'
        elif len(dates) > 1:
            error = f'the "{tab}" tab mixes more than one date ({", ".join(dates)})'
        elif date is None:
            error = f'the "{tab}" tab\'s date "{dates[0]}" is not a ddmmyyyy date'
        out[prop] = {"lines": lines, "date": date, "error": error}
    return out


async def _fetch_workbook() -> bytes:
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=xlsx"
    async with httpx.AsyncClient(follow_redirects=True, timeout=120) as client:
        r = await client.get(url)
        r.raise_for_status()
    if "spreadsheetml" not in r.headers.get("content-type", ""):
        raise ValueError("Google returned a sign-in page instead of the workbook - "
                         "the sheet is no longer shared for viewing")
    return r.content


def _our_lines(property_name: str, date: str) -> list:
    """The file we would actually file, built from the cached import. Raises
    the same ValueError get_rv_export does when there is nothing to export
    (not imported, no property code, an unmapped payment type)."""
    from app.services.sync_service import sync_service

    text, _filename = sync_service.get_rv_export(property_name, date)
    return [line for line in text.split("\n") if line.strip()]


def _synced_at(property_name: str, date: str) -> str:
    from app.services.sync_service import sync_service

    try:
        res = sync_service.supabase.table("rv_files_sync").select("synced_at").eq(
            "property", property_name).eq("report_date", date).limit(1).execute()
        return (res.data[0].get("synced_at") if res.data else "") or ""
    except Exception:
        return ""


def _local(ts: str, prop: str) -> str:
    if not ts:
        return ""
    ts = re.sub(r"\.(\d+)", lambda m: "." + m.group(1)[:6].ljust(6, "0"), ts)
    off = TZ_OFFSET.get(prop, 7)
    return datetime.fromisoformat(ts).astimezone(timezone(timedelta(hours=off))).strftime("%d %b %H:%M")


# --------------------------------------------------------------- comparison

def _differing(a: tuple, b: tuple) -> list:
    n = max(len(a), len(b))
    a, b = list(a) + [""] * (n - len(a)), list(b) + [""] * (n - len(b))
    return [(i, a[i], b[i]) for i in range(n) if a[i] != b[i]]


def _is_preauth_drift(ours: str, sheet: str) -> bool:
    """The sheet's description is ours with " Preauthorization" inserted after
    the masked card number - see _DRIFT_PREAUTH. Field 8 is truncated to 50
    characters on both sides, so removing the word leaves a SHORTER string
    that ours must start with, not one that equals it."""
    if " Preauthorization" not in sheet:
        return False
    stripped = sheet.replace(" Preauthorization", "", 1)
    return bool(stripped) and ours[:len(stripped)] == stripped


def _drift_reason(ours: str, sheet: str) -> str:
    return _DRIFT_PREAUTH if _is_preauth_drift(ours, sheet) else _DRIFT_ASCII


def _is_known_drift(index: int, ours: str, sheet: str) -> bool:
    if index != _DESC:
        return False
    from app.services.sync_service import _ascii_fold

    folded = _ascii_fold(sheet)
    if folded == ours or folded[:50] == ours[:50]:
        return True
    return _is_preauth_drift(ours, sheet)


def _totals(lines: list) -> tuple:
    debit = credit = Decimal("0")
    for line in lines:
        f = _fields(line)
        try:
            amount = Decimal(f[_AMOUNT].strip())
        except InvalidOperation:
            continue
        if f[_DC] == "D":
            debit += amount
        elif f[_DC] == "C":
            credit += amount
    return debit, credit


def _compare(ours: list, sheet: list) -> dict:
    o = Counter(_normalise(line) for line in ours)
    s = Counter(_normalise(line) for line in sheet)
    left_ours, left_sheet = sorted((o - s).elements()), sorted((s - o).elements())

    # Whatever is left is paired on the three fields that make two lines the
    # same posting - account, debit/credit and amount - and only then compared
    # field by field, so a changed description reads as one line with one
    # differing field rather than as a line missing from each side.
    pool = defaultdict(list)
    for f in left_sheet:
        pool[(f[_GL], f[_DC], f[_AMOUNT])].append(f)
    changed, drift, only_ours = [], [], []
    for f in left_ours:
        candidates = pool.get((f[_GL], f[_DC], f[_AMOUNT]))
        if not candidates:
            only_ours.append(f)
            continue
        best = min(candidates, key=lambda c: len(_differing(f, c)))
        candidates.remove(best)
        fields = _differing(f, best)
        entry = {"ours": f, "sheet": best, "fields": fields}
        if all(_is_known_drift(i, ov, sv) for i, ov, sv in fields):
            drift.append(entry)
        else:
            changed.append(entry)

    our_debit, our_credit = _totals(ours)
    sheet_debit, sheet_credit = _totals(sheet)
    currency = next((_fields(line)[_CURRENCY] for line in sheet + ours), "")
    return {
        "sheet_lines": len(sheet),
        "our_lines": len(ours),
        "identical": sum((o & s).values()),
        "sheet_debit": sheet_debit,
        "sheet_credit": sheet_credit,
        "our_debit": our_debit,
        "our_credit": our_credit,
        "currency": currency,
        "changed": changed,
        "drift": drift,
        "only_ours": only_ours,
        "only_sheet": sorted(f for group in pool.values() for f in group),
    }


def needs_review(p: dict) -> int:
    return len(p["changed"]) + len(p["only_ours"]) + len(p["only_sheet"])


async def build_comparison(want_date: str = None) -> dict:
    """The whole check, as data. `status` is one of:
      ok        - at least one property compared; see `properties`
      no_sheet  - the workbook itself could not be read
      no_data   - the workbook was read but no property could be compared
    A property that can't be compared (tab empty, not imported yet, holds a
    different date than want_date) is still listed, with a note saying why.
    """
    try:
        content = await _fetch_workbook()
    except Exception as e:
        logger.warning(f"RV compare: could not read the RV sheet: {e}")
        return {"status": "no_sheet", "reason": f"Could not read the RV Google Sheet: {e}", "properties": []}

    sheet = _parse_workbook(content)
    props = []
    for prop, (short, tab) in PROPERTIES.items():
        sh = sheet[prop]
        row = {"property": prop, "short": short, "tab": tab, "date": sh["date"]}
        if sh["error"]:
            row.update(status="no_sheet", note=sh["error"])
        elif want_date and sh["date"] != want_date:
            row.update(status="not_held", note=f"the sheet holds {sh['date']}, not {want_date}")
        else:
            try:
                ours = _our_lines(prop, sh["date"])
            except Exception as e:
                row.update(status="missing", note=str(e))
            else:
                row.update(status="ok", note="", synced_at=_synced_at(prop, sh["date"]),
                           **_compare(ours, sh["lines"]))
        props.append(row)

    compared = [p for p in props if p["status"] == "ok"]
    if not compared:
        return {"status": "no_data", "reason": "No property could be compared", "properties": props}

    return {
        "status": "ok",
        # Each property is compared at its own tab's date; this is the one most
        # of them hold, for the subject line and heading.
        "date": Counter(p["date"] for p in compared).most_common(1)[0][0],
        "properties": props,
        "totals": {
            "compared": len(compared),
            "properties": len(PROPERTIES),
            "sheet_lines": sum(p["sheet_lines"] for p in compared),
            "our_lines": sum(p["our_lines"] for p in compared),
            "needs_review": sum(needs_review(p) for p in compared),
            "drift": sum(len(p["drift"]) for p in compared),
        },
    }


def subject_summary(result: dict) -> str:
    if result["status"] != "ok":
        return "not comparable yet"
    t = result["totals"]
    if t["needs_review"]:
        return f"{t['needs_review']} line{'s' if t['needs_review'] != 1 else ''} need review"
    if t["compared"] < t["properties"]:
        return f"matches sheet ({t['compared']} of {t['properties']} properties compared)"
    return "matches sheet completely"


# ---------------------------------------------------------------- rendering

_TD = "padding:6px 10px;border:1px solid #e2e8f0;font-size:13px;"
_TH = "padding:6px 10px;border:1px solid #e2e8f0;font-size:11px;font-weight:700;background:#f8fafc;text-align:left;"
_MUTED = "color:#94a3b8;"
# Same three states the RR4/TM30 mail uses: green agrees, red needs somebody
# today, amber is a difference that has already been explained.
_OK = "color:#166534;font-weight:700;"
_BAD = "color:#b91c1c;font-weight:700;"
_AMBER = "background:#fef3c7;color:#92400e;font-weight:700;"
_TABLE_OPEN = '<table style="border-collapse:collapse">'


def _esc(value) -> str:
    return html.escape("" if value is None else str(value))


def _span(style: str, text: str) -> str:
    return f'<span style="{style}">{text}</span>'


def _money(value) -> str:
    return f"{value:,.2f}"


def _pair(sheet, ours, fmt=str) -> str:
    """Google Sheet / NHGOne - one value with a tick when they agree."""
    if sheet == ours:
        return _span(_OK, f"✓ {fmt(sheet)}")
    return _span(_BAD, f"✗ {fmt(sheet)} / {fmt(ours)}")


def _scroll(table: str, footnote: str = "") -> str:
    """Wider than a phone, so the table scrolls inside its own box rather than
    forcing the email body to - same wrapper the other two checks use."""
    note = f'<p style="font-size:11px;color:#94a3b8;margin:6px 0 0">{footnote}</p>' if footnote else ""
    return f'<div style="overflow-x:auto">{table}</div>{note}'


def _line_label(f) -> str:
    return (f"{_esc(f[_GL])} &middot; {_esc(f[_DC])} &middot; {_esc(f[_AMOUNT])}"
            f'<br><small style="color:#64748b">{_esc(f[_DESC])}</small>')


def render_summary_table(result: dict) -> str:
    """Table 1 - every property, Google Sheet / NHGOne."""
    if result["status"] != "ok":
        return f'<pre style="font-family:ui-monospace,monospace;font-size:13px">{_esc(render_text(result))}</pre>'

    h = [_TABLE_OPEN, "<tr>"]
    h += [f'<th style="{_TH}">{c}</th>' for c in
          ("Property", "Date", "Lines", "Debit", "Credit", "Result", "NHGOne imported")]
    h.append("</tr>")
    for p in result["properties"]:
        name = (f'<td style="{_TD}font-weight:600;white-space:nowrap">'
                f'<a href="{sheet_url()}" style="color:#152A00;text-decoration:underline">{_esc(p["short"])}</a></td>')
        date = f'<td style="{_TD}white-space:nowrap">{_esc(p.get("date") or chr(8212))}</td>'
        if p["status"] != "ok":
            h.append(f'<tr>{name}{date}<td style="{_TD}{_MUTED}" colspan="5">{_esc(p["note"])}</td></tr>')
            continue
        n, d = needs_review(p), len(p["drift"])
        verdict = _span(_BAD, f"✗ {n} line{'s' if n != 1 else ''} need review") if n \
            else _span(_OK, "✓ every line matches")
        if d:
            verdict += "<br>" + _span(_AMBER, f"{d} known drift")
        money = lambda v, c=p["currency"]: f"{_money(v)} {c}".strip()  # noqa: E731
        h.append(
            f"<tr>{name}{date}"
            f'<td style="{_TD}white-space:nowrap">{_pair(p["sheet_lines"], p["our_lines"])}</td>'
            f'<td style="{_TD}white-space:nowrap">{_pair(p["sheet_debit"], p["our_debit"], money)}</td>'
            f'<td style="{_TD}white-space:nowrap">{_pair(p["sheet_credit"], p["our_credit"], money)}</td>'
            f'<td style="{_TD}">{verdict}</td>'
            f'<td style="{_TD}{_MUTED}white-space:nowrap">{_esc(_local(p.get("synced_at"), p["property"]) or chr(8212))}</td>'
            "</tr>")
    h.append("</table>")
    return _scroll("".join(h),
                   "Every pair reads Google Sheet / NHGOne - ✓ means both sides agree. "
                   "Amounts are compared as numbers: the sheet holds 1700 where our file writes 1700.00.")


def render_detail_table(result: dict) -> str:
    """Table 2 - every line behind table 1's result, by name."""
    if result["status"] != "ok":
        return ""

    def tr(*cells):
        return "<tr>" + "".join(f'<td style="{_TD}">{c}</td>' for c in cells) + "</tr>"

    rows = []
    for p in result["properties"]:
        if p["status"] != "ok":
            continue
        short = f'<b style="white-space:nowrap">{_esc(p["short"])}</b>'
        entries = []
        for e in p["changed"]:
            for i, ov, sv in e["fields"]:
                why = _span(_AMBER, "Known drift") if _is_known_drift(i, ov, sv) else _span(_BAD, "Needs review")
                entries.append((_line_label(e["sheet"]), _FIELD_NAMES.get(i, f"Field {i + 1}"),
                                _esc(sv), _esc(ov), why))
        for f in p["only_sheet"]:
            entries.append((_line_label(f), "Line only in the sheet", "present", "missing",
                            _span(_BAD, "Needs review")))
        for f in p["only_ours"]:
            entries.append((_line_label(f), "Line only in NHGOne", "missing", "present",
                            _span(_BAD, "Needs review")))
        for label, what, sv, ov, why in entries[:_MAX_DETAIL_ROWS]:
            rows.append(tr(short, label, what, sv, ov, why))
        if len(entries) > _MAX_DETAIL_ROWS:
            rows.append(tr(short, _span(_MUTED, f"&hellip; and {len(entries) - _MAX_DETAIL_ROWS} more - "
                                                f'see the sheet\'s "{_esc(p["tab"])}" tab'), "", "", "", ""))
        if p["drift"]:
            # One summary row per drift REASON, not one per line: the same
            # character recurs every day and 28 identical amber rows would
            # bury the red ones this table exists to surface. Grouped by
            # reason rather than per property so a property carrying both
            # kinds doesn't get one of them explained by the other's text.
            buckets = {}
            for entry in p["drift"]:
                _i, ov, sv = entry["fields"][0]
                buckets.setdefault(_drift_reason(ov, sv), []).append((ov, sv))
            for reason, pairs in buckets.items():
                ov, sv = pairs[0]
                rows.append(tr(short, f'{len(pairs)} line{"s" if len(pairs) != 1 else ""}'
                                      f'<br><small style="color:#64748b">e.g. {_esc(sv)}</small>',
                               "Description", _esc(sv), _esc(ov), _span(_MUTED, _esc(reason))))

    if not rows:
        return '<p style="margin:0;font-size:13px;color:#166534;font-weight:700">Nothing to review - every line matched the sheet.</p>'
    head = "".join(f'<th style="{_TH}">{c}</th>' for c in
                   ("Property", "Line (account &middot; D/C &middot; amount)", "What differs",
                    "Google Sheet", "NHGOne", "Why"))
    return _scroll(f"{_TABLE_OPEN}<tr>{head}</tr>{''.join(rows)}</table>",
                   f"Red needs review; amber is already explained. At most {_MAX_DETAIL_ROWS} lines are named per property.")


def render_text(result: dict) -> str:
    """Plain-text form - the CLI output, and the email's text/plain part."""
    if result["status"] != "ok":
        out = [f"⛔ {result.get('reason') or 'Nothing comparable yet'}"]
        for p in result.get("properties") or []:
            out.append(f"   {p['short']:<11}{p.get('date') or '-':<12}{p.get('note', '')}")
        return "\n".join(out)

    t = result["totals"]
    out = ["=" * 78, f"RV Files vs Google Sheet — {result['date']}", "=" * 78,
           f"{'Property':<11}{'Date':<12}{'Lines S/N':<12}{'Debit S/N':<30}Result", "-" * 78]
    for p in result["properties"]:
        if p["status"] != "ok":
            out.append(f"{p['short']:<11}{p.get('date') or '-':<12}{p['note']}")
            continue
        n = needs_review(p)
        verdict = "✓" if n == 0 else f"✗ {n} need review"
        if p["drift"]:
            verdict += f" ({len(p['drift'])} known drift)"
        lines = f"{p['sheet_lines']}/{p['our_lines']}"
        debit = f"{_money(p['sheet_debit'])}/{_money(p['our_debit'])}"
        out.append(f"{p['short']:<11}{p['date']:<12}{lines:<12}{debit:<30}{verdict}")
        for e in p["changed"][:_MAX_DETAIL_ROWS]:
            for i, ov, sv in e["fields"]:
                out.append(f"     {_FIELD_NAMES.get(i, f'field {i + 1}')}: sheet {sv!r} / ours {ov!r}"
                           f"   [{e['sheet'][_GL]} {e['sheet'][_DC]} {e['sheet'][_AMOUNT]}]")
        for f in p["only_sheet"][:_MAX_DETAIL_ROWS]:
            out.append(f"     only in the sheet: {f[_GL]} {f[_DC]} {f[_AMOUNT]} {f[_DESC]}")
        for f in p["only_ours"][:_MAX_DETAIL_ROWS]:
            out.append(f"     only in NHGOne:    {f[_GL]} {f[_DC]} {f[_AMOUNT]} {f[_DESC]}")
    out.append("-" * 78)
    out.append(f"Lines {t['sheet_lines']}/{t['our_lines']} (sheet/NHGOne) · "
               f"{t['needs_review']} need review · {t['drift']} known drift · "
               f"{t['compared']} of {t['properties']} properties compared")
    out.append(f"Sheet: {sheet_url()}")
    return "\n".join(out)


def render_tokens(result: dict) -> dict:
    """Everything the email template can substitute."""
    t = result.get("totals") or {}
    day = datetime.strptime(result["date"], "%Y-%m-%d") if result.get("date") else None
    return {
        "Date": day.strftime("%d/%m/%Y") if day else "—",
        "PropertyCount": str(t.get("compared", 0)),
        "Lines": f"{t.get('sheet_lines', 0)} / {t.get('our_lines', 0)}",
        "NeedsReview": str(t.get("needs_review", 0)),
        "KnownDrift": str(t.get("drift", 0)),
        "SummaryTable": render_summary_table(result),
        "DetailTable": render_detail_table(result),
        "SheetLink": sheet_url(),
    }
