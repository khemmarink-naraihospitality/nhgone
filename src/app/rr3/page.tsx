"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { getAllowedProperties } from "@/lib/allowedProperties";
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
  IdentityCardNumber: string;
  PassportNumber: string;
  AlienBook: string;
  Occupation: string;
  AddressDetails: string;
  Telephone: string;
  Email: string;
}

const MAX_BATCH_PRINT = 100;

// Privacy: only the first 3 characters of a Thai ID/passport number are ever
// shown in this list view - the rest is masked. Full numbers are only ever
// rendered on the printed RR3 card itself, not this on-screen table.
const maskId = (v: string) => {
  if (!v) return "-";
  if (v.length <= 3) return v;
  return v.slice(0, 3) + "x".repeat(v.length - 3);
};

export default function Rr3Page() {
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [cards, setCards] = useState<Rr3Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortConfig, setSortConfig] = useState<{ key: keyof Rr3Card; direction: "asc" | "desc" } | null>(null);
  const [detailCard, setDetailCard] = useState<Rr3Card | null>(null);

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
      const res = await apiFetch(`/api/rr3/cards?${params.toString()}`);
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.message || result.detail || "Failed to fetch RR3 cards");
      setCards(result.data || []);
      setSelectedIds([]);
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

  const handleSort = (key: keyof Rr3Card) => {
    setSortConfig((prev) => {
      if (!prev || prev.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return null; // third click on the same column clears the sort
    });
  };

  const sortArrow = (key: keyof Rr3Card) => {
    if (sortConfig?.key !== key) return "↕";
    return sortConfig.direction === "asc" ? "↑" : "↓";
  };

  const sortedCards = useMemo(() => {
    if (!sortConfig) return cards;
    const { key, direction } = sortConfig;
    const dir = direction === "asc" ? 1 : -1;
    return [...cards].sort((a, b) => {
      if (key === "CheckIn" || key === "CheckOut") {
        return (new Date(a[key]).getTime() - new Date(b[key]).getTime()) * dir;
      }
      return String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * dir;
    });
  }, [cards, sortConfig]);

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    const visibleIds = sortedCards.map((c) => c.CardId);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : visibleIds);
  };

  const handlePrintSelected = () => {
    if (selectedIds.length === 0) return;
    if (selectedIds.length > MAX_BATCH_PRINT) {
      alert(`Please select ${MAX_BATCH_PRINT} guests or fewer at a time for batch printing (currently ${selectedIds.length}).`);
      return;
    }
    // Multiple ids go through a query param (?card_ids=a,b,c), not a path segment -
    // a comma in a path segment can get percent-encoded/decoded inconsistently
    // between client and server (see /print-bill's batch flow for the same fix).
    const params = printParams();
    params.append("card_ids", selectedIds.join(","));
    window.open(`/print-rr3?${params.toString()}`, "_blank");
  };

  return (
    <div className="flex-1 p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
      <div className="max-w-7xl mx-auto">
        <PageHeader title="RR3" description="ร.ร.๓ - Thai Hotel Act lodger registration cards, generated from MEWS check-ins for a date range." />

        <div className="flex flex-wrap items-end gap-x-6 gap-y-4 mt-8 mb-4">
          <div className="flex flex-col gap-2 w-full md:w-80">
            <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">Select Property</label>
            <select
              value={selectedProperty}
              onChange={(e) => setSelectedProperty(e.target.value)}
              className="w-full bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 py-2 text-[13px] appearance-none cursor-pointer text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
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
              className="w-full bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 py-1.5 text-[13px] text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
            />
          </div>
          <div className="flex flex-col gap-2 w-full md:w-48">
            <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 py-1.5 text-[13px] text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
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
          <button
            onClick={handlePrintSelected}
            disabled={selectedIds.length === 0}
            className="px-6 py-2 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 transition-colors whitespace-nowrap h-[46px] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Print Selected ({selectedIds.length})
          </button>
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
                      checked={sortedCards.length > 0 && sortedCards.every((c) => selectedIds.includes(c.CardId))}
                      onChange={toggleSelectAll}
                      className="accent-[var(--text-primary)]"
                    />
                  </th>
                  {([
                    ["ReservationsNumber", "Reservation No."],
                    ["FirstName", "First Name"],
                    ["RoomNumber", "Room"],
                    ["NationalityName", "Nationality"],
                    ["IdentityCardNumber", "Thai ID"],
                    ["PassportNumber", "Passport"],
                    ["CheckIn", "Check-in"],
                    ["CheckOut", "Check-out"],
                  ] as [keyof Rr3Card, string][]).map(([key, label]) => (
                    <th key={key} className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">
                      <button onClick={() => handleSort(key)} className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors">
                        {label} <span>{sortArrow(key)}</span>
                      </button>
                    </th>
                  ))}
                  <th className="p-2 px-3 border-b border-[var(--text-primary)]/10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--text-primary)]/5">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">Retrieving guests...</td>
                  </tr>
                ) : sortedCards.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">No guests found in this range.</td>
                  </tr>
                ) : (
                  sortedCards.map((c) => (
                    <tr key={c.CardId} className={`hover:bg-[var(--text-primary)]/3 transition-colors ${selectedIds.includes(c.CardId) ? "bg-[var(--text-primary)]/5" : ""}`}>
                      <td className="p-2 px-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(c.CardId)}
                          onChange={() => toggleSelectRow(c.CardId)}
                          className="accent-[var(--text-primary)]"
                        />
                      </td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap">{c.ReservationsNumber || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap">{c.FirstName || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap">{c.RoomNumber || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap">{c.NationalityName || "-"}</td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap font-mono">{maskId(c.IdentityCardNumber)}</td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap font-mono">{maskId(c.PassportNumber)}</td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap">{c.CheckIn} {c.CheckInTime}</td>
                      <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap">{c.CheckOut} {c.CheckOutTime}</td>
                      <td className="p-2 px-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setDetailCard(c)}
                            className="px-3 py-1 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 transition-colors whitespace-nowrap"
                          >
                            Detail
                          </button>
                          <button
                            onClick={() => handlePrintOne(c)}
                            className="px-3 py-1 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity whitespace-nowrap"
                          >
                            Print
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

        {detailCard && (
          <div
            className="fixed inset-0 bg-[var(--text-primary)]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setDetailCard(null)}
          >
            <div
              className="bg-[var(--paper)] border border-[var(--text-primary)]/14 rounded-sm w-full max-w-lg shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-[var(--text-primary)]/10 flex justify-between items-center bg-[var(--text-primary)]/5 shrink-0">
                <h2 className="text-2xl font-display text-[var(--text-primary)]">Guest Detail</h2>
                <button onClick={() => setDetailCard(null)} className="text-[var(--text-primary)]/40 hover:text-[var(--text-primary)] transition-colors">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="p-6 space-y-1 overflow-y-auto">
                {[
                  ["Reservation No.", detailCard.ReservationsNumber],
                  ["Full Name", `${detailCard.FirstName} ${detailCard.LastName}`.trim()],
                  ["Room", detailCard.RoomNumber],
                  ["Nationality", detailCard.NationalityName],
                  ["Thai ID", detailCard.IdentityCardNumber],
                  ["Passport", detailCard.PassportNumber],
                  ["Alien Book", detailCard.AlienBook],
                  ["Occupation", detailCard.Occupation],
                  ["Address", detailCard.AddressDetails],
                  ["Telephone", detailCard.Telephone],
                  ["Email", detailCard.Email],
                  ["Check-in", `${detailCard.CheckIn} ${detailCard.CheckInTime}`.trim()],
                  ["Check-out", `${detailCard.CheckOut} ${detailCard.CheckOutTime}`.trim()],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 py-2 border-b border-[var(--text-primary)]/5 last:border-0">
                    <span className="text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracked-caps shrink-0">{label}</span>
                    <span className="text-[13px] text-[var(--text-primary)] text-right break-words">{value || "-"}</span>
                  </div>
                ))}
              </div>
              <div className="p-6 pt-4 shrink-0">
                <button
                  onClick={() => setDetailCard(null)}
                  className="w-full py-3 border border-[var(--text-primary)] text-[11px] font-bold tracked-caps text-[var(--text-primary)] hover:bg-[#152A00] hover:text-[#FFEFD2] transition-all"
                >
                  CLOSE
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
