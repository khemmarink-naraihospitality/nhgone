"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getMenuPermissions } from "@/lib/menuPermissions";

/**
 * Admin Console > OSH has no content of its own - unlike Kiosks, which is a
 * real settings page with Check In Form as its sub-item, OSH is purely a
 * grouping label over Report and Setting (see Navigation.tsx's adminEntries
 * comment). Both children are gated by the same permission, osh_settings -
 * the entire back-office OSH area is one grant, separate from osh_checklist
 * (the front-end Form) - so landing here just goes to Report, the more
 * dashboard-like of the two, and back to Admin for the edge case of a role
 * with neither: Navigation.tsx's own admin route guard should already have
 * kept a role with neither from reaching this page at all, but this is the
 * same fail-safe every other redirect-only page here uses.
 */
export default function AdminOshIndex() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const perms = await getMenuPermissions();
      if (cancelled) return;
      if (perms.osh_settings) router.replace("/admin/osh/report");
      else router.replace("/admin");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
}
