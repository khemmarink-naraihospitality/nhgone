#!/usr/bin/env python
"""Score candidate TM30 day windows against each property's own sheet, by
passport, instead of moving one property's start time and waiting a day.

    .venv/Scripts/python.exe scripts/tm30_window_sweep.py 2026-09-16

Why this exists: every fixed 24-hour window tried so far has been "confirmed"
on one morning and contradicted on the next (Patong went 02:05 -> 00:00 on
12-Sep and missed ten guests at 00:00 on 16-Sep). A window moves BOTH ends,
so one morning's boundary guests can only ever vote for one side of it.
Scoring several window SHAPES at once - not just several start times - is
what can tell a wrong start apart from a wrong width.

Each candidate is (clock, start, end) relative to local midnight of the
sheet's own date, applied (start, end] the same way get_tm30_report's
in_window is. Rows come from get_tm30_report itself for the day before,
of, and after - so nationality filtering, companion expansion and passport
formatting (and the Edit page's manual overrides) are the report's own, not
a re-implementation - with the
property's configured start forced to 00:00 so those three days tile the
whole range with no gap or overlap.

Chinatown is skipped: its 12:15 start is set by explicit instruction and
knowingly files fewer guests than its sheet (see _TM30_DAY_START_FALLBACK).
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

_API = Path(__file__).resolve().parent.parent / "api"
os.chdir(_API)
sys.path.insert(0, str(_API))

from app.services import rr4_compare_service as cmp            # noqa: E402
from app.services.mews_client import mews_client               # noqa: E402
from app.services.sync_service import sync_service             # noqa: E402

# Same memoisation as st_arrival_sweep.py: overlapping days rebuild the same
# MEWS requests, and there is no reason to send them to a live PMS twice.
_CACHE = {}
_real_post = mews_client.post


async def _cached_post(endpoint, payload=None, property_name=None, **kw):
    key = (endpoint, property_name, repr(sorted((payload or {}).items(), key=str)))
    if key not in _CACHE:
        _CACHE[key] = await _real_post(endpoint, payload, property_name=property_name, **kw)
    return _CACHE[key]


mews_client.post = _cached_post


async def _midnight(property_name):
    return (0, 0)


sync_service._resolve_tm30_day_start = _midnight

DATE = sys.argv[1] if len(sys.argv) > 1 else sys.exit("usage: tm30_window_sweep.py YYYY-MM-DD")
SKIP = {"Lub d Bangkok Chinatown"}


def norm(v):
    return str(v or "").strip().upper()


def parse(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None


def hm(text):
    h, m = (text or "00:00").split(":")
    return int(h) * 60 + int(m)


async def score_property(prop, sheet):
    tz = await sync_service._resolve_property_timezone(prop)
    declared = hm(sheet["tm30_window"])
    sheet_pp = {norm(r.get("passport_no")) for r in sheet["tm30_rows"]} - {""}

    d = datetime.strptime(DATE, "%Y-%m-%d")
    days = [(d + timedelta(days=o)).strftime("%Y-%m-%d") for o in (-1, 0, 1)]

    # passport -> EVERY reservation id it arrives on. Not just the first one
    # seen: a guest who moved rooms or extended on a second booking arrives
    # on two reservations, and keeping only the first (walked from the day
    # BEFORE) tied them to yesterday's booking and dropped them from every
    # window at once - 6 Patong and 9 Samui guests, identically under every
    # shape, which read like evidence and was only this.
    rows = {}
    start_utc = {}
    for day in days:
        # apply_overrides=True, deliberately: the real comparison reads our
        # side through read_managed_day, which lays the Edit page's manual
        # corrections back over the raw import. A guest whose passport was
        # typed in by hand only pairs with the sheet WITH that correction -
        # scoring without it lost 9 Samui guests under every window shape,
        # which looked like evidence and was only a missing override.
        rep = await sync_service.get_tm30_report(prop, day, apply_overrides=True)
        for r in rep.get("rows", []):
            pp = norm(r.get("passport_no"))
            rid = (r.get("_key") or "").split(":")[0]
            if pp and rid:
                rows.setdefault(pp, set()).add(rid)
        _d, _s, _e, reservations, _c, _r = await sync_service._rr4_tm30_fetch_day(prop, day)
        for res in reservations:
            start_utc.setdefault(res.get("Id"), res.get("StartUtc"))

    ids = sorted({i for rids in rows.values() for i in rids})
    actual, scheduled = {}, {}
    for i in range(0, len(ids), 1000):
        out = await mews_client.post(
            "/api/connector/v1/reservations/getAll/2023-06-06",
            {"ReservationIds": ids[i:i + 1000], "Limitation": {"Count": 1000}},
            property_name=prop)
        for r in out.get("Reservations", []):
            actual[r["Id"]] = r.get("ActualStartUtc")
            scheduled[r["Id"]] = r.get("ScheduledStartUtc")

    local_midnight = d.replace(tzinfo=tz)
    candidates = [
        ("midnight -> midnight", 0, 1440),
        (f"declared {sheet['tm30_window']} -> +24h", declared, declared + 1440),
        (f"midnight -> next-day {sheet['tm30_window']}", 0, 1440 + declared),
    ]
    results = []
    # Four clocks, and the first two are NOT the same thing:
    #   StartUtc   - the un-versioned endpoint's field, which is what
    #                get_tm30_report windows on today. MEWS MOVES it to the
    #                real check-in when a guest arrives early (a 14:00 booking
    #                checked in at 00:40 reads 00:40 here).
    #   scheduled  - ScheduledStartUtc from 2023-06-06, which keeps the
    #                original 14:00 no matter when the guest turned up.
    #   actual     - ActualStartUtc, falling back to StartUtc if not checked in.
    #   checked-in - ActualStartUtc only; no check-in, no arrival.
    clocks = (("StartUtc", start_utc, True), ("scheduled", scheduled, True),
              ("actual", actual, True), ("checked-in", actual, False))
    for clock_name, stamps, fallback in clocks:
        for name, lo, hi in candidates:
            w_lo = (local_midnight + timedelta(minutes=lo)).astimezone(timezone.utc)
            w_hi = (local_midnight + timedelta(minutes=hi)).astimezone(timezone.utc)
            ours = set()
            for pp, rids in rows.items():
                for rid in rids:
                    t = parse(stamps.get(rid) or (start_utc.get(rid) if fallback else None))
                    if t and w_lo < t <= w_hi:
                        ours.add(pp)
                        break
            results.append((f"{clock_name}, {name}",
                            len(sheet_pp & ours), len(sheet_pp - ours), len(ours - sheet_pp)))
    return len(sheet_pp), results


async def main():
    sheets = await cmp._fetch_sheets()
    totals = {}
    for prop, (short, _sid) in cmp.SHEETS.items():
        if prop in SKIP:
            continue
        sh = sheets[prop]["data"]
        if not sh or sh["date"] != DATE:
            print(f"{short}: sheet holds {sh and sh['date']}, skipped")
            continue
        n, results = await score_property(prop, sh)
        print(f"\n{short} - sheet {n} guests, declares {sh['tm30_window']}")
        print(f"  {'candidate':52s} paired  only-sheet  only-ours")
        for name, paired, only_s, only_o in results:
            mark = "  <- exact" if only_s == 0 and only_o == 0 else ""
            print(f"  {name:52s} {paired:6d}  {only_s:10d}  {only_o:9d}{mark}")
        # Aggregated by POSITION, not label: the labels carry each property's
        # own declared time, but position i is the same window shape on every
        # property.
        for idx, (name, paired, only_s, only_o) in enumerate(results):
            agg = totals.setdefault(idx, [name, 0, 0, 0])
            agg[1] += 1 if only_s == 0 and only_o == 0 else 0
            agg[2] += only_s
            agg[3] += only_o

    print("\nACROSS PROPERTIES")
    print(f"  {'candidate (shape per property)':52s} exact  only-sheet  only-ours")
    for _idx, (name, exact, only_s, only_o) in sorted(totals.items()):
        print(f"  {name:52s} {exact:5d}  {only_s:10d}  {only_o:9d}")


asyncio.run(main())
