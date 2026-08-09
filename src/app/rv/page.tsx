"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getAllowedProperties } from "@/lib/allowedProperties";
import PageHeader from "@/components/PageHeader";

// Same collapsible-header pattern as ST Files / BCP - one toggle hides the
// description, the property/date controls and the loaded-report info bar
// together under a single "Details" line.
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

interface JournalRow {
  gl_code: string;
  department: string;
  name: string;
  amount: number;
  count: number;
  unmapped?: boolean;
  // Revenue rows only, and only for items sold on the stay service.
  market_segment?: string;
}

interface RvReport {
  property: string;
  date: string;
  revenue: JournalRow[];
  payments: JournalRow[];
  vat: number;
  vat_gl_code: string;
  // Only set for properties whose chart defines a secondary_tax (e.g.
  // Thailand's 1% provincial tax, reported under its own TaxRateCode).
  secondary_tax?: number | null;
  secondary_tax_gl_code?: string;
  secondary_tax_label?: string;
  guest_ledger: number;
  guest_ledger_gl_code: string;
  totals: {
    revenue_net: number;
    vat: number;
    revenue_gross: number;
    payments: number;
  };
  counts: {
    revenue_items: number;
    payment_items: number;
    canceled_items_skipped: number;
  };
  // Siem Reap posts in USD, not THB - absent on reports imported before this.
  currency?: string;
  gl_source: "mews_categories" | "billing_name_defaults";
  // Absent on reports imported before the GL chart was property-gated.
  gl_verified?: boolean;
  _synced_at?: string;
}

interface RvListRow {
  date: string;
  revenue_net: number;
  vat: number;
  revenue_gross: number;
  payments: number;
  guest_ledger: number;
  synced_at?: string;
}

type DataSource = "live" | "database";

const TABS = [
  { key: "revenue", label: "Revenue" },
  { key: "payments", label: "Payments" },
  { key: "summary", label: "Summary" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const fmtDateTime = (v: string) => {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
};

const fmtMoney = (v: number) =>
  (v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const thCls = "p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap";
const tdCls = "p-2 px-3 text-[13px] text-[var(--text-primary)] whitespace-nowrap";
const numCls = `${tdCls} text-right tabular-nums`;

export default function RvPage() {
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [report, setReport] = useState<RvReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<DataSource>("database");
  const [activeTab, setActiveTab] = useState<TabKey>("revenue");
  const [listRows, setListRows] = useState<RvListRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ date: string; text: string; filename: string } | null>(null);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(true);

  const getYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  };
  const [date, setDate] = useState(getYesterday());

  useEffect(() => {
    const fetchProperties = async () => {
      const { properties: names } = await getAllowedProperties();
      if (names.length > 0) {
        setProperties(names);
        setSelectedProperty(names[0]);
      }
    };
    fetchProperties();
  }, []);

  useEffect(() => {
    if (selectedProperty) {
      fetchReport();
      fetchList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProperty]);

  // Accepts an override date/source so the RV Files list can jump straight to
  // a day without racing the date/dataSource setters it calls right before.
  const fetchReport = async (opts?: { date?: string; source?: DataSource }) => {
    if (!selectedProperty) return;
    const targetDate = opts?.date ?? date;
    const source = opts?.source ?? dataSource;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ property_name: selectedProperty, date: targetDate });
      const endpoint = source === "database" ? "managed" : "report";
      const res = await fetch(`/api/rv/${endpoint}?${params.toString()}`);
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.message || result.detail || "Failed to fetch RV report");
      if (source === "database" && !result.data) {
        setReport(null);
        throw new Error(`No imported RV report for ${selectedProperty} on ${targetDate} yet - switch MODE to MEWS, or use "Import To Data Mart" first.`);
      }
      setReport(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchList = async () => {
    if (!selectedProperty) return;
    setListLoading(true);
    try {
      const params = new URLSearchParams({ property_name: selectedProperty });
      const res = await fetch(`/api/rv/list?${params.toString()}`);
      const result = await res.json();
      if (result.status === "success") setListRows(result.data || []);
    } catch {
      // swallow - the single-day report above is the primary view
    } finally {
      setListLoading(false);
    }
  };

  // Filename (<<Property Code>>_RV_<<yyyymmdd>>.csv) is decided server-side,
  // where the real Property Code is known - read it back off the response
  // rather than guessing client-side.
  const filenameFromResponse = (res: Response, rowDate: string) => {
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/);
    return match ? match[1] : `RV_${selectedProperty}_${rowDate}.csv`;
  };

  const handlePreview = async (rowDate: string) => {
    try {
      const params = new URLSearchParams({ property_name: selectedProperty, date: rowDate });
      const res = await fetch(`/api/rv/export?${params.toString()}`);
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
      const res = await fetch(`/api/rv/export?${params.toString()}`);
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
      const res = await fetch(`/api/rv/sync-manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_name: selectedProperty, start_date: date, end_date: date }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail || "Import failed");
      if (result.errors?.length) setError(result.errors.join(" | "));
      await fetchList();
      if (dataSource === "database") await fetchReport();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  // showSegment is on for revenue only: accommodation splits into one row per
  // market segment, so without the column those rows read as duplicates.
  const journalTable = (rows: JournalRow[], amountLabel: string, showSegment = false) => {
    const cols = showSegment ? 6 : 5;
    return (
      <table className="w-full text-left border-collapse min-w-max">
        <thead>
          <tr className="bg-[var(--text-primary)]/5">
            <th className={thCls}>GL Account</th>
            <th className={thCls}>Dept</th>
            {showSegment && <th className={thCls}>Segment</th>}
            <th className={thCls}>Description</th>
            <th className={`${thCls} text-right`}>Items</th>
            <th className={`${thCls} text-right`}>{amountLabel}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--text-primary)]/5">
          {rows.length === 0 ? (
            <tr><td colSpan={cols} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">None for this date.</td></tr>
          ) : rows.map((r, i) => (
            <tr key={r.gl_code + r.name + (r.market_segment || "") + i} className={`hover:bg-[var(--text-primary)]/[0.02] ${r.unmapped ? "bg-amber-500/[0.08]" : ""}`}>
              <td className={`${tdCls} font-bold font-mono`}>
                {r.gl_code || "—"}
                {r.unmapped && <span className="ml-2 text-[9px] font-bold tracked-caps text-amber-700">Unmapped</span>}
              </td>
              <td className={`${tdCls} font-mono text-[var(--text-primary)]/60`}>{r.department || "—"}</td>
              {showSegment && <td className={`${tdCls} font-mono text-[var(--text-primary)]/60`}>{r.market_segment || "—"}</td>}
              <td className={tdCls}>{r.name}</td>
              <td className={numCls}>{r.count}</td>
              <td className={`${numCls} font-bold`}>{fmtMoney(r.amount)}</td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="bg-[var(--text-primary)]/5">
              <td className={`${tdCls} font-bold`} colSpan={cols - 2}>Total</td>
              <td className={`${numCls} font-bold`}>{rows.reduce((s, r) => s + r.count, 0)}</td>
              <td className={`${numCls} font-bold`}>{fmtMoney(rows.reduce((s, r) => s + r.amount, 0))}</td>
            </tr>
          )}
        </tbody>
      </table>
    );
  };

  const summaryTable = (r: RvReport) => {
    // Mirrors how the journal itself balances: revenue + VAT on one side,
    // what was actually settled on the other, and the Guest Ledger row
    // carrying whatever is still owed on open bills.
    const lines: { label: string; value: number; gl?: string; strong?: boolean; rule?: boolean }[] = [
      { label: "Revenue (net)", value: r.totals.revenue_net },
      { label: "VAT", value: r.totals.vat, gl: r.vat_gl_code },
    ];
    // Only a few properties report a second, genuinely separate tax under its
    // own rate code (e.g. Thailand's 1% provincial tax) - shown only when the
    // report actually carries one, so most properties' summary is unchanged.
    if (r.secondary_tax) {
      lines.push({ label: r.secondary_tax_label || "Secondary Tax", value: r.secondary_tax, gl: r.secondary_tax_gl_code });
    }
    lines.push(
      { label: "Revenue (gross)", value: r.totals.revenue_gross, strong: true, rule: true },
      { label: "Payments settled", value: r.totals.payments },
      { label: "Guest Ledger (still owed)", value: r.guest_ledger, gl: r.guest_ledger_gl_code, strong: true, rule: true },
    );
    return (
      <table className="w-full text-left border-collapse min-w-max">
        <thead>
          <tr className="bg-[var(--text-primary)]/5">
            <th className={thCls}>Line</th>
            <th className={thCls}>GL Account</th>
            <th className={`${thCls} text-right`}>Amount ({r.currency || "THB"})</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--text-primary)]/5">
          {lines.map((l) => (
            <tr key={l.label} className={l.rule ? "bg-[var(--text-primary)]/5" : ""}>
              <td className={`${tdCls} ${l.strong ? "font-bold" : ""}`}>{l.label}</td>
              <td className={`${tdCls} font-mono text-[var(--text-primary)]/60`}>{l.gl || "—"}</td>
              <td className={`${numCls} ${l.strong ? "font-bold" : ""}`}>{fmtMoney(l.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const renderTab = () => {
    if (!report) return null;
    switch (activeTab) {
      case "revenue": return journalTable(report.revenue, `Amount (${currency})`, true);
      case "payments": return journalTable(report.payments, `Amount (${currency})`);
      case "summary": return summaryTable(report);
      default: return null;
    }
  };

  const tabCount = (key: TabKey): number | null => {
    if (!report) return null;
    switch (key) {
      case "revenue": return report.revenue.length;
      case "payments": return report.payments.length;
      default: return null;
    }
  };

  const currency = report?.currency || "THB";
  const hasUnmapped = !!report?.payments.some((p) => p.unmapped);
  // Only warn once a report is actually loaded, and treat an older stored
  // report (no gl_verified field) as verified rather than alarming on every
  // pre-existing import.
  const glUnverified = !!report && report.gl_verified === false;

  return (
    <div className="flex-1 p-4 sm:p-6 md:p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
      <div className="max-w-[100rem] mx-auto">
        <PageHeader title="Revenue Files">
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
          label={`Details — ${selectedProperty || "no property selected"}${report ? ` · ${report.date}` : ""}`}
        >
          <p className="text-[var(--text-primary)] text-sm opacity-70 leading-relaxed max-w-4xl">
            Daily revenue journal per property - every posted charge grouped by GL account, the VAT it carried, and how the day was settled (cash, card, online, prepayment, complimentary). Exports as the pipe-delimited Infor RV file.
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

        {glUnverified && (
          <div className="p-4 bg-[var(--paper)] border border-amber-300 text-amber-800 text-sm leading-relaxed mb-6">
            <span className="font-bold">GL codes not verified for this property.</span> The codes below
            come from Lub d Bangkok Chinatown&apos;s chart of accounts, and other properties do differ —
            Siem Reap books Guest Ledger to 11401 rather than 21203, online payments to 11208 rather
            than 11399, and laundry to 30450 rather than 30445. The figures are correct, but the
            account each one lands in may not be. Downloading the journal file is blocked until this
            property&apos;s GL mapping is confirmed.
          </div>
        )}

        {hasUnmapped && (
          <div className="p-4 bg-[var(--paper)] border border-amber-300 text-amber-800 text-sm leading-relaxed mb-6">
            This day contains a payment type with no GL account mapped (highlighted below). The file can&apos;t be exported until it&apos;s mapped.
          </div>
        )}

        {report && (
          <div>
            <CollapsibleSection open={headerOpen}>
              <div className="flex flex-wrap items-center gap-3 text-[11px] px-4 py-3 border bg-[var(--paper)] border-[var(--text-primary)]/14 text-[var(--text-primary)]/70 mb-4">
                <span className="font-bold">{report.property}</span>
                <span>{report.date}</span>
                <span>{report.counts.revenue_items} revenue items · {report.counts.payment_items} payments</span>
                {report.counts.canceled_items_skipped > 0 && (
                  <span>{report.counts.canceled_items_skipped} canceled items excluded</span>
                )}
                {report._synced_at && <span>Imported: {fmtDateTime(report._synced_at)}</span>}
              </div>
            </CollapsibleSection>

            <button
              onClick={() => setDataOpen((o) => !o)}
              className="flex items-center gap-2 mb-3 text-[var(--text-primary)] hover:opacity-70 transition-opacity"
            >
              <svg className={`w-4 h-4 shrink-0 transition-transform ${dataOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              <h2 className="text-xl font-serif">Revenue Data</h2>
            </button>

            {dataOpen && (
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
            <h2 className="text-xl font-serif text-[var(--text-primary)]">Revenue Files</h2>
            {listLoading && <span className="text-[10px] font-bold tracked-caps text-[var(--text-primary)]/40">Loading...</span>}
          </div>
          <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-max">
              <thead>
                <tr className="bg-[var(--text-primary)]/5">
                  <th className={thCls}>Date</th>
                  <th className={`${thCls} text-right`}>Revenue (net)</th>
                  <th className={`${thCls} text-right`}>VAT</th>
                  <th className={`${thCls} text-right`}>Revenue (gross)</th>
                  <th className={`${thCls} text-right`}>Payments</th>
                  <th className={`${thCls} text-right`}>Guest Ledger</th>
                  <th className={thCls}>Files</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--text-primary)]/5">
                {listRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">
                      {selectedProperty ? "No imported days yet - use “Import To Data Mart” above." : "Select a property to see imported RV history."}
                    </td>
                  </tr>
                ) : listRows.map((r) => {
                  const isActive = !!report && dataSource === "database" && report.date === r.date;
                  return (
                    <tr key={r.date} className={isActive ? "bg-emerald-500/[0.07]" : "hover:bg-[var(--text-primary)]/[0.02]"}>
                      <td className={`${tdCls} font-bold`}>
                        {r.date}
                        {isActive && <span className="ml-2 text-[9px] font-bold tracked-caps text-emerald-700">Viewing</span>}
                      </td>
                      <td className={numCls}>{fmtMoney(r.revenue_net)}</td>
                      <td className={numCls}>{fmtMoney(r.vat)}</td>
                      <td className={`${numCls} font-bold`}>{fmtMoney(r.revenue_gross)}</td>
                      <td className={numCls}>{fmtMoney(r.payments)}</td>
                      <td className={numCls}>{fmtMoney(r.guest_ledger)}</td>
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
