"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";

interface Rr3Card {
  CardId: string;
  ReservationsNumber: string;
  HotelName: string;
  FirstName: string;
  LastName: string;
  RoomNumber: string;
  CheckIn: string;
  CheckInTime: string;
  CheckOut: string;
  CheckOutTime: string;
  NationalityName: string;
}

export default function Rr3Page() {
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [cards, setCards] = useState<Rr3Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getDefaultRange = () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return {
      start: yesterday.toISOString().split("T")[0],
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

  const fetchCards = async () => {
    if (!selectedProperty) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        property_name: selectedProperty,
        start_date: `${startDate}T00:00:00Z`,
        end_date: `${endDate}T23:59:59Z`,
      });
      const res = await fetch(`/api/rr3/cards?${params.toString()}`);
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.message || result.detail || "Failed to fetch RR3 cards");
      setCards(result.data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const printParams = () => new URLSearchParams({
    property: selectedProperty,
    start_date: `${startDate}T00:00:00Z`,
    end_date: `${endDate}T23:59:59Z`,
  });

  const handlePrintAll = () => {
    if (cards.length === 0) return;
    window.open(`/print-rr3?${printParams().toString()}`, "_blank");
  };

  const handlePrintOne = (card: Rr3Card) => {
    const params = printParams();
    params.append("card_id", card.CardId);
    window.open(`/print-rr3?${params.toString()}`, "_blank");
  };

  return (
    <div className="flex-1 p-8 bg-[#FFEFD2] font-sans h-full overflow-auto">
      <div className="max-w-7xl mx-auto">
        <PageHeader title="RR3" description="ร.ร.๓ - Thai Hotel Act lodger registration cards, generated from MEWS check-ins for a date range." />

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
          <button onClick={fetchCards} disabled={loading} className="btn-brand btn-primary h-[46px]">
            {loading ? "Loading..." : "Fetch"}
          </button>
          <button
            onClick={handlePrintAll}
            disabled={cards.length === 0}
            className="px-6 py-2 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity whitespace-nowrap h-[46px] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Print All ({cards.length})
          </button>
        </div>

        {error ? (
          <div className="p-4 bg-white border border-red-200 text-red-700 text-sm leading-relaxed mb-6">{error}</div>
        ) : (
          <div className="bg-[#fffaf0] border border-[#152A00]/14 flex flex-col mb-8 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-max">
              <thead>
                <tr className="bg-[#152A00]/5">
                  {["Reservation No.", "First Name", "Last Name", "Room", "Nationality", "Check-in", "Check-out"].map((col) => (
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
                    <td colSpan={8} className="p-10 text-center text-[#152A00]/30 font-display text-2xl italic">Retrieving guests...</td>
                  </tr>
                ) : cards.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-[#152A00]/30 font-display text-2xl italic">No guests found in this range.</td>
                  </tr>
                ) : (
                  cards.map((c) => (
                    <tr key={c.CardId} className="hover:bg-[#152A00]/3 transition-colors">
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{c.ReservationsNumber || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{c.FirstName || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{c.LastName || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{c.RoomNumber || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{c.NationalityName || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{c.CheckIn} {c.CheckInTime}</td>
                      <td className="p-2 px-3 text-[12px] text-[#152A00]/80 whitespace-nowrap">{c.CheckOut} {c.CheckOutTime}</td>
                      <td className="p-2 px-3">
                        <button
                          onClick={() => handlePrintOne(c)}
                          className="px-3 py-1 text-[10px] font-bold tracked-caps bg-white border border-[#152A00] text-[#152A00] hover:bg-[#152A00]/5 transition-colors whitespace-nowrap"
                        >
                          Print
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
