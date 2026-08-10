"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getAllowedProperties } from "@/lib/allowedProperties";
import PageHeader from "@/components/PageHeader";

// Same collapsible-header pattern ST Files and BCP use - one shared
// open/close toggle wrapping the description + property/date controls so
// they hide together under a single "Details" line instead of permanently
// taking up space above the data.
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

interface Rr4Row {
  row_no: number;
  date_check_in: string;
  time_check_in: string;
  room_no: string;
  title_en: string;
  name_en: string;
  middle_name_en: string;
  surname_en: string;
  nationality: string;
  pid: string;
  passport: string;
  issued_by: string;
  address: string;
  address_country: string;
  occupation: string;
  come_from: string;
  come_from_country: string;
  will_go: string;
  will_go_country: string;
  date_check_out: string;
  time_check_out: string;
  data_status: number;
}

interface Rr4Report {
  property: string;
  property_thai_name: string;
  date: string;
  date_buddhist: string;
  rows: Rr4Row[];
}

interface Tm30Row {
  first_name: string;
  middle_name: string;
  last_name: string;
  gender: string;
  passport_no: string;
  nationality: string;
  birth_date: string;
  check_out_date: string;
  phone: string;
}

interface Tm30Report {
  property: string;
  property_thai_name: string;
  date: string;
  rows: Tm30Row[];
}

const TABS = [
  { key: "rr4", label: "RR4" },
  { key: "tm30", label: "TM30" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const thCls = "p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap";
const tdCls = "p-2 px-3 text-[13px] text-[var(--text-primary)] whitespace-nowrap";

export default function Rr4Tm30Page() {
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [rr4Report, setRr4Report] = useState<Rr4Report | null>(null);
  const [tm30Report, setTm30Report] = useState<Tm30Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("rr4");
  // Collapsed by default, same as ST Files/BCP's own header details section.
  const [headerOpen, setHeaderOpen] = useState(false);
  // The data tables - expanded by default, since they're the page's main
  // content rather than supporting detail.
  const [dataOpen, setDataOpen] = useState(true);

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

  useEffect(() => {
    if (selectedProperty) fetchReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProperty]);

  const fetchReports = async () => {
    if (!selectedProperty) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ property_name: selectedProperty, date });
      const [rr4Res, tm30Res] = await Promise.all([
        fetch(`/api/rr4/report?${params.toString()}`),
        fetch(`/api/tm30/report?${params.toString()}`),
      ]);
      const rr4Result = await rr4Res.json();
      const tm30Result = await tm30Res.json();
      if (rr4Result.status !== "success") throw new Error(rr4Result.detail || "Failed to fetch RR4 report");
      if (tm30Result.status !== "success") throw new Error(tm30Result.detail || "Failed to fetch TM30 report");
      setRr4Report(rr4Result.data);
      setTm30Report(tm30Result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Filename (<<Property Code>>_RR4_<<yyyymmdd>>.xlsx) is decided server-side,
  // where the real Property Code is known - read it back off the response
  // instead of guessing it client-side.
  const filenameFromResponse = (res: Response, fallback: string) => {
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/);
    return match ? match[1] : fallback;
  };

  const handleDownload = async (kind: TabKey) => {
    if (!selectedProperty) return;
    try {
      const params = new URLSearchParams({ property_name: selectedProperty, date });
      const res = await fetch(`/api/${kind}/export?${params.toString()}`);
      if (!res.ok) {
        const result = await res.json().catch(() => null);
        throw new Error(result?.detail || "Download failed");
      }
      const filename = filenameFromResponse(res, `${kind.toUpperCase()}_${selectedProperty}_${date}.xlsx`);
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

  const rr4Table = (rows: Rr4Row[]) => (
    <table className="w-full text-left border-collapse min-w-max">
      <thead>
        <tr className="bg-[var(--text-primary)]/5">
          <th className={thCls}>No.</th>
          <th className={thCls}>Check-in</th>
          <th className={thCls}>Time</th>
          <th className={thCls}>Room</th>
          <th className={thCls}>Title</th>
          <th className={thCls}>First Name</th>
          <th className={thCls}>Middle</th>
          <th className={thCls}>Last Name</th>
          <th className={thCls}>Nationality</th>
          <th className={thCls}>PID</th>
          <th className={thCls}>Passport</th>
          <th className={thCls}>Address</th>
          <th className={thCls}>Occupation</th>
          <th className={thCls}>Check-out</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--text-primary)]/5">
        {rows.length === 0 ? (
          <tr><td colSpan={14} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">None for this date.</td></tr>
        ) : rows.map((r) => (
          <tr key={r.row_no} className="hover:bg-[var(--text-primary)]/[0.02]">
            <td className={tdCls}>{r.row_no}</td>
            <td className={tdCls}>{r.date_check_in}</td>
            <td className={tdCls}>{r.time_check_in}</td>
            <td className={`${tdCls} font-bold`}>{r.room_no || "-"}</td>
            <td className={tdCls}>{r.title_en}</td>
            <td className={tdCls}>{r.name_en || "-"}</td>
            <td className={tdCls}>{r.middle_name_en || "-"}</td>
            <td className={tdCls}>{r.surname_en || "-"}</td>
            <td className={tdCls}>{r.nationality || "-"}</td>
            <td className={tdCls}>{r.pid || "-"}</td>
            <td className={tdCls}>{r.passport || "-"}</td>
            <td className={tdCls}>{r.address || "-"}</td>
            <td className={tdCls}>{r.occupation}</td>
            <td className={tdCls}>{r.date_check_out}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const tm30Table = (rows: Tm30Row[]) => (
    <table className="w-full text-left border-collapse min-w-max">
      <thead>
        <tr className="bg-[var(--text-primary)]/5">
          <th className={thCls}>First Name</th>
          <th className={thCls}>Middle</th>
          <th className={thCls}>Last Name</th>
          <th className={thCls}>Gender</th>
          <th className={thCls}>Passport No.</th>
          <th className={thCls}>Nationality</th>
          <th className={thCls}>Birth Date</th>
          <th className={thCls}>Check-out Date</th>
          <th className={thCls}>Phone</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--text-primary)]/5">
        {rows.length === 0 ? (
          <tr><td colSpan={9} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">No foreign arrivals for this date.</td></tr>
        ) : rows.map((r, i) => (
          <tr key={i} className="hover:bg-[var(--text-primary)]/[0.02]">
            <td className={tdCls}>{r.first_name || "-"}</td>
            <td className={tdCls}>{r.middle_name || "-"}</td>
            <td className={`${tdCls} font-bold`}>{r.last_name || "-"}</td>
            <td className={tdCls}>{r.gender}</td>
            <td className={tdCls}>{r.passport_no || "-"}</td>
            <td className={tdCls}>{r.nationality || "-"}</td>
            <td className={tdCls}>{r.birth_date || "-"}</td>
            <td className={tdCls}>{r.check_out_date}</td>
            <td className={tdCls}>{r.phone || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  // One row per generated file for the loaded day - the Files section's
  // equivalent of ST Files' per-day history table. RR4/TM30 are built live
  // from MEWS rather than cached in a sync table, so this lists the two
  // files the currently-loaded day can produce rather than a date history.
  const fileRows = [
    { key: "rr4" as TabKey, label: "RR4", description: "ทะเบียนผู้เข้าพักในโรงแรม (ร.ร.๔)", count: rr4Report?.rows.length ?? null },
    { key: "tm30" as TabKey, label: "TM30", description: "แจ้งที่พักคนต่างด้าว (ตม.30)", count: tm30Report?.rows.length ?? null },
  ];

  return (
    <div className="flex-1 p-4 sm:p-6 md:p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
      <div className="max-w-[100rem] mx-auto">
        <PageHeader title="RR4 / TM30" />

        <CollapsibleSection
          open={headerOpen}
          onToggle={() => setHeaderOpen((o) => !o)}
          label={`Details — ${selectedProperty || "no property selected"}${rr4Report ? ` · ${rr4Report.date}` : ""}`}
        >
          <p className="text-[var(--text-primary)] text-sm opacity-70 leading-relaxed max-w-4xl">
            Daily Thai Hotel Act guest register (RR4 / ร.ร.๔) and Immigration foreign-arrival notification (TM30), generated straight from MEWS - no manual copy-paste.
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
            <button onClick={() => fetchReports()} disabled={loading} className="btn-brand btn-primary h-[46px]">
              {loading ? "Loading..." : "Fetch Report"}
            </button>
          </div>
        </CollapsibleSection>

        {error && (
          <div className="p-4 bg-[var(--paper)] border border-red-200 text-red-700 text-sm leading-relaxed mb-6">{error}</div>
        )}

        {(rr4Report || tm30Report) && (
          <div>
            <CollapsibleSection open={headerOpen}>
              <div className="flex flex-wrap items-center gap-3 text-[11px] px-4 py-3 border bg-[var(--paper)] border-[var(--text-primary)]/14 text-[var(--text-primary)]/70 mb-4">
                <span className="font-bold">{rr4Report?.property_thai_name || selectedProperty}</span>
                <span>{rr4Report?.date}</span>
                {rr4Report && <span>ประจำวันที่ {rr4Report.date_buddhist}</span>}
              </div>
            </CollapsibleSection>

            <button
              onClick={() => setDataOpen((o) => !o)}
              className="flex items-center gap-2 mb-3 text-[var(--text-primary)] hover:opacity-70 transition-opacity"
            >
              <svg className={`w-4 h-4 shrink-0 transition-transform ${dataOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              <h2 className="text-xl font-serif">RR4 &amp; TM30 Data</h2>
            </button>

            {dataOpen && (
              <>
                <div className="flex flex-wrap border-b border-[var(--text-primary)]/14 mb-6">
                  {TABS.map((t) => {
                    const count = t.key === "rr4" ? rr4Report?.rows.length : tm30Report?.rows.length;
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
                        {t.label}{count !== undefined ? ` (${count})` : ""}
                      </button>
                    );
                  })}
                </div>

                <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 mb-8 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-x-auto p-0">
                  {activeTab === "rr4" ? rr4Table(rr4Report?.rows || []) : tm30Table(tm30Report?.rows || [])}
                </div>
              </>
            )}
          </div>
        )}

        {!rr4Report && !tm30Report && !error && !loading && (
          <div className="p-16 text-center text-[var(--text-primary)]/30 font-display text-2xl italic border border-dashed border-[var(--text-primary)]/14 bg-[var(--paper)]/40">
            Pick a property and date, then Fetch Report.
          </div>
        )}

        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-serif text-[var(--text-primary)]">RR4 &amp; TM30 Files</h2>
            {loading && <span className="text-[10px] font-bold tracked-caps text-[var(--text-primary)]/40">Loading...</span>}
          </div>
          <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-max">
              <thead>
                <tr className="bg-[var(--text-primary)]/5">
                  <th className={thCls}>File</th>
                  <th className={thCls}>Description</th>
                  <th className={thCls}>Date</th>
                  <th className={`${thCls} text-right`}>Rows</th>
                  <th className={thCls}>Format</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--text-primary)]/5">
                {!rr4Report && !tm30Report ? (
                  <tr>
                    <td colSpan={6} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">
                      {selectedProperty ? "Fetch a report above to generate files." : "Select a property to generate RR4/TM30 files."}
                    </td>
                  </tr>
                ) : fileRows.map((f) => (
                  <tr key={f.key} className={activeTab === f.key ? "bg-emerald-500/[0.07]" : "hover:bg-[var(--text-primary)]/[0.02]"}>
                    <td className={`${tdCls} font-bold`}>
                      {f.label}
                      {activeTab === f.key && <span className="ml-2 text-[9px] font-bold tracked-caps text-emerald-700">Viewing</span>}
                    </td>
                    <td className={tdCls}>{f.description}</td>
                    <td className={tdCls}>{date}</td>
                    <td className={`${tdCls} text-right`}>{f.count ?? "-"}</td>
                    <td className={tdCls}>.xlsx</td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setActiveTab(f.key); setDataOpen(true); }}
                          className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 transition-colors whitespace-nowrap"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleDownload(f.key)}
                          className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 transition-colors whitespace-nowrap"
                        >
                          Download
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
