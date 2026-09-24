"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getMenuPermissions } from "@/lib/menuPermissions";

/**
 * Admin Console > OSH has no content of its own - unlike Kiosks, which is a
 * real settings page with Check In Form as its sub-item, OSH is purely a
 * grouping label over Report and Setting (see Navigation.tsx's adminEntries
 * comment). Landing here sends the signed-in role straight to whichever
 * child it can actually open: Report first (osh_checklist, matching the
 * order Navigation.tsx lists them in), Setting if only osh_settings is
 * granted, and back to the Admin dashboard for the edge case of neither -
 * Navigation.tsx's own admin route guard should already have kept a role
 * with neither from reaching this page at all, but this is the same
 * fail-safe every other redirect-only page here uses.
 */
export default function AdminOshIndex() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const perms = await getMenuPermissions();
      if (cancelled) return;
      if (perms.osh_checklist) router.replace("/admin/osh/report");
      else if (perms.osh_settings) router.replace("/admin/osh/settings");
      else router.replace("/admin");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
}
