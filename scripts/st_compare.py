#!/usr/bin/env python
"""Daily ST Files check: our stored numbers vs each property's own
"<Name>-ST" Google Sheet, which is the ground truth for what gets filed.

    .venv/bin/python scripts/st_compare.py             # whatever date the sheets hold
    .venv/bin/python scripts/st_compare.py 2026-08-25  # a specific date
    .venv/bin/python scripts/st_compare.py --email     # also send the monitoring mail

A thin CLI over app.services.st_compare_service, and --email goes through the
same compare_mail.send the 08:00 job and the Admin "Send Test Now" button use -
so what this prints and what lands in the mailbox can never disagree.
"""
import asyncio
import os
import sys
from pathlib import Path

# app.config declares env_file=".env" relative to the CWD, so the backend's
# credentials only load when the process is rooted at api/. Chdir before the
# import rather than after - config is read at import time.
_API = Path(__file__).resolve().parent.parent / "api"
os.chdir(_API)
sys.path.insert(0, str(_API))

from app.services import compare_mail  # noqa: E402
from app.services import st_compare_service as svc  # noqa: E402


async def main():
    args = sys.argv[1:]
    send = "--email" in args
    want = next((a for a in args if not a.startswith("-")), None)

    print("กำลังโหลดชีตทั้ง 8 ...", flush=True)
    result = await svc.build_comparison(want)
    print()
    print(svc.render_text(result))

    if send:
        # mark_sent=False: a run from the terminal must never suppress that
        # day's real scheduled send.
        outcome = await compare_mail.send("st", mark_sent=False, want_date=want, sync_type="manual")
        if outcome["sent"]:
            print(f"\nส่งเมลไปที่ {', '.join(outcome['recipients'])} แล้ว")
        else:
            print(f"\n(ไม่ส่งเมล - {outcome['reason'][:200]})")


asyncio.run(main())
