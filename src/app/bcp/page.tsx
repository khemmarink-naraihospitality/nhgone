"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAllowedProperties } from "@/lib/allowedProperties";
import PageHeader from "@/components/PageHeader";

interface ReservationRow {
  number: string;
  guest: string;
  nationality: string;
  email: string;
  phone: string;
  room: string;
  check_in: string;
  check_out: string;
  state: string;
  adults: number;
  children: number;
  products: string[];
  notes: string;
  group_name?: string;
  category?: string;
  rate?: string;
  company?: string;
  travel_agency?: string;
  travel_agency_confirmation_number?: string;
  rate_amount?: number;
  items_amount?: number;
  rate_lines?: { label: string; amount: number }[];
  item_lines?: { label: string; amount: number }[];
  total_amount?: number | null;
  total_amount_gross?: number;
  to_be_paid?: number;
  currency?: string;
  service?: string;
  segment?: string;
  origin?: string;
  reservation_source?: string;
  purpose?: string;
  created_utc?: string;
  room_locked?: boolean;
}

interface CustomerRow {
  name: string;
  tags: string[];
  nationality: string;
  email: string;
  phone: string;
  notes: string;
}

interface PaymentRow {
  created: string;
  type: string;
  state: string;
  amount: number;
  currency: string;
  guest: string;
  reservation: string;
  notes: string;
}

interface RoomRow {
  room: string;
  floor: string;
  state: string;
  category?: string;
  category_short?: string;
  parent_room?: string;
  service?: string;
  group_category?: string;
  group_category_short?: string;
  is_child?: boolean;
}

interface BcpSnapshot {
  property: string;
  date: string;
  captured_utc: string;
  window?: { start: string; end: string };
  counts: Record<string, number>;
  rooms: RoomRow[];
  reservations?: ReservationRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
}

interface SnapshotMeta {
  id: string;
  captured_at: string;
}

type MainTab = "timeline" | "payments";

const DAY_MS = 24 * 60 * 60 * 1000;

const fmtDateTime = (v: string) => {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
};

// MEWS timestamps are UTC instants for a Bangkok-local check-in/out moment.
// Shifting by the fixed +7h offset and reading the UTC calendar fields back
// off gives the Bangkok calendar day without needing full Intl/timezone
// machinery - same trick used for the Dashboard's traffic lights.
const toBangkokDay = (isoUtc: string): Date => {
  const shifted = new Date(new Date(isoUtc).getTime() + 7 * 3600_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
};
const fmtYMD = (d: Date) => d.toISOString().slice(0, 10);
// Same +7h shift as toBangkokDay, but keeping the time-of-day instead of
// zeroing it - for the Manage view's "Wed 12:28" style check-in/out times.
const toBangkokDateTime = (isoUtc: string): Date => new Date(new Date(isoUtc).getTime() + 7 * 3600_000);
const fmtDateOnly = (isoUtc: string) => {
  const d = toBangkokDay(isoUtc);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};
const fmtWeekdayTime = (isoUtc: string) => {
  const d = toBangkokDateTime(isoUtc);
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  return `${weekday} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const guestInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((w) => w[0]).join("").toUpperCase() : "?";
};
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

const ROOM_DOT_CLS: Record<string, string> = {
  Clean: "bg-sky-500",
  Inspected: "bg-emerald-500",
  Dirty: "bg-amber-500",
  OutOfService: "bg-slate-400",
  OutOfOrder: "bg-red-500",
};

// Same housekeeping states as ROOM_DOT_CLS, styled as a solid pill instead of
// a dot - used in the Manage view's room row (matches MEWS's own colored
// "Dirty"/"Clean" badge there).
const ROOM_STATE_BADGE_CLS: Record<string, string> = {
  Clean: "bg-sky-50 text-sky-700 border-sky-200",
  Inspected: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Dirty: "bg-amber-50 text-amber-800 border-amber-200",
  OutOfService: "bg-slate-100 text-slate-600 border-slate-300",
  OutOfOrder: "bg-red-50 text-red-700 border-red-200",
};

const STATE_BADGE_CLS: Record<string, string> = {
  Confirmed: "bg-slate-100 text-slate-600 border-slate-300",
  Started: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Processed: "bg-slate-100 text-slate-500 border-slate-200",
};

// MEWS's own reservation-status wording (its Timeline bars/badges elsewhere
// in this file keep the raw state name - this is only for the Manage view,
// to match the reference screenshot's "Checked in" / "Checked out" labels).
const STATE_DISPLAY_LABEL: Record<string, string> = {
  Confirmed: "Confirmed",
  Started: "Checked in",
  Processed: "Checked out",
};

export default function BcpPage() {
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>("");
  const [snapshot, setSnapshot] = useState<BcpSnapshot | null>(null);
  const [isLiveFallback, setIsLiveFallback] = useState(false);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("timeline");
  const [showReadme, setShowReadme] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<ReservationRow | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<RoomRow | null>(null);
  const [manageTab, setManageTab] = useState<"reservation" | "group">("reservation");
  const [manageNotesOpen, setManageNotesOpen] = useState(false);
  const [rateLinesOpen, setRateLinesOpen] = useState(false);
  const [itemLinesOpen, setItemLinesOpen] = useState(false);
  const [showGuestProfile, setShowGuestProfile] = useState(false);

  // Timeline date-navigation toolbar (<< < Today > >> + space search) - pure
  // client-side scrolling of the already-rendered grid's own scroll
  // container, since the snapshot only ever contains reservations within
  // its captured window; there's no new data to fetch for these controls.
  const [focusedDate, setFocusedDate] = useState<string>("");
  const [spaceSearch, setSpaceSearch] = useState("");
  const [highlightedRoom, setHighlightedRoom] = useState<string | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const dayColRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const roomRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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

  const loadSnapshotList = async (property: string): Promise<SnapshotMeta[]> => {
    try {
      const res = await fetch(`/api/bcp/snapshots?property_name=${encodeURIComponent(property)}`);
      const result = await res.json();
      if (result.status === "success") return result.data || [];
    } catch {
      /* table may not exist yet - treated as empty history */
    }
    return [];
  };

  const loadSnapshot = async (property: string, snapshotId: string | null) => {
    setLoading(true);
    setError(null);
    setSelectedReservation(null);
    try {
      let res: Response;
      if (snapshotId) {
        res = await fetch(`/api/bcp/snapshot?id=${encodeURIComponent(snapshotId)}`);
      } else {
        // Nothing stored yet: build live from MEWS so the page still works.
        res = await fetch(`/api/bcp/live?property_name=${encodeURIComponent(property)}`);
      }
      const result = await res.json();
      if (result.status !== "success" || !result.data) {
        throw new Error(result.message || result.detail || "Failed to load BCP snapshot");
      }
      setSnapshot(result.data);
      setIsLiveFallback(!snapshotId);
    } catch (err: any) {
      setSnapshot(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Property change: refresh history, auto-open the newest stored snapshot
  // (or live fallback when none exist yet).
  useEffect(() => {
    if (!selectedProperty) return;
    (async () => {
      const list = await loadSnapshotList(selectedProperty);
      setSnapshots(list);
      const newest = list[0]?.id || "";
      setSelectedSnapshotId(newest);
      await loadSnapshot(selectedProperty, newest || null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProperty]);

  const handlePickSnapshot = async (id: string) => {
    setSelectedSnapshotId(id);
    await loadSnapshot(selectedProperty, id || null);
  };

  const handleCapture = async () => {
    if (!selectedProperty) return;
    setCapturing(true);
    setError(null);
    try {
      const res = await fetch(`/api/bcp/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_name: selectedProperty }),
      });
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.message || result.detail || "Capture failed");
      const list = await loadSnapshotList(selectedProperty);
      setSnapshots(list);
      const newest = list[0]?.id || "";
      setSelectedSnapshotId(newest);
      await loadSnapshot(selectedProperty, newest || null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCapturing(false);
    }
  };

  const ageMinutes = snapshot ? Math.round((Date.now() - new Date(snapshot.captured_utc).getTime()) / 60000) : 0;
  const stale = ageMinutes > 120;
  // Snapshots captured before this Timeline rewrite lack window/reservations
  // entirely - guard rather than crash; they age out within 48h (prune job).
  const isLegacyShape = !!snapshot && (!snapshot.window || !snapshot.reservations);

  const windowDays = useMemo(() => {
    if (!snapshot?.window) return [];
    const start = new Date(snapshot.window.start + "T00:00:00Z");
    const end = new Date(snapshot.window.end + "T00:00:00Z");
    const n = daysBetween(start, end) + 1;
    return Array.from({ length: n }, (_, i) => new Date(start.getTime() + i * DAY_MS));
  }, [snapshot?.window]);

  const roomIndexByName = useMemo(() => {
    const m = new Map<string, number>();
    (snapshot?.rooms || []).forEach((r, i) => m.set(r.room, i));
    return m;
  }, [snapshot?.rooms]);

  // Vertical category-group labels for the room column (e.g. "The Duo |
  // King"). Grouped by `group_category`, not `category`: a parent room and
  // its nested children (e.g. room 210 sold whole vs. its individual beds
  // 211-219 sold separately) share the parent's category label as one
  // section even though the children's own `category` differs - matching
  // MEWS's own Timeline. Rooms already arrive pre-sorted/pre-nested from the
  // backend, so a contiguous same-group_category run is just one group -
  // blank categories (no assignment on that resource) are skipped rather
  // than drawn as an empty label.
  const roomCategoryGroups = useMemo(() => {
    const rooms = snapshot?.rooms || [];
    const groups: { category: string; shortLabel: string; startIdx: number; count: number }[] = [];
    rooms.forEach((r, i) => {
      const cat = r.group_category ?? r.category ?? "";
      const last = groups[groups.length - 1];
      if (last && last.category === cat) {
        last.count++;
      } else {
        // The full category name is often too long to read comfortably in
        // this narrow vertical strip (e.g. "1 BED IN OUR TRIBE HIDEOUT
        // (8-SHARED-BEDS)") - use MEWS's own short code there instead,
        // falling back to the full name for categories with none configured.
        const shortLabel = r.group_category_short || r.category_short || cat;
        groups.push({ category: cat, shortLabel, startIdx: i, count: 1 });
      }
    });
    return groups.filter((g) => g.category);
  }, [snapshot?.rooms]);

  // Each reservation positioned as a grid bar: column = nights within the
  // visible window, clipped at both edges for stays that start before or
  // end after it. Checkout day itself isn't occupied, so the bar ends at
  // the start of that column, not inside it.
  const bars = useMemo(() => {
    if (!snapshot?.reservations || windowDays.length === 0) return [];
    const windowStart = windowDays[0];
    const totalDays = windowDays.length;
    return snapshot.reservations
      .map((res) => {
        const roomIdx = roomIndexByName.get(res.room);
        if (roomIdx === undefined) return null;
        const inDay = toBangkokDay(res.check_in);
        const outDay = toBangkokDay(res.check_out);
        let startIdx = daysBetween(windowStart, inDay);
        let endIdx = daysBetween(windowStart, outDay);
        if (endIdx <= startIdx) endIdx = startIdx + 1;
        const clippedStart = Math.max(0, startIdx);
        const clippedEnd = Math.min(totalDays, endIdx);
        if (clippedEnd <= clippedStart) return null;
        return { res, roomIdx, colStart: clippedStart + 4, colSpan: clippedEnd - clippedStart };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
  }, [snapshot?.reservations, windowDays, roomIndexByName]);

  const todayStats = useMemo(() => {
    if (!snapshot?.reservations) return { arrivals: 0, departures: 0, inHouse: 0 };
    const today = snapshot.date;
    let arrivals = 0, departures = 0, inHouse = 0;
    for (const r of snapshot.reservations) {
      const inDay = fmtYMD(toBangkokDay(r.check_in));
      const outDay = fmtYMD(toBangkokDay(r.check_out));
      if (inDay === today) arrivals++;
      if (outDay === today) departures++;
      if (r.state === "Started" && outDay !== today) inHouse++;
    }
    return { arrivals, departures, inHouse };
  }, [snapshot?.reservations, snapshot?.date]);

  // Today's occupant/arriving/departing per room, for the printable sheet -
  // derived from the timeline reservations instead of separate server fields.
  const housekeepingRows = useMemo(() => {
    if (!snapshot) return [];
    const today = snapshot.date;
    const occupant = new Map<string, string>();
    const arriving = new Map<string, string>();
    const departing = new Map<string, string>();
    for (const r of snapshot.reservations || []) {
      if (!r.room) continue;
      const inDay = fmtYMD(toBangkokDay(r.check_in));
      const outDay = fmtYMD(toBangkokDay(r.check_out));
      if (r.state === "Started" && outDay !== today) occupant.set(r.room, r.guest);
      if (inDay === today) arriving.set(r.room, r.guest);
      if (outDay === today) departing.set(r.room, r.guest);
    }
    return snapshot.rooms.map((room) => ({
      ...room,
      occupant: occupant.get(room.room) || "",
      arriving: arriving.get(room.room) || "",
      departing: departing.get(room.room) || "",
    }));
  }, [snapshot]);

  const matchedGuestProfile = useMemo(() => {
    if (!selectedReservation || !snapshot) return null;
    return snapshot.customers.find(
      (c) => (selectedReservation.email && c.email === selectedReservation.email) || c.name === selectedReservation.guest
    ) || null;
  }, [selectedReservation, snapshot]);
  const guestProfileNotes = matchedGuestProfile?.notes || "";

  // For the "Manage" detail view: the assigned room's today HK status
  // (joined from the room list) and the stay length, both absent from
  // ReservationRow itself.
  const selectedRoomInfo = useMemo(() => {
    if (!selectedReservation || !snapshot) return null;
    return snapshot.rooms.find((r) => r.room === selectedReservation.room) || null;
  }, [selectedReservation, snapshot]);

  const selectedNights = useMemo(() => {
    if (!selectedReservation) return 0;
    const inDay = toBangkokDay(selectedReservation.check_in);
    const outDay = toBangkokDay(selectedReservation.check_out);
    return Math.max(1, daysBetween(inDay, outDay));
  }, [selectedReservation]);

  // Reset the toolbar's focused date to "today" whenever a different
  // snapshot loads (new property or a different capture picked from history).
  useEffect(() => {
    if (snapshot?.date) setFocusedDate(snapshot.date);
  }, [snapshot?.property, snapshot?.captured_utc]);

  // Scrolls only the grid's own scroll container (never the outer page) by
  // setting scrollLeft/scrollTop directly - scrollIntoView() was cascading
  // up to the page's own scroll container too, jumping the whole page.
  const LEFT_COLS_WIDTH = 28 + 70 + 90; // category strip + parent/child room-number sticky columns

  const scrollToDate = (dateStr: string) => {
    const container = timelineScrollRef.current;
    const target = dayColRefs.current.get(dateStr);
    if (!container || !target) return;
    container.scrollTo({ left: Math.max(0, target.offsetLeft - LEFT_COLS_WIDTH), behavior: "smooth" });
  };

  const scrollToRoom = (roomName: string) => {
    const container = timelineScrollRef.current;
    const target = roomRowRefs.current.get(roomName);
    if (!container || !target) return;
    const top = target.offsetTop - container.clientHeight / 2 + target.offsetHeight / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };

  const clampToWindow = (dateStr: string) => {
    if (!snapshot?.window) return dateStr;
    if (dateStr < snapshot.window.start) return snapshot.window.start;
    if (dateStr > snapshot.window.end) return snapshot.window.end;
    return dateStr;
  };

  const shiftFocusedDate = (deltaDays: number) => {
    if (!focusedDate) return;
    const d = new Date(focusedDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + deltaDays);
    const next = clampToWindow(fmtYMD(d));
    setFocusedDate(next);
    scrollToDate(next);
  };

  const goToWindowStart = () => {
    if (!snapshot?.window) return;
    setFocusedDate(snapshot.window.start);
    scrollToDate(snapshot.window.start);
  };
  const goToWindowEnd = () => {
    if (!snapshot?.window) return;
    setFocusedDate(snapshot.window.end);
    scrollToDate(snapshot.window.end);
  };
  const goToToday = () => {
    if (!snapshot?.date) return;
    setFocusedDate(snapshot.date);
    scrollToDate(snapshot.date);
  };
  const handleSpaceSearch = () => {
    const query = spaceSearch.trim().toLowerCase();
    if (!query || !snapshot) return;
    const match = snapshot.rooms.find((r) => r.room.toLowerCase().includes(query));
    if (!match) return;
    setHighlightedRoom(match.room);
    scrollToRoom(match.room);
    setTimeout(() => setHighlightedRoom((cur) => (cur === match.room ? null : cur)), 1500);
  };

  const paymentTable = (rows: PaymentRow[]) => (
    <table className="w-full text-left border-collapse min-w-max">
      <thead>
        <tr className="bg-[var(--text-primary)]/5">
          <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">Time</th>
          <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">Guest</th>
          <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">Res No.</th>
          <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">Type</th>
          <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">State</th>
          <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap text-right">Amount</th>
          <th className="p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap">Notes</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--text-primary)]/5">
        {rows.length === 0 ? (
          <tr><td colSpan={7} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">None for this date.</td></tr>
        ) : rows.map((p, i) => (
          <tr key={p.created + i} className="hover:bg-[var(--text-primary)]/[0.02]">
            <td className="p-2 px-3 text-[13px] text-[var(--text-primary)] whitespace-nowrap align-top">{fmtDateTime(p.created)}</td>
            <td className="p-2 px-3 text-[13px] text-[var(--text-primary)] whitespace-nowrap align-top">{p.guest || "-"}</td>
            <td className="p-2 px-3 text-[13px] text-[var(--text-primary)] whitespace-nowrap align-top">{p.reservation || "-"}</td>
            <td className="p-2 px-3 text-[13px] text-[var(--text-primary)] whitespace-nowrap align-top">{p.type}</td>
            <td className="p-2 px-3 text-[13px] text-[var(--text-primary)] whitespace-nowrap align-top">{p.state}</td>
            <td className="p-2 px-3 text-[13px] text-[var(--text-primary)] whitespace-nowrap align-top text-right font-bold">{p.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} {p.currency}</td>
            <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 max-w-[240px]">{p.notes || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="flex-1 p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
      <div className="max-w-7xl mx-auto">
        <div className="no-print">
        <PageHeader title="BCP" description="Mews Business Continuity Plan - snapshots (captured every 5 minutes) of a 15-day reservation timeline, payments and room status, so the front desk can keep operating from the latest copy if MEWS goes down." />
        <button
          onClick={() => setShowReadme(true)}
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold tracked-caps border border-[var(--text-primary)]/30 text-[var(--text-primary)]/70 hover:text-[var(--text-primary)] hover:border-[var(--text-primary)] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          Read Me
        </button>

        {showReadme && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowReadme(false)}>
            <div
              className="bg-[var(--paper)] text-[var(--text-primary)] border border-[var(--text-primary)]/14 max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-[var(--paper)] border-b border-[var(--text-primary)]/10 px-6 py-4 flex items-center justify-between">
                <div className="font-display text-2xl">BCP คืออะไร / วิธีใช้งาน</div>
                <button onClick={() => setShowReadme(false)} className="p-1 text-[var(--text-primary)]/50 hover:text-[var(--text-primary)] transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="px-6 py-5 text-[13px] leading-relaxed flex flex-col gap-4">
                <div>
                  <div className="font-bold mb-1">BCP (Business Continuity Plan) คืออะไร</div>
                  <p>ระบบสำรองข้อมูลหน้าฟร้อนท์สำหรับกรณี <b>MEWS ล่ม</b> — ระบบจะเก็บสำเนา timeline การจอง 15 วัน (ย้อนหลัง 7 วัน + ล่วงหน้า 7 วัน) จาก MEWS <b>อัตโนมัติทุก 5 นาที</b> (เก็บย้อนหลัง 48 ชั่วโมงล่าสุดต่อโรงแรม) พร้อมสถานะห้องแม่บ้านและรายการชำระเงินวันนี้</p>
                </div>
                <div>
                  <div className="font-bold mb-1">การใช้งานปกติ (MEWS ยังใช้ได้)</div>
                  <p>ไม่ต้องทำอะไร — ระบบเก็บ snapshot ให้เองทุก 5 นาที หากต้องการสำเนาล่าสุดเดี๋ยวนั้น กดปุ่ม <b>Capture Now</b> ได้เลย และเลือกดูสำเนาย้อนหลังได้จากช่อง <b>Snapshot</b></p>
                </div>
                <div>
                  <div className="font-bold mb-1">เมื่อ MEWS ล่ม ให้ทำตามนี้</div>
                  <ol className="list-decimal list-inside flex flex-col gap-1">
                    <li>เปิดหน้านี้ เลือกโรงแรม แล้วเลือก <b>snapshot ล่าสุด</b> (ดูเวลา &quot;Data as of&quot; ประกอบ — ถ้าเก่ากว่า 2 ชม. ระบบจะเตือนสีส้ม)</li>
                    <li>ดูตาราง <b>Timeline</b> เหมือนหน้า MEWS ปกติ — คลิกที่แถบการจองเพื่อดูรายละเอียดแขก/โน้ต: ถ่ายรูปพาสปอร์ต / สแกนเอกสารเก็บเข้าคอมไว้ก่อน แล้วลงทะเบียนผ่านกระดาษ / PDF บน iPad แทน</li>
                    <li>ดูจุดสีหน้าเลขห้องเพื่อประสานแม่บ้านว่าให้แขกเข้าห้องไหน — กดปุ่ม <b>Print Housekeeping Sheet</b> พิมพ์ใบงานแจกแม่บ้าน (มีช่อง Cleaned ✓ ให้ติ๊กบนกระดาษ)</li>
                    <li>การเงิน: ชาร์จ Payment ไว้ก่อนได้ แต่<b>ยังตัดจ่ายไม่ได้</b>จนกว่า MEWS จะกลับมา — ใช้แท็บ <b>Payments</b> เทียบรายการที่เข้าแล้ววันนี้</li>
                    <li><b>จดบันทึกทุกรายการ</b>ที่ทำระหว่าง MEWS ล่ม (เช็คอิน/เช็คเอาท์/ย้ายห้อง/ชาร์จเงิน) ลงกระดาษหรือไฟล์ Activity report ของสาขา</li>
                    <li>เมื่อ MEWS กลับมาใช้ได้: นำบันทึกทั้งหมดไปคีย์ย้อนเข้า MEWS ให้ครบ (สาขาที่มี AdriaScan ใช้สแกนเอกสารเข้า MEWS ได้เลย)</li>
                  </ol>
                </div>
                <div>
                  <div className="font-bold mb-1">ข้อควรรู้</div>
                  <ul className="list-disc list-inside flex flex-col gap-1">
                    <li>ข้อมูลในหน้านี้เป็น &quot;สำเนา ณ เวลาที่เก็บ&quot; ไม่ใช่ข้อมูลสด — ป้าย <b>LIVE</b> สีเขียวจะขึ้นเฉพาะตอนที่ระบบดึงสดจาก MEWS ได้ (แปลว่า MEWS ยังไม่ล่ม)</li>
                    <li>Vouch kiosk เช็คอินผ่าน MEWS — ถ้า MEWS ล่ม ให้ถือว่า kiosk ใช้ไม่ได้ไปด้วย</li>
                    <li>หาก MEWS ล่มนานข้ามชั่วโมง snapshot จะไม่อัปเดตเพิ่ม (เก็บไม่ได้เพราะต้นทางล่ม) — ใช้อันล่าสุดที่มีเป็นหลัก</li>
                  </ul>
                </div>
                <div className="pt-2 border-t border-[var(--text-primary)]/10 flex justify-end">
                  <button onClick={() => setShowReadme(false)} className="btn-brand btn-primary">ปิด</button>
                </div>
              </div>
            </div>
          </div>
        )}

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
          <div className="flex flex-col gap-2 w-full md:w-72">
            <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">Snapshot</label>
            <select
              value={selectedSnapshotId}
              onChange={(e) => handlePickSnapshot(e.target.value)}
              className="w-full bg-[var(--paper)] border border-[var(--text-primary)]/14 px-4 py-2 text-[13px] appearance-none cursor-pointer text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none"
            >
              {snapshots.length === 0 && <option value="">Live (no stored snapshots yet)</option>}
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>{fmtDateTime(s.captured_at)}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleCapture}
            disabled={capturing || !selectedProperty}
            className="btn-brand btn-primary h-[46px] disabled:opacity-60"
          >
            {capturing ? "Capturing..." : "Capture Now"}
          </button>
        </div>

        {error && (
          <div className="p-4 bg-[var(--paper)] border border-red-200 text-red-700 text-sm leading-relaxed mb-6">{error}</div>
        )}
        </div>

        {loading ? (
          <div className="p-16 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">Loading snapshot...</div>
        ) : isLegacyShape ? (
          <div className="p-16 text-center text-[var(--text-primary)]/40 font-display text-xl italic border border-dashed border-[var(--text-primary)]/14">
            This snapshot predates the Timeline view — please Capture Now, or pick a newer one.
          </div>
        ) : snapshot && (
          <>
            <div className={`no-print flex flex-wrap items-center gap-3 text-[11px] mb-4 px-4 py-3 border ${
              stale && !isLiveFallback
                ? "bg-amber-50 border-amber-300 text-amber-800"
                : "bg-[var(--paper)] border-[var(--text-primary)]/14 text-[var(--text-primary)]/70"
            }`}>
              <span className="font-bold">{snapshot.property}</span>
              <span>Data as of: <b>{fmtDateTime(snapshot.captured_utc)}</b> (Asia/Bangkok)</span>
              {isLiveFallback ? (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">LIVE — not stored</span>
              ) : (
                <span>({ageMinutes < 60 ? `${ageMinutes} min ago` : `${Math.floor(ageMinutes / 60)} h ${ageMinutes % 60} min ago`})</span>
              )}
              {stale && !isLiveFallback && <span className="font-bold">⚠ Snapshot is over 2 hours old</span>}
            </div>

            <div className="no-print flex flex-wrap items-center justify-between gap-4 mb-4">
              <div className="flex border-b border-[var(--text-primary)]/14">
                {(["timeline", "payments"] as MainTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setMainTab(t)}
                    className={`px-5 py-3 text-[11px] font-bold tracked-caps border-b-2 -mb-px transition-all capitalize ${
                      mainTab === t
                        ? "border-[var(--text-primary)] text-[var(--text-primary)]"
                        : "border-transparent text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {t === "timeline" ? `Timeline (${snapshot.window?.start} – ${snapshot.window?.end})` : `Payments (${snapshot.counts.payments})`}
                  </button>
                ))}
              </div>
              {mainTab === "timeline" && (
                <div className="flex items-center gap-4 text-[10px] font-bold tracked-caps text-[var(--text-primary)]/60">
                  <span>Arrivals today: {todayStats.arrivals}</span>
                  <span>Departures today: {todayStats.departures}</span>
                  <span>In-house today: {todayStats.inHouse}</span>
                  <button onClick={() => window.print()} className="px-4 py-2 bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity">
                    Print Housekeeping Sheet
                  </button>
                </div>
              )}
            </div>

            {mainTab === "timeline" && snapshot.window && (
              <div className="no-print flex flex-wrap items-center gap-2 mb-4 p-2 border border-[var(--text-primary)]/14 bg-[var(--paper)]">
                <input
                  type="text"
                  value={spaceSearch}
                  onChange={(e) => setSpaceSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSpaceSearch(); }}
                  placeholder="Search space (press Enter)"
                  className="px-3 py-2 text-[12px] border border-[var(--text-primary)]/20 bg-transparent w-44 focus:outline-none focus:border-[var(--text-primary)]/50 placeholder:text-[var(--text-primary)]/40"
                />
                <div className="flex items-center border border-[var(--text-primary)]/20 divide-x divide-[var(--text-primary)]/20">
                  <button onClick={goToWindowStart} title={`First day with data (${snapshot.window.start})`} className="px-3 py-2 text-[14px] font-bold hover:bg-[var(--text-primary)]/5 transition-colors">«</button>
                  <button onClick={() => shiftFocusedDate(-1)} title="Previous day" className="px-3 py-2 text-[14px] font-bold hover:bg-[var(--text-primary)]/5 transition-colors">‹</button>
                  <button onClick={goToToday} title="Today" className="px-4 py-2 text-[10px] font-bold tracked-caps hover:bg-[var(--text-primary)]/5 transition-colors">Today</button>
                  <button onClick={() => shiftFocusedDate(1)} title="Next day" className="px-3 py-2 text-[14px] font-bold hover:bg-[var(--text-primary)]/5 transition-colors">›</button>
                  <button onClick={goToWindowEnd} title={`Last day with data (${snapshot.window.end})`} className="px-3 py-2 text-[14px] font-bold hover:bg-[var(--text-primary)]/5 transition-colors">»</button>
                </div>
              </div>
            )}

            {mainTab === "timeline" ? (
              <div ref={timelineScrollRef} className="bg-[var(--paper)] border border-[var(--text-primary)]/14 mb-8 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-auto max-h-[70vh]">
                <div
                  className="grid relative"
                  style={{ gridTemplateColumns: `28px 70px 90px repeat(${windowDays.length}, 84px)` }}
                >
                  {/* Header row */}
                  <div className="sticky top-0 left-0 z-30 bg-[color-mix(in_srgb,var(--paper),var(--text-primary)_10%)] border-b border-r border-[var(--text-primary)]/10" style={{ gridColumn: 1, gridRow: 1 }}></div>
                  <div className="sticky top-0 left-[28px] z-20 bg-[color-mix(in_srgb,var(--paper),var(--text-primary)_10%)] border-b border-r border-[var(--text-primary)]/10 p-2 text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps" style={{ gridColumn: "2 / span 2", gridRow: 1 }}>
                    Room
                  </div>
                  {windowDays.map((d, i) => {
                    const dateStr = fmtYMD(d);
                    const isToday = dateStr === snapshot.date;
                    // Focused-but-not-today still needs its own visible cue -
                    // on wide enough screens the whole window already fits on
                    // screen, so a nav click has nothing to scroll to; this
                    // highlight is what actually shows the click did something.
                    const isFocused = !isToday && dateStr === focusedDate;
                    return (
                      <div
                        key={i}
                        ref={(el) => { if (el) dayColRefs.current.set(dateStr, el); else dayColRefs.current.delete(dateStr); }}
                        className={`sticky top-0 z-10 border-b border-[var(--text-primary)]/10 p-2 text-[10px] font-bold text-center whitespace-nowrap ${
                          isToday
                            ? "bg-amber-100 text-amber-900"
                            : isFocused
                            ? "bg-[var(--text-primary)]/20 text-[var(--text-primary)]"
                            : "bg-[color-mix(in_srgb,var(--paper),var(--text-primary)_10%)] text-[var(--text-primary)]/70"
                        }`}
                        style={{ gridColumn: i + 4, gridRow: 1 }}
                      >
                        {d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} {d.getUTCDate()}
                      </div>
                    );
                  })}

                  {/* Room-category group labels (e.g. "The Duo | King"),
                      matching MEWS's own vertical grouping strip. Uses the
                      short code (title = full name, on hover) since long
                      category names don't fit legibly in this narrow strip. */}
                  {roomCategoryGroups.map((g, i) => (
                    <div
                      key={"cat" + i}
                      title={g.category}
                      className="sticky left-0 z-10 bg-[var(--paper)] border-b border-r border-[var(--text-primary)]/10 flex items-center justify-center overflow-hidden"
                      style={{ gridColumn: 1, gridRow: `${g.startIdx + 2} / span ${g.count}` }}
                    >
                      <span
                        className="text-[10px] font-bold text-[var(--text-primary)]/60 whitespace-nowrap"
                        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                      >
                        {g.shortLabel}
                      </span>
                    </div>
                  ))}

                  {/* Room-number columns, split into two like MEWS's own
                      Timeline: a "parent" column (standalone rooms and
                      whole-space buyouts, e.g. room 210) and a "child"
                      column (its individual sold-separately sub-resources,
                      e.g. beds 211-219) - only one of the two is non-empty
                      per row. The Search-space ref and click-to-open-Room-
                      Properties handler live on whichever cell actually
                      shows that room's number. */}
                  {snapshot.rooms.map((room, i) => (
                    <div
                      key={"parentcol" + room.room + i}
                      ref={room.is_child ? undefined : (el) => { if (el) roomRowRefs.current.set(room.room, el); else roomRowRefs.current.delete(room.room); }}
                      onClick={room.is_child ? undefined : () => setSelectedRoom(room)}
                      title={!room.is_child ? (room.category ? `Room ${room.room}\n${room.category}` : `Room ${room.room}`) : undefined}
                      className={`sticky left-[28px] z-10 border-b border-r border-[var(--text-primary)]/10 p-2 text-[12px] font-bold text-[var(--text-primary)] flex items-center gap-2 whitespace-nowrap transition-colors ${!room.is_child ? "cursor-pointer hover:bg-[var(--text-primary)]/5" : ""} ${highlightedRoom === room.room ? "bg-amber-200" : "bg-[var(--paper)]"}`}
                      style={{ gridColumn: 2, gridRow: i + 2 }}
                    >
                      {!room.is_child && (
                        <>
                          <span className={`w-2 h-2 rounded-full shrink-0 ${ROOM_DOT_CLS[room.state] || "bg-slate-300"}`} title={room.state}></span>
                          <span className="underline decoration-1 underline-offset-2">{room.room}</span>
                        </>
                      )}
                    </div>
                  ))}
                  {snapshot.rooms.map((room, i) => (
                    <div
                      key={"childcol" + room.room + i}
                      ref={room.is_child ? (el) => { if (el) roomRowRefs.current.set(room.room, el); else roomRowRefs.current.delete(room.room); } : undefined}
                      onClick={room.is_child ? () => setSelectedRoom(room) : undefined}
                      title={room.is_child ? (room.category ? `Room ${room.room}\n${room.category}` : `Room ${room.room}`) : undefined}
                      className={`sticky left-[98px] z-10 border-b border-r border-[var(--text-primary)]/10 p-2 text-[12px] text-[var(--text-primary)] flex items-center gap-2 whitespace-nowrap transition-colors ${room.is_child ? "cursor-pointer hover:bg-[var(--text-primary)]/5" : ""} ${highlightedRoom === room.room ? "bg-amber-200" : "bg-[var(--paper)]"}`}
                      style={{ gridColumn: 3, gridRow: i + 2 }}
                    >
                      {room.is_child && (
                        <>
                          <span className={`w-2 h-2 rounded-full shrink-0 ${ROOM_DOT_CLS[room.state] || "bg-slate-300"}`} title={room.state}></span>
                          <span>{room.room}</span>
                        </>
                      )}
                    </div>
                  ))}
                  {snapshot.rooms.map((room, i) => (
                    <div
                      key={"strip" + i}
                      className={`border-b border-[var(--text-primary)]/10 transition-colors ${highlightedRoom === room.room ? "bg-amber-100" : ""}`}
                      style={{
                        gridColumn: `4 / span ${windowDays.length}`,
                        gridRow: i + 2,
                        backgroundImage: `repeating-linear-gradient(to right, transparent, transparent calc(100%/${windowDays.length} - 1px), rgba(128,128,128,0.08) calc(100%/${windowDays.length} - 1px), rgba(128,128,128,0.08) calc(100%/${windowDays.length}))`,
                      }}
                    ></div>
                  ))}

                  {/* Reservation bars */}
                  {bars.map(({ res, roomIdx, colStart, colSpan }, i) => {
                    const started = res.state === "Started";
                    const cls = STATE_BADGE_CLS[res.state] || STATE_BADGE_CLS.Processed;
                    return (
                      <button
                        key={res.number + i}
                        onClick={() => { setSelectedReservation(res); setManageTab("reservation"); setManageNotesOpen(false); setShowGuestProfile(false); setRateLinesOpen(false); setItemLinesOpen(false); }}
                        className={`m-1 px-2 py-1 text-[11px] font-bold text-left truncate rounded border transition-all hover:brightness-95 flex items-center gap-1 ${cls} ${started ? "shadow-sm" : "border-dashed"}`}
                        style={{ gridColumn: `${colStart} / span ${colSpan}`, gridRow: roomIdx + 2, zIndex: 5 }}
                        title={`${res.guest} — ${res.state}${res.room_locked ? " (room locked)" : ""}`}
                      >
                        {res.room_locked && (
                          <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                        )}
                        <span className="truncate">{res.guest || "(no name)"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 mb-8 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-x-auto p-4">
                {paymentTable(snapshot.payments)}
              </div>
            )}

            {/* Print-only housekeeping sheet - not the on-screen Timeline grid,
                which doesn't paginate; a plain table prints reliably instead. */}
            <div className="hidden print:block">
              <div className="mb-4 text-black">
                <div className="text-lg font-bold">Housekeeping Room Status — {snapshot.property}</div>
                <div className="text-sm">Data as of: {fmtDateTime(snapshot.captured_utc)} (Asia/Bangkok) — Sign: ____________________</div>
              </div>
              <table className="w-full text-left border-collapse min-w-max">
                <thead>
                  <tr>
                    <th className="p-2 px-3 text-[9px] font-bold uppercase tracking-[0.12em] border-b">Floor</th>
                    <th className="p-2 px-3 text-[9px] font-bold uppercase tracking-[0.12em] border-b">Room</th>
                    <th className="p-2 px-3 text-[9px] font-bold uppercase tracking-[0.12em] border-b">HK Status</th>
                    <th className="p-2 px-3 text-[9px] font-bold uppercase tracking-[0.12em] border-b">Occupant</th>
                    <th className="p-2 px-3 text-[9px] font-bold uppercase tracking-[0.12em] border-b">Arriving Today</th>
                    <th className="p-2 px-3 text-[9px] font-bold uppercase tracking-[0.12em] border-b">Departing Today</th>
                    <th className="p-2 px-3 text-[9px] font-bold uppercase tracking-[0.12em] border-b">Cleaned ✓</th>
                  </tr>
                </thead>
                <tbody>
                  {housekeepingRows.map((r, i) => (
                    <tr key={r.room + i}>
                      <td className="p-2 px-3 text-[13px]">{r.floor || "-"}</td>
                      <td className="p-2 px-3 text-[13px] font-bold">{r.room}</td>
                      <td className="p-2 px-3 text-[13px]">{r.state}</td>
                      <td className="p-2 px-3 text-[13px]">{r.occupant || "-"}</td>
                      <td className="p-2 px-3 text-[13px]">{r.arriving || "-"}</td>
                      <td className="p-2 px-3 text-[13px]">{r.departing || "-"}</td>
                      <td className="p-2 px-3 text-[13px]">☐</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Reservation detail panel - mirrors MEWS's own reservation popup
            directly (Reservation/Group tabs, boxed stay+room+notes and guest
            sections, colored status/housekeeping badges). Read-only: no
            Billing/Payments/Unlock/kiosk actions and no Cancellation form,
            since there is nothing live to action from a stale snapshot and
            canceled reservations are excluded from the snapshot query in the
            first place - the "Manage" button is disabled for the same
            reason, kept only because MEWS's own equivalent screen shows one. */}
        {selectedReservation && (
          <div className="no-print fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setSelectedReservation(null)}>
            <div
              className="bg-[var(--paper)] text-[var(--text-primary)] border-l border-[var(--text-primary)]/14 w-full max-w-md h-full overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-[var(--paper)] border-b border-[var(--text-primary)]/10 px-6 py-4 flex items-center justify-between">
                <div className="font-display text-2xl truncate">{selectedReservation.guest || "(no name)"}</div>
                <button onClick={() => setSelectedReservation(null)} className="p-1 text-[var(--text-primary)]/50 hover:text-[var(--text-primary)] transition-colors shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {showGuestProfile ? (
                <div className="px-6 py-5 text-[13px] leading-relaxed flex flex-col gap-4">
                  <button
                    onClick={() => setShowGuestProfile(false)}
                    className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--text-primary)]/60 hover:text-[var(--text-primary)] transition-colors self-start"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    Back to reservation
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[var(--text-primary)]/10 flex items-center justify-center text-[13px] font-bold shrink-0">
                      {guestInitials(selectedReservation.guest || "?")}
                    </div>
                    <div className="font-display text-xl">{selectedReservation.guest || "(no name)"}</div>
                  </div>
                  <div className="border border-[var(--text-primary)]/14 rounded-lg grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3">
                    <div className="text-[var(--text-primary)]/50">Nationality</div><div className="text-right">{matchedGuestProfile?.nationality || selectedReservation.nationality || "-"}</div>
                    <div className="text-[var(--text-primary)]/50">Email</div><div className="text-right">{matchedGuestProfile?.email || selectedReservation.email || "-"}</div>
                    <div className="text-[var(--text-primary)]/50">Phone</div><div className="text-right">{matchedGuestProfile?.phone || selectedReservation.phone || "-"}</div>
                  </div>
                  <div className="border border-[var(--text-primary)]/14 rounded-lg px-4 py-3">
                    <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-1">Guest Profile Notes</div>
                    <div>{guestProfileNotes || "-"}</div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="px-6 flex gap-5 border-b border-[var(--text-primary)]/10">
                    {(["reservation", "group"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setManageTab(t)}
                        className={`py-3 text-[13px] font-bold capitalize border-b-2 -mb-px transition-all ${
                          manageTab === t
                            ? "border-[var(--text-primary)] text-[var(--text-primary)]"
                            : "border-transparent text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <div className="px-6 py-5 text-[13px] leading-relaxed flex flex-col gap-4">
                    {manageTab === "reservation" ? (
                  <>
                    {/* Box 1: stay dates, room + HK status, collapsible notes */}
                    <div className="border border-[var(--text-primary)]/14 rounded-lg overflow-hidden">
                      <div className="px-4 py-3 flex items-center justify-between">
                        <div>
                          <div className="font-bold">{fmtDateOnly(selectedReservation.check_in)} - {fmtDateOnly(selectedReservation.check_out)}</div>
                          <div className="text-[11px] text-[var(--text-primary)]/50 mt-0.5">
                            {selectedNights} Night{selectedNights !== 1 ? "s" : ""}, {fmtWeekdayTime(selectedReservation.check_in)} - {fmtWeekdayTime(selectedReservation.check_out)}
                          </div>
                          <div className="text-[11px] text-[var(--text-primary)]/50 mt-0.5">{selectedReservation.number}</div>
                        </div>
                        <span className={`shrink-0 inline-block px-2.5 py-1 text-[10px] font-bold border rounded ${STATE_BADGE_CLS[selectedReservation.state] || STATE_BADGE_CLS.Processed}`}>
                          {STATE_DISPLAY_LABEL[selectedReservation.state] || selectedReservation.state}
                        </span>
                      </div>

                      <div
                        className={`px-4 py-3 border-t border-[var(--text-primary)]/10 flex items-center justify-between ${selectedRoomInfo ? "cursor-pointer hover:bg-[var(--text-primary)]/5" : ""}`}
                        onClick={() => { if (selectedRoomInfo) setSelectedRoom(selectedRoomInfo); }}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`font-bold ${selectedRoomInfo ? "underline decoration-1 underline-offset-2" : ""}`}>
                            {selectedRoomInfo?.category_short ? `${selectedRoomInfo.category_short} ` : ""}{selectedReservation.room || "-"}
                          </div>
                          {typeof selectedReservation.room_locked === "boolean" && (
                            <span
                              title={selectedReservation.room_locked ? "Room assignment locked" : "Room assignment not locked"}
                              className={`inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0 ${selectedReservation.room_locked ? "bg-indigo-500 text-white" : "bg-slate-200 text-slate-400"}`}
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                            </span>
                          )}
                        </div>
                        {selectedRoomInfo && (
                          <span className={`shrink-0 inline-block px-2.5 py-1 text-[10px] font-bold border rounded ${ROOM_STATE_BADGE_CLS[selectedRoomInfo.state] || "bg-slate-100 text-slate-600 border-slate-300"}`}>
                            {selectedRoomInfo.state}
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => setManageNotesOpen((v) => !v)}
                        disabled={!selectedReservation.notes}
                        className="w-full px-4 py-3 border-t border-[var(--text-primary)]/10 flex items-center justify-between text-left disabled:cursor-default"
                      >
                        <span className="flex items-center gap-2">
                          Notes
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] font-bold">
                            {selectedReservation.notes ? 1 : 0}
                          </span>
                        </span>
                        {selectedReservation.notes && (
                          <svg className={`w-4 h-4 text-[var(--text-primary)]/50 transition-transform ${manageNotesOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        )}
                      </button>
                      {manageNotesOpen && selectedReservation.notes && (
                        <div className="px-4 pb-3 text-[var(--text-primary)]/70">{selectedReservation.notes}</div>
                      )}
                    </div>

                    {/* Box 2: guests */}
                    <div className="border border-[var(--text-primary)]/14 rounded-lg overflow-hidden">
                      <div className="px-4 py-3 flex items-center justify-between">
                        <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">Guests</div>
                        <div className="text-[11px] text-[var(--text-primary)]/50">
                          {selectedReservation.adults} × Adults{selectedReservation.children > 0 ? `, ${selectedReservation.children} × Children` : ""}
                        </div>
                      </div>
                      <div className="px-4 py-3 border-t border-[var(--text-primary)]/10 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[var(--text-primary)]/10 flex items-center justify-center text-[11px] font-bold shrink-0">
                            {guestInitials(selectedReservation.guest || "?")}
                          </div>
                          <div>
                            <button
                              onClick={() => setShowGuestProfile(true)}
                              className="font-bold underline decoration-1 underline-offset-2 hover:text-blue-600 transition-colors"
                            >
                              {selectedReservation.guest || "(no name)"}
                            </button>
                            <span className="text-[10px] text-[var(--text-primary)]/50"> Owner</span>
                          </div>
                        </div>
                      </div>
                      <div className="px-4 py-3 border-t border-[var(--text-primary)]/10">
                        <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-1">Guest Profile Notes</div>
                        <div>{guestProfileNotes || "-"}</div>
                      </div>
                      {/* "To be paid" lives in the Guests box (not the billing
                          box below) and is highlighted, matching the reference -
                          it's MEWS's own explicitly-requested-payment amount,
                          not a running balance, so it can read 0 against a
                          nonzero Total amount below. */}
                      {typeof selectedReservation.total_amount === "number" && (
                        <div className="px-4 py-3 border-t border-[var(--text-primary)]/10 flex items-center justify-between font-bold bg-amber-100 text-amber-900">
                          <div>To be paid</div>
                          <div>{(selectedReservation.to_be_paid ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} {selectedReservation.currency}</div>
                        </div>
                      )}
                    </div>

                    {/* Box 3: billing breakdown - Rate/Items amounts come from
                        order items (RequestedPaymentAmount on the reservation
                        itself is never populated in this property's data,
                        confirmed live). Rate/Items are expandable to their
                        individual line items, matching MEWS's own chevron. */}
                    {typeof selectedReservation.total_amount === "number" && (
                      <div className="border border-[var(--text-primary)]/14 rounded-lg overflow-hidden">
                        <button
                          onClick={() => setRateLinesOpen((v) => !v)}
                          disabled={!selectedReservation.rate_lines?.length}
                          className="w-full px-4 py-3 flex flex-col text-left disabled:cursor-default"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">
                              Rate
                              {!!selectedReservation.rate_lines?.length && (
                                <svg className={`w-3 h-3 transition-transform ${rateLinesOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <div>1× {selectedReservation.rate || "-"}</div>
                            <div>{(selectedReservation.rate_amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                          </div>
                        </button>
                        {rateLinesOpen && selectedReservation.rate_lines?.map((line, i) => (
                          <div key={i} className="px-4 pb-2 flex items-center justify-between text-[var(--text-primary)]/70">
                            <div>{line.label}</div>
                            <div>{line.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                          </div>
                        ))}
                        <button
                          onClick={() => setItemLinesOpen((v) => !v)}
                          disabled={!selectedReservation.item_lines?.length}
                          className="w-full px-4 py-3 border-t border-[var(--text-primary)]/10 flex flex-col text-left disabled:cursor-default"
                        >
                          <div className="flex items-center gap-1.5 text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">
                            Items
                            {!!selectedReservation.item_lines?.length && (
                              <svg className={`w-3 h-3 transition-transform ${itemLinesOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            )}
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <div>Products</div>
                            <div>{(selectedReservation.items_amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                          </div>
                        </button>
                        {itemLinesOpen && selectedReservation.item_lines?.map((line, i) => (
                          <div key={i} className="px-4 pb-2 flex items-center justify-between text-[var(--text-primary)]/70">
                            <div>{line.label}</div>
                            <div>{line.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                          </div>
                        ))}
                        <div className="px-4 py-3 border-t border-[var(--text-primary)]/10 flex items-center justify-between font-bold bg-amber-100 text-amber-900">
                          <div>Total amount</div>
                          <div>{selectedReservation.total_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} {selectedReservation.currency}</div>
                        </div>
                        <div className="px-4 py-3 border-t border-[var(--text-primary)]/10">
                          <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-1.5">Details</div>
                          <div className="grid grid-cols-2 gap-y-1.5">
                            <div className="text-[var(--text-primary)]/50">Avg. rate (nightly)</div>
                            <div className="text-right">{((selectedReservation.rate_amount ?? 0) / selectedNights).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                            <div className="text-[var(--text-primary)]/50">Avg. price with products (nightly)</div>
                            <div className="text-right">{(selectedReservation.total_amount / selectedNights).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                            {selectedReservation.service && (<><div className="text-[var(--text-primary)]/50">Service</div><div className="text-right">{selectedReservation.service}</div></>)}
                            {selectedReservation.travel_agency && (<><div className="text-[var(--text-primary)]/50">Travel agency</div><div className="text-right underline decoration-1 underline-offset-2">{selectedReservation.travel_agency}</div></>)}
                            {selectedReservation.travel_agency_confirmation_number && (<><div className="text-[var(--text-primary)]/50">Travel agency confirmation number</div><div className="text-right">{selectedReservation.travel_agency_confirmation_number}</div></>)}
                            {selectedReservation.purpose && (<><div className="text-[var(--text-primary)]/50">Booking purpose</div><div className="text-right">{selectedReservation.purpose}</div></>)}
                            {selectedReservation.segment && (<><div className="text-[var(--text-primary)]/50">Segment</div><div className="text-right">{selectedReservation.segment}</div></>)}
                            {selectedReservation.origin && (<><div className="text-[var(--text-primary)]/50">Origin</div><div className="text-right">{selectedReservation.origin}</div></>)}
                            {selectedReservation.reservation_source && (<><div className="text-[var(--text-primary)]/50">Reservation source</div><div className="text-right">{selectedReservation.reservation_source}</div></>)}
                            {typeof selectedReservation.total_amount_gross === "number" && (<><div className="text-[var(--text-primary)]/50">Total amount (Gross)</div><div className="text-right">{selectedReservation.total_amount_gross.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div></>)}
                            {selectedReservation.group_name && (<><div className="text-[var(--text-primary)]/50">Group name</div><div className="text-right">{selectedReservation.group_name}</div></>)}
                            {selectedReservation.created_utc && (<><div className="text-[var(--text-primary)]/50">Created</div><div className="text-right">{fmtDateTime(selectedReservation.created_utc)}</div></>)}
                          </div>
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-1">Products</div>
                      <div>{selectedReservation.products.length > 0 ? selectedReservation.products.join(", ") : "-"}</div>
                    </div>

                    {(selectedReservation.nationality || selectedReservation.category || selectedReservation.company) && (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-3 border-t border-[var(--text-primary)]/10">
                        {selectedReservation.nationality && (<><div className="text-[var(--text-primary)]/50">Nationality</div><div className="text-right">{selectedReservation.nationality}</div></>)}
                        {selectedReservation.category && (<><div className="text-[var(--text-primary)]/50">Requested category</div><div className="text-right">{selectedReservation.category}</div></>)}
                        {selectedReservation.company && (<><div className="text-[var(--text-primary)]/50">Company</div><div className="text-right">{selectedReservation.company}</div></>)}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="border border-[var(--text-primary)]/14 rounded-lg px-4 py-3">
                    {selectedReservation.group_name ? (
                      <>
                        <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-1">Group name</div>
                        <div className="font-bold">{selectedReservation.group_name}</div>
                        <div className="text-[11px] text-[var(--text-primary)]/50 mt-2">Other reservations in this group aren&apos;t available in this snapshot.</div>
                      </>
                    ) : (
                      <div className="text-[var(--text-primary)]/50">This reservation isn&apos;t part of a group.</div>
                    )}
                  </div>
                )}

                <div className="text-[11px] text-[var(--text-primary)]/40 italic pt-2 border-t border-[var(--text-primary)]/10">
                  Read-only snapshot from {isLiveFallback ? "a live MEWS check" : "the last capture"} - no live connection to MEWS to manage this reservation from here.
                </div>
              </div>
                </>
              )}
              <div className="sticky bottom-0 bg-[var(--paper)] border-t border-[var(--text-primary)]/10 px-6 py-4">
                <button
                  disabled
                  title="No live connection to MEWS to manage this reservation from here"
                  className="w-[30%] py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold opacity-50 cursor-not-allowed"
                >
                  Manage
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Room Properties panel - mirrors MEWS's own Room Properties screen
            (Number/Floor number/Status/Parent room/Category). Read-only: no
            segmented Clean/Dirty/Out-of-service control and no "Out of
            order" action, since there is nothing live to action from a stale
            snapshot - same reasoning as the disabled "Manage" button on the
            reservation panel above. "Reason for status" and "Recent space
            changes" are omitted entirely (not just hidden-if-empty): the
            MEWS Connector API doesn't expose either one - StateReason is a
            write-only input to resources/update, and there's no
            resource-history/activity-log endpoint at all - so this is a
            confirmed API gap, not a missing join. */}
        {selectedRoom && (
          <div className="no-print fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setSelectedRoom(null)}>
            <div
              className="bg-[var(--paper)] text-[var(--text-primary)] border-l border-[var(--text-primary)]/14 w-full max-w-md h-full overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-[var(--paper)] border-b border-[var(--text-primary)]/10 px-6 py-4 flex items-center gap-3">
                <button onClick={() => setSelectedRoom(null)} className="p-1 text-[var(--text-primary)]/50 hover:text-[var(--text-primary)] transition-colors shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <div className="font-display text-2xl truncate">{selectedRoom.room}</div>
              </div>

              <div className="px-6 py-5 text-[13px] leading-relaxed flex flex-col gap-4">
                <div className="border border-[var(--text-primary)]/14 rounded-lg px-4 py-3">
                  <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-2">Properties</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div className="text-[var(--text-primary)]/50">Number</div>
                    <div className="text-right">{selectedRoom.room}</div>
                    {selectedRoom.floor && (<><div className="text-[var(--text-primary)]/50">Floor number</div><div className="text-right">{selectedRoom.floor}</div></>)}
                    <div className="text-[var(--text-primary)]/50">Status</div>
                    <div className="text-right">
                      <span className={`inline-block px-2.5 py-1 text-[10px] font-bold border rounded ${ROOM_STATE_BADGE_CLS[selectedRoom.state] || "bg-slate-100 text-slate-600 border-slate-300"}`}>
                        {selectedRoom.state}
                      </span>
                    </div>
                    {selectedRoom.parent_room && (<><div className="text-[var(--text-primary)]/50">Parent room</div><div className="text-right">{selectedRoom.parent_room}</div></>)}
                    {selectedRoom.category && (<><div className="text-[var(--text-primary)]/50">Category</div><div className="text-right">{selectedRoom.service ? `${selectedRoom.service} → ` : ""}{selectedRoom.category}</div></>)}
                  </div>
                </div>

                <div className="text-[11px] text-[var(--text-primary)]/40 italic pt-2 border-t border-[var(--text-primary)]/10">
                  Read-only snapshot from {isLiveFallback ? "a live MEWS check" : "the last capture"} - no live connection to MEWS to manage this room from here. Reason for status and recent space-change history aren&apos;t exposed by the MEWS API and can&apos;t be shown here.
                </div>
              </div>

              <div className="sticky bottom-0 bg-[var(--paper)] border-t border-[var(--text-primary)]/10 px-6 py-4">
                <button
                  disabled
                  title="No live connection to MEWS to manage this room from here"
                  className="w-[40%] py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold opacity-50 cursor-not-allowed"
                >
                  Out of order
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
