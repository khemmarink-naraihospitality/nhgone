#!/usr/bin/env python
"""Daily RR4/TM30 check: our stored register vs each Thai property's own
"RR4-TM30-<Name>-Gen" Google Sheet, which is the ground truth for what gets
filed with the authorities.

    .venv/bin/python scripts/rr4_compare.py             # each sheet's own date
    .venv/bin/python scripts/rr4_compare.py 2026-08-25  # pin every property to one date
    .venv/bin/python scripts/rr4_compare.py --email     # also send the monitoring mail

The RR4/TM30 twin of st_compare.py, over app.services.rr4_compare_service.
Without a date each property is compared at whatever day its own sheet holds -
Chinatown cuts its day at 12:15 and so runs a day behind the other five.
"""
import asyncio
import os
import sys
from pathlib import Path

# Same reason as st_compare.py: app.config reads env_file=".env" relative to
# the CWD, so the process has to be rooted at api/ before the import.
_API = Path(__file__).resolve().parent.parent / "api"
os.chdir(_API)
sys.path.insert(0, str(_API))

from app.services import compare_mail  # noqa: E402
from app.services import rr4_compare_service as svc  # noqa: E402


async def main():
    args = sys.argv[1:]
    send = "--email" in args
    want = next((a for a in args if not a.startswith("-")), None)

    print(f"กำลังโหลดชีตทั้ง {len(svc.SHEETS)} ...", flush=True)
    result = await svc.build_comparison(want)
    print()
    print(svc.render_text(result))

    if send:
        # mark_sent=False: a run from the terminal must never suppress that
        # day's real scheduled send.
        outcome = await compare_mail.send("rr4", mark_sent=False, want_date=want, sync_type="manual")
        if outcome["sent"]:
            print(f"\nส่งเมลไปที่ {', '.join(outcome['recipients'])} แล้ว")
        else:
            print(f"\n(ไม่ส่งเมล - {outcome['reason'][:200]})")


asyncio.run(main())
