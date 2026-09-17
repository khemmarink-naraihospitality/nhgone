#!/usr/bin/env python
"""Name the TM30 guests a sheet files that our register doesn't, with the
timestamps that decide which day they land on.

    .venv/Scripts/python.exe scripts/tm30_missing_named.py 2026-09-16 "Lub d Phuket Patong"

For every passport on the property's own TM30 sheet tab that is missing from
our cached import of the same date, looks the guest up in our register for
the day BEFORE and the day AFTER (a window boundary moves guests exactly one
day either way), then prints that reservation's scheduled StartUtc and real
ActualStartUtc in the property's local time.

Same principle as scripts/st_arrival_named.py: name the reservation, never
infer from a count moving by one.
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

_API = Path(__file__).resolve().parent.parent / "api"
os.chdir(_API)
sys.path.insert(0, str(_API))

from app.routers.rr4 import read_managed_day                  # noqa: E402
from app.services import rr4_compare_service as cmp            # noqa: E402
from app.services.mews_client import mews_client               # noqa: E402
from app.services.sync_service import sync_service             # noqa: E402

DATE = sys.argv[1]
PROP = sys.argv[2]


def norm(v):
    return str(v or "").strip().upper()


def local(ts, tz):
    if not ts:
        return "-"
    t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return t.astimezone(tz).strftime("%d-%b %H:%M")


async def main():
    tz = await sync_service._resolve_property_timezone(PROP)
    start_h, start_m = await sync_service._resolve_tm30_day_start(PROP)
    print(f"{PROP} {DATE} - our TM30 day starts {start_h:02d}:{start_m:02d} local ({tz})")

    sheets = await cmp._fetch_sheets()
    sh = sheets[PROP]["data"]
    print(f"sheet holds {sh['date']}, declares TM30 window {sh['tm30_window']}")

    ours = (read_managed_day(PROP, DATE) or {}).get("tm30", {}).get("rows", [])
    ours_pp = {norm(r.get("passport_no")) for r in ours}
    missing = [r for r in sh["tm30_rows"] if norm(r.get("passport_no") or r.get("passport")) not in ours_pp]
    print(f"sheet {len(sh['tm30_rows'])} / ours {len(ours)} - {len(missing)} only in the sheet\n")
    if not missing:
        return

    # Where DO we file them? Build the neighbouring days live.
    d = datetime.strptime(DATE, "%Y-%m-%d")
    where = {}
    for offset in (-1, 1):
        day = (d + timedelta(days=offset)).strftime("%Y-%m-%d")
        rep = await sync_service.get_tm30_report(PROP, day, apply_overrides=False)
        for r in rep.get("rows", []):
            where.setdefault(norm(r.get("passport_no")), (day, r.get("_key", "")))

    res_ids = sorted({k.split(":")[0] for _d, k in where.values() if k})
    times = {}
    for i in range(0, len(res_ids), 1000):
        out = await mews_client.post(
            "/api/connector/v1/reservations/getAll/2023-06-06",
            {"ReservationIds": res_ids[i:i + 1000], "Limitation": {"Count": 1000}},
            property_name=PROP)
        for r in out.get("Reservations", []):
            times[r["Id"]] = r

    print(f"{'guest':34s} {'passport':12s} {'we file on':11s} {'scheduled':13s} {'actual check-in':15s}")
    for r in missing:
        pp = norm(r.get("passport_no") or r.get("passport"))
        name = f"{r.get('first_name', '')} {r.get('last_name', '')}".strip()[:34]
        day, key = where.get(pp, ("NOT FOUND", ""))
        res = times.get(key.split(":")[0], {}) if key else {}
        print(f"{name:34s} {pp:12s} {day:11s} "
              f"{local(res.get('ScheduledStartUtc') or res.get('StartUtc'), tz):13s} "
              f"{local(res.get('ActualStartUtc'), tz):15s}")


asyncio.run(main())
