"use client";

import { useEffect, useMemo, useState } from "react";
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
  total_amount?: number | null;
  currency?: string;
  origin?: string;
  purpose?: string;
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
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

const ROOM_DOT_CLS: Record<string, string> = {
  Clean: "bg-sky-500",
  Inspected: "bg-emerald-500",
  Dirty: "bg-amber-500",
  OutOfService: "bg-slate-400",
  OutOfOrder: "bg-red-500",
};

const STATE_BADGE_CLS: Record<string, string> = {
  Confirmed: "bg-slate-100 text-slate-600 border-slate-300",
  Started: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Processed: "bg-slate-100 text-slate-500 border-slate-200",
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
  const [showManage, setShowManage] = useState(false);

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
    setShowManage(false);
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
  // King"). Rooms already arrive pre-sorted alphabetically (A-Z) by
  // category from the backend, so a contiguous same-category run is just
  // one group - blank categories (no assignment on that resource) are
  // skipped rather than drawn as an empty label.
  const roomCategoryGroups = useMemo(() => {
    const rooms = snapshot?.rooms || [];
    const groups: { category: string; startIdx: number; count: number }[] = [];
    rooms.forEach((r, i) => {
      const cat = r.category || "";
      const last = groups[groups.length - 1];
      if (last && last.category === cat) {
        last.count++;
      } else {
        groups.push({ category: cat, startIdx: i, count: 1 });
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
        return { res, roomIdx, colStart: clippedStart + 3, colSpan: clippedEnd - clippedStart };
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

  const guestProfileNotes = useMemo(() => {
    if (!selectedReservation || !snapshot) return "";
    const match = snapshot.customers.find(
      (c) => (selectedReservation.email && c.email === selectedReservation.email) || c.name === selectedReservation.guest
    );
    return match?.notes || "";
  }, [selectedReservation, snapshot]);

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
        <PageHeader title="BCP" description="Mews Business Continuity Plan - hourly snapshots of a 10-day reservation timeline, payments and room status, so the front desk can keep operating from the latest copy if MEWS goes down." />
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
                  <p>ระบบสำรองข้อมูลหน้าฟร้อนท์สำหรับกรณี <b>MEWS ล่ม</b> — ระบบจะเก็บสำเนา timeline การจอง 10 วัน (ย้อนหลัง 3 วัน + ล่วงหน้า 7 วัน) จาก MEWS <b>อัตโนมัติทุก 1 ชั่วโมง</b> (เก็บย้อนหลัง 48 ชั่วโมงล่าสุดต่อโรงแรม) พร้อมสถานะห้องแม่บ้านและรายการชำระเงินวันนี้</p>
                </div>
                <div>
                  <div className="font-bold mb-1">การใช้งานปกติ (MEWS ยังใช้ได้)</div>
                  <p>ไม่ต้องทำอะไร — ระบบเก็บ snapshot ให้เองทุกชั่วโมง หากต้องการสำเนาล่าสุดเดี๋ยวนั้น กดปุ่ม <b>Capture Now</b> ได้เลย และเลือกดูสำเนาย้อนหลังได้จากช่อง <b>Snapshot</b></p>
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

            {mainTab === "timeline" ? (
              <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 mb-8 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-auto max-h-[70vh]">
                <div
                  className="grid relative"
                  style={{ gridTemplateColumns: `28px 160px repeat(${windowDays.length}, minmax(84px, 1fr))` }}
                >
                  {/* Header row */}
                  <div className="sticky top-0 left-0 z-30 bg-[color-mix(in_srgb,var(--paper),var(--text-primary)_10%)] border-b border-r border-[var(--text-primary)]/10" style={{ gridColumn: 1, gridRow: 1 }}></div>
                  <div className="sticky top-0 left-[28px] z-20 bg-[color-mix(in_srgb,var(--paper),var(--text-primary)_10%)] border-b border-r border-[var(--text-primary)]/10 p-2 text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps" style={{ gridColumn: 2, gridRow: 1 }}>
                    Room
                  </div>
                  {windowDays.map((d, i) => {
                    const isToday = fmtYMD(d) === snapshot.date;
                    return (
                      <div
                        key={i}
                        className={`sticky top-0 z-10 border-b border-[var(--text-primary)]/10 p-2 text-[10px] font-bold text-center whitespace-nowrap ${isToday ? "bg-amber-100 text-amber-900" : "bg-[color-mix(in_srgb,var(--paper),var(--text-primary)_10%)] text-[var(--text-primary)]/70"}`}
                        style={{ gridColumn: i + 3, gridRow: 1 }}
                      >
                        {d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} {d.getUTCDate()}
                      </div>
                    );
                  })}

                  {/* Room-category group labels (e.g. "The Duo | King"),
                      matching MEWS's own vertical grouping strip */}
                  {roomCategoryGroups.map((g, i) => (
                    <div
                      key={"cat" + i}
                      className="sticky left-0 z-10 bg-[var(--paper)] border-b border-r border-[var(--text-primary)]/10 flex items-center justify-center overflow-hidden"
                      style={{ gridColumn: 1, gridRow: `${g.startIdx + 2} / span ${g.count}` }}
                    >
                      <span
                        className="text-[10px] font-bold text-[var(--text-primary)]/60 whitespace-nowrap"
                        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                      >
                        {g.category}
                      </span>
                    </div>
                  ))}

                  {/* Room label column + gridline strips */}
                  {snapshot.rooms.map((room, i) => (
                    <div
                      key={room.room + i}
                      className="sticky left-[28px] z-10 bg-[var(--paper)] border-b border-r border-[var(--text-primary)]/10 p-2 text-[12px] font-bold text-[var(--text-primary)] flex items-center gap-2 whitespace-nowrap"
                      style={{ gridColumn: 2, gridRow: i + 2 }}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${ROOM_DOT_CLS[room.state] || "bg-slate-300"}`} title={room.state}></span>
                      {room.room}
                    </div>
                  ))}
                  {snapshot.rooms.map((_, i) => (
                    <div
                      key={"strip" + i}
                      className="border-b border-[var(--text-primary)]/10"
                      style={{
                        gridColumn: `3 / span ${windowDays.length}`,
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
                        onClick={() => { setSelectedReservation(res); setShowManage(false); }}
                        className={`m-1 px-2 py-1 text-[11px] font-bold text-left truncate rounded border transition-all hover:brightness-95 ${cls} ${started ? "shadow-sm" : "border-dashed"}`}
                        style={{ gridColumn: `${colStart} / span ${colSpan}`, gridRow: roomIdx + 2, zIndex: 5 }}
                        title={`${res.guest} — ${res.state}`}
                      >
                        {res.guest || "(no name)"}
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

        {/* Reservation detail panel. "Manage" opens a fuller read-only detail
            view (below) - there's no live MEWS connection to action anything
            from here, this is a stale snapshot for use when MEWS itself is
            unreachable. */}
        {selectedReservation && (
          <div className="no-print fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => { setSelectedReservation(null); setShowManage(false); }}>
            <div
              className="bg-[var(--paper)] text-[var(--text-primary)] border-l border-[var(--text-primary)]/14 w-full max-w-md h-full overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-[var(--paper)] border-b border-[var(--text-primary)]/10 px-6 py-4 flex items-center justify-between">
                <div className="font-display text-2xl truncate">{selectedReservation.guest || "(no name)"}</div>
                <button onClick={() => { setSelectedReservation(null); setShowManage(false); }} className="p-1 text-[var(--text-primary)]/50 hover:text-[var(--text-primary)] transition-colors shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="px-6 py-5 text-[13px] leading-relaxed flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border rounded ${STATE_BADGE_CLS[selectedReservation.state] || STATE_BADGE_CLS.Processed}`}>
                    {selectedReservation.state}
                  </span>
                  <span className="text-[var(--text-primary)]/50">Res. {selectedReservation.number}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">Room</div><div className="font-bold">{selectedReservation.room || "-"}</div></div>
                  <div><div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">Guests</div><div>{selectedReservation.adults + selectedReservation.children}</div></div>
                  <div><div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">Check-in</div><div>{fmtDateTime(selectedReservation.check_in)}</div></div>
                  <div><div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">Check-out</div><div>{fmtDateTime(selectedReservation.check_out)}</div></div>
                  <div><div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">Nationality</div><div>{selectedReservation.nationality || "-"}</div></div>
                  <div><div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">Phone</div><div>{selectedReservation.phone || "-"}</div></div>
                </div>
                <div><div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">Email</div><div>{selectedReservation.email || "-"}</div></div>
                <div>
                  <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-1">Product Items</div>
                  <div>{selectedReservation.products.length > 0 ? selectedReservation.products.join(", ") : "-"}</div>
                </div>
                <div className="pt-3 border-t border-[var(--text-primary)]/10">
                  <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-1">Reservation Notes</div>
                  <div>{selectedReservation.notes || "-"}</div>
                </div>
                <div>
                  <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-1">Guest Profile Notes</div>
                  <div>{guestProfileNotes || "-"}</div>
                </div>
              </div>
              <div className="sticky bottom-0 bg-[var(--paper)] border-t border-[var(--text-primary)]/10 px-6 py-4">
                <button
                  onClick={() => setShowManage(true)}
                  className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-colors"
                >
                  Manage
                </button>
              </div>
            </div>
          </div>
        )}

        {/* "Manage" full detail view - mirrors MEWS's own reservation Status
            page (Customers / Spaces / detailed key-value list). Still
            read-only: no Billing/Payments/Unlock/kiosk actions and no
            Cancellation form, since there is nothing live to action from a
            stale snapshot and canceled reservations are excluded from the
            snapshot query in the first place. */}
        {selectedReservation && showManage && (
          <div className="no-print fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8" onClick={() => setShowManage(false)}>
            <div
              className="bg-[var(--paper)] text-[var(--text-primary)] border border-[var(--text-primary)]/14 w-full max-w-2xl rounded-xl shadow-2xl my-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-[var(--text-primary)]/10 px-6 py-4 flex items-center justify-between">
                <div>
                  <div className="font-display text-xl truncate">{selectedReservation.group_name || selectedReservation.guest || "(no name)"}</div>
                  <div className="text-[11px] text-[var(--text-primary)]/50">Res. {selectedReservation.number}</div>
                </div>
                <button onClick={() => setShowManage(false)} className="p-1 text-[var(--text-primary)]/50 hover:text-[var(--text-primary)] transition-colors shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="px-6 py-5 text-[13px] leading-relaxed flex flex-col gap-6">
                {/* Customers */}
                <div>
                  <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-2">Customers</div>
                  <div className="flex items-center justify-between border border-[var(--text-primary)]/10 rounded-lg px-4 py-3">
                    <div>
                      <div className="font-bold">{selectedReservation.guest || "(no name)"}</div>
                      <div className="text-[11px] text-[var(--text-primary)]/50">{selectedReservation.email || "-"} · {selectedReservation.phone || "-"}</div>
                    </div>
                    <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border rounded ${STATE_BADGE_CLS[selectedReservation.state] || STATE_BADGE_CLS.Processed}`}>
                      {selectedReservation.state}
                    </span>
                  </div>
                </div>

                {/* Spaces */}
                <div>
                  <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-2">Spaces</div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">
                    {fmtDateTime(selectedReservation.check_in)} - {fmtDateTime(selectedReservation.check_out)}
                  </div>
                  <div className="flex items-center justify-between border border-[var(--text-primary)]/10 rounded-lg px-4 py-3">
                    <div className="font-bold">{selectedReservation.room || "-"}</div>
                    {selectedRoomInfo && (
                      <span className="inline-flex items-center gap-1.5 text-[11px]">
                        <span className={`w-2 h-2 rounded-full ${ROOM_DOT_CLS[selectedRoomInfo.state] || "bg-slate-400"}`} />
                        {selectedRoomInfo.state}
                      </span>
                    )}
                  </div>
                </div>

                {/* Reservation detail key-value list */}
                <div>
                  <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-2">Reservation</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-[var(--text-primary)]/10 pt-3">
                    <div className="text-[var(--text-primary)]/50">Service</div><div className="text-right">Stay (Accommodation)</div>
                    <div className="text-[var(--text-primary)]/50">Confirmation number</div><div className="text-right">{selectedReservation.number || "-"}</div>
                    {selectedReservation.group_name && (<><div className="text-[var(--text-primary)]/50">Group name</div><div className="text-right">{selectedReservation.group_name}</div></>)}
                    <div className="text-[var(--text-primary)]/50">Status</div><div className="text-right">{selectedReservation.state}</div>
                    <div className="text-[var(--text-primary)]/50">Arrival</div><div className="text-right">{fmtDateTime(selectedReservation.check_in)}</div>
                    <div className="text-[var(--text-primary)]/50">Departure</div><div className="text-right">{fmtDateTime(selectedReservation.check_out)}</div>
                    <div className="text-[var(--text-primary)]/50">Nights</div><div className="text-right">{selectedNights}</div>
                    {selectedReservation.purpose && (<><div className="text-[var(--text-primary)]/50">Booking purpose</div><div className="text-right">{selectedReservation.purpose}</div></>)}
                    <div className="text-[var(--text-primary)]/50">Companions</div><div className="text-right">{selectedReservation.adults} × Adults{selectedReservation.children > 0 ? `, ${selectedReservation.children} × Children` : ""}</div>
                    {selectedReservation.category && (<><div className="text-[var(--text-primary)]/50">Requested category</div><div className="text-right">{selectedReservation.category}</div></>)}
                    <div className="text-[var(--text-primary)]/50">Assigned space</div>
                    <div className="text-right">
                      {selectedReservation.room || "-"}
                      {selectedRoomInfo && <span className="ml-1.5 text-[10px] text-[var(--text-primary)]/50">({selectedRoomInfo.state})</span>}
                    </div>
                    {selectedReservation.rate && (<><div className="text-[var(--text-primary)]/50">Rate</div><div className="text-right">{selectedReservation.rate}</div></>)}
                    {selectedReservation.company && (<><div className="text-[var(--text-primary)]/50">Company</div><div className="text-right">{selectedReservation.company}</div></>)}
                    {selectedReservation.travel_agency && (<><div className="text-[var(--text-primary)]/50">Travel agency</div><div className="text-right">{selectedReservation.travel_agency}</div></>)}
                    {typeof selectedReservation.total_amount === "number" && (
                      <>
                        <div className="text-[var(--text-primary)]/50">Avg. rate (nightly)</div>
                        <div className="text-right">{(selectedReservation.total_amount / selectedNights).toLocaleString("en-US", { minimumFractionDigits: 2 })} {selectedReservation.currency}</div>
                        <div className="text-[var(--text-primary)]/50">Total amount</div>
                        <div className="text-right font-bold">{selectedReservation.total_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} {selectedReservation.currency}</div>
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-1">Products</div>
                  <div>{selectedReservation.products.length > 0 ? selectedReservation.products.join(", ") : "-"}</div>
                </div>

                <div className="pt-3 border-t border-[var(--text-primary)]/10">
                  <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-1">Reservation Notes</div>
                  <div>{selectedReservation.notes || "-"}</div>
                </div>
                <div>
                  <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-1">Guest Profile Notes</div>
                  <div>{guestProfileNotes || "-"}</div>
                </div>

                <div className="text-[11px] text-[var(--text-primary)]/40 italic pt-2 border-t border-[var(--text-primary)]/10">
                  Read-only snapshot from {isLiveFallback ? "a live MEWS check" : "the last capture"} - no live connection to MEWS to manage this reservation from here.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
