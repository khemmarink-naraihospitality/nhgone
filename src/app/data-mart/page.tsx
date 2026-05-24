"use client";

import DashboardView from "@/components/DashboardView";

export default function DataMartPage() {
  return (
    <DashboardView 
      title="Data Mart"
      subtitle="Historical PMS data synchronized with NHGOne database"
      defaultDataSource="saved"
      defaultSection="reservations"
      allowToggleDataSource={false}
      showSectionTabs={true}
      defaultDays={7}
    />
  );
}
