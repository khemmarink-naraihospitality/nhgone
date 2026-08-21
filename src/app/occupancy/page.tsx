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
}

const thCls =
  "p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap";
const tdCls = "p-2 px-3 text-[13px] text-[var(--text-primary)] whitespace-nowrap";

const iso = (d: Date) => d.toISOString().split("T")[0];
const addDays = (d: Date, n: number) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

// "21/08" over "Fri" - the grid can run to three months, so the column head
// has to stay narrow while still letting someone find a weekend at a glance.
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

const pct = (v: number | null) => (v === null || v === undefined ? "-" : `${v.toFixed(2)}%`);

// A wash of the brand green whose strength tracks occupancy, so a full house
// and an empty one are distinguishable without reading every number. Kept
// deliberately faint - the figure itself stays the thing you read.
const heat = (v: number | null) => {
  if (v === null || v === undefined) return undefined;
  const a = Math.max(0, Math.min(100, v)) / 100;
  return { backgroundColor: `color-mix(in srgb, var(--text-primary) ${(a * 14).toFixed(1)}%, transparent)` };
};

export default function OccupancyPage() {
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [startDate, setStartDate] = useState(iso(new Date()));
  const [endDate, setEndDate] = useState(iso(addDays(new Date(), 13)));
  const [report, setReport] = useState<OccupancyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAllowedProperties().then(({ properties: list }) => {
      setProperties(list);
      setSelectedProperty((cur) => cur || list[0] || "");
    });
  }, []);

  const fetchReport = useCallback(async () => {
    if (!selectedProperty) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        property_name: selectedProperty,
        start_date: startDate,
        end_date: endDate,
      });
      const res = await fetch(`/api/occupancy/report?${params.toString()}`);
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
  }, [selectedProperty, startDate, endDate]);

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
          title="Occupancy by Room Type"
          description="Occupancy percentage per space category per night, straight from MEWS - the same view as its Availability report's Occupancy tab."
        />

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
          <div className="flex flex-col gap-2 w-full md:w-44">
            <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">From</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 py-1.5 text-[13px] text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
            />
          </div>
          <div className="flex flex-col gap-2 w-full md:w-44">
            <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">To</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 py-1.5 text-[13px] text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
            />
          </div>
          <button onClick={fetchReport} disabled={loading || !selectedProperty} className="btn-brand btn-primary h-[46px]">
            {loading ? "Loading..." : "Fetch Report"}
          </button>
          <button
            onClick={handleExport}
            disabled={!report}
            className="px-6 py-2 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 transition-colors whitespace-nowrap h-[46px] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Export .xlsx
          </button>
        </div>

        {error && (
          <div className="p-4 bg-[var(--paper)] border border-red-200 text-red-700 text-sm leading-relaxed mt-6">{error}</div>
        )}

        {report && (
          <div className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
              <h2 className="text-xl font-serif">Occupancy</h2>
              <span className="text-[10px] font-bold tracked-caps text-[var(--text-primary)]/40">
                {report.service} · {report.categories.length} categories · {nDays} night{nDays === 1 ? "" : "s"} · counting {report.space_types.join(" + ")}
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
              same bed is never counted twice - the same rule the Statistic Files page uses.
            </p>
          </div>
        )}

        {!report && !error && !loading && (
          <div className="mt-10 p-12 bg-[var(--paper)] border border-[var(--text-primary)]/14 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">
            Pick a property and a date range, then Fetch Report.
          </div>
        )}
      </div>
    </div>
  );
}
