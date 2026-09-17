#!/usr/bin/env python
"""Name the day-use reservations behind today's Arrivals mismatches, the same
way the 10-Sep-2026 investigation pinned the (since-reversed) actual-check-in
rule and the 17-Sep-2026 one pinned _ST_DAY_USE_ARRIVAL_START_HOUR: by
reservation, not by a category total moving by one.

    .venv/Scripts/python.exe scripts/st_arrival_named.py 2026-09-16 Chinatown Siam Samui "Siem Reap"

Reuses sync_service's own (already-verified) category resolution rather than
re-deriving it - only the disputed part, the day-use arrival predicate, is
left for the reader to judge from the printed timestamps.
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

_API = Path(__file__).resolve().parent.parent / "api"
os.chdir(_API)
sys.path.insert(0, str(_API))

from app.services.mews_client import mews_client   # noqa: E402
from app.services.sync_service import sync_service  # noqa: E402

DATE = sys.argv[1]
PROPERTIES = sys.argv[2:]


def parse_utc(ts):
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


async def investigate(property_name: str, date: str):
    tz = await sync_service._resolve_property_timezone(property_name)
    space_types = await sync_service._resolve_st_space_types(property_name)
    day = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=tz)
    day_start_utc = day.astimezone(timezone.utc)
    day_end_utc = (day + timedelta(days=1)).astimezone(timezone.utc)

    services_res = await mews_client.post(
        "/api/connector/v1/services/getAll", {"Limitation": {"Count": 100}},
        property_name=property_name)
    stay = sync_service._resolve_stay_service(services_res.get("Services", []))
    service_id = stay["Id"]

    cats_res = await mews_client.post(
        "/api/connector/v1/resourceCategories/getAll",
        {"ServiceIds": [service_id], "Limitation": {"Count": 200}},
        property_name=property_name)
    categories = {}
    for c in cats_res.get("ResourceCategories", []):
        if not c.get("IsActive", True):
            continue
        shorts = c.get("ShortNames") or {}
        categories[c["Id"]] = {
            "short_name": shorts.get("en-US") or shorts.get("en-GB") or next(iter(shorts.values()), ""),
            "type": c.get("Type", ""),
            "in_report": c.get("Type") in space_types,
        }

    all_res = await mews_client.post(
        "/api/connector/v1/resources/getAll",
        {"Extent": {"Resources": True, "ResourceCategoryAssignments": True}, "Limitation": {"Count": 1000}},
        property_name=property_name)
    resource_category = {
        a["ResourceId"]: a["CategoryId"]
        for a in all_res.get("ResourceCategoryAssignments", [])
        if a.get("ResourceId") and a.get("CategoryId")
    }
    parent_children = {}
    for r in all_res.get("Resources", []):
        parent = r.get("ParentResourceId")
        if parent and r.get("Id"):
            parent_children.setdefault(parent, []).append(r["Id"])

    def space_categories(res):
        resource_id = res.get("AssignedResourceId")
        cat_id = resource_category.get(resource_id)
        if categories.get(cat_id, {}).get("in_report"):
            return [cat_id]
        child_cats = [resource_category.get(c) for c in parent_children.get(resource_id, [])]
        child_cats = [c for c in child_cats if categories.get(c, {}).get("in_report")]
        if child_cats:
            return child_cats
        requested = res.get("RequestedCategoryId")
        if categories.get(requested, {}).get("in_report"):
            return [requested]
        return []

    # Extent, un-versioned - wide net, then filter to this day's window.
    extent_res = await mews_client.post(
        "/api/connector/v1/reservations/getAll",
        {"StartUtc": (day_start_utc - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
         "EndUtc": (day_end_utc + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
         "Extent": {"Reservations": True, "Customers": True, "Resources": True}},
        property_name=property_name)
    reservations = extent_res.get("Reservations", [])

    # ActualStartUtc only lives on the 2023-06-06 endpoint.
    ids = [r["Id"] for r in reservations if r.get("Id")]
    actual_start = {}
    for i in range(0, len(ids), 1000):
        batch = ids[i:i + 1000]
        ar = await mews_client.post(
            "/api/connector/v1/reservations/getAll/2023-06-06",
            {"ReservationIds": batch, "Limitation": {"Count": 1000}},
            property_name=property_name)
        for r in ar.get("Reservations", []):
            if r.get("Id"):
                actual_start[r["Id"]] = r.get("ActualStartUtc")

    def in_window(ts):
        t = parse_utc(ts)
        return t is not None and day_start_utc <= t < day_end_utc

    active = {"Confirmed", "Started", "Processed", "Optional"}
    print(f"\n=== {property_name} — {date} (tz {tz}) — day-use stays (arrive AND depart this day) ===")
    found = False
    for res in reservations:
        if res.get("State") not in active:
            continue
        if not (in_window(res.get("StartUtc")) and in_window(res.get("EndUtc"))):
            continue
        found = True
        cats = [categories.get(c, {}).get("short_name", "?") for c in space_categories(res)]
        start = parse_utc(res.get("StartUtc"))
        actual = parse_utc(actual_start.get(res.get("Id")))
        print(
            f"  #{res.get('Number', res.get('Id'))[:24]:24s} cat={','.join(cats) or '(none)':10s} "
            f"state={res.get('State'):10s} "
            f"sched={start.astimezone(tz).strftime('%H:%M') if start else '?':6s} "
            f"actual={actual.astimezone(tz).strftime('%H:%M') if actual else 'NEVER CHECKED IN':>6s}"
        )
    if not found:
        print("  (no day-use stays found in this window)")


async def main():
    for p in PROPERTIES:
        await investigate(p, DATE)


asyncio.run(main())
