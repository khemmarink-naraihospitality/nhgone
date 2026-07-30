"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import DashboardView from "@/components/DashboardView";

function DataMartContent() {
  // ?search= lets another page (BCP's Action Log Detail "View in Data
  // Mart" button) deep-link straight to one reservation instead of
  // landing on an unfiltered table.
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get("search") || undefined;

  return (
    <DashboardView
      title="Data Mart"
      subtitle="Synchronized PMS data; switch to MEWS for a live view and import it here"
      defaultDataSource="saved"
      defaultSection="reservations"
      allowToggleDataSource={true}
      showSectionTabs={true}
      initialSearch={initialSearch}
    />
  );
}

export default function DataMartPage() {
  return (
    <Suspense fallback={null}>
      <DataMartContent />
    </Suspense>
  );
}
