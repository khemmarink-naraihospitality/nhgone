"use client";

import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { getAllowedProperties } from "@/lib/allowedProperties";
import PageHeader from "@/components/PageHeader";

// Same collapsible-header pattern as BCP's own page (bcp/page.tsx) - one
// shared open/close toggle can wrap multiple separate blocks (the
// description, the property/date controls, the loaded-report info bar)
// so they all hide together under a single "Details" line instead of
// permanently taking up space above the tabs/table.
function CollapsibleSection({ label, open, onToggle, children }: { label?: string; open: boolean; onToggle?: () => void; children: ReactNode }) {
  return (
    <div className="no-print mb-3">
      {label && onToggle && (
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 text-[9px] font-bold tracked-caps text-[var(--text-primary)]/40 hover:text-[var(--text-primary)] transition-colors"
        >
          <svg className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {label}
        </button>
      )}
      {open && <div className={label ? "mt-2" : ""}>{children}</div>}
    </div>
  );
}

interface CategoryRow {
  short_name: string;
  name: string;
  type: string;
  count: number;
}

interface BlockRow {
  room: string;
  name: string;
  notes: string;
  start_utc: string;
  end_utc: string;
}

interface CustomerRow {
  name: string;
  nationality: string;
  email: string;
  phone: string;
}

interface ReservationRow {
  number: string;
  guest: string;
  nationality: string;
  room: string;
  category: string;
  check_in: string;
  check_out: string;
  state: string;
  adults: number;
  children: number;
}

interface StFilesReport {
  parameters: {
    property: string;
    service: string;
    date: string;
    space_types: string[];
    generated_utc: string;
  };
  spaces: CategoryRow[];
  occupied: CategoryRow[];
  house_use: CategoryRow[];
  house_use_blocks: BlockRow[];
  out_of_order: CategoryRow[];
  out_of_order_blocks: BlockRow[];
  availability: CategoryRow[];
  customers: CustomerRow[];
  arrivals: ReservationRow[];
  departures: ReservationRow[];
  _synced_at?: string;
}

type DataSource = "live" | "database";

const TABS = [
  { key: "spaces", label: "Spaces" },
  { key: "occupied", label: "Occupied" },
  { key: "house_use", label: "House Uses" },
  { key: "out_of_order", label: "Out of Order" },
  { key: "availability", label: "Availability" },
  { key: "customers", label: "Customers" },
  { key: "arrivals", label: "Arrivals" },
  { key: "departures", label: "Departures" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const fmtDateTime = (v: string) => {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
};

const thCls = "p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap";
const tdCls = "p-2 px-3 text-[13px] text-[var(--text-primary)] whitespace-nowrap";

export default function StFilesPage() {
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [report, setReport] = useState<StFilesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<DataSource>("database");
  const [activeTab, setActiveTab] = useState<TabKey>("spaces");
  // Collapsed by default, same as BCP's own header details section.
  const [headerOpen, setHeaderOpen] = useState(false);

  const getYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  };
  const [date, setDate] = useState(getYesterday());

  useEffect(() => {
    const fetchProperties = async () => {
      // Property-restricted roles (Admin > Users > Role, "Property" column)
      // only ever get their own property back here - not every property.
      const { properties: names } = await getAllowedProperties();
      if (names.length > 0) {
        setProperties(names);
        setSelectedProperty(names[0]);
      }
    };
    fetchProperties();
  }, []);

  // Auto-loads as soon as a property is selected (on open, and again if the
  // property is switched) instead of waiting for a manual Fetch Report
  // click - dataSource defaults to "database" above, so this is a fast
  // cached read, not a live MEWS call.
  useEffect(() => {
    if (selectedProperty) {
      fetchReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProperty]);

  const fetchReport = async () => {
    if (!selectedProperty) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ property_name: selectedProperty, date });
      const endpoint = dataSource === "database" ? "managed" : "report";
      const res = await fetch(`/api/st-files/${endpoint}?${params.toString()}`);
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.message || result.detail || "Failed to fetch ST Files report");
      if (dataSource === "database" && !result.data) {
        setReport(null);
        throw new Error(`No imported report for ${selectedProperty} on ${date} yet - switch MODE to Live API, or use "Import To Data Mart" first.`);
      }
      setReport(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!selectedProperty) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/st-files/sync-manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_name: selectedProperty, start_date: date, end_date: date }),
      });
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.message || result.detail || "Import failed");
      if (result.errors?.length) throw new Error(`Import finished with errors: ${result.errors.join("; ")}`);
      alert(`Imported ST Files report for ${selectedProperty} ${date} to Data Mart.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const categoryTable = (rows: CategoryRow[], countLabel: string) => (
    <table className="w-full text-left border-collapse min-w-max">
      <thead>
        <tr className="bg-[var(--text-primary)]/5">
          <th className={thCls}>Space Category</th>
          <th className={thCls}>Room Type</th>
          <th className={thCls}>Name</th>
          <th className={`${thCls} text-right`}>{countLabel}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--text-primary)]/5">
        {rows.map((r) => (
          <tr key={r.short_name + r.name} className="hover:bg-[var(--text-primary)]/[0.02]">
            <td className={`${tdCls} font-bold`}>{r.short_name || "-"}</td>
            <td className={tdCls}>{r.type}</td>
            <td className={tdCls}>{r.name}</td>
            <td className={`${tdCls} text-right font-bold`}>{r.count}</td>
          </tr>
        ))}
        <tr className="bg-[var(--text-primary)]/5">
          <td className={`${tdCls} font-bold`} colSpan={3}>Total</td>
          <td className={`${tdCls} text-right font-bold`}>{rows.reduce((s, r) => s + r.count, 0)}</td>
        </tr>
      </tbody>
    </table>
  );

  const blocksTable = (rows: BlockRow[], title: string) => (
    <div className="mt-6">
      <div className="text-[10px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-2 px-1">{title} ({rows.length})</div>
      {rows.length === 0 ? (
        <div className="p-4 text-[13px] text-[var(--text-primary)]/40 italic border border-dashed border-[var(--text-primary)]/14">None for this date.</div>
      ) : (
        <table className="w-full text-left border-collapse min-w-max">
          <thead>
            <tr className="bg-[var(--text-primary)]/5">
              <th className={thCls}>Room</th>
              <th className={thCls}>Name</th>
              <th className={thCls}>Notes</th>
              <th className={thCls}>From</th>
              <th className={thCls}>To</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--text-primary)]/5">
            {rows.map((b, i) => (
              <tr key={i}>
                <td className={`${tdCls} font-bold`}>{b.room || "-"}</td>
                <td className={tdCls}>{b.name}</td>
                <td className="p-2 px-3 text-[13px] text-[var(--text-primary)]">{b.notes || "-"}</td>
                <td className={tdCls}>{fmtDateTime(b.start_utc)}</td>
                <td className={tdCls}>{fmtDateTime(b.end_utc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const reservationTable = (rows: ReservationRow[]) => (
    <table className="w-full text-left border-collapse min-w-max">
      <thead>
        <tr className="bg-[var(--text-primary)]/5">
          <th className={thCls}>Reservation No.</th>
          <th className={thCls}>Guest</th>
          <th className={thCls}>Nationality</th>
          <th className={thCls}>Room</th>
          <th className={thCls}>Category</th>
          <th className={thCls}>Check-in</th>
          <th className={thCls}>Check-out</th>
          <th className={thCls}>State</th>
          <th className={`${thCls} text-right`}>Guests</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--text-primary)]/5">
        {rows.length === 0 ? (
          <tr><td colSpan={9} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">None for this date.</td></tr>
        ) : rows.map((r, i) => (
          <tr key={r.number + i} className="hover:bg-[var(--text-primary)]/[0.02]">
            <td className={`${tdCls} font-bold`}>{r.number}</td>
            <td className={tdCls}>{r.guest || "-"}</td>
            <td className={tdCls}>{r.nationality || "-"}</td>
            <td className={tdCls}>{r.room || "-"}</td>
            <td className={tdCls}>{r.category || "-"}</td>
            <td className={tdCls}>{fmtDateTime(r.check_in)}</td>
            <td className={tdCls}>{fmtDateTime(r.check_out)}</td>
            <td className={tdCls}>{r.state}</td>
            <td className={`${tdCls} text-right`}>{r.adults + r.children}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const customerTable = (rows: CustomerRow[]) => (
    <table className="w-full text-left border-collapse min-w-max">
      <thead>
        <tr className="bg-[var(--text-primary)]/5">
          <th className={thCls}>Name</th>
          <th className={thCls}>Nationality</th>
          <th className={thCls}>Email</th>
          <th className={thCls}>Phone</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--text-primary)]/5">
        {rows.length === 0 ? (
          <tr><td colSpan={4} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">None for this date.</td></tr>
        ) : rows.map((c, i) => (
          <tr key={c.name + i} className="hover:bg-[var(--text-primary)]/[0.02]">
            <td className={`${tdCls} font-bold`}>{c.name || "-"}</td>
            <td className={tdCls}>{c.nationality || "-"}</td>
            <td className={tdCls}>{c.email || "-"}</td>
            <td className={tdCls}>{c.phone || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderTab = () => {
    if (!report) return null;
    switch (activeTab) {
      case "spaces":
        return categoryTable(report.spaces, "Spaces");
      case "occupied":
        return categoryTable(report.occupied, "Occupied");
      case "house_use":
        return (
          <>
            {categoryTable(report.house_use, "House Use")}
            {blocksTable(report.house_use_blocks, "House Use Blocks")}
          </>
        );
      case "out_of_order":
        return (
          <>
            {categoryTable(report.out_of_order, "Out of Order")}
            {blocksTable(report.out_of_order_blocks, "Out of Order Blocks")}
          </>
        );
      case "availability":
        return categoryTable(report.availability, "Available");
      case "customers":
        return customerTable(report.customers);
      case "arrivals":
        return reservationTable(report.arrivals);
      case "departures":
        return reservationTable(report.departures);
    }
  };

  const tabCount = (key: TabKey): number | null => {
    if (!report) return null;
    switch (key) {
      case "customers": return report.customers.length;
      case "arrivals": return report.arrivals.length;
      case "departures": return report.departures.length;
      case "out_of_order": return report.out_of_order.reduce((s, r) => s + r.count, 0);
      case "house_use": return report.house_use.reduce((s, r) => s + r.count, 0);
      default: return null;
    }
  };

  return (
    <div className="flex-1 p-4 sm:p-6 md:p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
      <div className="max-w-7xl mx-auto">
        <PageHeader title="ST Files">
          <div className="flex flex-col items-end gap-1">
            <span className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">Mode</span>
            <div className="flex border border-[var(--text-primary)]/14 bg-[var(--paper)]">
              <button
                onClick={() => setDataSource("live")}
                className={`px-6 py-2 text-[10px] font-bold tracked-caps transition-all ${dataSource === "live" ? "bg-[#152A00] text-[#FFEFD2]" : "text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"}`}
              >
                Live API
              </button>
              <button
                onClick={() => setDataSource("database")}
                className={`px-6 py-2 text-[10px] font-bold tracked-caps transition-all ${dataSource === "database" ? "bg-[#152A00] text-[#FFEFD2]" : "text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"}`}
              >
                Database
              </button>
            </div>
          </div>
        </PageHeader>

        <CollapsibleSection
          open={headerOpen}
          onToggle={() => setHeaderOpen((o) => !o)}
          label={`Details — ${selectedProperty || "no property selected"}${report ? ` · ${report.parameters.date}` : ""}`}
        >
          <p className="text-[var(--text-primary)] text-sm opacity-70 leading-relaxed max-w-4xl">
            Daily occupancy report per property - spaces, occupied, house use, out of order, availability, plus that day&apos;s customers, arrivals and departures, straight from MEWS.
          </p>
        </CollapsibleSection>

        <CollapsibleSection open={headerOpen}>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4 mt-4">
            <div className="flex flex-col gap-2 w-full md:w-80">
              <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">Select Property</label>
              <div className="relative">
                <select
                  value={selectedProperty}
                  onChange={(e) => setSelectedProperty(e.target.value)}
                  className="w-full bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 pr-10 py-2 text-[13px] appearance-none cursor-pointer text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
                >
                  {properties.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-primary)]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </div>
            </div>
            <div className="flex flex-col gap-2 w-full md:w-48">
              <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 py-1.5 text-[13px] text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
              />
            </div>
            <button onClick={fetchReport} disabled={loading} className="btn-brand btn-primary h-[46px]">
              {loading ? "Loading..." : "Fetch Report"}
            </button>
            <button
              onClick={handleImport}
              disabled={importing || !selectedProperty}
              className="px-6 py-2 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 transition-colors whitespace-nowrap h-[46px] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {importing ? "Importing..." : "Import To Data Mart"}
            </button>
          </div>
        </CollapsibleSection>

        {error && (
          <div className="p-4 bg-[var(--paper)] border border-red-200 text-red-700 text-sm leading-relaxed mb-6">{error}</div>
        )}

        {report && (
          <>
            <CollapsibleSection open={headerOpen}>
              <div className="flex flex-wrap items-center gap-3 text-[11px] px-4 py-3 border bg-[var(--paper)] border-[var(--text-primary)]/14 text-[var(--text-primary)]/70 mb-4">
                <span className="font-bold">{report.parameters.property}</span>
                <span>{report.parameters.date}</span>
                <span>Space types: {report.parameters.space_types.join(", ")}</span>
                {report._synced_at && <span>Imported: {fmtDateTime(report._synced_at)}</span>}
              </div>
            </CollapsibleSection>

            <div className="flex flex-wrap border-b border-[var(--text-primary)]/14 mb-6">
              {TABS.map((t) => {
                const count = tabCount(t.key);
                return (
                  <button
                    key={t.key}
                    onClick={() => setActiveTab(t.key)}
                    className={`px-5 py-3 text-[11px] font-bold tracked-caps border-b-2 -mb-px transition-all ${
                      activeTab === t.key
                        ? "border-[var(--text-primary)] text-[var(--text-primary)]"
                        : "border-transparent text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {t.label}{count !== null ? ` (${count})` : ""}
                  </button>
                );
              })}
            </div>

            <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 mb-8 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-x-auto p-0">
              {renderTab()}
            </div>
          </>
        )}

        {!report && !error && !loading && (
          <div className="p-16 text-center text-[var(--text-primary)]/30 font-display text-2xl italic border border-dashed border-[var(--text-primary)]/14 bg-[var(--paper)]/40">
            Pick a property and date, then Fetch Report.
          </div>
        )}
      </div>
    </div>
  );
}
