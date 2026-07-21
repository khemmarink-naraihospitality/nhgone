"use client";

import { useEffect, useState } from "react";
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
  occupant: string;
  arriving: string;
  departing: string;
}

interface BcpSnapshot {
  property: string;
  date: string;
  captured_utc: string;
  counts: Record<string, number>;
  arrivals: ReservationRow[];
  departures: ReservationRow[];
  in_house: ReservationRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  rooms: RoomRow[];
}

interface SnapshotMeta {
  id: string;
  captured_at: string;
}

const TABS = [
  { key: "arrivals", label: "Arrivals" },
  { key: "departures", label: "Departures" },
  { key: "in_house", label: "In-House" },
  { key: "customers", label: "Customers" },
  { key: "payments", label: "Payments" },
  { key: "rooms", label: "Room Status" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const fmtDateTime = (v: string) => {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
};

const fmtTime = (v: string) => {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
};

const ROOM_STATE_CLS: Record<string, string> = {
  Clean: "bg-sky-50 text-sky-700 border-sky-200",
  Inspected: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Dirty: "bg-amber-50 text-amber-700 border-amber-200",
  OutOfService: "bg-slate-100 text-slate-600 border-slate-300",
  OutOfOrder: "bg-red-50 text-red-700 border-red-200",
};

const thCls = "p-2 px-3 text-[9px] font-bold text-[var(--text-primary)]/50 uppercase tracking-[0.12em] border-b border-[var(--text-primary)]/10 whitespace-nowrap";
const tdCls = "p-2 px-3 text-[13px] text-[var(--text-primary)] whitespace-nowrap align-top";

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
  const [activeTab, setActiveTab] = useState<TabKey>("arrivals");
  const [showReadme, setShowReadme] = useState(false);

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

  const reservationTable = (rows: ReservationRow[], showProducts: boolean) => (
    <table className="w-full text-left border-collapse min-w-max">
      <thead>
        <tr className="bg-[var(--text-primary)]/5">
          <th className={thCls}>Res No.</th>
          <th className={thCls}>Guest</th>
          <th className={thCls}>Nat.</th>
          <th className={thCls}>Email</th>
          <th className={thCls}>Room</th>
          <th className={thCls}>Check-in</th>
          <th className={thCls}>Check-out</th>
          <th className={thCls}>State</th>
          <th className={`${thCls} text-right`}>Guests</th>
          {showProducts && <th className={thCls}>Product Items</th>}
          <th className={thCls}>Notes</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--text-primary)]/5">
        {rows.length === 0 ? (
          <tr><td colSpan={showProducts ? 11 : 10} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">None for this date.</td></tr>
        ) : rows.map((r, i) => (
          <tr key={r.number + i} className="hover:bg-[var(--text-primary)]/[0.02]">
            <td className={`${tdCls} font-bold`}>{r.number}</td>
            <td className={tdCls}>{r.guest || "-"}</td>
            <td className={tdCls}>{r.nationality || "-"}</td>
            <td className={tdCls}>{r.email || "-"}</td>
            <td className={`${tdCls} font-bold`}>{r.room || "-"}</td>
            <td className={tdCls}>{fmtDateTime(r.check_in)}</td>
            <td className={tdCls}>{fmtDateTime(r.check_out)}</td>
            <td className={tdCls}>{r.state}</td>
            <td className={`${tdCls} text-right`}>{r.adults + r.children}</td>
            {showProducts && (
              <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 max-w-[280px]">
                {r.products.length > 0 ? r.products.join(", ") : "-"}
              </td>
            )}
            <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 max-w-[280px]">{r.notes || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const customerTable = (rows: CustomerRow[]) => (
    <table className="w-full text-left border-collapse min-w-max">
      <thead>
        <tr className="bg-[var(--text-primary)]/5">
          <th className={thCls}>Name</th>
          <th className={thCls}>Status</th>
          <th className={thCls}>Nat.</th>
          <th className={thCls}>Email</th>
          <th className={thCls}>Phone</th>
          <th className={thCls}>Profile Notes</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--text-primary)]/5">
        {rows.length === 0 ? (
          <tr><td colSpan={6} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">None for this date.</td></tr>
        ) : rows.map((c, i) => (
          <tr key={c.name + i} className="hover:bg-[var(--text-primary)]/[0.02]">
            <td className={`${tdCls} font-bold`}>{c.name || "-"}</td>
            <td className={tdCls}>
              {c.tags.map((t) => (
                <span key={t} className="inline-block mr-1 px-2 py-0.5 text-[10px] font-bold border rounded bg-[var(--text-primary)]/5 border-[var(--text-primary)]/10">{t}</span>
              ))}
            </td>
            <td className={tdCls}>{c.nationality || "-"}</td>
            <td className={tdCls}>{c.email || "-"}</td>
            <td className={tdCls}>{c.phone || "-"}</td>
            <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 max-w-[320px]">{c.notes || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const paymentTable = (rows: PaymentRow[]) => (
    <table className="w-full text-left border-collapse min-w-max">
      <thead>
        <tr className="bg-[var(--text-primary)]/5">
          <th className={thCls}>Time</th>
          <th className={thCls}>Guest</th>
          <th className={thCls}>Res No.</th>
          <th className={thCls}>Type</th>
          <th className={thCls}>State</th>
          <th className={`${thCls} text-right`}>Amount</th>
          <th className={thCls}>Notes</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--text-primary)]/5">
        {rows.length === 0 ? (
          <tr><td colSpan={7} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">None for this date.</td></tr>
        ) : rows.map((p, i) => (
          <tr key={p.created + i} className="hover:bg-[var(--text-primary)]/[0.02]">
            <td className={tdCls}>{fmtDateTime(p.created)}</td>
            <td className={tdCls}>{p.guest || "-"}</td>
            <td className={tdCls}>{p.reservation || "-"}</td>
            <td className={tdCls}>{p.type}</td>
            <td className={tdCls}>{p.state}</td>
            <td className={`${tdCls} text-right font-bold`}>{p.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} {p.currency}</td>
            <td className="p-2 px-3 text-[12px] text-[var(--text-primary)]/80 max-w-[240px]">{p.notes || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const roomTable = (rows: RoomRow[]) => (
    <>
      <div className="no-print flex justify-end mb-3">
        <button onClick={() => window.print()} className="px-6 py-2 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity">
          Print Housekeeping Sheet
        </button>
      </div>
      <div className="hidden print:block mb-4 text-black">
        <div className="text-lg font-bold">Housekeeping Room Status — {snapshot?.property}</div>
        <div className="text-sm">Data as of: {fmtDateTime(snapshot?.captured_utc || "")} (Asia/Bangkok) — Sign: ____________________</div>
      </div>
      <table className="w-full text-left border-collapse min-w-max">
        <thead>
          <tr className="bg-[var(--text-primary)]/5">
            <th className={thCls}>Floor</th>
            <th className={thCls}>Room</th>
            <th className={thCls}>HK Status</th>
            <th className={thCls}>Occupant (In-house)</th>
            <th className={thCls}>Arriving Today</th>
            <th className={thCls}>Departing Today</th>
            <th className={`${thCls} print:table-cell`}>Cleaned ✓</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--text-primary)]/5">
          {rows.map((r, i) => (
            <tr key={r.room + i} className="hover:bg-[var(--text-primary)]/[0.02]">
              <td className={tdCls}>{r.floor || "-"}</td>
              <td className={`${tdCls} font-bold`}>{r.room}</td>
              <td className={tdCls}>
                <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border rounded ${ROOM_STATE_CLS[r.state] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                  {r.state}
                </span>
              </td>
              <td className={tdCls}>{r.occupant || "-"}</td>
              <td className={tdCls}>{r.arriving || "-"}</td>
              <td className={tdCls}>{r.departing || "-"}</td>
              <td className={tdCls}>☐</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );

  const renderTab = () => {
    if (!snapshot) return null;
    switch (activeTab) {
      case "arrivals": return reservationTable(snapshot.arrivals, true);
      case "departures": return reservationTable(snapshot.departures, false);
      case "in_house": return reservationTable(snapshot.in_house, false);
      case "customers": return customerTable(snapshot.customers);
      case "payments": return paymentTable(snapshot.payments);
      case "rooms": return roomTable(snapshot.rooms);
    }
  };

  const tabCount = (key: TabKey): number | null => {
    if (!snapshot) return null;
    return snapshot.counts[key] ?? null;
  };

  return (
    <div className="flex-1 p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
      <div className="max-w-7xl mx-auto">
        <div className="no-print">
        <PageHeader title="BCP" description="Mews Business Continuity Plan - hourly snapshots of today's arrivals, departures, in-house guests, payments and room status, so the front desk can keep operating from the latest copy if MEWS goes down." />
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
                  <p>ระบบสำรองข้อมูลหน้าฟร้อนท์สำหรับกรณี <b>MEWS ล่ม</b> — ระบบจะเก็บสำเนาข้อมูลของ &quot;วันนี้&quot; จาก MEWS <b>อัตโนมัติทุก 1 ชั่วโมง</b> (เก็บย้อนหลัง 48 ชั่วโมงล่าสุดต่อโรงแรม) ได้แก่ แขกเข้าวันนี้ (Arrivals พร้อมรายการสินค้า/โน้ต), แขกออกวันนี้ (Departures), แขกที่พักอยู่ (In-House), โปรไฟล์ลูกค้าพร้อมโน้ต, รายการชำระเงินวันนี้ (Payments) และสถานะห้องแม่บ้านทุกห้อง (Room Status)</p>
                </div>
                <div>
                  <div className="font-bold mb-1">การใช้งานปกติ (MEWS ยังใช้ได้)</div>
                  <p>ไม่ต้องทำอะไร — ระบบเก็บ snapshot ให้เองทุกชั่วโมง หากต้องการสำเนาล่าสุดเดี๋ยวนั้น กดปุ่ม <b>Capture Now</b> ได้เลย และเลือกดูสำเนาย้อนหลังได้จากช่อง <b>Snapshot</b></p>
                </div>
                <div>
                  <div className="font-bold mb-1">เมื่อ MEWS ล่ม ให้ทำตามนี้</div>
                  <ol className="list-decimal list-inside flex flex-col gap-1">
                    <li>เปิดหน้านี้ เลือกโรงแรม แล้วเลือก <b>snapshot ล่าสุด</b> (ดูเวลา &quot;Data as of&quot; ประกอบ — ถ้าเก่ากว่า 2 ชม. ระบบจะเตือนสีส้ม)</li>
                    <li>ใช้แท็บ <b>Arrivals</b> เช็คแขกที่จะเข้าวันนี้: ถ่ายรูปพาสปอร์ต / สแกนเอกสารเก็บเข้าคอมไว้ก่อน แล้วลงทะเบียนผ่านกระดาษ / PDF บน iPad แทน</li>
                    <li>ใช้แท็บ <b>Room Status</b> ประสานแม่บ้านว่าให้แขกเข้าห้องไหนตามประเภทห้อง — กดปุ่ม <b>Print Housekeeping Sheet</b> พิมพ์ใบงานแจกแม่บ้าน (มีช่อง Cleaned ✓ ให้ติ๊กบนกระดาษ)</li>
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

            <div className="no-print flex flex-wrap border-b border-[var(--text-primary)]/14 mb-6">
              {TABS.map((t) => {
                const count = tabCount(t.key);
                return (
                  <button
                    key={t.key}
                    onClick={() => setActiveTab(t.key)}
                    className={`px-5 py-3 text-[11px] font-bold tracked-caps border-b-2 -mb-px transition-all ${
                      activeTab === t.key
                        ? "border-[var(--text-primary)] text-[var(--text-primary)]"
                        : "border-transparent text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {t.label}{count !== null ? ` (${count})` : ""}
                  </button>
                );
              })}
            </div>

            <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 mb-8 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-x-auto p-4 print:border-0 print:shadow-none print:bg-white">
              {renderTab()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
