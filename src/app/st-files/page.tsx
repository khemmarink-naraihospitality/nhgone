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

interface ReservationAuditRow {
  number: string;
  guest: string;
  room: string;
  category: string;
  rate: string;
  state: string;
  check_in: string;
  check_out: string;
  complimentary: boolean;
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
  reservations?: ReservationAuditRow[];
  _synced_at?: string;
}

interface StFilesListRow {
  date: string;
  spaces: number;
  occupied: number;
  house_use: number;
  out_of_order: number;
  availability: number;
  customers: number;
  arrivals: number;
  departures: number;
  complimentary: number;
  synced_at?: string;
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
  { key: "reservations", label: "Reservations" },
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
  const [listRows, setListRows] = useState<StFilesListRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ date: string; text: string; filename: string } | null>(null);
  // Collapsed by default, same as BCP's own header details section.
  const [headerOpen, setHeaderOpen] = useState(false);
  // Statistic Data (tabs + table) - expanded by default, unlike headerOpen,
  // since it's the page's main content rather than supporting detail.
  const [statsOpen, setStatsOpen] = useState(true);

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
      fetchList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProperty]);

  // Accepts an override date/source so the ST Files List's "Files" button can
  // jump straight to a given day without racing the date/dataSource state
  // setters it calls right before this (setState is async, so reading the
  // plain `date`/`dataSource` closure vars here would still see the old day).
  const fetchReport = async (opts?: { date?: string; source?: DataSource }) => {
    if (!selectedProperty) return;
    const targetDate = opts?.date ?? date;
    const source = opts?.source ?? dataSource;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ property_name: selectedProperty, date: targetDate });
      const endpoint = source === "database" ? "managed" : "report";
      const res = await fetch(`/api/st-files/${endpoint}?${params.toString()}`);
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.message || result.detail || "Failed to fetch ST Files report");
      if (source === "database" && !result.data) {
        setReport(null);
        throw new Error(`No imported report for ${selectedProperty} on ${targetDate} yet - switch MODE to MEWS, or use "Import To Data Mart" first.`);
      }
      setReport(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ST Files List's per-day summary rows - always reads from the Database
  // (st_files_sync), matching the requested "based on what's already in the
  // Database" scope; non-critical if it fails, so no error banner for it.
  const fetchList = async () => {
    if (!selectedProperty) return;
    setListLoading(true);
    try {
      const params = new URLSearchParams({ property_name: selectedProperty });
      const res = await fetch(`/api/st-files/list?${params.toString()}`);
      const result = await res.json();
      if (result.status === "success") setListRows(result.data || []);
    } catch {
      // swallow - the single-day report above is the primary view
    } finally {
      setListLoading(false);
    }
  };

  // Preview shows the exact pipe-delimited ST export file content in a
  // popup - what Download would save to disk - not the day's dashboard
  // view above (that's a separate, already-visible thing).
  // Filename (<<Property Code>>_ST_<<yyyymmdd>>.csv) is decided server-side,
  // where the real Property Code is known - read back from the response
  // instead of guessing it client-side.
  const filenameFromResponse = (res: Response, rowDate: string) => {
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/);
    return match ? match[1] : `ST_${selectedProperty}_${rowDate}.csv`;
  };

  const handlePreview = async (rowDate: string) => {
    try {
      const params = new URLSearchParams({ property_name: selectedProperty, date: rowDate });
      const res = await fetch(`/api/st-files/export?${params.toString()}`);
      const text = await res.text();
      if (!res.ok) {
        let detail = text;
        try { detail = JSON.parse(text).detail || text; } catch { /* not JSON */ }
        throw new Error(detail);
      }
      setPreviewFile({ date: rowDate, text, filename: filenameFromResponse(res, rowDate) });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDownload = async (rowDate: string) => {
    try {
      const params = new URLSearchParams({ property_name: selectedProperty, date: rowDate });
      const res = await fetch(`/api/st-files/export?${params.toString()}`);
      if (!res.ok) {
        const result = await res.json().catch(() => null);
        throw new Error(result?.detail || "Download failed");
      }
      const filename = filenameFromResponse(res, rowDate);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message);
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
      fetchList();
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

  // Reservation-level audit for the Complimentary number above - shows every
  // reservation colliding with the day plus its Rate/State, so a mismatch
  // between the aggregate count and what's expected can be traced back to a
  // specific reservation (e.g. a "Complimentary Room" rate that's since
  // checked out, so it no longer counts - State reflects MEWS's current
  // status, not a historical snapshot of that day).
  const reservationAuditTable = (rows: ReservationAuditRow[]) => (
    <table className="w-full text-left border-collapse min-w-max">
      <thead>
        <tr className="bg-[var(--text-primary)]/5">
          <th className={thCls}>Reservation No.</th>
          <th className={thCls}>Guest</th>
          <th className={thCls}>Room</th>
          <th className={thCls}>Category</th>
          <th className={thCls}>Rate</th>
          <th className={thCls}>State</th>
          <th className={thCls}>Complimentary</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--text-primary)]/5">
        {rows.length === 0 ? (
          <tr><td colSpan={7} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">None for this date.</td></tr>
        ) : rows.map((r, i) => (
          <tr key={r.number + i} className={`hover:bg-[var(--text-primary)]/[0.02] ${r.complimentary ? "bg-emerald-500/[0.05]" : ""}`}>
            <td className={`${tdCls} font-bold`}>{r.number}</td>
            <td className={tdCls}>{r.guest || "-"}</td>
            <td className={tdCls}>{r.room || "-"}</td>
            <td className={tdCls}>{r.category || "-"}</td>
            <td className={tdCls}>{r.rate || "-"}</td>
            <td className={tdCls}>{r.state}</td>
            <td className={tdCls}>{r.complimentary ? "Yes" : "-"}</td>
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
      case "reservations":
        return reservationAuditTable(report.reservations || []);
    }
  };

  const tabCount = (key: TabKey): number | null => {
    if (!report) return null;
    switch (key) {
      case "customers": return report.customers.length;
      case "arrivals": return report.arrivals.length;
      case "departures": return report.departures.length;
      case "reservations": return report.reservations?.length ?? null;
      case "out_of_order": return report.out_of_order.reduce((s, r) => s + r.count, 0);
      case "house_use": return report.house_use.reduce((s, r) => s + r.count, 0);
      case "occupied": return report.occupied.reduce((s, r) => s + r.count, 0);
      case "availability": return report.availability.reduce((s, r) => s + r.count, 0);
      default: return null;
    }
  };

  return (
    <div className="flex-1 p-4 sm:p-6 md:p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
      <div className="max-w-[100rem] mx-auto">
        <PageHeader
          title={
            <span className="inline-flex items-center gap-4">
              Statistic Files
              <a
                href="/docs/st-files-export-format.html"
                target="_blank"
                rel="noopener noreferrer"
                className="font-sans inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold tracked-caps border border-[var(--text-primary)]/30 text-[var(--text-primary)]/70 hover:text-[var(--text-primary)] hover:border-[var(--text-primary)] transition-colors align-middle"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Read Me
              </a>
            </span>
          }
        >
          <div className="flex flex-col items-end gap-1">
            <span className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">Mode</span>
            <div className="flex border border-[var(--text-primary)]/14 bg-[var(--paper)]">
              <button
                onClick={() => setDataSource("live")}
                className={`px-6 py-2 text-[10px] font-bold tracked-caps transition-all ${dataSource === "live" ? "bg-[#152A00] text-[#FFEFD2]" : "text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"}`}
              >
                MEWS
              </button>
              <button
                onClick={() => setDataSource("database")}
                className={`px-6 py-2 text-[10px] font-bold tracked-caps transition-all ${dataSource === "database" ? "bg-[#152A00] text-[#FFEFD2]" : "text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"}`}
              >
                NHG
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
            <button onClick={() => fetchReport()} disabled={loading} className="btn-brand btn-primary h-[46px]">
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
          <div>
            <CollapsibleSection open={headerOpen}>
              <div className="flex flex-wrap items-center gap-3 text-[11px] px-4 py-3 border bg-[var(--paper)] border-[var(--text-primary)]/14 text-[var(--text-primary)]/70 mb-4">
                <span className="font-bold">{report.parameters.property}</span>
                <span>{report.parameters.date}</span>
                <span>Space types: {report.parameters.space_types.join(", ")}</span>
                {report._synced_at && <span>Imported: {fmtDateTime(report._synced_at)}</span>}
              </div>
            </CollapsibleSection>

            <button
              onClick={() => setStatsOpen((o) => !o)}
              className="flex items-center gap-2 mb-3 text-[var(--text-primary)] hover:opacity-70 transition-opacity"
            >
              <svg className={`w-4 h-4 shrink-0 transition-transform ${statsOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              <h2 className="text-xl font-serif">Statistic Data</h2>
            </button>

            {statsOpen && (
              <>
                <div className="flex flex-wrap border-b border-[var(--text-primary)]/14 mb-6">
                  {TABS.map((t) => {
                    const count = tabCount(t.key);
                    return (
                      <button
                        key={t.key}
                        onClick={() => setActiveTab(t.key)}
                        className={`px-3 py-3 text-[11px] font-bold tracked-caps border-b-2 -mb-px whitespace-nowrap transition-all ${
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
          </div>
        )}

        {!report && !error && !loading && (
          <div className="p-16 text-center text-[var(--text-primary)]/30 font-display text-2xl italic border border-dashed border-[var(--text-primary)]/14 bg-[var(--paper)]/40">
            Pick a property and date, then Fetch Report.
          </div>
        )}

        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-serif text-[var(--text-primary)]">Statistic Files</h2>
            {listLoading && <span className="text-[10px] font-bold tracked-caps text-[var(--text-primary)]/40">Loading...</span>}
          </div>
          <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-max">
              <thead>
                <tr className="bg-[var(--text-primary)]/5">
                  <th className={thCls}>Date</th>
                  <th className={`${thCls} text-right`}>Spaces</th>
                  <th className={`${thCls} text-right`}>Occupied</th>
                  <th className={`${thCls} text-right`}>House uses</th>
                  <th className={`${thCls} text-right`}>Out of order</th>
                  <th className={`${thCls} text-right`}>Availability</th>
                  <th className={`${thCls} text-right`}>Customers</th>
                  <th className={`${thCls} text-right`}>Arrivals</th>
                  <th className={`${thCls} text-right`}>Departures</th>
                  <th className={`${thCls} text-right`}>Complimentary</th>
                  <th className={`${thCls} text-right`}>No. of Day</th>
                  <th className={thCls}>Files</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--text-primary)]/5">
                {listRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">
                      {selectedProperty ? "No imported days yet - use “Import To Data Mart” above." : "Select a property to see imported ST Files history."}
                    </td>
                  </tr>
                ) : listRows.map((r) => {
                  // Highlights whichever row's day is currently loaded into
                  // Statistic Data above, via the Select Property/Date/Fetch
                  // Report controls (Preview below opens a separate popup,
                  // not this section).
                  const isActive = !!report && dataSource === "database" && report.parameters.date === r.date;
                  return (
                  <tr key={r.date} className={isActive ? "bg-emerald-500/[0.07]" : "hover:bg-[var(--text-primary)]/[0.02]"}>
                    <td className={`${tdCls} font-bold`}>
                      {r.date}
                      {isActive && <span className="ml-2 text-[9px] font-bold tracked-caps text-emerald-700">Viewing</span>}
                    </td>
                    <td className={`${tdCls} text-right`}>{r.spaces}</td>
                    <td className={`${tdCls} text-right`}>{r.occupied}</td>
                    <td className={`${tdCls} text-right`}>{r.house_use}</td>
                    <td className={`${tdCls} text-right`}>{r.out_of_order}</td>
                    <td className={`${tdCls} text-right`}>{r.availability}</td>
                    <td className={`${tdCls} text-right`}>{r.customers}</td>
                    <td className={`${tdCls} text-right`}>{r.arrivals}</td>
                    <td className={`${tdCls} text-right`}>{r.departures}</td>
                    <td className={`${tdCls} text-right`}>{r.complimentary}</td>
                    <td className={`${tdCls} text-right`}>1</td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handlePreview(r.date)}
                          className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 transition-colors whitespace-nowrap"
                        >
                          Preview
                        </button>
                        <button
                          onClick={() => handleDownload(r.date)}
                          className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 transition-colors whitespace-nowrap"
                        >
                          Download
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="bg-[var(--paper)] border border-[var(--text-primary)]/14 w-full max-w-4xl max-h-[90vh] flex flex-col shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--text-primary)]/14">
              <div>
                <div className="text-[9px] font-bold tracked-caps text-[var(--text-primary)]/50">File Preview</div>
                <div className="text-sm font-bold text-[var(--text-primary)]">{selectedProperty} — {previewFile.date}</div>
                <div className="text-[11px] font-mono text-[var(--text-primary)]/50 mt-0.5">({previewFile.filename})</div>
              </div>
              <button
                onClick={() => setPreviewFile(null)}
                className="text-[var(--text-primary)]/40 hover:text-[var(--text-primary)] text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-5 text-[10.5px] font-mono leading-relaxed text-[var(--text-primary)] whitespace-pre">{previewFile.text}</pre>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--text-primary)]/14">
              <button
                onClick={() => setPreviewFile(null)}
                className="px-4 py-2 text-[10px] font-bold tracked-caps border border-[var(--text-primary)]/30 text-[var(--text-primary)]/70 hover:text-[var(--text-primary)] transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => handleDownload(previewFile.date)}
                className="px-4 py-2 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity"
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
