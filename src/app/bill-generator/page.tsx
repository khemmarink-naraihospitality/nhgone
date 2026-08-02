"use client";

import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { getAllowedProperties } from "@/lib/allowedProperties";
import PageHeader from "@/components/PageHeader";

interface Bill {
  mews_id: string;
  Number: string;
  Type: string;
  State: string;
  "Owner Name": string;
  "Issued At": string;
  "Net Amount": number;
  VAT: number;
  "Total Amount": number;
}

const fmtDate = (v: string) => {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")}-${months[d.getMonth()]}-${d.getFullYear()}`;
};

const fmtAmount = (v: number) =>
  typeof v === "number" ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";

const MAX_BATCH_PRINT = 100;
const MAX_BATCH_PDF = 10; // each opens its own tab; browsers cap popups per click well below MAX_BATCH_PRINT
const PAGE_SIZE = 100; // matches MAX_BATCH_PRINT so "select all" on a page never exceeds the batch-print cap
const PRINT_CHUNK_SIZE = 100; // one tab for the full selection. The "hang" that originally prompted
// 20-per-tab chunking turned out to be the billing_templates fetch failing silently (page stuck on
// "Loading template..." forever) - not print-pipeline overload - so full-batch tabs are back. If a
// selection cap above 100 is ever allowed, revisit whether one tab still prints reliably.

type DataSource = "live" | "database";

export default function BillGeneratorPage() {
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfEventIds, setPdfEventIds] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dataSource, setDataSource] = useState<DataSource>("database");
  const [page, setPage] = useState(0);
  const [billNumberFilter, setBillNumberFilter] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: keyof Bill; direction: "asc" | "desc" } | null>(null);

  const DEFAULT_PROPERTY = "Lub d Koh Tao Tanote Bay";
  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate] = useState("2025-01-31");

  useEffect(() => {
    const fetchProperties = async () => {
      // Property-restricted roles (Admin > Users > Role, "Property" column)
      // only ever get their own property back here - not every property.
      const { properties: names } = await getAllowedProperties();
      if (names.length > 0) {
        setProperties(names);
        setSelectedProperty(names.includes(DEFAULT_PROPERTY) ? DEFAULT_PROPERTY : names[0]);
      }
    };
    fetchProperties();
  }, []);

  const fetchBills = async () => {
    if (!selectedProperty) return;
    setLoading(true);
    setError(null);
    try {
      let res: Response;
      if (dataSource === "database") {
        // Data Mart: fast Supabase read of whatever's already been synced (e.g.
        // via "Import To Data Mart" or a manual backfill) - won't show bills
        // that haven't been synced for this property/range yet.
        const params = new URLSearchParams({
          property: selectedProperty,
          start_date: `${startDate}T00:00:00Z`,
          end_date: `${endDate}T23:59:59Z`,
        });
        res = await apiFetch(`/api/bills/managed?${params.toString()}`);
      } else {
        const params = new URLSearchParams({
          property_name: selectedProperty,
          start_date: `${startDate}T00:00:00Z`,
          end_date: `${endDate}T23:59:59Z`,
        });
        res = await apiFetch(`/api/bills/live?${params.toString()}`);
      }
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.message || "Failed to fetch bills");
      setBills(result.data || []);
      setSelectedIds([]);
      setPage(0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGetMewsPdf = async (bill: Bill) => {
    // Open the tab synchronously (within the click's user-gesture) so the browser
    // doesn't treat it as a popup once we redirect it after the async fetch below.
    const previewWindow = window.open("", "_blank");
    try {
      const params = new URLSearchParams({ property_name: selectedProperty });
      const existingEventId = pdfEventIds[bill.mews_id];
      if (existingEventId) params.append("bill_print_event_id", existingEventId);

      const res = await apiFetch(`/api/bills/${bill.mews_id}/pdf?${params.toString()}`);
      const result = await res.json();

      if (result.status === "success" && result.pdf_base64) {
        const byteChars = atob(result.pdf_base64);
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
        const blob = new Blob([new Uint8Array(byteNumbers)], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        if (previewWindow) {
          previewWindow.location.href = url;
        } else {
          window.open(url, "_blank");
        }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        setPdfEventIds((prev) => {
          const next = { ...prev };
          delete next[bill.mews_id];
          return next;
        });
      } else if (result.status === "pending") {
        previewWindow?.close();
        setPdfEventIds((prev) => ({ ...prev, [bill.mews_id]: result.bill_print_event_id }));
        alert("MEWS is still generating this PDF. Click \"MEWS Bill\" again in a few seconds.");
      } else {
        previewWindow?.close();
        alert("Failed to get PDF: " + (result.message || result.detail || "Unknown error"));
      }
    } catch (err: any) {
      previewWindow?.close();
      alert("Failed to get PDF: " + err.message);
    }
  };

  const handleSort = (key: keyof Bill) => {
    setSortConfig((prev) => {
      if (!prev || prev.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return null; // third click on the same column clears the sort
    });
    setPage(0);
  };

  const sortArrow = (key: keyof Bill) => {
    if (sortConfig?.key !== key) return "↕";
    return sortConfig.direction === "asc" ? "↑" : "↓";
  };

  const filteredBills = useMemo(() => {
    // Defensively drop any row without a real mews_id so a bad/missing id can
    // never end up selectable and sent to MEWS as a malformed BillIds filter.
    let result = bills.filter((b) => !!b.mews_id);

    const numberQuery = billNumberFilter.trim().toLowerCase();
    if (numberQuery) result = result.filter((b) => (b.Number || "").toLowerCase().includes(numberQuery));

    if (sortConfig) {
      const { key, direction } = sortConfig;
      const dir = direction === "asc" ? 1 : -1;
      result = [...result].sort((a, b) => {
        if (key === "Issued At") {
          return (new Date(a["Issued At"]).getTime() - new Date(b["Issued At"]).getTime()) * dir;
        }
        if (key === "Net Amount" || key === "VAT" || key === "Total Amount") {
          return ((a[key] as number || 0) - (b[key] as number || 0)) * dir;
        }
        if (key === "Number") {
          const an = parseInt(a.Number, 10);
          const bn = parseInt(b.Number, 10);
          if (!isNaN(an) && !isNaN(bn)) return (an - bn) * dir;
        }
        return String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * dir;
      });
    }

    return result;
  }, [bills, billNumberFilter, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(filteredBills.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pagedBills = useMemo(
    () => filteredBills.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
    [filteredBills, currentPage]
  );

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    // Only the current page (max PAGE_SIZE/MAX_BATCH_PRINT rows) so "select all"
    // can never exceed the batch-print cap.
    const visibleIds = pagedBills.map((b) => b.mews_id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handlePrintSelected = () => {
    if (selectedIds.length === 0) return;
    if (selectedIds.length > MAX_BATCH_PRINT) {
      alert(`Please select ${MAX_BATCH_PRINT} bills or fewer at a time for batch printing (currently ${selectedIds.length}).`);
      return;
    }
    if (selectedIds.length === 1) {
      window.open(`/print-bill/${selectedIds[0]}?property=${encodeURIComponent(selectedProperty)}`, "_blank");
      return;
    }
    // Multiple ids go through a query param (?ids=a,b,c) instead of the path segment.
    // Browsers/Next.js can percent-encode a comma in a *path* segment inconsistently
    // between client and server, silently merging split ids back together; query
    // string values are decoded reliably via the standard URLSearchParams API.
    //
    // Large selections are split into PRINT_CHUNK_SIZE-sized tabs instead of one
    // giant document - each bill's invoice can span several physical pages
    // (Original + Copy), so a single tab holding all 100 selected bills could
    // mean 300+ pages for the browser's print pipeline to lay out at once, which
    // is what was causing the page to hang.
    for (let i = 0; i < selectedIds.length; i += PRINT_CHUNK_SIZE) {
      const chunk = selectedIds.slice(i, i + PRINT_CHUNK_SIZE);
      const params = new URLSearchParams({ ids: chunk.join(","), property: selectedProperty });
      window.open(`/print-bill/batch?${params.toString()}`, "_blank");
    }
  };

  const handleGetMewsPdfSelected = () => {
    if (selectedIds.length === 0) return;
    if (selectedIds.length > MAX_BATCH_PDF) {
      alert(`MEWS Bill opens one tab per bill — please select ${MAX_BATCH_PDF} or fewer at a time (currently ${selectedIds.length}). Browsers block opening more tabs than that from a single click.`);
      return;
    }
    const selectedBills = filteredBills.filter((b) => selectedIds.includes(b.mews_id));
    selectedBills.forEach((bill) => handleGetMewsPdf(bill));
  };

  return (
    <div className="flex-1 p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
      <div className="max-w-7xl mx-auto">
        <PageHeader title="Bills" description="Select a real MEWS bill and generate a printable Thai tax invoice/receipt from it. MEWS mode reads live from MEWS; Data Mart mode reads from our own database (faster, already imported).">
          <div className="flex flex-col gap-2">
            <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">Mode</label>
            <div className="flex border border-[var(--text-primary)]/20 overflow-hidden">
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
                Data Mart
              </button>
            </div>
          </div>
        </PageHeader>

        <div className="flex flex-col gap-4 mt-8 mb-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <div className="flex flex-col gap-2 w-full md:w-80">
              <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">Select Property</label>
              <select
                value={selectedProperty}
                onChange={(e) => setSelectedProperty(e.target.value)}
                className="w-full h-[42px] bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 text-[13px] appearance-none cursor-pointer text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
              >
                {properties.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2 w-full md:w-48">
              <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full h-[42px] bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 text-[13px] text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
              />
            </div>
            <div className="flex flex-col gap-2 w-full md:w-48">
              <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full h-[42px] bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 text-[13px] text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
              />
            </div>
            <div className="flex flex-col gap-2 w-full md:w-56">
              <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">Bill Number</label>
              <input
                type="text"
                value={billNumberFilter}
                onChange={(e) => {
                  setBillNumberFilter(e.target.value);
                  setPage(0);
                }}
                placeholder="Search bill number..."
                className="w-full h-[42px] bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 text-[13px] text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
              />
            </div>
            <button onClick={fetchBills} disabled={loading} className="btn-brand btn-primary h-[42px]">
              {loading ? "Loading..." : "Fetch Bills"}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrintSelected}
              disabled={selectedIds.length === 0}
              className="px-6 py-2 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity whitespace-nowrap h-[42px] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              NHG Bill Selected ({selectedIds.length})
            </button>
            <button
              onClick={handleGetMewsPdfSelected}
              disabled={selectedIds.length === 0}
              className="px-6 py-2 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 transition-colors whitespace-nowrap h-[42px] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              MEWS Bill Selected ({selectedIds.length})
            </button>
          </div>
        </div>

        {error ? (
          <div className="p-4 bg-[var(--paper)] border border-red-200 text-red-700 text-sm leading-relaxed mb-6">{error}</div>
        ) : (
          <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 flex flex-col mb-8 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-max">
              <thead>
                <tr className="bg-[var(--text-primary)]/5">
                  <th className="p-2 px-3 border-b border-[var(--text-primary)]/10">
                    <input
                      type="checkbox"
                      checked={pagedBills.length > 0 && pagedBills.every((b) => selectedIds.includes(b.mews_id))}
                      onChange={toggleSelectAll}
                      className="accent-[var(--text-primary)]"
                    />
                  </th>
                  <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">
                    <button onClick={() => handleSort("Number")} className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors">
                      Number <span>{sortArrow("Number")}</span>
                    </button>
                  </th>
                  <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">
                    <button onClick={() => handleSort("Type")} className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors">
                      Type <span>{sortArrow("Type")}</span>
                    </button>
                  </th>
                  <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">
                    <button onClick={() => handleSort("State")} className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors">
                      State <span>{sortArrow("State")}</span>
                    </button>
                  </th>
                  <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">
                    <button onClick={() => handleSort("Owner Name")} className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors">
                      Owner Name <span>{sortArrow("Owner Name")}</span>
                    </button>
                  </th>
                  <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">
                    <button onClick={() => handleSort("Issued At")} className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors">
                      Issued At <span>{sortArrow("Issued At")}</span>
                    </button>
                  </th>
                  <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">
                    <button onClick={() => handleSort("Net Amount")} className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors ml-auto">
                      Net Amount <span>{sortArrow("Net Amount")}</span>
                    </button>
                  </th>
                  <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">
                    <button onClick={() => handleSort("VAT")} className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors ml-auto">
                      VAT <span>{sortArrow("VAT")}</span>
                    </button>
                  </th>
                  <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">
                    <button onClick={() => handleSort("Total Amount")} className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors ml-auto">
                      Total Amount <span>{sortArrow("Total Amount")}</span>
                    </button>
                  </th>
                  <th className="p-2 px-3 border-b border-[var(--text-primary)]/10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--text-primary)]/5">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">Retrieving bills...</td>
                  </tr>
                ) : filteredBills.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">No bills found in this range.</td>
                  </tr>
                ) : (
                  pagedBills.map((b) => (
                    <tr key={b.mews_id} className={`hover:bg-[var(--text-primary)]/3 transition-colors ${selectedIds.includes(b.mews_id) ? "bg-[var(--text-primary)]/5" : ""}`}>
                      <td className="p-2 px-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(b.mews_id)}
                          onChange={() => toggleSelectRow(b.mews_id)}
                          className="accent-[var(--text-primary)]"
                        />
                      </td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap">{b.Number || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap">{b.Type || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap">{b.State || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap">{b["Owner Name"] || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap">{fmtDate(b["Issued At"])}</td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap text-right">{fmtAmount(b["Net Amount"])}</td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap text-right">{fmtAmount(b.VAT)}</td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap text-right font-bold">{fmtAmount(b["Total Amount"])}</td>
                      <td className="p-2 px-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => window.open(`/print-bill/${b.mews_id}?property=${encodeURIComponent(selectedProperty)}`, "_blank")}
                            className="px-3 py-1 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity whitespace-nowrap"
                          >
                            NHG Bill
                          </button>
                          <button
                            onClick={() => handleGetMewsPdf(b)}
                            className="px-3 py-1 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 transition-colors whitespace-nowrap"
                          >
                            MEWS Bill
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {!error && filteredBills.length > 0 && (
          <div className="flex items-center justify-between mb-8 -mt-4">
            <span className="text-[11px] text-[var(--text-primary)]/50">
              Showing {currentPage * PAGE_SIZE + 1}-{Math.min((currentPage + 1) * PAGE_SIZE, filteredBills.length)} of {filteredBills.length} bills
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="px-4 py-1.5 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <span className="text-[11px] text-[var(--text-primary)]/60 whitespace-nowrap">Page {currentPage + 1} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                className="px-4 py-1.5 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
