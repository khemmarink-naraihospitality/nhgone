"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** The menu's own link lands on its first sub-menu, OSH Form - the
 * prototype's opening tab. */
export default function OshChecklistIndex() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/osh-checklist/form");
  }, [router]);
  return null;
}
