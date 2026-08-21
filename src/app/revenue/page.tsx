"use client";

import { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import PageHeader from "@/components/PageHeader";
import { getAllowedProperties } from "@/lib/allowedProperties";

interface CategoryRow {
  short_name: string;
  name: string;
  type: string;
  occupied: number[];
  active: number[];
  percent: (number | null)[];
}

interface OccupancyReport {
  property: string;
  service: string;
  space_types: string[];
  start_date: string;
  end_date: string;
  dates: string[];
  categories: CategoryRow[];
  total: { occupied: number[]; active: number[]; percent: (number | null)[] };
  _synced_at?: string;
}

interface SnapshotRow {
  date: string;
  synced_at: string | null;
  nights: number;
  categories: number;
  first_night_percent: number | null;
}

type DataSource = "live" | "database";

// One tab today; Revenue is the section, and the next revenue report drops in
// beside this one without the page needing restructuring.
const TABS = [{ key: "occupancy", label: "Occupancy by Room Type" }] as const;
type TabKey = (typeof TABS)[number]["key"];

const thCls =
  "p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap";
const tdCls = "p-2 px-3 text-[13px] text-[var(--text-primary)] whitespace-nowrap";

const iso = (d: Date) => d.toISOString().split("T")[0];
// Default sweep: the 1st of this month through the 1st of the month 3
// months out - a sensible default outlook, not a backend limit. MEWS
// mode can go up to about a year in one Fetch Report; get_occupancy_report
// stitches that together from several MEWS calls under the hood (MEWS
// itself caps a single call's own interval at 99 days).
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

const fmtDateTime = (v?: string | null) => {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
};

// "21/08" over "Fri" - the grid can run a year wide, so a column head has
// to stay narrow while still letting someone spot a weekend at a glance.
const dayLabel = (s: string) => {
  const d = new Date(s + "T00:00:00");
  if (isNaN(d.getTime())) return { top: s, sub: "", weekend: false };
  const dow = d.getDay();
  return {
    top: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
    sub: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow],
    weekend: dow === 0 || dow === 6,
  };
};

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "-" : `${v.toFixed(2)}%`);

// A wash of the brand green whose strength tracks occupancy, so a full house
// and an empty one are distinguishable without reading every number. Kept
// deliberately faint - the figure itself stays the thing you read.
const heat = (v: number | null) => {
  if (v === null || v === undefined) return undefined;
  const a = Math.max(0, Math.min(100, v)) / 100;
  return { backgroundColor: `color-mix(in srgb, var(--text-primary) ${(a * 14).toFixed(1)}%, transparent)` };
};

export default function RevenuePage() {
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [dataSource, setDataSource] = useState<DataSource>("database");
  const [activeTab, setActiveTab] = useState<TabKey>("occupancy");

  const [startDate, setStartDate] = useState(iso(startOfMonth(new Date())));
  const [endDate, setEndDate] = useState(iso(addMonths(startOfMonth(new Date()), 3)));
  const [snapshotDate, setSnapshotDate] = useState(iso(new Date()));

  const [report, setReport] = useState<OccupancyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);

  useEffect(() => {
    getAllowedProperties().then(({ properties: list }) => {
      setProperties(list);
      setSelectedProperty((cur) => cur || list[0] || "");
    });
  }, []);

  const loadSnapshots = useCallback(async () => {
    if (!selectedProperty) return;
    try {
      const res = await fetch(`/api/occupancy/list?property_name=${encodeURIComponent(selectedProperty)}`);
      const json = await res.json();
      setSnapshots(json.status === "success" ? json.data : []);
    } catch {
      setSnapshots([]);
    }
  }, [selectedProperty]);

  useEffect(() => {
    setReport(null);
    setError(null);
    loadSnapshots();
  }, [selectedProperty, loadSnapshots]);

  // Auto-loads as soon as a property is selected - on open (once the first
  // allowed property lands above), and again if the property is switched -
  // instead of leaving the page on its empty "Pick a property..." state
  // until Fetch Report is clicked by hand. dataSource defaults to
  // "database" (NHG mode), so this first load is a cheap cached read, not a
  // live MEWS call. Keyed on selectedProperty alone, same as Statistic
  // Files' own page - changing the date range or MODE toggle still needs an
  // explicit Fetch Report, so those never fire a request the user didn't
  // ask for.
  useEffect(() => {
    if (selectedProperty) fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProperty]);

  const fetchReport = useCallback(async (overrideSnapshot?: string) => {
    if (!selectedProperty) return;
    setLoading(true);
    setError(null);
    try {
      const url =
        dataSource === "database"
          ? `/api/occupancy/managed?property_name=${encodeURIComponent(selectedProperty)}&date=${overrideSnapshot ?? snapshotDate}`
          : `/api/occupancy/report?${new URLSearchParams({ property_name: selectedProperty, start_date: startDate, end_date: endDate })}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || json.status !== "success") {
        throw new Error(json.detail || json.message || "Could not load the occupancy report");
      }
      setReport(json.data);
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : "Could not load the occupancy report");
    } finally {
      setLoading(false);
    }
  }, [selectedProperty, dataSource, snapshotDate, startDate, endDate]);

  const handleImport = async () => {
    if (!selectedProperty) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch("/api/occupancy/sync-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_name: selectedProperty, start_date: snapshotDate, end_date: snapshotDate }),
      });
      const json = await res.json();
      if (!res.ok || json.status !== "success") throw new Error(json.detail || "Import failed");
      if (json.errors?.length) throw new Error(json.errors[0]);
      await loadSnapshots();
      if (dataSource === "database") await fetchReport();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleExport = () => {
    if (!report) return;
    const rows = report.categories.map((c) => {
      const row: Record<string, string | number> = {
        "Space category": c.short_name || c.name,
        Name: c.name,
        Type: c.type,
      };
      report.dates.forEach((d, i) => {
        row[d] = c.percent[i] === null ? "" : c.percent[i]! / 100;
      });
      return row;
    });
    const totalRow: Record<string, string | number> = { "Space category": "Total", Name: "", Type: "" };
    report.dates.forEach((d, i) => {
      totalRow[d] = report.total.percent[i] === null ? "" : report.total.percent[i]! / 100;
    });
    rows.push(totalRow);

    const ws = XLSX.utils.json_to_sheet(rows);
    // Percent-format every date column so the file opens looking like the
    // MEWS report it mirrors rather than a sheet of raw fractions.
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let R = 1; R <= range.e.r; R++) {
      for (let C = 3; C <= range.e.c; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (cell && typeof cell.v === "number") cell.z = "0.00%";
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Occupancy");
    XLSX.writeFile(wb, `Occupancy_${selectedProperty.replace(/\s+/g, "")}_${report.start_date}_${report.end_date}.xlsx`);
  };

  const nDays = report?.dates.length ?? 0;

  return (
    <div className="flex-1 p-4 sm:p-6 md:p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
      <div className="max-w-[100rem] mx-auto">
        <PageHeader
          title="Revenue"
          description="Occupancy and pace reporting per property, straight from MEWS or from the nightly snapshot kept in the Data Mart."
        >
          <div className="flex flex-col items-end gap-1">
            <span className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">Mode</span>
            <div className="flex border border-[var(--text-primary)]/14 bg-[var(--paper)]">
              <button
                onClick={() => { setDataSource("live"); setReport(null); setError(null); }}
                className={`px-6 py-2 text-[10px] font-bold tracked-caps transition-all ${dataSource === "live" ? "bg-[#152A00] text-[#FFEFD2]" : "text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"}`}
              >
                MEWS
              </button>
              <button
                onClick={() => { setDataSource("database"); setReport(null); setError(null); }}
                className={`px-6 py-2 text-[10px] font-bold tracked-caps transition-all ${dataSource === "database" ? "bg-[#152A00] text-[#FFEFD2]" : "text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"}`}
              >
                NHG
              </button>
            </div>
          </div>
        </PageHeader>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-4 mt-6">
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

          {dataSource === "live" ? (
            <>
              <div className="flex flex-col gap-2 w-full md:w-44">
                <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">From</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 py-1.5 text-[13px] text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none" />
              </div>
              <div className="flex flex-col gap-2 w-full md:w-44">
                <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">To</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 py-1.5 text-[13px] text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none" />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2 w-full md:w-52">
              <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">Snapshot Date</label>
              <input type="date" value={snapshotDate} onChange={(e) => setSnapshotDate(e.target.value)}
                className="w-full bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 py-1.5 text-[13px] text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none" />
            </div>
          )}

          <button onClick={() => fetchReport()} disabled={loading || !selectedProperty} className="btn-brand btn-primary h-[46px]">
            {loading ? "Loading..." : "Fetch Report"}
          </button>
          <button
            onClick={handleImport}
            disabled={importing || !selectedProperty}
            className="px-6 py-2 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 transition-colors whitespace-nowrap h-[46px] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {importing ? "Importing..." : "Import To Data Mart"}
          </button>
          <button
            onClick={handleExport}
            disabled={!report}
            className="px-6 py-2 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)]/30 text-[var(--text-primary)]/70 hover:text-[var(--text-primary)] hover:border-[var(--text-primary)] transition-colors whitespace-nowrap h-[46px] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Export .xlsx
          </button>
        </div>

        <p className="mt-3 text-[11px] text-[var(--text-primary)]/45 leading-relaxed max-w-4xl">
          {dataSource === "live"
            ? "MEWS mode asks MEWS for any range you like, right now."
            : "NHG mode reads the snapshot captured at 08:00 Bangkok that morning, which freezes the outlook for the year ahead - so this morning's booking pace can be compared against an earlier one."}
        </p>

        {error && (
          <div className="p-4 bg-[var(--paper)] border border-red-200 text-red-700 text-sm leading-relaxed mt-6">{error}</div>
        )}

        <div className="flex flex-wrap border-b border-[var(--text-primary)]/14 mt-8 mb-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-5 py-3 text-[11px] font-bold tracked-caps border-b-2 -mb-px transition-all ${activeTab === t.key ? "border-[var(--text-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "occupancy" && (
          <>
            {report ? (
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
                  <h2 className="text-xl font-serif">
                    {report.start_date} — {report.end_date}
                  </h2>
                  <span className="text-[10px] font-bold tracked-caps text-[var(--text-primary)]/40">
                    {report.service} · {report.categories.length} categories · {nDays} night{nDays === 1 ? "" : "s"} · counting {report.space_types?.join(" + ")}
                    {report._synced_at ? ` · captured ${fmtDateTime(report._synced_at)}` : ""}
                  </span>
                </div>

                <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 overflow-x-auto overscroll-contain">
                  <table className="w-full text-left border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-[var(--text-primary)]/5">
                        <th className={`${thCls} sticky left-0 z-10 bg-[#F2EEE4]`}>Space category</th>
                        {report.dates.map((d) => {
                          const { top, sub, weekend } = dayLabel(d);
                          return (
                            <th key={d} className={`${thCls} text-right ${weekend ? "text-[var(--text-primary)]/80" : ""}`}>
                              <div>{top}</div>
                              <div className="font-normal opacity-60">{sub}</div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {report.categories.map((c) => (
                        <tr key={(c.short_name || "") + c.name} className="hover:bg-[var(--text-primary)]/[0.02]">
                          <td className={`${tdCls} sticky left-0 z-10 bg-[var(--paper)] border-b border-[var(--text-primary)]/5`}>
                            <span className="font-bold">{c.short_name || c.name}</span>
                            <span className="ml-2 text-[11px] text-[var(--text-primary)]/45">{c.name}</span>
                          </td>
                          {c.percent.map((p, i) => (
                            <td
                              key={report.dates[i]}
                              style={heat(p)}
                              title={`${c.occupied[i]} of ${c.active[i]} occupied`}
                              className={`${tdCls} text-right tabular-nums border-b border-[var(--text-primary)]/5`}
                            >
                              {pct(p)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr className="bg-[var(--text-primary)]/5 font-bold">
                        <td className={`${tdCls} sticky left-0 z-10 bg-[#F2EEE4] font-bold`}>Total</td>
                        {report.total.percent.map((p, i) => (
                          <td
                            key={report.dates[i]}
                            title={`${report.total.occupied[i]} of ${report.total.active[i]} occupied`}
                            className={`${tdCls} text-right tabular-nums font-bold`}
                          >
                            {pct(p)}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="mt-3 text-[11px] text-[var(--text-primary)]/45 leading-relaxed max-w-4xl">
                  Occupancy is occupied spaces divided by active spaces for that night. The Total row weighs every
                  category by its own size rather than averaging the percentages. Parent categories that merely
                  contain the spaces counted above them (a whole-dorm or whole-apartment product) are left out so the
                  same bed is never counted twice — the same rule the Statistic Files page uses.
                </p>
              </div>
            ) : (
              !error && !loading && (
                <div className="p-12 bg-[var(--paper)] border border-[var(--text-primary)]/14 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">
                  Pick a property and {dataSource === "live" ? "a date range" : "a snapshot date"}, then Fetch Report.
                </div>
              )
            )}

            {dataSource === "database" && (
              <div className="mt-10">
                <h2 className="text-xl font-serif mb-3">Snapshot History</h2>
                <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 overflow-x-auto">
                  <table className="w-full text-left border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-[var(--text-primary)]/5">
                        <th className={thCls}>Snapshot date</th>
                        <th className={`${thCls} text-right`}>Nights</th>
                        <th className={`${thCls} text-right`}>Categories</th>
                        <th className={`${thCls} text-right`}>Occupancy, first night</th>
                        <th className={thCls}>Captured</th>
                        <th className={thCls}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshots.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">
                            {selectedProperty ? "No snapshots yet — the 08:00 auto-import will create one, or use “Import To Data Mart”." : "Select a property to see its snapshots."}
                          </td>
                        </tr>
                      ) : snapshots.map((s) => {
                        const isActive = !!report && dataSource === "database" && report.start_date === s.date;
                        return (
                          <tr key={s.date} className={isActive ? "bg-emerald-500/[0.07]" : "hover:bg-[var(--text-primary)]/[0.02]"}>
                            <td className={`${tdCls} font-bold border-b border-[var(--text-primary)]/5`}>
                              {s.date}
                              {isActive && <span className="ml-2 text-[9px] font-bold tracked-caps text-emerald-700">Viewing</span>}
                            </td>
                            <td className={`${tdCls} text-right border-b border-[var(--text-primary)]/5`}>{s.nights}</td>
                            <td className={`${tdCls} text-right border-b border-[var(--text-primary)]/5`}>{s.categories}</td>
                            <td className={`${tdCls} text-right tabular-nums border-b border-[var(--text-primary)]/5`}>{pct(s.first_night_percent)}</td>
                            <td className={`${tdCls} border-b border-[var(--text-primary)]/5`}>{fmtDateTime(s.synced_at)}</td>
                            <td className={`${tdCls} border-b border-[var(--text-primary)]/5`}>
                              <button
                                onClick={() => { setSnapshotDate(s.date); fetchReport(s.date); }}
                                className="px-3 py-1.5 text-[9px] font-bold tracked-caps border border-[var(--text-primary)]/20 text-[var(--text-primary)]/70 hover:bg-[var(--text-primary)]/5 hover:text-[var(--text-primary)] transition-colors"
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
