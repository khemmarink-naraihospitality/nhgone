"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import PageHeader from "@/components/PageHeader";
import { getAllowedProperties } from "@/lib/allowedProperties";
import { downloadStopSaleXlsx, type StopSaleChartData, type StopSaleDayCell } from "@/lib/stopSaleChartExport";

// Same collapsible-header pattern as Statistic Files' own page - one
// shared open/close toggle hides the property/date controls and the
// mode-explainer paragraph together under a single "Details" line, instead
// of them permanently taking up space above the table once a report is
// loaded.
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

// A compact trigger-button-plus-panel dropdown, for filters that would
// otherwise sprawl into a full row of pills/checkboxes (the Occupancy By
// Type Calendar's Room Types and Month filters both used to be exactly
// that). Closes on an outside click - same interaction UserHeader.tsx's
// profile menu uses, restyled here with this page's own paper/text-primary
// tokens instead of that component's hardcoded dark-menu classes, so it
// reads as part of this page rather than a transplanted piece of chrome.
// Children are a render prop so a single-select panel (Month) can close
// itself the moment an option is picked, while a multi-select one (Room
// Types) can leave itself open across several checkbox clicks.
function FilterDropdown({
  label,
  summary,
  active,
  children,
}: {
  label: string;
  summary: string;
  active: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 pl-3 pr-2.5 py-1.5 border text-[11px] transition-colors ${
          active
            ? "border-[var(--text-primary)]/30 bg-[var(--text-primary)]/[0.05]"
            : "border-[var(--text-primary)]/14 hover:bg-[var(--text-primary)]/[0.03]"
        }`}
      >
        <span className="text-[9px] font-bold tracked-caps text-[var(--text-primary)]/40">{label}</span>
        <span className="font-bold whitespace-nowrap">{summary}</span>
        <svg
          className={`w-3 h-3 text-[var(--text-primary)]/40 transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-20 min-w-[240px] max-h-80 overflow-y-auto bg-[var(--paper)] border border-[var(--text-primary)]/14 shadow-xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface CategoryRow {
  short_name: string;
  name: string;
  type: string;
  occupied: number[];
  active: number[];
  percent: (number | null)[];
}

// One month's own Room Types checkbox panel - the calendar renders one of
// these per MonthBlock rather than a single filter shared across all of
// them, so a category worth watching in a busy month doesn't have to stay
// toggled on (or off) for every quiet one too. `selected` undefined means
// "everything", matching FilterDropdown's own null-means-all convention.
function RoomTypesFilter({
  categories,
  selected,
  onChange,
}: {
  categories: CategoryRow[];
  selected: Set<string> | undefined;
  onChange: (next: Set<string> | undefined) => void;
}) {
  return (
    <FilterDropdown
      label="Room Types"
      active={!!selected}
      summary={!selected ? "All" : `${selected.size} of ${categories.length}`}
    >
      {() => (
        <>
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--text-primary)]/10">
            <button
              onClick={() => onChange(undefined)}
              className="text-[10px] font-bold tracked-caps text-[var(--text-primary)]/60 hover:text-[var(--text-primary)]"
            >
              Select All
            </button>
            <button
              onClick={() => onChange(new Set())}
              className="text-[10px] font-bold tracked-caps text-[var(--text-primary)]/60 hover:text-[var(--text-primary)]"
            >
              Clear
            </button>
          </div>
          {categories.map((c) => {
            const id = c.short_name || c.name;
            const checked = !selected || selected.has(id);
            return (
              <label
                key={id}
                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-[var(--text-primary)]/[0.03] text-[12px]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const base = selected ?? new Set(categories.map((c2) => c2.short_name || c2.name));
                    const next = new Set(base);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    onChange(next);
                  }}
                  className="w-3.5 h-3.5 accent-[var(--text-primary)] shrink-0"
                />
                <span className="font-bold shrink-0">{id}</span>
                <span className="text-[var(--text-primary)]/45 truncate">{c.name}</span>
              </label>
            );
          })}
        </>
      )}
    </FilterDropdown>
  );
}

interface RateCategoryRow {
  short_name: string;
  name: string;
  type: string;
  prices: (number | null)[];
}

interface RateReport {
  property: string;
  rate_name: string;
  currency: string;
  space_types: string[];
  start_date: string;
  end_date: string;
  dates: string[];
  categories: RateCategoryRow[];
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
  // Present once the Rate tab has actually been fetched alongside this
  // report - absent on an older NHG snapshot captured before the Rate tab
  // existed, or if the live MEWS-mode rate call itself failed (see
  // fetchReport: a rate failure never blocks Occupancy from loading).
  rate?: RateReport;
}

interface SnapshotRow {
  date: string;
  synced_at: string | null;
  nights: number;
  categories: number;
  first_night_percent: number | null;
}

type DataSource = "live" | "database";

const TABS = [
  { key: "occupancy", label: "Occupancy by Room Type" },
  { key: "rate", label: "Rate" },
] as const;
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

// Whole-currency-unit formatting (THB rates are quoted in round baht, no
// cents in practice) - falls back to a plain number if the currency code
// somehow isn't one Intl recognizes, rather than throwing and blanking the
// whole table.
const fmtMoney = (v: number | null | undefined, currency: string) => {
  if (v === null || v === undefined) return "-";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
  } catch {
    return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
};

// Time only, Bangkok - the date is already the first half of the option's own
// label, so repeating it there would just push the useful part out of a narrow
// select.
const fmtTime = (v?: string | null) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
};

// The capture time matters, not just the day: the 08:00 auto-import and a
// mid-afternoon manual re-import are different pictures of the same date, and
// which one you are looking at is otherwise invisible.
const snapshotLabel = (s: SnapshotRow) =>
  s.synced_at ? `${s.date} · captured ${fmtTime(s.synced_at)}` : `${s.date} (not captured yet)`;

// A wash of the brand green whose strength tracks occupancy, so a full house
// and an empty one are distinguishable without reading every number. Kept
// deliberately faint - the figure itself stays the thing you read.
const heat = (v: number | null) => {
  if (v === null || v === undefined) return undefined;
  const a = Math.max(0, Math.min(100, v)) / 100;
  return { backgroundColor: `color-mix(in srgb, var(--text-primary) ${(a * 14).toFixed(1)}%, transparent)` };
};

// ---------------------------------------------------------------------------
// Occupancy By Type Calendar (the stop-sale chart)
// ---------------------------------------------------------------------------

// A category/night at or above this is considered sold out enough to stop
// selling to travel agents. Only the starting value - the calendar exposes
// it as an input, because 90% is the right line for a property running full
// and far too high for one whose forward book is still filling: Chinatown's
// December 2026 peaks at 84%, so a fixed 90 renders that whole month blank
// and tells a revenue manager nothing.
const DEFAULT_STOP_SELL_THRESHOLD = 90;

// Three states, and they need TWO snapshots to tell apart - "new" only means
// anything relative to what the position was the morning before, and
// "re-open" is by definition a change. The comparison baseline is the
// previous stored snapshot (see loadBaseline).
type StopState = "none" | "new-stop" | "existing-stop" | "reopen";

const stopState = (current: number | null | undefined, previous: number | null | undefined, hasBaseline: boolean, threshold: number): StopState => {
  const nowStopped = current !== null && current !== undefined && current >= threshold;
  const wasStopped = previous !== null && previous !== undefined && previous >= threshold;
  // With nothing to compare against, every stop reads as "existing" rather
  // than flagging the whole chart red on its first ever day - claiming
  // everything is newly stopped would be worse than saying nothing changed.
  if (!hasBaseline) return nowStopped ? "existing-stop" : "none";
  if (nowStopped) return wasStopped ? "existing-stop" : "new-stop";
  return wasStopped ? "reopen" : "none";
};

const STOP_CELL: Record<Exclude<StopState, "none">, { symbol: string; cls: string; title: string }> = {
  "existing-stop": { symbol: "X", cls: "text-[var(--text-primary)] font-bold", title: "Existing stop sale" },
  "new-stop": { symbol: "X", cls: "text-red-600 font-bold bg-yellow-300/60", title: "New stop sale" },
  reopen: { symbol: "o", cls: "text-cyan-700 font-bold bg-cyan-400/15", title: "Re-open" },
};

const MONTH_NAMES = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY",
  "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

interface MonthBlock {
  key: string;
  label: string;
  daysInMonth: number;
  // Day-of-month (1-based) -> index into the report's own dates array, or -1
  // where that day falls outside the loaded range. A report starting mid-month
  // leaves the earlier days of its first month genuinely empty rather than
  // guessing at them.
  dayIndex: number[];
}

const buildMonthBlocks = (dates: string[]): MonthBlock[] => {
  const blocks = new Map<string, MonthBlock>();
  dates.forEach((d, i) => {
    const [y, m, day] = d.split("-").map(Number);
    if (!y || !m || !day) return;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (!blocks.has(key)) {
      blocks.set(key, {
        key,
        label: `${MONTH_NAMES[m - 1]} ${y}`,
        daysInMonth: new Date(y, m, 0).getDate(),
        dayIndex: new Array(32).fill(-1),
      });
    }
    blocks.get(key)!.dayIndex[day] = i;
  });
  return Array.from(blocks.values()).sort((a, b) => (a.key < b.key ? -1 : 1));
};

export default function RevenuePage() {
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [dataSource, setDataSource] = useState<DataSource>("database");
  const [activeTab, setActiveTab] = useState<TabKey>("occupancy");
  const [headerOpen, setHeaderOpen] = useState(false);
  // Revenue Data (tabs + table) - expanded by default, unlike headerOpen,
  // matching Statistic Data's own default on the Statistic Files page: the
  // controls are the thing worth tucking away once loaded, not the report.
  const [dataOpen, setDataOpen] = useState(true);

  const [startDate, setStartDate] = useState(iso(startOfMonth(new Date())));
  const [endDate, setEndDate] = useState(iso(addMonths(startOfMonth(new Date()), 3)));
  const [snapshotDate, setSnapshotDate] = useState(iso(new Date()));

  const [report, setReport] = useState<OccupancyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [calendarOpen, setCalendarOpen] = useState(true);
  const [stopThreshold, setStopThreshold] = useState(DEFAULT_STOP_SELL_THRESHOLD);
  // The morning-before snapshot the calendar diffs against to tell a NEW stop
  // sale from one that was already in place. null until loaded, or when there
  // simply isn't an earlier snapshot to compare with yet.
  const [baseline, setBaseline] = useState<OccupancyReport | null>(null);
  // Which snapshot the baseline came from. Not derivable from `baseline`
  // itself: its start_date is the 1st of its month, not the morning it was
  // captured, so labelling the comparison with it named the wrong day.
  const [baselineDate, setBaselineDate] = useState<string | null>(null);
  // Which room-type rows each month's table shows - one filter PER MONTH
  // rather than one shared across all of them, since a category worth
  // watching in a busy month (say, dorm beds in August) is often just noise
  // in a quiet one. Keyed by MonthBlock.key -> a Set of `short_name || name`
  // (the same id the table rows themselves use, so a filter can never drift
  // from what's on screen), or undefined/absent for "everything", which is
  // every month's default until that month's own dropdown is touched.
  const [visibleCategoriesByMonth, setVisibleCategoriesByMonth] = useState<Record<string, Set<string>>>({});

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
      if (dataSource === "database") {
        // One stored snapshot already carries both Occupancy and Rate
        // together (see sync_occupancy_day) - a single read covers both
        // tabs. An older snapshot captured before the Rate tab existed
        // just comes back without a "rate" key; the Rate tab's own empty
        // state below handles that.
        const url = `/api/occupancy/managed?property_name=${encodeURIComponent(selectedProperty)}&date=${overrideSnapshot ?? snapshotDate}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok || json.status !== "success") {
          throw new Error(json.detail || json.message || "Could not load the occupancy report");
        }
        setReport(json.data);
      } else {
        // MEWS mode: fire Occupancy and Rate together so Rate is already
        // sitting there ready the moment someone switches tabs, instead of
        // making them wait through a second fetch on click. Rate is
        // best-effort - a property missing a default (BAR) rate, or any
        // other rate-side failure, must not stop Occupancy from loading;
        // the Rate tab just shows its own empty state when report.rate
        // ends up undefined.
        const params = new URLSearchParams({ property_name: selectedProperty, start_date: startDate, end_date: endDate });
        const [occRes, rateRes] = await Promise.all([
          fetch(`/api/occupancy/report?${params}`).then(async (r) => ({ ok: r.ok, json: await r.json() })),
          fetch(`/api/occupancy/rate?${params}`).then(async (r) => ({ ok: r.ok, json: await r.json() })).catch(() => null),
        ]);
        if (!occRes.ok || occRes.json.status !== "success") {
          throw new Error(occRes.json.detail || occRes.json.message || "Could not load the occupancy report");
        }
        const rate = rateRes && rateRes.ok && rateRes.json.status === "success" ? rateRes.json.data : undefined;
        setReport({ ...occRes.json.data, rate });
      }
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : "Could not load the occupancy report");
    } finally {
      setLoading(false);
    }
  }, [selectedProperty, dataSource, snapshotDate, startDate, endDate]);

  // Loads the snapshot immediately before whichever report is on screen, to
  // diff against. In NHG mode that's the stored snapshot before the selected
  // date; in MEWS mode (a live, unsaved outlook) the newest stored snapshot is
  // the closest thing to "the position as of the last capture". Failures are
  // silent on purpose - no baseline just means the calendar shows every stop
  // as existing rather than breaking the page.
  useEffect(() => {
    if (!report || !selectedProperty || snapshots.length === 0) {
      setBaseline(null);
      setBaselineDate(null);
      return;
    }
    const currentDate = dataSource === "database" ? snapshotDate : null;
    const prior = currentDate
      ? snapshots.find((s) => s.date < currentDate && s.synced_at)
      : snapshots.find((s) => s.synced_at);
    if (!prior) {
      setBaseline(null);
      setBaselineDate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/occupancy/managed?property_name=${encodeURIComponent(selectedProperty)}&date=${prior.date}`);
        const json = await res.json();
        const ok = res.ok && json.status === "success";
        if (!cancelled) {
          setBaseline(ok ? json.data : null);
          setBaselineDate(ok ? prior.date : null);
        }
      } catch {
        if (!cancelled) { setBaseline(null); setBaselineDate(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [report, selectedProperty, snapshots, dataSource, snapshotDate]);

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

    // Rate rides along as a second sheet whenever it's actually loaded -
    // same "have it ready, not a separate export" spirit as fetching it
    // alongside Occupancy in the first place.
    if (report.rate) {
      const rateRows = report.rate.categories.map((c) => {
        const row: Record<string, string | number> = {
          "Space category": c.short_name || c.name,
          Name: c.name,
          Type: c.type,
        };
        report.rate!.dates.forEach((d, i) => {
          row[d] = c.prices[i] === null ? "" : c.prices[i]!;
        });
        return row;
      });
      const rws = XLSX.utils.json_to_sheet(rateRows);
      XLSX.utils.book_append_sheet(wb, rws, "Rate");
    }

    XLSX.writeFile(wb, `Occupancy_${selectedProperty.replace(/\s+/g, "")}_${report.start_date}_${report.end_date}.xlsx`);
  };

  const nDays = report?.dates.length ?? 0;

  // The picker's option list: every stored snapshot, newest first, plus the
  // currently-selected date if it isn't one of them - so a select whose
  // value is today (the default) never renders blank just because today
  // hasn't been captured yet, and the option's own label says so.
  const monthBlocks = useMemo(() => (report ? buildMonthBlocks(report.dates) : []), [report]);

  // The filter resets to "everything, every month" on every new report
  // rather than persisting across fetches - a category picked for one
  // property's chart may not exist on the next.
  useEffect(() => {
    setVisibleCategoriesByMonth({});
  }, [report]);

  const categoryRowsForMonth = useCallback(
    (monthKey: string) => {
      const picked = visibleCategoriesByMonth[monthKey];
      return picked ? report?.categories.filter((c) => picked.has(c.short_name || c.name)) ?? [] : report?.categories ?? [];
    },
    [report, visibleCategoriesByMonth]
  );

  // Baseline occupancy looked up by "<category> <date>" rather than by array
  // index: the earlier snapshot starts on its own date and so is offset from
  // the current one by however many days apart the two captures are, and its
  // category list can differ too if a room type was added or retired.
  const baselineByKey = useMemo(() => {
    const map = new Map<string, number | null>();
    if (!baseline) return map;
    baseline.categories.forEach((c) => {
      const id = c.short_name || c.name;
      baseline.dates.forEach((d, i) => map.set(`${id}|${d}`, c.percent[i] ?? null));
    });
    return map;
  }, [baseline]);

  // The one place a category/day turns into a stop-sale cell state - used
  // by the on-screen table AND the export/print views below, so none of
  // them can ever disagree with each other about what a cell shows.
  const dayState = useCallback(
    (c: CategoryRow, block: MonthBlock, day: number): { exists: boolean; state: StopState } => {
      const idx = block.dayIndex[day];
      if (idx < 0 || !report) return { exists: false, state: "none" };
      const id = c.short_name || c.name;
      const date = report.dates[idx];
      const value = c.percent[idx];
      const state = stopState(value, baselineByKey.get(`${id}|${date}`), !!baseline, stopThreshold);
      return { exists: true, state };
    },
    [report, baselineByKey, baseline, stopThreshold]
  );

  // dd/mm/yyyy for the "Report as of" line - the calendar's own date
  // (whichever stored snapshot is selected in NHG mode, or today in MEWS
  // live mode), not the comparison baseline shown alongside the legend.
  const reportAsOf = useMemo(() => {
    const d = dataSource === "database" ? snapshotDate : iso(new Date());
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  }, [dataSource, snapshotDate]);

  // The full Stop Sale Chart, in export-ready shape - every month, honoring
  // each month's own Room Types selection, built from the same dayState()
  // the on-screen table renders from.
  const stopSaleChartData: StopSaleChartData | null = useMemo(() => {
    if (!report) return null;
    return {
      propertyName: selectedProperty,
      reportAsOf,
      months: monthBlocks.map((block) => ({
        key: block.key,
        label: block.label,
        daysInMonth: block.daysInMonth,
        categories: categoryRowsForMonth(block.key).map((c) => ({
          label: c.short_name || c.name,
          cells: Array.from({ length: 31 }, (_, i) => {
            const day = i + 1;
            const { exists, state } = dayState(c, block, day);
            return { day, exists, state } as StopSaleDayCell;
          }),
        })),
      })),
    };
  }, [report, selectedProperty, reportAsOf, monthBlocks, categoryRowsForMonth, dayState]);

  // Renames the tab title while printing so a browser's "Save as PDF" picks
  // a sane filename, then restores it - same pattern bcp/page.tsx's Reg Card
  // print (handlePrintRegCard) already uses. This app has no server-side PDF
  // route by deliberate choice (see CLAUDE.md: one was built, worked, and was
  // removed again for the Chromium function's server cost) - browser print
  // is the established way every other print-to-PDF page here works.
  const handlePrintStopSaleChart = () => {
    if (!stopSaleChartData) return;
    const originalTitle = document.title;
    document.title = `StopSaleChart_${stopSaleChartData.propertyName.replace(/\s+/g, "")}`;
    const restoreTitle = () => {
      document.title = originalTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);
    window.print();
  };

  const snapshotOptions = (() => {
    const byDate = new Map(snapshots.map((s) => [s.date, s]));
    if (!byDate.has(snapshotDate)) {
      byDate.set(snapshotDate, { date: snapshotDate, synced_at: null, nights: 0, categories: 0, first_night_percent: null });
    }
    return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
  })();

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

        <CollapsibleSection
          open={headerOpen}
          onToggle={() => setHeaderOpen((o) => !o)}
          label={`Details — ${selectedProperty || "no property selected"}${report ? ` · ${report.start_date} — ${report.end_date}` : ""}`}
        >
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
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
            <div className="flex flex-col gap-2 w-full md:w-80">
              <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">Snapshot Date</label>
              <div className="relative">
                <select
                  value={snapshotDate}
                  onChange={(e) => { setSnapshotDate(e.target.value); fetchReport(e.target.value); }}
                  className="w-full bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 pr-10 py-2 text-[13px] appearance-none cursor-pointer text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
                >
                  {snapshotOptions.map((s) => (
                    <option key={s.date} value={s.date}>{snapshotLabel(s)}</option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-primary)]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </div>
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
        </CollapsibleSection>

        {error && (
          <div className="p-4 bg-[var(--paper)] border border-red-200 text-red-700 text-sm leading-relaxed mt-6">{error}</div>
        )}

        <button
          onClick={() => setDataOpen((o) => !o)}
          className="flex items-center gap-2 mt-8 mb-3 text-[var(--text-primary)] hover:opacity-70 transition-opacity"
        >
          <svg className={`w-4 h-4 shrink-0 transition-transform ${dataOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          <h2 className="text-xl font-serif">Revenue Data</h2>
        </button>

        {dataOpen && (
          <>
        <div className="flex flex-wrap border-b border-[var(--text-primary)]/14 mb-4">
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
          </>
        )}

        {activeTab === "rate" && (
          <>
            {report?.rate ? (
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
                  <h2 className="text-xl font-serif">
                    {report.rate.start_date} — {report.rate.end_date}
                  </h2>
                  <span className="text-[10px] font-bold tracked-caps text-[var(--text-primary)]/40">
                    {report.rate.rate_name} · {report.rate.categories.length} categories · {report.rate.dates.length} night{report.rate.dates.length === 1 ? "" : "s"} · counting {report.rate.space_types?.join(" + ")}
                    {report._synced_at ? ` · captured ${fmtDateTime(report._synced_at)}` : ""}
                  </span>
                </div>

                <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 overflow-x-auto overscroll-contain">
                  <table className="w-full text-left border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-[var(--text-primary)]/5">
                        <th className={`${thCls} sticky left-0 z-10 bg-[#F2EEE4]`}>Space category</th>
                        {report.rate.dates.map((d) => {
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
                      {report.rate.categories.map((c) => (
                        <tr key={(c.short_name || "") + c.name} className="hover:bg-[var(--text-primary)]/[0.02]">
                          <td className={`${tdCls} sticky left-0 z-10 bg-[var(--paper)] border-b border-[var(--text-primary)]/5`}>
                            <span className="font-bold">{c.short_name || c.name}</span>
                            <span className="ml-2 text-[11px] text-[var(--text-primary)]/45">{c.name}</span>
                          </td>
                          {c.prices.map((p, i) => (
                            <td
                              key={report.rate!.dates[i]}
                              className={`${tdCls} text-right tabular-nums border-b border-[var(--text-primary)]/5`}
                            >
                              {fmtMoney(p, report.rate!.currency)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="mt-3 text-[11px] text-[var(--text-primary)]/45 leading-relaxed max-w-4xl">
                  Rate is the nightly sales price of {report.rate.rate_name} - the property&apos;s own default (BAR)
                  rate - per space category, net of tax. There is no Total row: unlike occupancy, summing or
                  averaging list prices across different room types has no standard meaning. Parent categories are
                  left out for the same reason the Occupancy tab leaves them out - the same beds priced twice.
                </p>
              </div>
            ) : (
              !error && !loading && (
                <div className="p-12 bg-[var(--paper)] border border-[var(--text-primary)]/14 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">
                  {report
                    ? "No rate data on this snapshot - re-import to include it, or switch MODE to MEWS."
                    : `Pick a property and ${dataSource === "live" ? "a date range" : "a snapshot date"}, then Fetch Report.`}
                </div>
              )
            )}
          </>
        )}
          </>
        )}

        <button
          onClick={() => setCalendarOpen((o) => !o)}
          className="flex items-center gap-2 mt-10 mb-3 text-[var(--text-primary)] hover:opacity-70 transition-opacity"
        >
          <svg className={`w-4 h-4 shrink-0 transition-transform ${calendarOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          <h2 className="text-xl font-serif">Occupancy By Type Calendar</h2>
        </button>

        {calendarOpen && (
          report ? (
            // no-print: the on-screen grid uses theme-var colours and a
            // horizontal scroll that don't survive pagination. The purpose-
            // built print-only table just below (hidden print:block) is
            // what actually prints, same split BCP's Timeline/housekeeping
            // sheet already uses.
            <div className="no-print">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-primary)]/60">
                  <span>Stop-sale chart — a night at or above</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={stopThreshold}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) setStopThreshold(Math.min(100, Math.max(1, n)));
                    }}
                    className="w-16 bg-[var(--paper)] border border-[var(--text-primary)]/14 px-2 py-1 text-[12px] tabular-nums text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
                  />
                  <span>% occupancy is stopped for travel agents.</span>
                </div>
                <span className="text-[10px] font-bold tracked-caps text-[var(--text-primary)]/40">
                  {baseline && baselineDate
                    ? `compared against ${baselineDate}${(() => {
                        const t = fmtTime(snapshots.find((s) => s.date === baselineDate)?.synced_at);
                        return t ? ` · captured ${t}` : "";
                      })()}`
                    : "no earlier snapshot to compare — every stop shown as existing"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4 text-[11px] text-[var(--text-primary)]/70">
                <span className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 border border-[var(--text-primary)]/14 font-bold">X</span> Existing stop sale
                </span>
                <span className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 border border-[var(--text-primary)]/14 font-bold text-red-600 bg-yellow-300/60">X</span> New stop sale
                </span>
                <span className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 border border-[var(--text-primary)]/14 font-bold text-cyan-700 bg-cyan-400/15">o</span> Re-open
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-6">
                <button
                  onClick={() => stopSaleChartData && downloadStopSaleXlsx(stopSaleChartData)}
                  disabled={!stopSaleChartData}
                  className="px-3 py-1.5 border border-[var(--text-primary)]/14 text-[10px] font-bold tracked-caps hover:bg-[var(--text-primary)]/[0.04] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Export Stop Sale Chart (.xlsx)
                </button>
                <button
                  onClick={handlePrintStopSaleChart}
                  disabled={!stopSaleChartData}
                  className="px-3 py-1.5 border border-[var(--text-primary)]/14 text-[10px] font-bold tracked-caps hover:bg-[var(--text-primary)]/[0.04] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Print / Save as PDF
                </button>
              </div>

              <div className="space-y-8">
                {monthBlocks.map((block) => {
                  const rows = categoryRowsForMonth(block.key);
                  const selected = visibleCategoriesByMonth[block.key];
                  return (
                    <div key={block.key}>
                      <div className="flex flex-wrap items-center gap-3 mb-2 pb-2 border-b border-[var(--text-primary)]/10">
                        <span className="text-[11px] font-bold tracked-caps text-[var(--text-primary)]/50">{block.label}</span>
                        <RoomTypesFilter
                          categories={report.categories}
                          selected={selected}
                          onChange={(next) =>
                            setVisibleCategoriesByMonth((prev) => {
                              const copy = { ...prev };
                              if (next === undefined) delete copy[block.key];
                              else copy[block.key] = next;
                              return copy;
                            })
                          }
                        />
                      </div>

                      {rows.length === 0 ? (
                        <div className="p-8 bg-[var(--paper)] border border-[var(--text-primary)]/14 text-center text-[var(--text-primary)]/40 text-[13px]">
                          No room types selected for {block.label} — check at least one above to show this month.
                        </div>
                      ) : (
                        <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 overflow-x-auto overscroll-contain">
                          <table className="w-full text-left border-separate border-spacing-0">
                            <thead>
                              <tr className="bg-[var(--text-primary)]/[0.03]">
                                <th className={`${thCls} sticky left-0 z-10 bg-[#F2EEE4] w-56 min-w-56`}>Date</th>
                                {Array.from({ length: block.daysInMonth }, (_, i) => i + 1).map((day) => (
                                  <th key={day} className={`${thCls} text-center px-0 w-8 min-w-8`}>{day}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((c) => {
                                const id = c.short_name || c.name;
                                return (
                                  <tr key={id} className="hover:bg-[var(--text-primary)]/[0.02]">
                                    <td className={`${tdCls} sticky left-0 z-10 bg-[var(--paper)] border-b border-[var(--text-primary)]/5`}>
                                      <span className="font-bold">{c.short_name || c.name}</span>
                                      <span className="ml-2 text-[11px] text-[var(--text-primary)]/45">{c.name}</span>
                                    </td>
                                    {Array.from({ length: block.daysInMonth }, (_, i) => i + 1).map((day) => {
                                      const idx = block.dayIndex[day];
                                      if (idx < 0) {
                                        return <td key={day} className="border-b border-l border-[var(--text-primary)]/5 bg-[var(--text-primary)]/[0.03]" />;
                                      }
                                      const date = report.dates[idx];
                                      const value = c.percent[idx];
                                      const state = stopState(value, baselineByKey.get(`${id}|${date}`), !!baseline, stopThreshold);
                                      const style = state === "none" ? null : STOP_CELL[state];
                                      return (
                                        <td
                                          key={day}
                                          title={`${date} · ${pct(value)}${style ? ` · ${style.title}` : ""}`}
                                          className={`text-center p-1 border-b border-l border-[var(--text-primary)]/5 ${style ? `text-[12px] ${style.cls}` : "text-[10px] text-[var(--text-primary)]/70 tabular-nums"}`}
                                        >
                                          {style ? style.symbol : ""}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="mt-3 text-[11px] text-[var(--text-primary)]/45 leading-relaxed max-w-4xl">
                Built from the Occupancy by Room Type figures above, so it follows whichever property, mode and
                snapshot are loaded there. A month with no X simply
                has nothing at or above the threshold yet, which is not the same as missing data — lower the
                threshold to surface the nights getting close. &ldquo;New&rdquo; and &ldquo;Re-open&rdquo; are changes against the previous
                stored snapshot — until a second morning has been captured there is nothing to compare against, and
                every stop is shown as existing rather than flagged as new.
              </p>
            </div>
          ) : (
            !error && !loading && (
              <div className="p-12 bg-[var(--paper)] border border-[var(--text-primary)]/14 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">
                Load a report above to build the calendar.
              </div>
            )
          )
        )}

        {/* Print-only Stop Sale Chart - the on-screen calendar above is
            marked no-print (see its own comment) because its theme colours
            and horizontal scroll don't survive pagination. This is a plain,
            explicitly-black-on-white table built from the exact same
            stopSaleChartData the .xlsx export uses, so print/PDF and xlsx
            can never show different numbers. print-color-adjust is set
            inline because browsers strip background fills by default when
            printing (to save ink) - without it every coloured cell below
            would print as plain white. Landscape fits the 31 day columns
            far better than portrait; pick that in the browser's print
            dialog when saving as PDF. */}
        {stopSaleChartData && (
          <div className="hidden print:block text-black" style={{ WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
            <div className="mb-1 px-2 py-1 bg-[#1F3864] text-white font-bold text-[13px]">
              STOP SALE CHART :&nbsp;&nbsp;{stopSaleChartData.propertyName}
            </div>
            <div className="mb-4 text-[11px]">
              <span className="font-bold text-[#C00000]">Report as of :</span>{" "}
              <span className="bg-[#FFFF00] font-bold px-1">{stopSaleChartData.reportAsOf}</span>
            </div>

            {stopSaleChartData.months.map((month) => (
              <table key={month.key} className="border-collapse mb-4 break-inside-avoid">
                <thead>
                  <tr>
                    <th colSpan={32} className="bg-[#D9E2F3] border border-gray-400 text-[11px] font-bold py-1">
                      {month.label}
                    </th>
                  </tr>
                  <tr>
                    <th className="bg-[#DCE6F1] border border-gray-400 text-[9px] font-bold w-24 min-w-24 px-1 text-left">Date</th>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                      <th
                        key={day}
                        className={`border border-gray-400 text-[8px] font-bold w-5 min-w-5 ${day > month.daysInMonth ? "bg-black" : "bg-[#DCE6F1]"}`}
                      >
                        {day <= month.daysInMonth ? day : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {month.categories.map((cat) => (
                    <tr key={cat.label}>
                      <td className="border border-gray-400 text-[9px] font-bold px-1 whitespace-nowrap">{cat.label}</td>
                      {cat.cells.map((day) => (
                        <td
                          key={day.day}
                          className={`border border-gray-400 text-[8px] text-center font-bold ${
                            !day.exists
                              ? "bg-black"
                              : day.state === "new-stop"
                                ? "bg-[#FFFF00] text-[#C00000]"
                                : day.state === "reopen"
                                  ? "bg-[#22D3EE] text-[#063B4A]"
                                  : ""
                          }`}
                        >
                          {day.exists && day.state === "existing-stop" ? "X" : ""}
                          {day.exists && day.state === "new-stop" ? "X" : ""}
                          {day.exists && day.state === "reopen" ? "o" : ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td className="border border-gray-400 text-[9px] font-bold px-1 text-[#C00000] whitespace-nowrap">EXTRA BED</td>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                      <td key={day} className={`border border-gray-400 ${day > month.daysInMonth ? "bg-black" : ""}`} />
                    ))}
                  </tr>
                </tbody>
              </table>
            ))}

            <div className="text-[10px]">
              <div className="font-bold underline mb-1">Remark</div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="inline-flex items-center justify-center w-4 h-4 border border-gray-400 bg-[#FFFF00] text-[#C00000] font-bold">X</span>
                New Stop Sales
              </div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="inline-flex items-center justify-center w-4 h-4 border border-gray-400 font-bold">X</span>
                Existing Stop Sales
              </div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="inline-flex items-center justify-center w-4 h-4 border border-gray-400 bg-[#22D3EE] text-[#063B4A] font-bold">o</span>
                Re-open
              </div>
              <div className="flex items-center gap-2 text-[#C00000]">
                <span className="inline-flex items-center justify-center w-4 h-4 border border-gray-400 font-bold">&nbsp;</span>
                Extra Bed Stop Sale — not tracked in MEWS; fill in by hand
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
