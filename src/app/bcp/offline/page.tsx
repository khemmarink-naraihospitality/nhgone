"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { getAllowedProperties } from "@/lib/allowedProperties";

interface ReservationRow {
  number: string;
  guest: string;
  nationality: string;
  room: string;
  check_in: string;
  check_out: string;
  state: string;
  category?: string;
  adults: number;
  children: number;
}

interface RoomRow {
  room: string;
  floor: string;
  state: string;
  category?: string;
}

interface BcpSnapshot {
  property: string;
  date: string;
  captured_utc: string;
  rooms: RoomRow[];
  reservations?: ReservationRow[];
}

type Tab = "reservations" | "rooms" | "logs";

interface OfflineAction {
  at: string;
  reservationNumber: string;
  guest: string;
  room: string;
  action: "Check In" | "Check Out" | "Chg Room";
  detail: string;
}

// Same Bangkok-day trick used on /bcp's Timeline - MEWS timestamps are UTC
// instants for a Bangkok-local moment, so shifting by the fixed +7h offset
// and reading the UTC calendar fields back gives the local calendar day.
const toBangkokDay = (isoUtc: string): Date => {
  const shifted = new Date(new Date(isoUtc).getTime() + 7 * 3600_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
};
const fmtYMD = (d: Date) => d.toISOString().slice(0, 10);
const fmtDateOnly = (isoUtc: string) => {
  const d = toBangkokDay(isoUtc);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

const ROOM_STATE_BADGE_CLS: Record<string, string> = {
  Clean: "bg-sky-50 text-sky-700 border-sky-200",
  Inspected: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Dirty: "bg-amber-50 text-amber-800 border-amber-200",
  OutOfService: "bg-slate-100 text-slate-600 border-slate-300",
  OutOfOrder: "bg-red-50 text-red-700 border-red-200",
};

function statusFor(r: ReservationRow, today: string): { label: string; cls: string } | null {
  const inDay = fmtYMD(toBangkokDay(r.check_in));
  const outDay = fmtYMD(toBangkokDay(r.check_out));
  if (inDay === today) return { label: "Arrival", cls: "bg-blue-50 text-blue-700 border-blue-200" };
  if (r.state === "Started" && outDay === today) return { label: "Departure", cls: "bg-amber-50 text-amber-800 border-amber-200" };
  if (r.state === "Started") return { label: "In-house", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  return null;
}

export default function BcpOfflinePage() {
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [snapshot, setSnapshot] = useState<BcpSnapshot | null>(null);
  const [isLiveFallback, setIsLiveFallback] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("reservations");
  const [actions, setActions] = useState<OfflineAction[]>([]);
  const [regCardFor, setRegCardFor] = useState<ReservationRow | null>(null);
  const [chgRoomFor, setChgRoomFor] = useState<ReservationRow | null>(null);
  const [newRoomValue, setNewRoomValue] = useState("");

  useEffect(() => {
    (async () => {
      const { properties: names } = await getAllowedProperties();
      if (names.length > 0) {
        setProperties(names);
        setSelectedProperty(names[0]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedProperty) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const listRes = await fetch(`/api/bcp/snapshots?property_name=${encodeURIComponent(selectedProperty)}`);
        const listResult = await listRes.json();
        const newestId = listResult.status === "success" ? listResult.data?.[0]?.id : null;

        const res = newestId
          ? await fetch(`/api/bcp/snapshot?id=${encodeURIComponent(newestId)}`)
          : await fetch(`/api/bcp/live?property_name=${encodeURIComponent(selectedProperty)}`);
        const result = await res.json();
        if (result.status !== "success" || !result.data) throw new Error(result.message || "Failed to load data");
        setSnapshot(result.data);
        setIsLiveFallback(!newestId);
      } catch (err: unknown) {
        setSnapshot(null);
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedProperty]);

  // Action log persists locally per property+date so it survives a page
  // refresh during a long outage. There's nowhere real to write these back
  // to - MEWS being down is the whole premise of this page - so it's purely
  // the front desk's own paper trail to re-key into MEWS once it's back.
  const storageKey = snapshot ? `bcp_offline_actions_${snapshot.property}_${snapshot.date}` : null;
  useEffect(() => {
    if (!storageKey) {
      setActions([]);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      setActions(raw ? JSON.parse(raw) : []);
    } catch {
      setActions([]);
    }
  }, [storageKey]);

  const logAction = (entry: OfflineAction) => {
    if (!storageKey) return;
    setActions((prev) => {
      const next = [entry, ...prev];
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  const today = snapshot?.date || "";
  const rows = useMemo(() => {
    if (!snapshot?.reservations) return [];
    return snapshot.reservations
      .map((r) => ({ r, status: statusFor(r, today) }))
      .filter((x): x is { r: ReservationRow; status: { label: string; cls: string } } => x.status !== null)
      .sort((a, b) => a.r.room.localeCompare(b.r.room, undefined, { numeric: true }));
  }, [snapshot, today]);

  const rooms = useMemo(() => {
    if (!snapshot?.rooms) return [];
    return [...snapshot.rooms].sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }));
  }, [snapshot]);

  const latestActionFor = (number: string) => actions.find((a) => a.reservationNumber === number);

  const handleCheckIn = (r: ReservationRow) =>
    logAction({ at: new Date().toISOString(), reservationNumber: r.number, guest: r.guest, room: r.room, action: "Check In", detail: `Room ${r.room}` });
  const handleCheckOut = (r: ReservationRow) =>
    logAction({ at: new Date().toISOString(), reservationNumber: r.number, guest: r.guest, room: r.room, action: "Check Out", detail: `Room ${r.room}` });
  const handleChgRoomSave = () => {
    if (!chgRoomFor || !newRoomValue.trim()) return;
    logAction({
      at: new Date().toISOString(),
      reservationNumber: chgRoomFor.number,
      guest: chgRoomFor.guest,
      room: chgRoomFor.room,
      action: "Chg Room",
      detail: `${chgRoomFor.room} -> ${newRoomValue.trim()}`,
    });
    setChgRoomFor(null);
    setNewRoomValue("");
  };

  return (
    <div className="flex-1 p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
      <div className="max-w-6xl mx-auto">
        <div className="no-print">
        <PageHeader
          title="Front Desk Operations"
          description="Offline mode - a simple action list for front desk to keep processing guests from the latest cached copy while MEWS is down. Actions here are logged locally only, to be re-entered into MEWS once it's back."
        >
          <Link href="/bcp" className="text-[10px] font-bold tracked-caps text-[var(--text-primary)]/60 hover:text-[var(--text-primary)] transition-colors">
            ← Back to BCP
          </Link>
        </PageHeader>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-4 mt-8 mb-6">
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
        </div>

        {error && <div className="p-4 bg-[var(--paper)] border border-red-200 text-red-700 text-sm mb-6">{error}</div>}

        {loading ? (
          <div className="p-16 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">Loading...</div>
        ) : snapshot && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-[11px] mb-4 px-4 py-3 border bg-[var(--paper)] border-[var(--text-primary)]/14 text-[var(--text-primary)]/70">
              <span className="font-bold">{snapshot.property}</span>
              <span>Data as of: <b>{fmtTime(snapshot.captured_utc)}</b> (Asia/Bangkok)</span>
              {isLiveFallback && (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">LIVE — not stored</span>
              )}
            </div>

            <div className="flex border-b border-[var(--text-primary)]/14 mb-6">
              {(
                [
                  ["reservations", "Reservations"],
                  ["rooms", "Rooms (HK)"],
                  ["logs", `Action Logs${actions.length ? ` (${actions.length})` : ""}`],
                ] as [Tab, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-5 py-3 text-[11px] font-bold tracked-caps border-b-2 -mb-px transition-all ${
                    tab === key ? "border-[var(--text-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "reservations" && (
              <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <thead>
                    <tr className="border-b border-[var(--text-primary)]/14 bg-[var(--text-primary)]/[0.03]">
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Status</th>
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Guest Name</th>
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Dates</th>
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Room</th>
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Category</th>
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-[var(--text-primary)]/40 italic">
                          No arrivals or in-house guests for today.
                        </td>
                      </tr>
                    )}
                    {rows.map(({ r, status }) => {
                      const done = latestActionFor(r.number);
                      return (
                        <tr key={r.number} className="border-b border-[var(--text-primary)]/8 last:border-0">
                          <td className="p-3 px-4 align-top">
                            <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border rounded ${status.cls}`}>{status.label}</span>
                          </td>
                          <td className="p-3 px-4 align-top">
                            <div className="font-bold text-[13px] text-[var(--text-primary)]">{r.guest || "(no name)"}</div>
                            <div className="text-[11px] text-[var(--text-primary)]/50">{r.nationality || "-"}</div>
                            {done && <div className="text-[10px] text-emerald-700 font-bold mt-1">✓ {done.action} logged {fmtTime(done.at)}</div>}
                          </td>
                          <td className="p-3 px-4 align-top text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap">
                            {fmtDateOnly(r.check_in)} – {fmtDateOnly(r.check_out)}
                          </td>
                          <td className="p-3 px-4 align-top text-[13px] font-bold text-[var(--text-primary)]">{r.room}</td>
                          <td className="p-3 px-4 align-top text-[12px] text-[var(--text-primary)]/70">{r.category || "-"}</td>
                          <td className="p-3 px-4 align-top">
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => setRegCardFor(r)}
                                className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity"
                              >
                                Reg Card
                              </button>
                              {status.label === "Arrival" ? (
                                <button
                                  onClick={() => handleCheckIn(r)}
                                  className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-emerald-600 text-white hover:opacity-90 transition-opacity"
                                >
                                  Check In
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleCheckOut(r)}
                                  className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity"
                                >
                                  Check Out
                                </button>
                              )}
                              <button
                                onClick={() => { setChgRoomFor(r); setNewRoomValue(r.room); }}
                                className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-amber-400 text-[#152A00] hover:opacity-90 transition-opacity"
                              >
                                Chg Room
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "rooms" && (
              <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead>
                    <tr className="border-b border-[var(--text-primary)]/14 bg-[var(--text-primary)]/[0.03]">
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Floor</th>
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Room</th>
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Category</th>
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">HK Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((rm) => (
                      <tr key={rm.room} className="border-b border-[var(--text-primary)]/8 last:border-0">
                        <td className="p-3 px-4 text-[12px] text-[var(--text-primary)]/70">{rm.floor || "-"}</td>
                        <td className="p-3 px-4 text-[13px] font-bold text-[var(--text-primary)]">{rm.room}</td>
                        <td className="p-3 px-4 text-[12px] text-[var(--text-primary)]/70">{rm.category || "-"}</td>
                        <td className="p-3 px-4">
                          <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border rounded ${ROOM_STATE_BADGE_CLS[rm.state] || "bg-slate-100 text-slate-600 border-slate-300"}`}>
                            {rm.state}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "logs" && (
              <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr className="border-b border-[var(--text-primary)]/14 bg-[var(--text-primary)]/[0.03]">
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Time</th>
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Guest</th>
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Room</th>
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Action</th>
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actions.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-[var(--text-primary)]/40 italic">
                          No actions logged yet.
                        </td>
                      </tr>
                    )}
                    {actions.map((a, i) => (
                      <tr key={i} className="border-b border-[var(--text-primary)]/8 last:border-0">
                        <td className="p-3 px-4 text-[12px] whitespace-nowrap text-[var(--text-primary)]/70">{fmtTime(a.at)}</td>
                        <td className="p-3 px-4 text-[13px] font-bold text-[var(--text-primary)]">{a.guest}</td>
                        <td className="p-3 px-4 text-[13px] text-[var(--text-primary)]">{a.room}</td>
                        <td className="p-3 px-4 text-[12px] font-bold text-[var(--text-primary)]/80">{a.action}</td>
                        <td className="p-3 px-4 text-[12px] text-[var(--text-primary)]/60">{a.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="p-3 px-4 text-[10px] text-[var(--text-primary)]/40 italic border-t border-[var(--text-primary)]/8">
                  Saved on this device only — use as a reference to re-enter these actions into MEWS once it&apos;s back online.
                </div>
              </div>
            )}
          </>
        )}
        </div>

        {/* Print-only registration card - the interactive modal below is
            marked no-print (fixed-position overlays don't paginate/print
            reliably), so this plain in-flow duplicate is what actually
            prints, matching the housekeeping-sheet pattern on /bcp. */}
        {regCardFor && (
          <div className="hidden print:block text-black">
            <div className="text-lg font-bold mb-1">{snapshot?.property}</div>
            <div className="text-xs text-black/50 mb-4">Guest Registration Card</div>
            <div className="grid grid-cols-2 gap-y-2 text-sm max-w-md">
              <div className="text-black/50">Guest Name</div><div className="font-bold">{regCardFor.guest || "-"}</div>
              <div className="text-black/50">Nationality</div><div>{regCardFor.nationality || "-"}</div>
              <div className="text-black/50">Room</div><div className="font-bold">{regCardFor.room}</div>
              <div className="text-black/50">Category</div><div>{regCardFor.category || "-"}</div>
              <div className="text-black/50">Check-in</div><div>{fmtDateOnly(regCardFor.check_in)}</div>
              <div className="text-black/50">Check-out</div><div>{fmtDateOnly(regCardFor.check_out)}</div>
              <div className="text-black/50">Guests</div><div>{regCardFor.adults} adult(s), {regCardFor.children} child(ren)</div>
            </div>
            <div className="mt-6 pt-4 border-t border-black/10 text-[10px] text-black/40 italic max-w-md">
              Generated from cached BCP data while MEWS is unavailable — not a substitute for MEWS&apos;s own registration card.
            </div>
          </div>
        )}

        {regCardFor && (
          <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRegCardFor(null)}>
            <div className="bg-white text-black border border-black/10 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="p-6">
                <div className="text-lg font-bold mb-1">{snapshot?.property}</div>
                <div className="text-xs text-black/50 mb-4">Guest Registration Card</div>
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <div className="text-black/50">Guest Name</div><div className="font-bold">{regCardFor.guest || "-"}</div>
                  <div className="text-black/50">Nationality</div><div>{regCardFor.nationality || "-"}</div>
                  <div className="text-black/50">Room</div><div className="font-bold">{regCardFor.room}</div>
                  <div className="text-black/50">Category</div><div>{regCardFor.category || "-"}</div>
                  <div className="text-black/50">Check-in</div><div>{fmtDateOnly(regCardFor.check_in)}</div>
                  <div className="text-black/50">Check-out</div><div>{fmtDateOnly(regCardFor.check_out)}</div>
                  <div className="text-black/50">Guests</div><div>{regCardFor.adults} adult(s), {regCardFor.children} child(ren)</div>
                </div>
                <div className="mt-6 pt-4 border-t border-black/10 text-[10px] text-black/40 italic">
                  Generated from cached BCP data while MEWS is unavailable — not a substitute for MEWS&apos;s own registration card.
                </div>
              </div>
              <div className="flex justify-end gap-2 p-4 border-t border-black/10">
                <button onClick={() => setRegCardFor(null)} className="px-4 py-2 text-[11px] font-bold tracked-caps border border-black/20 hover:bg-black/5 transition-colors">
                  Close
                </button>
                <button onClick={() => window.print()} className="px-4 py-2 text-[11px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity">
                  Print
                </button>
              </div>
            </div>
          </div>
        )}

        {chgRoomFor && (
          <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setChgRoomFor(null)}>
            <div className="bg-[var(--paper)] text-[var(--text-primary)] border border-[var(--text-primary)]/14 max-w-sm w-full shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
              <div className="font-display text-xl mb-1">Change Room</div>
              <div className="text-[12px] text-[var(--text-primary)]/60 mb-4">{chgRoomFor.guest} — currently in {chgRoomFor.room}</div>
              <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">New Room Number</label>
              <input
                autoFocus
                value={newRoomValue}
                onChange={(e) => setNewRoomValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleChgRoomSave(); }}
                className="w-full mt-1 bg-[var(--bg-primary)] border border-[var(--text-primary)]/14 px-4 py-2 text-[13px] text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
              />
              <div className="text-[10px] text-[var(--text-primary)]/40 italic mt-2">
                This only logs the change locally — it does not move the reservation in MEWS.
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setChgRoomFor(null)} className="px-4 py-2 text-[11px] font-bold tracked-caps border border-[var(--text-primary)]/20 hover:bg-[var(--text-primary)]/5 transition-colors">
                  Cancel
                </button>
                <button onClick={handleChgRoomSave} className="px-4 py-2 text-[11px] font-bold tracked-caps bg-amber-400 text-[#152A00] hover:opacity-90 transition-opacity">
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
