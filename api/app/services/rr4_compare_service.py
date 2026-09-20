"""RR4 / TM30 verification: our stored register vs each property's own
"RR4-TM30-<Name>-Gen" Google Sheet, which is the ground truth for what
actually gets filed with the authorities.

The RR4/TM30 counterpart to st_compare_service, and deliberately the same
shape - but three things differ, each forced by the source sheets:

1. **Thailand only.** Lub d Siem Reap and Lub d Philippines Makati don't file
   under the Thai Hotel Act and have no generator sheet at all (same exclusion
   sync_service._RR4_TM30_EMAIL_EXCLUDED_PROPERTIES already applies to the
   daily RR4/TM30 digest).

2. **Each property is compared at ITS OWN date**, not one date shared by all -
   unlike the ST sheets, which are all pasted within an hour of each other.
   These windows run to the property's own cutoff hour, and Chinatown's is
   12:15 where everyone else's is ~02:00, so at any given moment Chinatown's
   sheet is a full day behind the rest. Demanding one common date would mean
   never sending a mail at all.

3. **Rows are paired by identity, then compared column by column.** A
   key-based diff that stops at "we found a row with this passport" hides real
   defects (on 2026-08-22 a 4-field key called Patong's TM30 a perfect match
   while a full-field diff surfaced 6 differing rows). So the passport/PID is
   used ONLY to pair the two sides up; every column of a paired row is then
   compared, and a name that changed shows up as a column difference rather
   than as two unmatched rows.

Known drift is reported separately from real differences - see _KNOWN_DRIFT
below. Those four patterns have each been investigated and confirmed to be
the sheet or MEWS moving on after the fact, not our bug; counting them as
mismatches every single day would bury the differences that do matter.
"""
import asyncio
import io
import logging
import re
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

import httpx
from openpyxl import load_workbook

logger = logging.getLogger(__name__)

# The six Thai properties' generator workbooks. Marasca is the "MRCS"-style
# sheet, NOT `1tY_kX...`/MRCKY-Gen, whose ImportInhouse was empty when checked.
SHEETS = OrderedDict([
    ("Lub d Bangkok Chinatown",       ("Chinatown", "1qT4ZClqvTLVUW9Bc4Oaxx2oy6u8QZo0dCVlyM35JRy4")),
    ("Lub d Bangkok Siam",            ("Siam",      "1liiB8tqYGCgAyKqDsRCCaZSonubHgnMr2YSZQr7-SlQ")),
    ("Lub d Koh Samui Chaweng Beach", ("Samui",     "1nanCOqRnRjiFzkQ_l0RyZqJ0oZ_LGJ6-RTB0qDMTAyg")),
    ("Lub d Koh Tao Tanote Bay",      ("Koh Tao",   "1akGkOIoHKURs6DihwkCRw5zx37HkWVlaYFSdjj-KI6c")),
    ("Lub d Phuket Patong",           ("Patong",    "1XKfU7pSyMwSFIiq7g1wKlKJB_gW9d1JtTuniahqBja8")),
    ("Marasca Samui",                 ("Marasca",   "1YZD0CYpaOwxSiHLa7iH_7bK3ED5CAIhdR2GizwKKwuI")),
])

# Kept out of table 1 entirely - its own row AND the Total it feeds.
#
# Chinatown cuts its TM30 day at 12:15 where everyone else cuts at ~02:00, so
# its register deliberately files fewer arrivals than its sheet holds: every
# guest who arrives before noon belongs to the previous day's filing. That is
# the configuration working, not a difference to review, but it renders as a
# red "34 / 30" every single morning - which trains a reader to ignore the one
# table whose job is to say whether anything is wrong. Chinatown is therefore
# reported only in table 2 ("What Differs"), where a genuine problem on it
# still surfaces by name, with the window itself in table 3.
_SUMMARY_EXCLUDED = {"Lub d Bangkok Chinatown"}

# rowNo is excluded from the comparison: both sides renumber their own rows
# from 1, and the two exports don't emit guests in the same order (the sheet
# lists a room's unnamed occupant slot first, we don't), so it would report a
# difference on almost every row while meaning nothing.
_SKIP_RR4_COLUMNS = {"row_no"}

# Differences that have each been chased down and confirmed as the world
# moving on after the sheet was generated, not a defect on our side. Reported
# in their own column so the "real differences" number stays meaningful.
_GEORGIA_DRIFT = (
    'The sheet\'s own RR4-Nationality tab keys this lookup by "Georgian" (the demonym) '
    'instead of "Georgia" (what MEWS actually calls it, matching ImportInhouse!K and our own '
    "rr4_nationality_codes) - the sheet's VLOOKUP fails on that mismatch and returns blank. "
    "Confirmed a template-wide typo, not one property's mistake: all six sheets' "
    'RR4-Nationality tabs have "Georgian" and none has "Georgia" (checked 15-Sep-2026). '
    "Our 226 is Georgia's correct code either way."
)
_KNOWN_DRIFT = {
    "time_check_in":
        "MEWS wrote ActualStartUtc at :59 seconds, right after the sheet was generated (sheet is exactly 1 minute behind)",
    "date_check_out":
        "Guest checked out earlier than scheduled, after the sheet was generated (ours is ahead of the sheet)",
    "check_out_date":
        "Guest checked out earlier than scheduled, after the sheet was generated (ours is ahead of the sheet)",
    "birth_date":
        "Sheet prints 30/12/1899 when MEWS has no birth date (Excel's render of an empty value) - ours leaves it blank, which is correct",
    # Chinatown, 14-Sep-2026: two Georgian guests in room 626 (Natia
    # Garashvili, Lasha Sulaberidze) came back blank on the sheet for all
    # four of these columns. See _GEORGIA_DRIFT for why - it isn't a
    # per-guest coincidence, it is this one nationality, every time.
    "nationality": _GEORGIA_DRIFT,
    "issued_by": _GEORGIA_DRIFT,
    "address_country": _GEORGIA_DRIFT,
    "come_from_country": _GEORGIA_DRIFT,
}


def _norm(v) -> str:
    """One cell, normalized for comparison. Strips the leading apostrophe the
    sheets use to force Text formatting (our export carries it too, on the
    date columns only - see the RR4 importer's own rule), collapses 63 vs
    63.0 vs "63", and treats None and "" as the same empty."""
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%d/%m/%Y")
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    if s.startswith("'"):
        s = s[1:].strip()
    return s


def _dmy(s: str):
    """(y, m, d) from a dd/mm/yyyy string - Buddhist or Christian era, since
    both sides of any one column always use the same one."""
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    return (int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None


def _hhmm(s: str):
    """Minutes-since-midnight from the sheets' "HH.MM" check-in time."""
    m = re.match(r"^(\d{1,2})[.:](\d{2})$", s)
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


_GEORGIA_RR4_CODE = "226"

# Koh Tao, 16-Sep-2026: Dimitra Sofia Trantaki (Greek passport) filed GRL on
# the sheet, GRC by us. Not a mismatch to chase: the sheet's own
# TM30-Nationality tab has Greenland's data in its "Greece" row, and
# rr4_tm30_reference.TM30_NATIONALITY_CODE carries GR -> GRC as a deliberate,
# documented correction of it. Filing a Greek national as Greenland to
# Immigration would be the actual error.
_GREECE_DRIFT = (
    'The sheet\'s own TM30-Nationality tab has Greenland\'s code (GRL) in its "Greece" row. '
    "Ours files Greece as GRC on purpose (rr4_tm30_reference.py) - GRL would tell Immigration "
    "a Greek passport holder is from Greenland.")


def _is_known_drift(key: str, ours: str, sheet: str) -> bool:
    if key == "time_check_in":
        a, b = _hhmm(ours), _hhmm(sheet)
        return a is not None and b is not None and b - a == 1
    if key in ("date_check_out", "check_out_date"):
        a, b = _dmy(ours), _dmy(sheet)
        return a is not None and b is not None and a < b
    if key == "birth_date":
        return ours == "" and sheet == "30/12/1899"
    if key == "nationality" and ours == "GRC" and sheet == "GRL":
        # See _GREECE_DRIFT - this exact pair only, so any other nationality
        # disagreement on a TM30 row still reports as a real difference.
        return True
    if key in ("nationality", "issued_by", "address_country", "come_from_country"):
        # See _GEORGIA_DRIFT - only this one code, only when the sheet came
        # back blank, so a real mismatch on a Georgian guest's OWN code (a
        # typo'd passport entry, say) still reports as a difference.
        return sheet == "" and ours == _GEORGIA_RR4_CODE
    return False


def _drift_why(key: str, examples: list) -> str:
    """The reason line for a column of known drift. Chosen from the drift's
    own values, not the column alone: "nationality" carries two unrelated
    sheet defects (Georgia on RR4, Greece on TM30), and naming the wrong one
    would send whoever reads the mail looking in the wrong place."""
    if key == "nationality" and any(o == "GRC" and s == "GRL" for _w, o, s in examples):
        return _GREECE_DRIFT
    return _KNOWN_DRIFT.get(key, "Known drift")


def _pair_key(row: dict, kind: str) -> tuple:
    """What identifies the same guest on both sides. Passport first (the one
    field the filing itself is keyed on), then Thai national ID, then the
    name - and for MEWS's unnamed occupant slots, which carry none of the
    three, the room and check-in they were booked under."""
    if kind == "rr4":
        pp, pid = _norm(row.get("passport")).upper(), _norm(row.get("pid")).upper()
        if pp:
            return ("P", pp)
        if pid:
            return ("I", pid)
        name = (_norm(row.get("name_en")) + "|" + _norm(row.get("surname_en"))).upper()
        if name != "|":
            return ("N", name)
        # Deliberately NOT keyed on time_check_in: the two exports routinely
        # disagree by a minute on it (_is_known_drift has a rule for exactly
        # that), and a field known to drift cannot also be an identity. When
        # it was part of this key the drift stopped the row pairing at all,
        # so one unnamed slot surfaced as "only ours" AND "only sheet"
        # instead of as the known drift it is - Patong room 2313 on
        # 2026-08-26 (ours 06.42, sheet 06.43) was doing exactly that. Room +
        # check-in date still separates the slots; two of them sharing even
        # that are paired by content in _index.
        return ("X", _norm(row.get("room_no")), _norm(row.get("date_check_in")))
    pp = _norm(row.get("passport_no")).upper()
    if pp:
        return ("P", pp)
    return ("N", (_norm(row.get("first_name")) + "|" + _norm(row.get("last_name"))).upper())


def _row_label(row: dict, kind: str) -> str:
    """One guest, named well enough to be found in MEWS from the mail alone.

    Name first because that is what a person recognises, then the number the
    filing is actually keyed on, then (RR4 only) the room - which is all there
    is to go on for MEWS's unnamed occupant slots, since they carry neither of
    the first two. TM30 has no room column at all, so it gets name + passport.
    """
    if kind == "rr4":
        name = " ".join(x for x in (_norm(row.get("name_en")), _norm(row.get("surname_en"))) if x)
        ident = _norm(row.get("passport")) or _norm(row.get("pid"))
        room = _norm(row.get("room_no"))
    else:
        name = " ".join(x for x in (_norm(row.get("first_name")), _norm(row.get("last_name"))) if x)
        ident = _norm(row.get("passport_no"))
        room = ""
    bits = [name or "(no name)"]
    if ident:
        bits.append(ident)
    if room:
        bits.append(f"room {room}")
    return " · ".join(bits)


# How many differing guests the detail table names per column, and per
# one-side-only group. The counts printed beside them are always the FULL
# number and the table's own footnote states these caps, so a truncated list
# can never be read as the complete one.
_EXAMPLES_PER_COLUMN = 3
_EXAMPLES_PER_MISSING_GROUP = 6


def _index(rows: list, kind: str, columns: list) -> dict:
    """Rows by pair key, with an occurrence counter appended so two guests
    sharing a passport (or two unnamed slots in the same room) stay distinct
    instead of one silently overwriting the other.

    Where a key DOES repeat, the duplicates are ordered by their own compared
    values rather than by the order the export happened to emit them. The two
    sides genuinely do emit rows in different orders (see the module
    docstring), so numbering by first-seen paired a guest's first row against
    the sheet's second and reported every column that differs between the
    guest's own two rows as a difference on both of them - twice over, once
    in each direction. Verified 2026-08-26: Chinatown's Andrea Solves Vidal
    (530 @ 21.43 + 404 @ 21.44) and Siam's PATTRAPORN CHANIM (105 @ 13.59 +
    101 @ 14.00) each held identical data on both sides in opposite order,
    and accounted for 4 of the 5 "real" RR4 differences that day. Sorting on
    the compared columns is deterministic and identical on both sides, so
    matching rows line up and genuinely different ones still report.
    """
    groups = {}
    for row in rows:
        groups.setdefault(_pair_key(row, kind), []).append(row)
    out = {}
    for k, group in groups.items():
        if len(group) > 1:
            group = sorted(group, key=lambda r: tuple(_norm(r.get(c)) for c in columns))
        for i, row in enumerate(group, 1):
            out[k + (i,)] = row
    return out


def _compare_rows(ours: list, sheet: list, kind: str, columns: list) -> dict:
    """One property, one register. Pairs the two sides up by identity, then
    compares every column of every paired row."""
    ours_ix, sheet_ix = _index(ours, kind, columns), _index(sheet, kind, columns)
    paired = ours_ix.keys() & sheet_ix.keys()

    diff_rows, drift_rows = 0, 0
    cols, drift_cols = {}, {}
    col_examples, drift_col_examples = {}, {}
    # sorted() rather than the set's own order: which guests end up as the
    # mail's named examples must not move between two runs over identical
    # data, or someone comparing this morning's mail against yesterday's sees
    # a change that never happened.
    for k in sorted(paired):
        o, s = ours_ix[k], sheet_ix[k]
        real, drift = [], []
        for key in columns:
            ov, sv = _norm(o.get(key)), _norm(s.get(key))
            if ov == sv:
                continue
            (drift if _is_known_drift(key, ov, sv) else real).append((key, ov, sv))
        who = _row_label(o, kind)
        for key, ov, sv in drift:
            drift_cols[key] = drift_cols.get(key, 0) + 1
            ex = drift_col_examples.setdefault(key, [])
            if len(ex) < _EXAMPLES_PER_COLUMN:
                ex.append((who, ov, sv))
        for key, ov, sv in real:
            cols[key] = cols.get(key, 0) + 1
            ex = col_examples.setdefault(key, [])
            if len(ex) < _EXAMPLES_PER_COLUMN:
                ex.append((who, ov, sv))
        if real:
            diff_rows += 1
        elif drift:
            drift_rows += 1

    # Named, not just counted. A morning that reads "3 rows only in the sheet"
    # tells nobody which three, and the answer is not derivable from the mail;
    # with the names in hand the same reader can open those guests in MEWS
    # before the register is filed.
    only_ours_keys = sorted(ours_ix.keys() - sheet_ix.keys())
    only_sheet_keys = sorted(sheet_ix.keys() - ours_ix.keys())
    return {
        "ours": len(ours),
        "sheet": len(sheet),
        "paired": len(paired),
        "only_ours": len(only_ours_keys),
        "only_sheet": len(only_sheet_keys),
        "only_ours_rows": [_row_label(ours_ix[k], kind)
                           for k in only_ours_keys[:_EXAMPLES_PER_MISSING_GROUP]],
        "only_sheet_rows": [_row_label(sheet_ix[k], kind)
                            for k in only_sheet_keys[:_EXAMPLES_PER_MISSING_GROUP]],
        "clean_rows": len(paired) - diff_rows - drift_rows,
        "diff_rows": diff_rows,
        "drift_rows": drift_rows,
        "cols": cols,
        "drift_cols": drift_cols,
        # There used to be a separate `samples` list here - up to 3 whole rows
        # with up to 4 of their differing columns each - feeding its own table.
        # It is gone rather than kept alongside col_examples, because two
        # parallel example paths can name different guests for the same
        # difference, and it could never carry a known-drift row at all (it was
        # only appended inside `if real:`).
        "col_examples": col_examples,
        "drift_col_examples": drift_col_examples,
    }


def _unmapped_nationalities(payload: dict) -> dict:
    """Rows in OUR OWN generated file whose nationality column came out blank.

    Not a sheet comparison at all - this one reads only what we filed, because
    a blank nationality is wrong on a government form whether or not the sheet
    happens to be blank in the same place too (it usually is: both sides look
    the code up in the same table).

    Two different faults produce the same blank cell, and they need different
    people to fix them, so they are counted apart:

      "no_code"    MEWS DOES have a nationality for this guest and we have no
                   Thai Hotel Act number / TM30 alpha-3 for it. Fixed in Admin
                   > RR4-Nationality or TM30-Nationality by typing the code in
                   - the country name is already sitting there in a row.
      "no_country" MEWS has no nationality on the guest profile at all. No
                   code table can help; somebody has to fill it in on the
                   MEWS profile.

    RR4 tells the two apart on its own: `address` carries MEWS's own country
    name and is blank only in the second case. TM30 has no country column - it
    writes the literal "Not found" for both - so it is joined back to the RR4
    row for the same guest by _key, which both registers build the same way
    (<ReservationId>:<CustomerId>).
    """
    rr4_rows = (payload.get("rr4") or {}).get("rows") or []
    tm30_rows = (payload.get("tm30") or {}).get("rows") or []
    country_by_key = {r.get("_key"): (r.get("address") or "").strip()
                      for r in rr4_rows if r.get("_key")}

    out = {"rr4": [], "tm30": []}
    for r in rr4_rows:
        name = " ".join(x for x in (r.get("name_en"), r.get("surname_en")) if x).strip()
        # A nameless row is MEWS's own unbooked occupant slot - it is dropped
        # from the filed .xlsx entirely, so a blank nationality on it is not a
        # missing code, just an empty row.
        if not name or (r.get("nationality") or "").strip():
            continue
        country = (r.get("address") or "").strip()
        out["rr4"].append({
            "name": name,
            "room": r.get("room_no") or "",
            "document": (r.get("passport") or r.get("pid") or "").strip(),
            "country": country,
            "kind": "no_code" if country else "no_country",
        })

    for r in tm30_rows:
        code = (r.get("nationality") or "").strip()
        if code and code != "Not found":
            continue
        name = " ".join(x for x in (r.get("first_name"), r.get("last_name")) if x).strip()
        if not name:
            continue
        country = country_by_key.get(r.get("_key"), "")
        out["tm30"].append({
            "name": name,
            "room": "",
            "document": (r.get("passport_no") or "").strip(),
            "country": country,
            "kind": "no_code" if country else "no_country",
        })
    return out


def _parse_sheet(content: bytes) -> dict:
    """One workbook's RR4 and TM30 tabs, plus the window each was exported
    over. The Master tab is the only place every sheet agrees on: A2 is the
    ImportInhouse (RR4) start and B2 the ImportCP (TM30) start. Chinatown also
    carries Parameter-* tabs, but the other five don't."""
    wb = load_workbook(io.BytesIO(content), data_only=True, read_only=True)

    ms = wb["Master"]
    rr4_start, tm30_start = ms.cell(2, 1).value, ms.cell(2, 2).value
    date = rr4_start.strftime("%Y-%m-%d") if isinstance(rr4_start, datetime) else None

    # RR4 tab: row 3 is the Thai header, row 4 the English field keys, data
    # from row 5. Columns are located BY that field-key row rather than by
    # position, so a sheet that gains a column doesn't silently shift the
    # whole comparison one to the left.
    from app.services.sync_service import sync_service
    rr4_rows = []
    if "RR4" in wb.sheetnames:
        ws = wb["RR4"]
        grid = [[c.value for c in row] for row in ws.iter_rows(min_row=4, max_col=27)]
        keys = {_norm(v): i for i, v in enumerate(grid[0])} if grid else {}
        by_key = {field: keys.get(field) for _k, _l, field in sync_service._RR4_COLUMNS}
        for row in grid[1:]:
            if _norm(row[0]) == "":
                continue
            rr4_rows.append({
                key: (row[by_key[field]] if by_key.get(field) is not None else None)
                for key, _label, field in sync_service._RR4_COLUMNS
            })

    # TM30 tab: one header row of the government form's own bilingual labels,
    # then data. Nine fixed columns in the export's own order - matched
    # positionally because those labels carry embedded newlines and stray
    # spaces that differ between sheets.
    tm30_rows = []
    if "TM30" in wb.sheetnames:
        ws = wb["TM30"]
        for row in ws.iter_rows(min_row=2, max_col=len(sync_service._TM30_COLUMNS), values_only=True):
            if _norm(row[0]) == "":
                continue
            tm30_rows.append({key: row[i] for i, (key, _label) in enumerate(sync_service._TM30_COLUMNS)})

    wb.close()
    return {
        "date": date,
        "rr4_rows": rr4_rows,
        "tm30_rows": tm30_rows,
        "rr4_window": rr4_start.strftime("%H:%M") if isinstance(rr4_start, datetime) else None,
        "tm30_window": tm30_start.strftime("%H:%M") if isinstance(tm30_start, datetime) else None,
    }


async def _fetch_sheets() -> dict:
    """All six workbooks over their public export URL, concurrently. One that
    fails comes back as an error on that property's row rather than failing
    the run - five comparable properties still beat none."""
    async def one(prop, sheet_id):
        url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx"
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=120) as client:
                r = await client.get(url)
                r.raise_for_status()
            return prop, _parse_sheet(r.content), None
        except Exception as e:
            logger.warning(f"RR4 compare: could not read {prop}'s sheet: {e}")
            return prop, None, str(e)

    results = await asyncio.gather(*(one(p, sid) for p, (_, sid) in SHEETS.items()))
    return {p: {"data": d, "error": e} for p, d, e in results}


def _windows() -> dict:
    """Each property's configured RR4 day window, to be shown next to the one
    the sheet was actually exported over. A stale value here silently
    undercounts the register - a leftover 14:00/12:00 on Chinatown once
    produced 160 rows where the real answer was 241 - and the sheets change
    their window without warning, so this is worth a daily look."""
    from app.services.sync_service import sync_service
    try:
        res = sync_service.supabase.table("property_api_settings").select(
            "property_name, rr4_tm30_day_start_hour, rr4_tm30_day_start_minute").execute()
        return {r["property_name"]: f"{r.get('rr4_tm30_day_start_hour') or 0:02d}:"
                                    f"{r.get('rr4_tm30_day_start_minute') or 0:02d}"
                for r in (res.data or [])}
    except Exception as e:
        logger.warning(f"RR4 compare: could not read property windows: {e}")
        return {}


async def _tm30_windows() -> dict:
    """TM30's own configured window per property - a separate setting from
    RR4's, so the mail has to ask for it separately too. Read through
    _resolve_tm30_day_start rather than the table directly, so this column
    can never disagree with the one the register was actually built on."""
    from app.services.sync_service import sync_service
    out = {}
    for prop in SHEETS:
        try:
            h, m = await sync_service._resolve_tm30_day_start(prop)
            out[prop] = f"{h:02d}:{m:02d}"
        except Exception as e:
            logger.warning(f"RR4 compare: could not read {prop}'s TM30 window: {e}")
    return out


def _local(ts: str) -> str:
    """A stored UTC timestamp as Bangkok wall-clock. Every property here is in
    Thailand, so there is only the one offset to apply."""
    if not ts:
        return ""
    ts = re.sub(r"\.(\d+)", lambda m: "." + m.group(1)[:6].ljust(6, "0"), ts)
    return datetime.fromisoformat(ts).astimezone(timezone(timedelta(hours=7))).strftime("%d %b %H:%M")


async def build_comparison(want_date: str = None) -> dict:
    """The whole check, as data.

    `want_date` (the CLI's optional argument) pins every property to one date
    instead of each following its own sheet - useful for reproducing a past
    run, and it simply reports "the sheet holds a different date" for any property whose sheet
    has since moved on, because these workbooks hold one pasted export each
    and a day they no longer hold cannot be reconstructed.
    """
    from app.routers.rr4 import read_managed_day

    sheets = await _fetch_sheets()
    windows = _windows()
    tm30_windows = await _tm30_windows()
    props = []

    for prop, (short, _sid) in SHEETS.items():
        row = {"property": prop, "short": short, "date": None, "status": "error",
               "note": "", "rr4": None, "tm30": None, "synced_at": "",
               "unmapped": {"rr4": [], "tm30": []},
               "sheet_rr4_window": "", "sheet_tm30_window": "",
               "our_window": windows.get(prop, ""),
               "our_tm30_window": tm30_windows.get(prop, "")}
        sh = sheets[prop]["data"]
        if not sh:
            row["note"] = f"Could not read sheet — {sheets[prop]['error']}"
            props.append(row)
            continue

        row["date"] = sh["date"]
        row["sheet_rr4_window"] = sh["rr4_window"] or ""
        row["sheet_tm30_window"] = sh["tm30_window"] or ""
        if not sh["date"]:
            row["note"] = "Sheet has no date in Master"
            props.append(row)
            continue
        if want_date and want_date != sh["date"]:
            row["status"] = "other_date"
            row["note"] = f"Sheet holds {sh['date']}, not {want_date}"
            props.append(row)
            continue

        try:
            payload = read_managed_day(prop, sh["date"])
        except Exception as e:
            row["note"] = f"Could not read rr4_tm30_sync — {e}"
            props.append(row)
            continue
        if not payload:
            row["status"] = "missing"
            row["note"] = f"{sh['date']} has not been imported yet"
            props.append(row)
            continue

        from app.services.sync_service import sync_service
        rr4_cols = [k for k, _l, _f in sync_service._RR4_COLUMNS if k not in _SKIP_RR4_COLUMNS]
        tm30_cols = [k for k, _l in sync_service._TM30_COLUMNS]
        row["status"] = "ok"
        row["synced_at"] = _local(payload.get("_synced_at") or "")
        row["rr4"] = _compare_rows((payload.get("rr4") or {}).get("rows", []),
                                   sh["rr4_rows"], "rr4", rr4_cols)
        row["tm30"] = _compare_rows((payload.get("tm30") or {}).get("rows", []),
                                    sh["tm30_rows"], "tm30", tm30_cols)
        row["unmapped"] = _unmapped_nationalities(payload)
        props.append(row)

    compared = [p for p in props if p["status"] == "ok"]
    if not compared:
        return {"status": "no_data", "properties": props, "date": want_date}

    # The headline date is whichever day most properties are sitting on -
    # Chinatown's later cutoff routinely leaves it a day behind the other
    # five, and naming its date in the subject line would misdescribe the mail.
    counts = {}
    for p in compared:
        counts[p["date"]] = counts.get(p["date"], 0) + 1
    date = max(counts, key=lambda d: (counts[d], d))

    # Chinatown is excluded from the Total row (and everything derived from
    # it - the headline Rr4Rows/Tm30Rows/subject_summary tokens too) by
    # request: its 12:15 TM30 cutoff drops every guest arriving before noon
    # BY DESIGN (see _summary_cell's window note), which is a permanent,
    # already-explained skew rather than something to review - left in, it
    # would paint the Total row red every single morning regardless of
    # whether every other property is clean. Chinatown's own row above the
    # Total is untouched and still shows its real Sheet/NHGOne numbers.
    totals_rows = [p for p in compared if p["property"] not in _SUMMARY_EXCLUDED]
    totals = {}
    for kind in ("rr4", "tm30"):
        totals[kind] = {
            f: sum(p[kind][f] for p in totals_rows)
            for f in ("ours", "sheet", "paired", "only_ours", "only_sheet",
                      "clean_rows", "diff_rows", "drift_rows")
        }
    return {
        "status": "ok",
        "date": date,
        "mixed_dates": len(counts) > 1,
        "properties": props,
        "compared": len(compared),
        "totals": totals,
        "totals_compared": len(totals_rows),
    }


def _title(result: dict) -> str:
    day = datetime.strptime(result["date"], "%Y-%m-%d")
    # "%-d" (unpadded day) is a glibc extension - it raises ValueError on
    # Windows, which made this whole mail impossible to preview from a dev
    # machine. Formatting the day separately is portable and identical.
    return f"RR4/TM30 {day.day} {day.strftime('%b %Y')}"


def render_text(result: dict) -> str:
    """Plain-text form - the CLI output, and the email's text/plain part."""
    if result["status"] != "ok":
        out = ["⛔ Not comparable yet, for any property:"]
        for p in result["properties"]:
            out.append(f"     {p['short']:<12} {p['note']}")
        return "\n".join(out)

    out = ["=" * 88, f"Comparison Summary — {_title(result)}", "=" * 88]
    who = ", ".join(short for short, _url in review_properties(result))
    if who:
        out.append(f"Needs review: {who}")
    if result["mixed_dates"]:
        out.append("(Each property is compared at its own sheet's date — Chinatown cuts its day at 12:15, so it runs a day behind the rest)")

    # The same three sections the HTML mail is built from, in the same order,
    # so the text/plain part of a message can never describe a different check
    # from the part most people actually read.
    section = [0]

    def head(title):
        section[0] += 1
        return ["", f"{section[0]}. {title}", "-" * 88]

    out += head("EVERY PROPERTY — Google Sheet / NHGOne")
    out.append(f"{'Property':<12}{'Date':<12}{'RR4 sheet/ours':<17}{'Diff':<7}"
               f"{'TM30 sheet/ours':<17}Diff")
    for p in result["properties"]:
        if p["property"] in _SUMMARY_EXCLUDED:
            continue
        if p["status"] != "ok":
            out.append(f"{p['short']:<12}{(p['date'] or '—'):<12}{p['note']}")
            continue
        r, t = p["rr4"], p["tm30"]
        r_count = "{}/{}".format(r["sheet"], r["ours"])
        t_count = "{}/{}".format(t["sheet"], t["ours"])
        # Same rule as the HTML cell: the guest COUNT decides the mark, and
        # what still differs inside matching-sized registers is section 2's.
        r_gap = r["sheet"] - r["ours"]
        t_gap = t["sheet"] - t["ours"]
        out.append(
            f"{p['short']:<12}{p['date']:<12}"
            f"{r_count:<17}{('✓' if r_gap == 0 else f'✗ {r_gap:+d}'):<7}"
            f"{t_count:<17}{'✓' if t_gap == 0 else f'✗ {t_gap:+d}'}")
    out.append("-" * 88)

    tr, tt = result["totals"]["rr4"], result["totals"]["tm30"]
    out.append(f"Total ({result.get('totals_compared', result['compared'])} properties, Chinatown not shown "
               f"- its 12:15 window files fewer TM30 arrivals than its sheet holds by design; "
               f"anything genuinely wrong on it still appears in section 2):")
    out.append(f"RR4  total {tr['sheet']}/{tr['ours']} rows · paired {tr['paired']} · fully matched "
               f"{tr['clean_rows']} · real diff {tr['diff_rows']} · known drift {tr['drift_rows']} · "
               f"only in sheet {tr['only_sheet']} · only in NHGOne {tr['only_ours']}")
    out.append(f"TM30 total {tt['sheet']}/{tt['ours']} rows · paired {tt['paired']} · fully matched "
               f"{tt['clean_rows']} · real diff {tt['diff_rows']} · known drift {tt['drift_rows']} · "
               f"only in sheet {tt['only_sheet']} · only in NHGOne {tt['only_ours']}")

    groups = _diff_groups(result)
    if groups:
        out += head("WHAT DIFFERS (sheet / NHGOne)")
    for g in groups:
        tag = {"real": "!!", "expected": "..", "drift": "  "}[g["tone"]]
        shown = "" if len(g["ex"]) >= g["n"] else f" (showing {len(g['ex'])})"
        out.append(f"{tag} {g['short']:<12} {g['reg']:<5} {g['what']}  "
                   f"× {g['n']}{shown}  — {g['why']}")
        for who, ours, sheet in g["ex"]:
            out.append(f"       {_clip(who, 46):<48} {_clip(sheet, 30) or '—'}  /  "
                       f"{_clip(ours, 30) or '—'}")
    if groups:
        out.append("   (!! needs review today · .. expected from a configured window · "
                   "blank = known drift, already explained)")

    unmapped_lines = []
    for p in result["properties"]:
        for kind in ("rr4", "tm30"):
            for e in (p.get("unmapped") or {}).get(kind, []):
                where = "RR4 " if kind == "rr4" else "TM30"
                who = f'{e["name"]}{" · room " + e["room"] if e["room"] else ""}'
                why = (f'{e["country"]} has no {where.strip()} code'
                       if e["kind"] == "no_code" else "no nationality on the MEWS profile")
                unmapped_lines.append(f'  {p["short"]:<12} {where}  {who[:46]:<46} {why}')
    if unmapped_lines:
        out += head("FILED WITH NO NATIONALITY CODE") + unmapped_lines
        out.append('   A missing code is fixed in Admin > RR4-Nationality / TM30-Nationality; '
                   'an empty MEWS profile has to be fixed in MEWS.')

    out += head("WHEN EACH SIDE PULLED ITS DATA")
    for p in result["properties"]:
        bad = (p["sheet_rr4_window"] != p["our_window"]
               or p["sheet_tm30_window"] != p["our_tm30_window"])
        flag = "   ⚠️ mismatch" if bad else ""
        out.append(f"  {p['short']:<12} RR4 sheet {p['sheet_rr4_window'] or '—':<7} ours "
                   f"{p['our_window'] or '—':<7} · TM30 sheet {p['sheet_tm30_window'] or '—':<7} ours "
                   f"{p['our_tm30_window'] or '—':<7} · built {p['synced_at'] or '—':<13}{flag}")
    out.append("   Each side sweeps a 24-hour day that STARTS at these times — both halves of a "
               "pair must match.")
    return "\n".join(out)


def _esc(s) -> str:
    """Guest names, passport numbers and addresses come from MEWS, i.e. from
    whatever a guest typed at check-in - they are never trusted as markup."""
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


_TD = "padding:6px 10px;border:1px solid #e2e8f0;font-size:13px;"
_TH = "padding:6px 10px;border:1px solid #e2e8f0;font-size:11px;font-weight:700;background:#f8fafc;text-align:left;"
_MUTED = "color:#94a3b8;"

# Three states, three colours, used consistently by all three tables so a
# colour means the same thing wherever it appears:
#   green  the sheet and NHGOne agree - nothing to do
#   red    a real difference - somebody has to look at it today
#   amber  a difference that has already been explained (_KNOWN_DRIFT, or a
#          shortfall the property's own configured window is supposed to
#          produce) - worth seeing, not worth chasing
# Amber was the only highlight before this; splitting it means the daily
# known-drift rows stop competing for attention with the rare real ones.
_OK = "color:#166534;font-weight:700;"
_BAD = "background:#fee2e2;color:#b91c1c;font-weight:700;"
_EXPECTED = "background:#fef3c7;color:#92400e;font-weight:700;"

# An em dash as a name rather than inline: an f-string expression cannot
# contain a backslash before Python 3.12, and this file has to import on the
# 3.10 that runs it locally as well as the 3.12 on Vercel.
_DASH = "—"
_TICK = "✓"
_CROSS = "✗"


_TABLE_OPEN = '<table style="border-collapse:collapse">'


def _scroll(parts: list, footnote: str) -> str:
    """Every table here is wider than a phone, so each one scrolls inside its
    own box rather than forcing the email body to - the same wrapper
    st_compare_service.render_grid_table uses, and the reason _TABLE_OPEN
    carries no width:100%: a table pinned to 100% of an overflow-x box can
    never overflow it, so the cells squash instead of the box scrolling.

    Outlook desktop (the Word rendering engine) ignores overflow-x entirely
    and widens the card instead. That is survivable and is why the tables stay
    as narrow as they do; it is not a reason to add columns.
    """
    return ('<div style="overflow-x:auto">' + "".join(parts) + "</div>"
            + f'<p style="font-size:11px;color:#94a3b8;margin:6px 0 0">{footnote}</p>')


def _clip(value: str, limit: int = 60) -> str:
    """MEWS free text can be long - an RR4 `address` is a whole postal address -
    and one long value in a cell widens the whole card in the clients that
    ignore overflow-x. Cut it here rather than trusting a CSS property Outlook
    doesn't implement."""
    s = str(value or "")
    return s if len(s) <= limit else s[:limit - 1].rstrip() + "…"


def _dmy_display(iso: str) -> str:
    """The sheets' own ISO date as DD/MM/YYYY, so the cells agree with the
    <<Date>> token in the line above them instead of printing 2026-09-02
    beside 02/09/2026."""
    try:
        return datetime.strptime(iso, "%Y-%m-%d").strftime("%d/%m/%Y")
    except (TypeError, ValueError):
        return iso or _DASH


def _summary_cell(block: dict, window: str = "") -> str:
    """One register's cell in table 1: a green "✓ N" when the sheet and NHGOne
    hold the SAME NUMBER OF GUESTS, a red "✗ sheet / ours" when they don't.

    The count is the whole test for the colour, by request. Anything else that
    differs - a column whose value disagrees, a guest one side holds and the
    other doesn't, known drift - is reported in grey inside the green cell and
    listed row by row in table 2, but does not turn it red. Two registers of
    the same size are the thing the filing is judged on; which of their rows
    still need a look is the next table's job.

    Sheet first, then ours, in that order everywhere in this mail - it is the
    sheet that is the ground truth being checked against, so it reads as
    "what should be there / what we produced".

    `window` is the property's configured TM30 start. A non-midnight one files
    a shorter day than the sheet holds ON PURPOSE (Chinatown's 12:15 drops
    every guest arriving before noon - 2 to 20 of them on each of the seven
    days measured to 29-Aug-2026), so that shortfall is annotated as the
    configured consequence it is. It still shows red, because it is a real
    difference in the number of guests filed and, unlike _KNOWN_DRIFT, cannot
    be verified row by row - TM30 carries no check-in column to test each
    missing guest against, so a genuine new miss would look identical.
    """
    # Deliberately "is our window non-midnight", NOT "does our window differ
    # from the sheet's". The sheets DECLARE a TM30 window in Master!B2 that
    # they do not actually filter by: on 02-Sep-2026 Chinatown's sheet said
    # 12:15, exactly what we are configured to, and still held 32 arrivals to
    # our 26 - and Patong's said 02:05 to our 02:05, 42 to our 39. Comparing
    # the two windows would therefore find them equal and call both shortfalls
    # unexplained every single morning. Our own non-midnight start is the real
    # cause (an earlier check found midnight reproduces Chinatown's sheet
    # exactly, 67 for 67, where 12:15 gives 56), so that is what is tested.
    shifted = bool(window) and window != "00:00"

    bits = []
    if block["diff_rows"]:
        bits.append(f"{block['diff_rows']} differ")
    if block["only_ours"]:
        bits.append(f"{block['only_ours']} only in NHGOne")
    if block["only_sheet"]:
        bits.append(f"{block['only_sheet']} only in the sheet"
                    + (f", as our {window} window intends" if shifted else ""))
    if block["drift_rows"]:
        bits.append(f"{block['drift_rows']} known drift")

    # THE HEADLINE IS THE GUEST COUNT, and only the guest count. A register
    # holding the same number of guests as the sheet reads green even when
    # some of those rows still disagree on a column - by request, and because
    # a count that matches is the thing the filing is judged on. Whatever
    # still differs is not hidden: it is spelled out in grey right here and
    # listed row by row in the next table.
    #
    # The two are genuinely independent. Patong on 06-Sep-2026 held exactly
    # 233 RR4 rows against the sheet's 233 while three of them differed on a
    # column and one guest existed on each side that the other did not - the
    # unpaired pair cancels in the total.
    if block["sheet"] == block["ours"]:
        note = ""
        if bits:
            note = (f'<span style="{_MUTED}font-weight:400"> '
                    f'({", ".join(bits)})</span>')
        return f'<td style="{_TD}{_OK}">{_TICK} {block["sheet"]}{note}</td>'
    # The counts stay on one line; the note after them is allowed to wrap, or
    # "6 only in the sheet, as our 12:15 window intends" pushes the table past
    # the card in every client that honours nowrap.
    return (f'<td style="{_TD}{_BAD}">'
            f'<span style="white-space:nowrap">{_CROSS} {block["sheet"]} / {block["ours"]}</span>'
            f'<span style="font-weight:400;font-size:11px"> ({", ".join(bits)})</span></td>')


def _sheet_url(prop: str) -> str:
    """That property's own RR4-TM30-<Name>-Gen workbook, as a person would
    open it - not the /export?format=xlsx one _fetch_sheets downloads."""
    entry = SHEETS.get(prop)
    return f"https://docs.google.com/spreadsheets/d/{entry[1]}/edit" if entry else ""


def review_properties(result: dict) -> list:
    """[(short, url)] for every property with something RED in this mail, in
    SHEETS order.

    "Red" is deliberately not the same as the headline count. The count
    excludes Chinatown (its 12:15 window makes a TM30 shortfall permanent and
    expected - see _SUMMARY_EXCLUDED), but if Chinatown has a REAL difference
    it still has to be named, and an amber window-shortfall on anyone else
    must not name them. So this reads the same two things a reader would
    scroll for: section 2's real-tone groups, and section 3's blank
    nationalities.
    """
    if result.get("status") != "ok":
        return []
    bad = {g["short"] for g in _diff_groups(result) if g["tone"] == "real"}
    for prop in result["properties"]:
        u = prop.get("unmapped") or {}
        if u.get("rr4") or u.get("tm30"):
            bad.add(prop["short"])
    return [(prop["short"], _sheet_url(prop["property"]))
            for prop in result["properties"] if prop["short"] in bad]


def render_review_properties(result: dict) -> str:
    """The <<ReviewProperties>> token - a linked list of the properties that
    need a look, or nothing at all when none do."""
    props = review_properties(result)
    if not props:
        return ""
    links = ", ".join(
        f'<a href="{url}" style="color:#b91c1c;font-weight:700;text-decoration:underline">{_esc(short)}</a>'
        if url else f'<b style="color:#b91c1c">{_esc(short)}</b>'
        for short, url in props)
    return (f'<p style="margin:0 0 4px 0;font-size:13px;color:#152A00">'
            f'Needs review: {links}</p>')


def render_summary_table(result: dict) -> str:
    """TABLE 1 - every property, both registers, Google Sheet / NHGOne with a
    green tick or a red cross. The <<SummaryTable>> token, and the one table
    that has to answer "is anything wrong this morning?" on its own."""
    if result["status"] != "ok":
        return f'<pre style="font-family:ui-monospace,monospace;font-size:12px">{render_text(result)}</pre>'

    h = [f'{_TABLE_OPEN}<tr>'
         f'<th style="{_TH}">Property</th><th style="{_TH}">Date</th>'
         f'<th style="{_TH}">RR4 &mdash; Google Sheet / NHGOne</th>'
         f'<th style="{_TH}">TM30 &mdash; Google Sheet / NHGOne</th></tr>']
    for p in result["properties"]:
        if p["property"] in _SUMMARY_EXCLUDED:
            continue
        # Linked, so a row that needs review can be opened against the very
        # sheet it was compared with.
        url = _sheet_url(p["property"])
        name = (f'<a href="{url}" style="color:#152A00;text-decoration:underline">{p["short"]}</a>'
                if url else p["short"])
        h.append(f'<tr><td style="{_TD}font-weight:600;white-space:nowrap">{name}</td>')
        if p["status"] != "ok":
            h.append(f'<td style="{_TD}" colspan="3">'
                     f'<span style="{_BAD}padding:2px 6px;border-radius:4px">'
                     f'{_esc(p["note"])}</span></td></tr>')
            continue
        h.append(f'<td style="{_TD}{_MUTED}white-space:nowrap">{_dmy_display(p["date"])}</td>')
        h.append(_summary_cell(p["rr4"]))
        h.append(_summary_cell(p["tm30"], p.get("our_tm30_window", "")))
        h.append("</tr>")

    tr, tt = result["totals"]["rr4"], result["totals"]["tm30"]
    h.append(f'<tr style="background:#f1f5f9"><td style="{_TD}font-weight:700">Total</td>'
             f'<td style="{_TD}{_MUTED}">{result.get("totals_compared", result["compared"])} properties'
             f'<span style="font-weight:400;font-size:11px"> (Chinatown not shown - its 12:15 window '
             f'files fewer TM30 arrivals than its sheet holds by design)</span></td>')
    h.append(_summary_cell(tr))
    h.append(_summary_cell(tt))
    h.append("</tr></table>")
    return _scroll(
        h,
        f'{_TICK} the sheet and NHGOne hold the <b>same number of guests</b> &nbsp;·&nbsp; '
        f'{_CROSS} that number differs, shown as <b>Google Sheet / NHGOne</b>. '
        f'Anything still differing inside rows that DO line up is noted in grey '
        f'and listed in full in the next table. '
        f'Rows are paired by passport/ID number, then every column of each paired row is compared '
        f'(except the row number, which both sides renumber on their own). '
        f'Rows with no name (a MEWS-booked slot not yet linked to a guest profile) are counted here '
        f'because the sheet keeps them too, but are dropped from the filed .xlsx.')


def _diff_groups(result: dict) -> list:
    """Every difference in the whole comparison as one group each, ordered so
    the ones somebody has to act on today come first.

    A group is one (property, register, thing that differs) with up to a few
    named guests under it. Three kinds go in, and they used to live in two
    separate tables plus a summary note:
      real      a column whose value differs, or a guest one side has and the
                other doesn't - nobody has explained these yet
      expected  a guest the sheet holds and we don't BECAUSE of the property's
                own configured TM30 window - the shortfall the setting is for
      drift     _KNOWN_DRIFT: already chased down, already explained
    """
    groups = []
    for p in result["properties"]:
        if p["status"] != "ok":
            continue
        window = p.get("our_tm30_window", "")
        shifted = bool(window) and window != "00:00"
        for kind, label in (("rr4", "RR4"), ("tm30", "TM30")):
            b = p[kind]
            for key, n in sorted(b["cols"].items(), key=lambda kv: -kv[1]):
                groups.append({
                    "short": p["short"], "reg": label, "what": key, "n": n,
                    "ex": b["col_examples"].get(key, []),
                    "why": "Needs review", "tone": "real",
                })
            if b["only_sheet"]:
                why = "In the sheet but not in our register — needs review"
                tone = "real"
                if kind == "tm30" and shifted:
                    why = (f"Expected — our TM30 day starts at {window}, so a guest arriving "
                           f"before that is filed on the previous day, not this one")
                    tone = "expected"
                groups.append({
                    "short": p["short"], "reg": label,
                    "what": "Guest only in the sheet", "n": b["only_sheet"],
                    "ex": [(who, "missing", "present") for who in b["only_sheet_rows"]],
                    "why": why, "tone": tone,
                })
            if b["only_ours"]:
                groups.append({
                    "short": p["short"], "reg": label,
                    "what": "Guest only in NHGOne", "n": b["only_ours"],
                    "ex": [(who, "present", "missing") for who in b["only_ours_rows"]],
                    "why": "In our register but not in the sheet — needs review",
                    "tone": "real",
                })
            for key, n in sorted(b["drift_cols"].items(), key=lambda kv: -kv[1]):
                groups.append({
                    "short": p["short"], "reg": label, "what": key, "n": n,
                    "ex": b["drift_col_examples"].get(key, []),
                    "why": _drift_why(key, b["drift_col_examples"].get(key, [])), "tone": "drift",
                })
    rank = {"real": 0, "expected": 1, "drift": 2}
    # Stable, so within a tone the properties keep SHEETS' own order.
    groups.sort(key=lambda g: rank[g["tone"]])
    return groups


def render_column_table(result: dict) -> str:
    """TABLE 2 - the detail behind every red and amber cell in table 1, the
    <<ColumnTable>> token.

    This is the old ColumnTable ("nationality differs on 2 rows") and
    SampleTable ("Nikolaos Pantotis: GRC vs GRL") merged into one, plus the
    guests that only one side holds, which were previously counted in table 1
    and then named nowhere - so a morning like 02-Sep-2026, whose ONLY
    differences were 6 Chinatown and 3 Patong TM30 guests missing on our side,
    showed red cells above a detail table that said everything matched.
    """
    if result["status"] != "ok":
        return ""

    groups = _diff_groups(result)
    # Empty, not a green "everything matched" line: render_tokens drops a
    # section whose body is empty, heading and all, so a clean morning's mail
    # is table 1 and the windows rather than three paragraphs saying nothing
    # happened. Table 1 already carries the ticks.
    if not groups:
        return ""

    tone_style = {"real": "color:#b91c1c;font-weight:700;",
                  "expected": "color:#92400e;font-weight:700;",
                  "drift": _MUTED}
    h = [f'{_TABLE_OPEN}<tr>'
         f'<th style="{_TH}">Property</th><th style="{_TH}">Register</th>'
         f'<th style="{_TH}">What differs</th><th style="{_TH}">Guest</th>'
         f'<th style="{_TH}">Google Sheet</th><th style="{_TH}">NHGOne</th>'
         f'<th style="{_TH}">Why</th></tr>']
    for g in groups:
        ex = g["ex"] or [(_DASH, "", "")]
        span = f' rowspan="{len(ex)}"' if len(ex) > 1 else ""
        style = tone_style[g["tone"]]
        shown = "" if len(ex) >= g["n"] else f' (showing {len(ex)})'
        for i, (who, ours, sheet) in enumerate(ex):
            h.append("<tr>")
            if i == 0:
                h.append(
                    f'<td style="{_TD}white-space:nowrap"{span}>{g["short"]}</td>'
                    f'<td style="{_TD}{_MUTED}"{span}>{g["reg"]}</td>'
                    f'<td style="{_TD}{style}"{span}>{_esc(g["what"])}'
                    f'<div style="font-weight:400;font-size:11px;color:#64748b">'
                    f'{g["n"]} row{"s" if g["n"] != 1 else ""}{shown}</div></td>')
            h.append(f'<td style="{_TD}">{_esc(_clip(who, 46))}</td>'
                     f'<td style="{_TD}{_MUTED}">{_esc(_clip(sheet)) or _DASH}</td>'
                     f'<td style="{_TD}font-weight:700">{_esc(_clip(ours)) or _DASH}</td>')
            if i == 0:
                h.append(f'<td style="{_TD}font-size:11px;{style}"{span}>{g["why"]}</td>')
            h.append("</tr>")
    h.append("</table>")
    return _scroll(
        h,
        f'<b style="color:#b91c1c">Red</b> needs review today. '
        f'<b style="color:#92400e">Amber</b> has already been explained — either known drift '
        f'(the sheet and MEWS moving on after the export) or the shortfall a property\'s own '
        f'configured window is meant to produce. '
        f'Up to {_EXAMPLES_PER_COLUMN} guests are named per column and '
        f'{_EXAMPLES_PER_MISSING_GROUP} per missing-guest group; '
        f'the row count beside each is always the full number.')


def render_sample_table(result: dict) -> str:
    """Retained deliberately, and empty. The example rows this used to render
    are part of ColumnTable now. An Admin template saved before that change
    still carries <<SampleTable>>, and an unknown token is left in the body
    verbatim - so this keeps that template rendering nothing there instead of
    the literal text "<<SampleTable>>" in somebody's mail."""
    return ""


def render_unmapped_table(result: dict) -> str:
    """TABLE 3 - the <<UnmappedTable>> token: every guest we filed with a
    BLANK nationality, and which of the two fixes each one needs.

    Nothing here is a disagreement with the sheet; it is a gap in the file we
    generated. Both sides read the same code tables, so an unmapped
    nationality is usually blank on the sheet too and table 1 stays green
    while a government form goes out with an empty cell.
    """
    rows, totals = [], {"no_code": 0, "no_country": 0}
    for p in result["properties"]:
        unmapped = p.get("unmapped") or {}
        for kind in ("rr4", "tm30"):
            for e in unmapped.get(kind, []):
                totals[e["kind"]] += 1
                where = "RR4" if kind == "rr4" else "TM30"
                room = f' &middot; room {_esc(e["room"])}' if e["room"] else ""
                if e["kind"] == "no_code":
                    what = (f'<span style="{_BAD}">{_esc(e["country"])}</span>'
                            f'<br><small style="color:#64748b">has no {where} code</small>')
                    fix = (f'Admin &gt; {"RR4" if kind == "rr4" else "TM30"}-Nationality &mdash; '
                           f'the row for "{_esc(e["country"])}" is already there, '
                           f'type its number in')
                else:
                    what = (f'<span style="{_EXPECTED}">no nationality at all</span>'
                            f'<br><small style="color:#64748b">MEWS profile is empty</small>')
                    fix = "Fill the nationality in on the guest's MEWS profile"
                rows.append(
                    f'<tr><td style="{_TD}white-space:nowrap">{p["short"]}</td>'
                    f'<td style="{_TD}white-space:nowrap">{where}</td>'
                    f'<td style="{_TD}">{_esc(e["name"])}'
                    f'<small style="color:#94a3b8">{room}'
                    f'{" &middot; " + _esc(e["document"]) if e["document"] else ""}</small></td>'
                    f'<td style="{_TD}">{what}</td>'
                    f'<td style="{_TD}{_MUTED}">{fix}</td></tr>')

    # Same as table 2: nothing to say means no section at all.
    if not rows:
        return ""

    h = [f'{_TABLE_OPEN}<tr>'
         f'<th style="{_TH}">Property</th><th style="{_TH}">File</th>'
         f'<th style="{_TH}">Guest</th><th style="{_TH}">What is missing</th>'
         f'<th style="{_TH}">How to fix it</th></tr>'] + rows + ["</table>"]
    parts = []
    if totals["no_code"]:
        parts.append(f'<b>{totals["no_code"]}</b> have a nationality in MEWS that our code '
                     f'table has no number for &mdash; add it in Admin and the next import '
                     f'fills it in')
    if totals["no_country"]:
        parts.append(f'<b>{totals["no_country"]}</b> have no nationality on the MEWS profile '
                     f'at all, which no code table can fix')
    return _scroll(
        h,
        'These rows went out with an EMPTY nationality cell. This is not a disagreement with '
        'the sheet &mdash; both sides look the code up in the same table, so a missing code is '
        'usually blank on the sheet too and table 1 still shows a tick. ' + '; '.join(parts) + '.')


def render_window_table(result: dict) -> str:
    """TABLE 4 - when each side pulled its data, the <<WindowTable>> token.

    Both sides sweep a 24-hour day that STARTS at the time in these columns,
    so a pair that disagrees means the two registers are counting different
    guests, whatever the row counts in table 1 happen to say. See _windows()
    for why that is worth a look every single morning; the last column is when
    our own import actually ran.
    """
    h = [f'{_TABLE_OPEN}<tr>'
         f'<th style="{_TH}">Property</th>'
         f'<th style="{_TH}">RR4 &mdash; Google Sheet</th><th style="{_TH}">RR4 &mdash; NHGOne</th>'
         f'<th style="{_TH}">TM30 &mdash; Google Sheet</th><th style="{_TH}">TM30 &mdash; NHGOne</th>'
         f'<th style="{_TH}">NHGOne built the file</th></tr>']
    for p in result["properties"]:
        ok = p["sheet_rr4_window"] == p["our_window"] and p["sheet_rr4_window"]
        tm_ok = p["sheet_tm30_window"] == p["our_tm30_window"] and p["sheet_tm30_window"]
        h.append(f'<tr><td style="{_TD}white-space:nowrap">{p["short"]}</td>'
                 f'<td style="{_TD}{_MUTED}">{p["sheet_rr4_window"] or _DASH}</td>'
                 f'<td style="{_TD}{_OK if ok else _BAD}">'
                 f'{_TICK if ok else _CROSS} {p["our_window"] or _DASH}</td>'
                 f'<td style="{_TD}{_MUTED}">{p["sheet_tm30_window"] or _DASH}</td>'
                 f'<td style="{_TD}{_OK if tm_ok else _BAD}">'
                 f'{_TICK if tm_ok else _CROSS} {p["our_tm30_window"] or _DASH}</td>'
                 f'<td style="{_TD}{_MUTED}white-space:nowrap">{p["synced_at"] or _DASH}</td></tr>')
    h.append("</table>")
    return _scroll(
        h,
        'Each side sweeps a 24-hour day that <b>starts</b> at the time shown, so both halves of a '
        'pair have to match or the two registers are counting different guests. '
        'The sheets change these windows without warning, and a stale value on our side silently '
        'undercounts the register. TM30 has its own setting per property, separate from RR4\'s — '
        'Chinatown\'s 12:15 is deliberate. The last column is when our own import ran.')


# Each section token carries its own <h3>, because a section that can vanish
# cannot leave its heading behind in the template, and because the numbers
# have to close up when one does. Matches the markup the headings had while
# they lived in the template; the first one on the page loses the top margin.
def _sectioned(bodies: list) -> dict:
    """[(token, title, body)] -> {token: heading + body}, numbered in order
    and skipping every empty body. A section that renders nothing gets an
    empty string, so its token substitutes away to nothing in the template."""
    out, n = {}, 0
    for token, title, body in bodies:
        if not body:
            out[token] = ""
            continue
        n += 1
        margin = "0 0 8px 0" if n == 1 else "28px 0 8px 0"
        out[token] = (f'<h3 style="margin:{margin}; font-size:15px; color:#152A00;">'
                      f'{n}. {title}</h3>\n        {body}')
    return out


def render_tokens(result: dict) -> dict:
    """Everything the email template can substitute."""
    t = result.get("totals") or {"rr4": {}, "tm30": {}}
    day = datetime.strptime(result["date"], "%Y-%m-%d") if result.get("date") else None
    return {
        "Date": day.strftime("%d/%m/%Y") if day else _DASH,
        "PropertyCount": str(result.get("compared", 0)),
        "Rr4Diff": str(t["rr4"].get("diff_rows", _DASH)),
        "Tm30Diff": str(t["tm30"].get("diff_rows", _DASH)),
        # Sheet first, then ours - the same order every table in this mail
        # reads in, so the header line and the tables can't contradict.
        "Rr4Rows": f"{t['rr4'].get('sheet', _DASH)} / {t['rr4'].get('ours', _DASH)}",
        "Tm30Rows": f"{t['tm30'].get('sheet', _DASH)} / {t['tm30'].get('ours', _DASH)}",
        # Summary and Windows are deliberately NOT droppable. Summary is the
        # whole point of the mail, and the window table is a watch: the sheets
        # change their export windows without warning and a stale value on our
        # side silently undercounts the register, which is exactly the failure
        # that shows nothing anywhere else.
        **_sectioned([
            ("SummaryTable", "Every Property", render_summary_table(result)),
            ("ColumnTable", "What Differs", render_column_table(result)),
            ("UnmappedTable", "Filed With No Nationality Code", render_unmapped_table(result)),
            ("WindowTable", "When Each Side Pulled Its Data", render_window_table(result)),
        ]),
        "ReviewProperties": render_review_properties(result),
        "SampleTable": render_sample_table(result),
    }


def subject_summary(result: dict) -> str:
    if result["status"] != "ok":
        return "not comparable yet"
    t = result["totals"]
    bad = t["rr4"]["diff_rows"] + t["tm30"]["diff_rows"] \
        + t["rr4"]["only_ours"] + t["rr4"]["only_sheet"] \
        + t["tm30"]["only_ours"] + t["tm30"]["only_sheet"]
    if bad == 0 and not review_properties(result):
        return "matches sheet completely"
    who = ", ".join(short for short, _url in review_properties(result))
    count = f"{bad} rows need review" if bad else "needs review"
    return f"{count} — {who}" if who else count
