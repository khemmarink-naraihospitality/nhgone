#!/usr/bin/env python
"""Daily RV Files check: our stored revenue journal vs the RV Google Sheet,
which holds the PMSRV file MEWS generated for each property.

    .venv/bin/python scripts/rv_compare.py             # whatever date each tab holds
    .venv/bin/python scripts/rv_compare.py 2026-09-13  # only tabs holding this date
    .venv/bin/python scripts/rv_compare.py --email     # also send the monitoring mail

The RV twin of st_compare.py, over app.services.rv_compare_service. --email
goes through the same compare_mail.send the scheduled job and the Admin "Send
Test Now" button use, so what this prints and what lands in the mailbox can
never disagree.
"""
import asyncio
import os
import sys
from pathlib import Path

# Same reason as st_compare.py: app.config reads env_file=".env" relative to
# the CWD, and config is read at import time - so chdir before importing.
_API = Path(__file__).resolve().parent.parent / "api"
os.chdir(_API)
sys.path.insert(0, str(_API))

from app.services import compare_mail  # noqa: E402
from app.services import rv_compare_service as svc  # noqa: E402


async def main():
    args = sys.argv[1:]
    send = "--email" in args
    want = next((a for a in args if not a.startswith("-")), None)

    print("กำลังโหลดชีต RV ...", flush=True)
    result = await svc.build_comparison(want)
    print()
    print(svc.render_text(result))

    if send:
        # mark_sent=False: a run from the terminal must never suppress that
        # day's real scheduled send.
        outcome = await compare_mail.send("rv", mark_sent=False, want_date=want, sync_type="manual")
        if outcome["sent"]:
            print(f"\nส่งเมลไปที่ {', '.join(outcome['recipients'])} แล้ว")
        else:
            print(f"\n(ไม่ส่งเมล - {outcome['reason'][:200]})")


asyncio.run(main())
