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

export default function BillGeneratorPage() {
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

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
      const params = new URLSearchParams({
        property_name: selectedProperty,
        start_date: `${startDate}T00:00:00Z`,
        end_date: `${endDate}T23:59:59Z`,
      });
      const res = await fetch(`/api/bills/live?${params.toString()}`);
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.message || "Failed to fetch bills");
      setBills(result.data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredBills = useMemo(() => {
    if (!searchTerm) return bills;
    const lower = searchTerm.toLowerCase();
    return bills.filter((b) => Object.values(b).some((v) => String(v || "").toLowerCase().includes(lower)));
  }, [bills, searchTerm]);

  return (
    <div className="flex-1 p-8 bg-[#FFEFD2] font-sans h-full overflow-auto">
      <div className="max-w-7xl mx-auto">
        <PageHeader title="Bill Generator" description="Select a real MEWS bill and generate a printable Thai tax invoice/receipt from it." />

        <div className="flex flex-wrap items-end gap-x-6 gap-y-4 mt-8 mb-4">
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
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Filter records..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-[#152A00]/14 px-4 py-2 text-[13px] text-[#152A00] focus:border-[#152A00] outline-none"
            />
          </div>
        </div>

        {error ? (
          <div className="p-4 bg-white border border-red-200 text-red-700 text-sm leading-relaxed mb-6">{error}</div>
        ) : (
          <div className="bg-[#fffaf0] border border-[#152A00]/14 flex flex-col mb-8 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-max">
              <thead>
                <tr className="bg-[#152A00]/5">
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
                    <td colSpan={9} className="p-10 text-center text-[#152A00]/30 font-display text-2xl italic">Retrieving bills...</td>
                  </tr>
                ) : filteredBills.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-10 text-center text-[#152A00]/30 font-display text-2xl italic">No bills found in this range.</td>
                  </tr>
                ) : (
                  filteredBills.map((b) => (
                    <tr key={b.mews_id} className="hover:bg-[#152A00]/3 transition-colors">
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{b.Number || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{b.Type || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{b.State || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{b["Owner Name"] || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{fmtDate(b["Issued At"])}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{fmtDate(b["Due At"])}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{fmtDate(b["Paid At"])}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis">{b.Notes || "-"}</td>
                      <td className="p-2 px-3">
                        <button
                          onClick={() => window.open(`/print-bill/${b.mews_id}?property=${encodeURIComponent(selectedProperty)}`, "_blank")}
                          className="px-3 py-1 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity whitespace-nowrap"
                        >
                          Generate Bill
                        </button>
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
