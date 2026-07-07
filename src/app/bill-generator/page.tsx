"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";

interface Bill {
  mews_id: string;
  Number: string;
  Type: string;
  State: string;
  "Owner Name": string;
  "Issued At": string;
  "Due At": string;
  "Paid At": string;
  Notes: string;
}

const fmtDate = (v: string) => {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")}-${months[d.getMonth()]}-${d.getFullYear()}`;
};

const MAX_BATCH_PRINT = 100;
const MAX_BATCH_PDF = 10; // each opens its own tab; browsers cap popups per click well below MAX_BATCH_PRINT

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

  const getDefaultRange = () => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - 30);
    return {
      start: start.toISOString().split("T")[0],
      end: now.toISOString().split("T")[0],
    };
  };

  const initialRange = getDefaultRange();
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);

  useEffect(() => {
    const fetchProperties = async () => {
      const { data } = await supabase.from("property_api_settings").select("property_name").order("property_name");
      if (data && data.length > 0) {
        const names = data.map((p) => p.property_name);
        setProperties(names);
        setSelectedProperty(names[0]);
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
        res = await fetch(`/api/bills/managed?${params.toString()}`);
      } else {
        const params = new URLSearchParams({
          property_name: selectedProperty,
          start_date: `${startDate}T00:00:00Z`,
          end_date: `${endDate}T23:59:59Z`,
        });
        res = await fetch(`/api/bills/live?${params.toString()}`);
      }
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.message || "Failed to fetch bills");
      setBills(result.data || []);
      setSelectedIds([]);
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

      const res = await fetch(`/api/bills/${bill.mews_id}/pdf?${params.toString()}`);
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

  const filteredBills = useMemo(() => {
    // Defensively drop any row without a real mews_id so a bad/missing id can
    // never end up selectable and sent to MEWS as a malformed BillIds filter.
    return bills.filter((b) => !!b.mews_id);
  }, [bills]);

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    const visibleIds = filteredBills.map((b) => b.mews_id);
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
    const params = new URLSearchParams({ ids: selectedIds.join(","), property: selectedProperty });
    window.open(`/print-bill/batch?${params.toString()}`, "_blank");
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
    <div className="flex-1 p-8 bg-[#FFEFD2] font-sans h-full overflow-auto">
      <div className="max-w-7xl mx-auto">
        <PageHeader title="Bill Generator" description="Select a real MEWS bill and generate a printable Thai tax invoice/receipt from it.">
          <div className="flex border border-[#152A00]/20 overflow-hidden">
            <button
              onClick={() => setDataSource("live")}
              className={`px-6 py-2 text-[10px] font-bold tracked-caps transition-all ${dataSource === "live" ? "bg-[#152A00] text-[#FFEFD2]" : "text-[#152A00]/40 hover:text-[#152A00]"}`}
            >
              MEWS
            </button>
            <button
              onClick={() => setDataSource("database")}
              className={`px-6 py-2 text-[10px] font-bold tracked-caps transition-all ${dataSource === "database" ? "bg-[#152A00] text-[#FFEFD2]" : "text-[#152A00]/40 hover:text-[#152A00]"}`}
            >
              Data Mart
            </button>
          </div>
        </PageHeader>

        <div className="flex flex-col gap-4 mt-8 mb-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <div className="flex flex-col gap-2 w-full md:w-80">
              <label className="text-[9px] font-bold text-[#152A00]/50 tracked-caps ml-1">Select Property</label>
              <select
                value={selectedProperty}
                onChange={(e) => setSelectedProperty(e.target.value)}
                className="w-full bg-white border border-[#152A00]/14 px-4 py-2 text-[13px] appearance-none cursor-pointer text-[#152A00] focus:border-[#152A00] outline-none"
              >
                {properties.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2 w-full md:w-48">
              <label className="text-[9px] font-bold text-[#152A00]/50 tracked-caps ml-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-white border border-[#152A00]/14 px-4 py-1.5 text-[13px] text-[#152A00] focus:border-[#152A00] outline-none"
              />
            </div>
            <div className="flex flex-col gap-2 w-full md:w-48">
              <label className="text-[9px] font-bold text-[#152A00]/50 tracked-caps ml-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-white border border-[#152A00]/14 px-4 py-1.5 text-[13px] text-[#152A00] focus:border-[#152A00] outline-none"
              />
            </div>
            <button onClick={fetchBills} disabled={loading} className="btn-brand btn-primary h-[46px]">
              {loading ? "Loading..." : "Fetch Bills"}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrintSelected}
              disabled={selectedIds.length === 0}
              className="px-6 py-2 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity whitespace-nowrap h-[46px] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              NHG Bill Selected ({selectedIds.length})
            </button>
            <button
              onClick={handleGetMewsPdfSelected}
              disabled={selectedIds.length === 0}
              className="px-6 py-2 text-[10px] font-bold tracked-caps bg-white border border-[#152A00] text-[#152A00] hover:bg-[#152A00]/5 transition-colors whitespace-nowrap h-[46px] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              MEWS Bill Selected ({selectedIds.length})
            </button>
          </div>
        </div>

        {error ? (
          <div className="p-4 bg-white border border-red-200 text-red-700 text-sm leading-relaxed mb-6">{error}</div>
        ) : (
          <div className="bg-[#fffaf0] border border-[#152A00]/14 flex flex-col mb-8 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-max">
              <thead>
                <tr className="bg-[#152A00]/5">
                  <th className="p-2 px-3 border-b border-[#152A00]/10">
                    <input
                      type="checkbox"
                      checked={filteredBills.length > 0 && filteredBills.every((b) => selectedIds.includes(b.mews_id))}
                      onChange={toggleSelectAll}
                      className="accent-[#152A00]"
                    />
                  </th>
                  {["Number", "Type", "State", "Owner Name", "Issued At", "Due At", "Paid At", "Notes"].map((col) => (
                    <th key={col} className="p-2 px-3 text-[9px] font-bold text-[#152A00]/50 uppercase tracking-[0.12em] border-b border-[#152A00]/10 whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                  <th className="p-2 px-3 border-b border-[#152A00]/10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#152A00]/5">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="p-10 text-center text-[#152A00]/30 font-display text-2xl italic">Retrieving bills...</td>
                  </tr>
                ) : filteredBills.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-10 text-center text-[#152A00]/30 font-display text-2xl italic">No bills found in this range.</td>
                  </tr>
                ) : (
                  filteredBills.map((b) => (
                    <tr key={b.mews_id} className={`hover:bg-[#152A00]/3 transition-colors ${selectedIds.includes(b.mews_id) ? "bg-[#152A00]/5" : ""}`}>
                      <td className="p-2 px-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(b.mews_id)}
                          onChange={() => toggleSelectRow(b.mews_id)}
                          className="accent-[#152A00]"
                        />
                      </td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{b.Number || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{b.Type || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{b.State || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{b["Owner Name"] || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{fmtDate(b["Issued At"])}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{fmtDate(b["Due At"])}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{fmtDate(b["Paid At"])}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis">{b.Notes || "-"}</td>
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
                            className="px-3 py-1 text-[10px] font-bold tracked-caps bg-white border border-[#152A00] text-[#152A00] hover:bg-[#152A00]/5 transition-colors whitespace-nowrap"
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
      </div>
    </div>
  );
}
