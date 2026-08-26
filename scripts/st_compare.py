#!/usr/bin/env python
"""Daily ST Files check: our stored numbers vs each property's own
"<Name>-ST" Google Sheet, which is the ground truth for what gets filed.

    .venv/bin/python scripts/st_compare.py             # whatever date the sheets hold
    .venv/bin/python scripts/st_compare.py 2026-08-25  # a specific date
    .venv/bin/python scripts/st_compare.py --email     # also send the monitoring mail

A thin CLI over app.services.st_compare_service, which is the same code the
scheduled 03:00 job in main.py runs - so what this prints and what lands in
the mailbox can never disagree.
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

from app.services import st_compare_service as svc  # noqa: E402


async def main():
    args = [a for a in sys.argv[1:]]
    send = "--email" in args
    want = next((a for a in args if not a.startswith("-")), None)

    print("กำลังโหลดชีตทั้ง 8 ...", flush=True)
    result = await svc.build_comparison(want)
    print()
    print(svc.render_text(result))

    if send:
        if result["status"] != "ok":
            print("\n(ไม่ส่งเมล - ยังเทียบไม่ได้)")
            return
        from app.services.email_service import email_service
        email_service.send_email(
            svc.MONITOR_RECIPIENT,
            f"[NHGOne Monitor] {svc._title(result)} — ตรงกัน "
            f"{result['matched_cells']}/{result['total_cells']} ช่อง",
            svc.render_html(result),
            svc.render_text(result),
        )
        print(f"\nส่งเมลไปที่ {svc.MONITOR_RECIPIENT} แล้ว")


asyncio.run(main())
