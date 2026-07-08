"use client";

import DashboardView from "@/components/DashboardView";

export default function DataMartPage() {
  return (
    <DashboardView
      title="Data Mart"
      subtitle="Synchronized PMS data; switch to MEWS for a live view and import it here"
      defaultDataSource="saved"
      defaultSection="reservations"
      allowToggleDataSource={true}
      showSectionTabs={true}
    />
  );
}
