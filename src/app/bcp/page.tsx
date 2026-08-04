"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { getAllowedProperties } from "@/lib/allowedProperties";
import PageHeader from "@/components/PageHeader";
import { renderRr3Template, type Rr3TokenData } from "@/lib/rr3Template";
import SignaturePad, { cropSignatureDataUrlToInk } from "@/components/SignaturePad";

// The guest-identity fields the Reg Card/RR3 form and the Guest Profile
// page need - shared shape for both the reservation's primary guest
// (spread across ReservationRow's own top-level fields, see
// ownerGuestIdentity below) and each companion (companions: GuestIdentity[]
// on ReservationRow), so any guest name in the app can open the same Guest
// Profile page regardless of which one it is.
// MEWS links a payment to the paying Customer's AccountId, not a
// reservation - fetched and attached per-guest (GuestIdentity.payments)
// rather than per-reservation, matching how MEWS's own Guest Profile >
// Payments tab is scoped to the guest, not the stay.
interface GuestPayment {
  created: string;
  amount: number;
  currency: string;
  type: string;
  sub_type?: string;
  identifier?: string;
  state: string;
  notes?: string;
}

interface GuestIdentity {
  name: string;
  first_name?: string;
  last_name?: string;
  second_last_name?: string;
  title?: string;
  sex?: string;
  language?: string;
  birth_date?: string;
  birth_country_name?: string;
  birth_place?: string;
  nationality: string;
  nationality_name?: string;
  email: string;
  phone: string;
  identity_card_number?: string;
  passport_number?: string;
  occupation?: string;
  address_details?: string;
  alien_book?: string;
  mews_customer_id?: string;
  payments?: GuestPayment[];
}

interface ReservationRow {
  number: string;
  // MEWS's own internal Id (a GUID, distinct from the human-readable
  // number above) - needed as ServiceOrderId when adding a note via
  // serviceOrderNotes/add (see handleAddReservationNote).
  mews_reservation_id?: string;
  guest: string;
  first_name?: string;
  last_name?: string;
  second_last_name?: string;
  title?: string;
  sex?: string;
  language?: string;
  birth_date?: string;
  birth_country_name?: string;
  birth_place?: string;
  nationality: string;
  nationality_name?: string;
  email: string;
  phone: string;
  identity_card_number?: string;
  passport_number?: string;
  occupation?: string;
  address_details?: string;
  alien_book?: string;
  mews_customer_id?: string;
  payments?: GuestPayment[];
  // The bill's own display name (e.g. "LE-27-7-6043") - resolved from the
  // BillId already present on this reservation's order items, via a
  // dedicated bills/getAll lookup (MEWS's "Number" field stays null until
  // a bill is formally issued/closed, so "Name" is used instead - confirmed
  // live against this exact reservation's still-open bill).
  bill_name?: string;
  room: string;
  check_in: string;
  check_out: string;
  state: string;
  adults: number;
  children: number;
  products: string[];
  notes: { text: string; type: string; created_utc: string }[];
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
  // Other named guests MEWS attaches to this same reservation (its own
  // CompanionIds) alongside the primary guest above (MEWS's "Owner") - e.g.
  // a 2 Adults/1 Child reservation can have up to 2 more named profiles
  // here. Absent/empty just means MEWS has no individual profile for the
  // rest of the occupancy count, not that our data is missing them.
  companions?: GuestIdentity[];
}

// The primary guest's fields live flat on ReservationRow itself (kept for
// every existing consumer - Reg Card, RR3 tokens, etc.) rather than nested
// like companions are - this just re-packages them into the same
// GuestIdentity shape so the Owner's name can open the same Guest Profile
// page as any companion.
function ownerGuestIdentity(r: ReservationRow): GuestIdentity {
  return {
    name: r.guest,
    first_name: r.first_name,
    last_name: r.last_name,
    second_last_name: r.second_last_name,
    title: r.title,
    sex: r.sex,
    language: r.language,
    birth_date: r.birth_date,
    birth_country_name: r.birth_country_name,
    birth_place: r.birth_place,
    nationality: r.nationality,
    nationality_name: r.nationality_name,
    email: r.email,
    phone: r.phone,
    identity_card_number: r.identity_card_number,
    passport_number: r.passport_number,
    occupation: r.occupation,
    address_details: r.address_details,
    alien_book: r.alien_book,
    mews_customer_id: r.mews_customer_id,
    payments: r.payments,
  };
}

// Every named guest on one reservation - the Owner first, then each
// companion - used to populate the Guest Profile page's "Related guests"
// box (MEWS's own equivalent lists other guests sharing the same
// reservation) and to let clicking one of them navigate to their own
// profile within the same fixed group, without recomputing it.
function allReservationGuests(r: ReservationRow): GuestIdentity[] {
  return [ownerGuestIdentity(r), ...(r.companions || [])];
}

// Keep in sync with the Edit/Add Guest modal's own field list further down -
// used only to build a human-readable Action Log detail string, not to
// render the form itself, so there's no single shared source of truth to
// import from without a bigger refactor.
const GUEST_FIELD_LABELS: [keyof GuestIdentity, string][] = [
  ["name", "Full name"],
  ["title", "Title"],
  ["first_name", "First name"],
  ["last_name", "Last name"],
  ["second_last_name", "Second last name"],
  ["nationality_name", "Nationality"],
  ["language", "Language"],
  ["phone", "Telephone"],
  ["sex", "Sex"],
  ["birth_date", "Date of birth"],
  ["birth_country_name", "Country of birth"],
  ["birth_place", "Place of birth"],
  ["occupation", "Occupation"],
  ["passport_number", "Passport"],
  ["identity_card_number", "ID Card"],
  ["alien_book", "Alien Book"],
  ["email", "Email"],
  ["address_details", "Address"],
];

// Builds the Action Log's Detail string for Guest Added/Edited/Removed -
// added/removed list every filled-in field (so the log itself is the full
// record of what was there), edited lists only the fields that actually
// changed, old -> new, same "before -> after" pattern as Room Status/Chg
// Room/Arrival Changed/Room Type Changed elsewhere in this file.
function summarizeGuestChanges(before: GuestIdentity | null, after: GuestIdentity, mode: "added" | "edited" | "removed"): string {
  const val = (g: GuestIdentity | null, field: keyof GuestIdentity) => ((g?.[field] as string) || "").trim();
  if (mode === "edited") {
    const changes = GUEST_FIELD_LABELS
      .filter(([field]) => val(before, field) !== val(after, field))
      .map(([field, label]) => `${label}: ${val(before, field) || "(blank)"} -> ${val(after, field) || "(blank)"}`);
    return changes.length ? changes.join(" | ") : "No fields changed";
  }
  const filled = GUEST_FIELD_LABELS
    .filter(([field]) => val(after, field))
    .map(([field, label]) => `${label}: ${val(after, field)}`);
  const verb = mode === "added" ? "Added" : "Removed";
  return filled.length ? `${verb}: ${filled.join(" | ")}` : `${verb} guest with no details entered`;
}

// MEWS's BirthDate is a plain YYYY-MM-DD calendar date (no time component,
// unlike check-in/out instants) - reformatted directly rather than through
// the Bangkok +7h shift helpers used elsewhere, which would risk flipping
// the day near midnight for a value that was never a UTC instant to begin
// with.
function fmtBirthDate(isoDate?: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
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

type MainTab = "timeline" | "rooms" | "logs";

type ReservationSortKey = "status" | "guest" | "dates" | "room" | "category";

type ActionLogSortKey = "time" | "guest" | "room" | "action" | "detail" | "userEmail" | "checked";

interface OfflineAction {
  id: string;
  at: string;
  reservationNumber?: string;
  guest: string;
  room: string;
  action: "Check In" | "Check Out" | "Undo Check In" | "Undo Check Out" | "Chg Room" | "Room Status" | "Room Number" | "Reg Card Saved" | "Note Added" | "Guest Added" | "Guest Edited" | "Guest Removed" | "Arrival Changed" | "Room Type Changed" | "Payment Processed";
  detail: string;
  // Required reason for OutOfService/OutOfOrder (see the reason modal) - its
  // own field, not folded into detail's text, so the Action Log Detail page
  // can show it as its own labeled row.
  reason?: string;
  // Who was signed in when this action was logged - filled in automatically
  // by logOfflineAction from the current Supabase Auth session, not passed
  // by callers, so it can never be forgotten/inconsistent per call site.
  userEmail?: string;
  // "BCP Check" - ticked once the front desk has re-keyed this action into
  // MEWS, so it no longer needs flagging red or counting toward the Action
  // Logs tab's outstanding-items badge. The row itself stays in the log
  // either way - this only changes how it's displayed, not the history.
  checked?: boolean;
  // Frozen copies of the reservation + matched guest profile as they stood
  // at the moment this action was logged - captured once, permanently,
  // specifically so the Action Log Detail page can still show full
  // Reservation Detail/Guest Profile for old entries even if the booking
  // has since changed, checked out, or fallen outside the live Timeline's
  // ±7 day window. Absent for actions with no associated reservation
  // (e.g. a Room Status/Room Number change on a currently vacant room).
  reservationSnapshot?: ReservationRow | null;
  guestProfileSnapshot?: CustomerRow | null;
}

// Reservations tab (front-desk action list) status, distinct from the
// Timeline's own raw MEWS state - "today" here is the snapshot's own date,
// matching the Arrivals/Departures/In-house counts in the toolbar.
function frontDeskStatus(r: ReservationRow, today: string): { label: string; cls: string } | null {
  const inDay = fmtYMD(toBangkokDay(r.check_in));
  const outDay = fmtYMD(toBangkokDay(r.check_out));
  if (inDay === today) return { label: "Arrival", cls: "bg-blue-50 text-blue-700 border-blue-200" };
  if (r.state === "Started" && outDay === today) return { label: "Departure", cls: "bg-amber-50 text-amber-800 border-amber-200" };
  if (r.state === "Started") return { label: "In-house", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  return null;
}

// Reg Card prints the exact same ร.ร.๓ form as /rr3. get_bcp_snapshot's
// Timeline query already requests Customers:True from MEWS (needed for
// guest name/nationality), so identity_card_number/passport_number/
// occupation/address_details/alien_book below come from that same fetch,
// not an extra live call - captured into the snapshot, so still there once
// MEWS is down. Only GuestSign has no MEWS source at all (it's whatever the
// front desk types or the SignaturePad captures on screen).
const RR3_MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// dd/mmm/yyyy (e.g. 28/Jul/2026) specifically for the RR3 form's Date of
// Arrival/Expected Departure fields - matches _rr3_format_thai_date on the
// /rr3 side (same form, same token, same format). A fixed abbreviation
// array instead of toLocaleDateString/strftime %b avoids the month name
// silently depending on the browser's/server's locale. Deliberately
// separate from fmtDateOnly (DD/MM/YYYY), which is used all over this
// page's Manage view to mirror MEWS's own date display and shouldn't change.
function fmtRr3Date(isoUtc: string): string {
  if (!isoUtc) return "";
  const d = toBangkokDay(isoUtc);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${RR3_MONTH_ABBR[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
}

// Split from ReservationRow so a Reg Card can be built for ANY guest on the
// stay - the Owner or a companion - not just the reservation's own flat
// fields (which are really just the Owner's GuestIdentity, repackaged; see
// ownerGuestIdentity). roomNumberDisplay lets the caller (the component,
// where the display-name override lives) pass in the room number as the
// user actually sees it - this function is module-level, outside the
// component, so it can't reach roomNumberOverrides/effectiveRoomNumber
// itself. Falls back to stay.room (the raw MEWS number) if not given.
function buildRegCardTokens(
  guest: GuestIdentity,
  stay: { number: string; room: string; check_in: string; check_out: string },
  hotelName: string,
  roomNumberDisplay?: string
): Rr3TokenData {
  // first_name/last_name are MEWS's own separate fields (see
  // extract_guest_identity) - only split the combined name as a fallback,
  // for the unlikely case a profile is missing them.
  const nameParts = (guest.name || "").trim().split(/\s+/);
  const fmtTimeOnly = (iso: string) => {
    if (!iso) return "";
    const d = toBangkokDateTime(iso);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  return {
    HotelName: hotelName,
    FirstName: guest.first_name || nameParts[0] || "",
    LastName: guest.last_name || nameParts.slice(1).join(" "),
    ReservationsNumber: stay.number,
    RoomNumber: roomNumberDisplay ?? stay.room,
    CheckIn: fmtRr3Date(stay.check_in),
    CheckInTime: fmtTimeOnly(stay.check_in),
    CheckOut: fmtRr3Date(stay.check_out),
    CheckOutTime: fmtTimeOnly(stay.check_out),
    NationalityCode: guest.nationality,
    NationalityName: guest.nationality_name || guest.nationality,
    IdentityCardNumber: guest.identity_card_number,
    PassportNumber: guest.passport_number,
    // Print-safe default - ONLY for the printed form, so AddressDetails
    // never shows literally blank. guest.address_details itself is the raw
    // MEWS value (possibly empty) - the Guest Profile page shows it as-is
    // and must never see this fallback, or it would display fabricated data
    // as if MEWS had actually provided it. Occupation has no such fallback
    // (see regCardOccupation) - it's a required field the front desk fills
    // in themselves whenever MEWS doesn't have one, not guessed at.
    Occupation: guest.occupation || "",
    AddressDetails: guest.address_details || guest.nationality_name || guest.nationality || "",
    Telephone: guest.phone,
    AlienBook: guest.alien_book,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

const fmtDateTime = (v: string) => {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
};

// Matches MEWS's own note-timestamp precision (down to the second), unlike
// fmtDateTime above which only needs minute precision elsewhere.
const fmtNoteTimestamp = (v: string) => {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Bangkok" });
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
// MEWS's own Manage screen shows Arrival/Departure as "DD/MM/YYYY HH:MM:SS
// Weekday" (full weekday name, with seconds) - none of the shorter
// formatters above match that combination.
const fmtFullDateTime = (isoUtc: string) => {
  if (!isoUtc) return "-";
  const d = toBangkokDateTime(isoUtc);
  const time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `${fmtDateOnly(isoUtc)} ${time} ${weekday}`;
};
// Properties tab's Arrival/Departure editor needs plain <input type="date">/
// <input type="time"> values (Bangkok-local) rather than any of the display
// formats above, plus the reverse conversion back to a UTC instant on save -
// same +7h shift as toBangkokDateTime, just inverted.
const toBangkokInputDate = (isoUtc: string): string => {
  if (!isoUtc) return "";
  const d = toBangkokDateTime(isoUtc);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};
const toBangkokInputTime = (isoUtc: string): string => {
  if (!isoUtc) return "";
  const d = toBangkokDateTime(isoUtc);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const fromBangkokInput = (dateStr: string, timeStr: string): string | null => {
  if (!dateStr || !timeStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  if (!y || !m || !d || isNaN(hh) || isNaN(mm)) return null;
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0) - 7 * 3600_000).toISOString();
};
const guestInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((w) => w[0]).join("").toUpperCase() : "?";
};
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

// Matches MEWS's own housekeeping status colors: Clean=blue, Inspected=
// green, Dirty=dark orange, OutOfService=light orange/yellow, OutOfOrder=
// red. (Card/dot/badge previously disagreed with each other - e.g. Dirty
// rendered red on the card but amber as the dot, OutOfOrder the reverse -
// all three now share this same scheme.)
const ROOM_DOT_CLS: Record<string, string> = {
  Clean: "bg-sky-500",
  Inspected: "bg-emerald-500",
  Dirty: "bg-orange-600",
  OutOfService: "bg-amber-300",
  OutOfOrder: "bg-red-500",
};

// Same housekeeping states as ROOM_DOT_CLS, styled as a solid pill instead of
// a dot - used in the Manage view's room row (matches MEWS's own colored
// "Dirty"/"Clean" badge there).
const ROOM_STATE_BADGE_CLS: Record<string, string> = {
  Clean: "bg-sky-50 text-sky-700 border-sky-200",
  Inspected: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Dirty: "bg-orange-100 text-orange-800 border-orange-300",
  OutOfService: "bg-amber-50 text-amber-700 border-amber-200",
  OutOfOrder: "bg-red-50 text-red-700 border-red-200",
};

// Manually adjustable HK status options for the Rooms (HK) card grid.
// Overriding one here persists to our own database (see
// bcp_room_status_overrides / roomStatusOverrides below) but is NEVER sent
// to MEWS - there's nothing live to write it back to while MEWS is down,
// which is the entire premise of this tab. OutOfService/OutOfOrder require
// a typed reason (see roomStatusReasonFor below) before they're applied.
const ROOM_STATUS_OPTIONS = ["Inspected", "Clean", "Dirty", "OutOfService", "OutOfOrder"] as const;
const ROOM_STATUS_REQUIRES_REASON = new Set(["OutOfService", "OutOfOrder"]);
const ROOM_STATUS_CARD_CLS: Record<string, string> = {
  Clean: "bg-sky-50 border-sky-200",
  Inspected: "bg-emerald-50 border-emerald-200",
  Dirty: "bg-orange-50 border-orange-200",
  OutOfService: "bg-amber-50 border-amber-200",
  OutOfOrder: "bg-red-50 border-red-200",
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

// Show/hide wrapper for the header blocks above the tabs (description,
// property/snapshot picker, status bar) - all 3 share one externally-owned
// open state (a single toggle button covers all of them) so the actual
// data table gets more vertical room by default, one click away when
// actually needed. Only the block passed a label+onToggle renders the
// button itself; the others just follow the same `open` value.
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

export default function BcpPage() {
  // Fetched once for the Action Logs "User" column - who was signed in when
  // each Check In/Out/Chg Room/Room Status/Reg Card Saved entry was logged.
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserEmail(data.user?.email || ""));
  }, []);

  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  // Same green/amber/red BCP Auto Capture health check as the Dashboard
  // (GET /bcp/last-capture), scoped to just the property being viewed here
  // rather than every allowed property - front desk staff on this page
  // specifically want to know "is auto capture working for THIS hotel".
  const [bcpLastCapture, setBcpLastCapture] = useState<string | null>(null);
  const [bcpCaptureChecked, setBcpCaptureChecked] = useState(false);
  useEffect(() => {
    if (!selectedProperty) return;
    setBcpCaptureChecked(false);
    const fetchBcpHealth = async () => {
      try {
        const response = await fetch(`/api/bcp/last-capture?properties=${encodeURIComponent(selectedProperty)}`);
        const result = await response.json();
        setBcpLastCapture(result.status === "success" ? result.captured_at : null);
      } catch (err) {
        console.warn("Could not fetch BCP capture health:", err instanceof Error ? err.message : err);
      } finally {
        setBcpCaptureChecked(true);
      }
    };
    fetchBcpHealth();
  }, [selectedProperty]);
  const bcpMinutesSinceCapture = bcpLastCapture ? (Date.now() - new Date(bcpLastCapture).getTime()) / 60_000 : null;
  const bcpHealthLevel: "green" | "amber" | "red" =
    bcpMinutesSinceCapture === null ? "red" : bcpMinutesSinceCapture <= 10 ? "green" : bcpMinutesSinceCapture <= 30 ? "amber" : "red";
  const bcpHealthLabel = !bcpCaptureChecked
    ? "Checking…"
    : bcpMinutesSinceCapture === null
    ? "No snapshot yet"
    : bcpHealthLevel === "green"
    ? `Running (${Math.round(bcpMinutesSinceCapture)} min ago)`
    : bcpHealthLevel === "amber"
    ? `Delayed (${Math.round(bcpMinutesSinceCapture)} min ago)`
    : `Not running (${Math.round(bcpMinutesSinceCapture)} min ago)`;
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>("");
  const [snapshot, setSnapshot] = useState<BcpSnapshot | null>(null);
  const [isLiveFallback, setIsLiveFallback] = useState(false);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("timeline");
  // Housekeeping roles (Admin > Users > Role Settings, "House Keeping"
  // checkbox) only ever see the BCP link in the sidebar (see Navigation.tsx)
  // and, once inside, only the Rooms (HK) tab - Timeline/Action Logs are
  // hidden below and mainTab is forced there the moment this resolves true,
  // since housekeeping staff have no use for the rest of BCP.
  const [isHousekeepingRole, setIsHousekeepingRole] = useState(false);
  // Capture Now forces an out-of-cycle snapshot (the automatic one already
  // runs every 5 minutes) - gated to Super Admin only so front-desk/finance
  // roles aren't tempted to spam it.
  const [isSuperAdminRole, setIsSuperAdminRole] = useState(false);
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      const role = profile?.role;
      if (!role) return;
      if (role === "Super Admin" || role === "super_admin") {
        setIsSuperAdminRole(true);
        return;
      }
      const { data: permRow } = await supabase.from("role_permissions").select("housekeeping").eq("role", role).single();
      if (permRow?.housekeeping) {
        setIsHousekeepingRole(true);
        setMainTab("rooms");
      }
    })();
  }, []);
  // Reservations used to be a 4th tab alongside Timeline/Rooms/Logs, but the
  // reservation table stayed expanded by default whichever of those 3 was
  // active - now its own collapsed-by-default section (same show/hide
  // pattern as CollapsibleSection above) sitting independently above
  // whichever of the 3 tabs is showing, not part of the mutually-exclusive
  // tab switch at all.
  const [reservationsOpen, setReservationsOpen] = useState(false);
  // Reservations tab search (name/room/confirmation #) and sortable column
  // headers - client-side only, since frontDeskRows is already the full
  // day's list in memory.
  const [reservationSearch, setReservationSearch] = useState("");
  const [reservationSort, setReservationSort] = useState<{ key: ReservationSortKey; dir: "asc" | "desc" }>({ key: "room", dir: "asc" });
  // Same idea for Rooms (HK) and Action Logs - each tab searches its own data.
  const [roomSearch, setRoomSearch] = useState("");
  const [logSearch, setLogSearch] = useState("");
  // Default matches the server's own order (list_action_logs sorts
  // created_at desc), so leaving headers unclicked looks unchanged.
  const [logSort, setLogSort] = useState<{ key: ActionLogSortKey; dir: "asc" | "desc" }>({ key: "time", dir: "desc" });
  const [showReadme, setShowReadme] = useState(false);
  // English by default (matching every other label in the app), with a
  // toggle button in the modal itself for Thai - not persisted, resets to
  // English each session.
  const [readmeLang, setReadmeLang] = useState<"en" | "th" | "fil">("en");
  // Single toggle covering About BCP / Select Property & Snapshot / the
  // status bar - see CollapsibleSection above.
  const [headerOpen, setHeaderOpen] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<ReservationRow | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<RoomRow | null>(null);
  // Draft text for the Room Properties page's editable Number field - kept
  // as its own local state (like Chg Room's newRoomValue) rather than
  // writing straight into roomNumberOverrides on every keystroke.
  const [roomNumberDraft, setRoomNumberDraft] = useState("");
  const [showManagePage, setShowManagePage] = useState(false);
  const [manageTab, setManageTab] = useState<"reservation" | "group">("reservation");
  // Manage page's own tab bar (Status/Properties/Billing, matching MEWS's
  // own Status/Properties/Group/.../Billing order) - reset to "status" every
  // time Manage is opened, matching MEWS always landing there first.
  const [managePageTab, setManagePageTab] = useState<"status" | "properties" | "billing">("status");
  const [undoCheckInReason, setUndoCheckInReason] = useState("");
  const [undoCheckOutReason, setUndoCheckOutReason] = useState("");
  // Properties tab's Arrival/Departure + Room Type editors - both require a
  // typed reason before Save enables, same "Reason *" pattern as Undo Check
  // In/Out above. Seeded from the open reservation's current values by the
  // useEffect near effectiveRoomNumber below (keyed on selectedReservation's
  // number, not the whole object, so a later override-driven update to
  // selectedReservation itself doesn't clobber in-progress edits).
  const [editArrivalDate, setEditArrivalDate] = useState("");
  const [editArrivalTime, setEditArrivalTime] = useState("");
  const [editDepartureDate, setEditDepartureDate] = useState("");
  const [editDepartureTime, setEditDepartureTime] = useState("");
  const [arrivalChangeReason, setArrivalChangeReason] = useState("");
  const [savingArrivalChange, setSavingArrivalChange] = useState(false);
  const [editRoomType, setEditRoomType] = useState("");
  const [roomTypeChangeReason, setRoomTypeChangeReason] = useState("");
  const [savingRoomTypeChange, setSavingRoomTypeChange] = useState(false);
  // Billing tab's Process Payment modal - reads the reservation's own
  // itemized breakdown (already computed there) plus a Payment Note, and on
  // Save flips Billing Status permanently from "To be paid" to "Paid" (see
  // billingProcessedOverrides below), same one-way "can't undo, matches
  // MEWS's own Process payment" semantics as the rest of BCP.
  const [showProcessPaymentModal, setShowProcessPaymentModal] = useState(false);
  const [paymentNoteDraft, setPaymentNoteDraft] = useState("");
  const [savingPaymentProcess, setSavingPaymentProcess] = useState(false);
  // Billing tab's own expand/collapse state (separate from rateLinesOpen/
  // itemLinesOpen below, which belong to the reservation detail drawer's own
  // Rate/Items breakdown) - one flag for the Night group, one per distinct
  // item_lines product name (Service Charge, Room Adjustment, etc.) since
  // each is its own independently-expandable group.
  const [manageNightsOpen, setManageNightsOpen] = useState(false);
  const [manageItemGroupsOpen, setManageItemGroupsOpen] = useState<Record<string, boolean>>({});
  const [manageNotesOpen, setManageNotesOpen] = useState(false);
  const [rateLinesOpen, setRateLinesOpen] = useState(false);
  const [itemLinesOpen, setItemLinesOpen] = useState(false);
  // Full-page Guest Profile view (mirrors MEWS's own Profile screen), opened
  // by clicking ANY guest name - the reservation's Owner or a companion -
  // set to that specific guest's GuestIdentity so each opens its own data,
  // not always the reservation's primary guest.
  const [selectedGuestProfile, setSelectedGuestProfile] = useState<GuestIdentity | null>(null);
  // The fixed set of guests on the reservation selectedGuestProfile was
  // opened from (Owner + companions, see allReservationGuests) - lets the
  // Guest Profile page's "Related guests" box list "everyone else on this
  // booking" and navigate between them without needing to reopen the
  // reservation panel each time.
  const [guestProfileGroup, setGuestProfileGroup] = useState<GuestIdentity[]>([]);
  // The Guest Profile page's own tab bar (mirrors MEWS's Dashboard/Profile/
  // Internals/Contracting/Payments/Billing/Action log tabs - we only have
  // real data for three of those). Reset to "profile" every time a
  // different guest is opened, matching MEWS always landing there first.
  const [guestProfileTab, setGuestProfileTab] = useState<"profile" | "payments" | "billing">("profile");
  // The reservation selectedGuestProfile was opened from - Billing reuses
  // its already-fetched rate/item lines and total (same data the Manage
  // view's charge breakdown uses), since a guest has no bill of their own
  // independent of the stay they're attached to.
  const [guestProfileReservation, setGuestProfileReservation] = useState<ReservationRow | null>(null);

  // Notes added to the currently-open reservation through our own system
  // (permanent in bcp_reservation_notes, separate from bcp_snapshots) -
  // shown merged with MEWS's own res.notes in the Manage view. The one BCP
  // field that writes back into MEWS automatically once it's reachable
  // again (see sync_pending_reservation_notes on the backend) - synced
  // here just reflects whether that's already happened for display.
  const [reservationNotes, setReservationNotes] = useState<
    { id: string; text: string; created_at: string; created_by?: string; synced_to_mews: boolean }[]
  >([]);
  const [newNoteText, setNewNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Local corrections to the currently-open reservation's guest list -
  // editing a guest's profile, adding a walk-in MEWS never had, or removing
  // one from the displayed list (permanent in bcp_guest_overrides, separate
  // from bcp_snapshots). Keyed by guest_key: an existing guest's own
  // mews_customer_id for an edit/removal, or a client-generated "local-..."
  // id for one added here with no MEWS record at all.
  const [guestOverrides, setGuestOverrides] = useState<Record<string, { removed: boolean; data: GuestIdentity }>>({});
  // The guest currently being edited in the modal - null guestKey.startsWith
  // isn't needed here since isNew already distinguishes "editing an existing
  // guest" from "adding a brand new one" for the Save handler.
  const [editGuestFor, setEditGuestFor] = useState<{ guestKey: string; isNew: boolean } | null>(null);
  const [editGuestForm, setEditGuestForm] = useState<GuestIdentity | null>(null);
  // The guest's fields exactly as they were before this modal opened - kept
  // purely so handleSaveGuestEdit can log a field-by-field diff (Action Log
  // detail) instead of just "Edited guest X" with no indication of what
  // actually changed.
  const [editGuestOriginal, setEditGuestOriginal] = useState<GuestIdentity | null>(null);
  const [savingGuestEdit, setSavingGuestEdit] = useState(false);
  const [guestEditError, setGuestEditError] = useState<string | null>(null);
  const [removeGuestFor, setRemoveGuestFor] = useState<{ guestKey: string; guest: GuestIdentity } | null>(null);

  // Reservations tab (front-desk action list) - Check In/Out and Chg Room
  // can't write back to MEWS (that's the whole premise of this page: MEWS
  // is down), so they only log locally as the front desk's own paper trail
  // to re-key into MEWS once it's back. Persisted per property+date so it
  // survives a refresh during a long outage.
  const [actions, setActions] = useState<OfflineAction[]>([]);
  // regCardFor is the stay (dates/room/reservation number, shared by every
  // guest on it) - regCardGuestFor is WHICH guest's own Reg Card is open
  // (the Owner or a companion), since each has their own name/nationality/
  // passport/etc and needs their own printed card and saved signature.
  const [regCardFor, setRegCardFor] = useState<ReservationRow | null>(null);
  const [regCardGuestFor, setRegCardGuestFor] = useState<GuestIdentity | null>(null);
  // Set only when Reg Card is opened from Action Log Detail's "Open Reg
  // Card" button (which closes that page first so Reg Card isn't hidden
  // behind it - both are fixed inset-0 overlays) - Reg Card's own Close
  // button restores it, so closing goes back to that same log entry
  // instead of dropping straight to the bare Timeline. Left null (and so a
  // no-op) for every other Reg Card entry point, which never closed
  // anything to get here in the first place.
  const [regCardReturnLogEntry, setRegCardReturnLogEntry] = useState<OfflineAction | null>(null);
  // Same idea, for Reg Card opened from the reservation detail drawer's
  // Guests box - the drawer never closed itself before (it's a right-side
  // slide-over, not a full-page overlay), but it's declared later in the
  // JSX than Reg Card and both are fixed inset-0, so the still-open drawer
  // painted on top of Reg Card instead of Reg Card actually being visible.
  // Now the drawer closes when Reg Card opens, and Close restores it.
  const [regCardReturnReservation, setRegCardReturnReservation] = useState<ReservationRow | null>(null);
  // Captured on-screen at print time (SignaturePad), reset per guest. Not
  // persisted automatically - the front desk chooses to via the Save button,
  // which unlike Check In/Out/Chg Room/Room Status actually writes to
  // Supabase (bcp_reg_cards): a signed Reg Card is new data we're creating,
  // not something that needs to be reconciled back into MEWS later.
  const [guestSignature, setGuestSignature] = useState<string | null>(null);
  const [savingRegCard, setSavingRegCard] = useState(false);
  const [regCardSaveResult, setRegCardSaveResult] = useState<{ ok: boolean; message: string } | null>(null);
  // ร.ร.๓ sections 1 (Place of Departure) and 2 (Next Destination) - each is
  // a two-way choice between "the current address above" and "somewhere
  // else" (with a free-text line for that other address), so a single
  // "current"/"other" value per section can only ever have exactly one of
  // the two printed checkboxes marked - the form's own "answer at least one"
  // requirement holds automatically since "current" is the default.
  const [regCardDepartureOption, setRegCardDepartureOption] = useState<"current" | "other">("current");
  const [regCardDepartureDetail, setRegCardDepartureDetail] = useState("");
  const [regCardDestinationOption, setRegCardDestinationOption] = useState<"current" | "other">("current");
  const [regCardDestinationDetail, setRegCardDestinationDetail] = useState("");
  // Required field, unlike Departure/Destination above (which always have a
  // default answer) - MEWS's own customer profile very often has no
  // Occupation at all, and printing a fabricated "นักธุรกิจ" (businessman) in
  // that case was misrepresenting data MEWS never actually provided.
  // Pre-filled from MEWS when present (still editable/correctable), blank
  // otherwise - Save/Print are disabled until the front desk types one in.
  const [regCardOccupation, setRegCardOccupation] = useState("");
  // Pre-filled from MEWS's own customer profile when present (still
  // editable/correctable), same pattern as Occupation - but not required,
  // since MEWS usually does have an email on file already. Marketing
  // consent is a separate opt-in choice next to it - always starts
  // unchecked (never assumed) regardless of what's pre-filled here.
  const [regCardEmail, setRegCardEmail] = useState("");
  const [regCardMarketingConsent, setRegCardMarketingConsent] = useState(false);
  const [chgRoomFor, setChgRoomFor] = useState<ReservationRow | null>(null);
  const [newRoomValue, setNewRoomValue] = useState("");
  // Rooms (HK) tab - housekeeping status can't be written back to MEWS
  // (it's down), but unlike Check In/Check Out this is a real durable
  // current-state value, not just an audit-trail entry - persisted in
  // bcp_room_status_overrides, keyed by (property, room) only, so it
  // survives a device change and doesn't reset at midnight the way the old
  // localStorage-per-day version did.
  const [roomStatusOverrides, setRoomStatusOverrides] = useState<Record<string, string>>({});
  // The typed reason behind an OutOfService/OutOfOrder status (see the
  // required-reason modal below) - shown on the room's own card underneath
  // the status dropdown. Absent for any other status.
  const [roomStatusReasons, setRoomStatusReasons] = useState<Record<string, string>>({});
  // Which room a reservation is actually in right now, per Chg Room -
  // persisted in bcp_room_changes, keyed by (property, reservation_number).
  // Applied transparently in frontDeskRows below so every place that reads
  // r.room (the table, sort, search, the detail panel, Reg Card tokens)
  // automatically shows the current room without each needing its own fix.
  const [roomChangeOverrides, setRoomChangeOverrides] = useState<Record<string, string>>({});
  // Arrival/Departure override per reservation - persisted in
  // bcp_arrival_overrides, keyed by (property, reservation_number). Applied
  // the same transparent way as roomChangeOverrides in frontDeskRows below.
  const [arrivalOverrides, setArrivalOverrides] = useState<Record<string, { check_in?: string; check_out?: string; reason?: string }>>({});
  // Room type (category) override per reservation - persisted in
  // bcp_room_type_overrides, same (property, reservation_number) key.
  const [roomTypeOverrides, setRoomTypeOverrides] = useState<Record<string, { category: string; reason?: string }>>({});
  // Whether the Billing tab's Process Payment has been used on this
  // reservation - persisted in bcp_billing_overrides, same (property,
  // reservation_number) key. Presence alone means "processed" (there's no
  // un-process action, matching MEWS's own one-way behavior once paid).
  const [billingProcessedOverrides, setBillingProcessedOverrides] = useState<Record<string, { note?: string; processedAt: string }>>({});
  // Current housekeeping status for a room - the override if housekeeping
  // has changed it via Rooms (HK), otherwise whatever MEWS last reported.
  // Used everywhere a room's status color/badge shows (Timeline dot, Manage
  // view badge, Rooms (HK) card) so changing it in one place is reflected
  // everywhere immediately, not just on the Rooms (HK) card itself.
  const effectiveRoomState = (room: { room: string; state: string }) => roomStatusOverrides[room.room] || room.state;
  // Display-only room number override - persisted in
  // bcp_room_number_overrides, keyed by the ORIGINAL MEWS room number
  // (never the renamed value), so every other override that keys by room
  // number (status, reason, chg-room, action-log matching) keeps working
  // unchanged after a rename. Applied purely at display time everywhere a
  // room number shows on screen (Timeline, Rooms (HK), Reservations, Room
  // Properties, Reg Card) - never used for lookups/matching itself.
  const [roomNumberOverrides, setRoomNumberOverrides] = useState<Record<string, string>>({});
  const effectiveRoomNumber = useCallback((room: string) => roomNumberOverrides[room] || room, [roomNumberOverrides]);
  useEffect(() => {
    setRoomNumberDraft(selectedRoom ? effectiveRoomNumber(selectedRoom.room) : "");
  }, [selectedRoom, effectiveRoomNumber]);
  // Action Logs tab - clicking a logged row opens its own Detail view.
  const [selectedLogEntry, setSelectedLogEntry] = useState<OfflineAction | null>(null);
  // Action Log Detail's own tab bar (Log/Properties/Guest Profile) - local
  // and separate from showManagePage/selectedGuestProfile so opening these
  // tabs never triggers the live Manage page or the live Guest Profile page
  // navigation, and always reads selectedLogEntry.reservationSnapshot (the
  // frozen copy from when the action was logged) rather than any live or
  // rotating (bcp_snapshots) data.
  const [logDetailTab, setLogDetailTab] = useState<"log" | "properties" | "guestProfile">("log");
  // Which guest the embedded Guest Profile tab is showing - defaults to the
  // reservation's Owner, switchable via that tab's own Related Guests list.
  const [logGuestProfile, setLogGuestProfile] = useState<GuestIdentity | null>(null);
  const [logGuestProfileTab, setLogGuestProfileTab] = useState<"profile" | "payments" | "billing">("profile");
  useEffect(() => {
    setLogDetailTab("log");
    setLogGuestProfileTab("profile");
    if (selectedLogEntry?.reservationSnapshot) {
      const guests = allReservationGuests(selectedLogEntry.reservationSnapshot);
      // Default to whichever guest this specific action was actually about
      // (e.g. the companion a Reg Card was saved for), falling back to the
      // Owner for room-level actions (guest === "-").
      setLogGuestProfile(guests.find((gg) => gg.name === selectedLogEntry.guest) || guests[0]);
    } else {
      setLogGuestProfile(null);
    }
  }, [selectedLogEntry?.id]);

  // Reg Card prints on the exact same admin-editable ร.ร.๓ form as /rr3
  // (rr3_templates table) - fetched once, since it's one shared template
  // regardless of property, same as /print-rr3 itself.
  const [rr3Template, setRr3Template] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/rr3/template`);
        const result = await res.json();
        if (result.status === "success") setRr3Template(result.data.html_template);
      } catch {
        /* Print button below just stays disabled if this never loads. */
      }
    })();
  }, []);

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
    setShowManagePage(false);
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
    const groups: { category: string; startIdx: number; count: number }[] = [];
    rooms.forEach((r, i) => {
      const cat = r.group_category ?? r.category ?? "";
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

  const displayedHousekeepingRows = useMemo(() => {
    const q = roomSearch.trim().toLowerCase();
    if (!q) return housekeepingRows;
    return housekeepingRows.filter(
      (rm) => rm.room.toLowerCase().includes(q) || effectiveRoomNumber(rm.room).toLowerCase().includes(q) || rm.occupant.toLowerCase().includes(q)
    );
  }, [housekeepingRows, roomSearch, effectiveRoomNumber]);

  const frontDeskRows = useMemo(() => {
    if (!snapshot?.reservations) return [];
    const today = snapshot.date;
    return snapshot.reservations
      .map((raw) => {
        // Chg Room's override is applied here, once, so every downstream
        // consumer of r.room (this table, sort, search, the detail panel,
        // Reg Card tokens, Check In/Out log details) automatically shows
        // the room the guest is actually in instead of the stale
        // pre-change one, without each needing its own fix. Arrival/
        // Departure and Room Type overrides (Properties tab) are merged the
        // same way, for the same reason.
        const overriddenRoom = roomChangeOverrides[raw.number];
        const arrivalOverride = arrivalOverrides[raw.number];
        const roomTypeOverride = roomTypeOverrides[raw.number];
        const r = {
          ...raw,
          ...(overriddenRoom && overriddenRoom !== raw.room ? { room: overriddenRoom } : {}),
          ...(arrivalOverride?.check_in ? { check_in: arrivalOverride.check_in } : {}),
          ...(arrivalOverride?.check_out ? { check_out: arrivalOverride.check_out } : {}),
          ...(roomTypeOverride ? { category: roomTypeOverride.category } : {}),
        };
        return { r, status: frontDeskStatus(r, today) };
      })
      .filter((x): x is { r: ReservationRow; status: { label: string; cls: string } } => x.status !== null)
      .sort((a, b) => a.r.room.localeCompare(b.r.room, undefined, { numeric: true }));
  }, [snapshot, roomChangeOverrides, arrivalOverrides, roomTypeOverrides]);

  // Search matches guest (covers first/last name together) + room + the
  // reservation/confirmation number; sort is column-driven via the table
  // headers below. Kept separate from frontDeskRows so the tab's badge
  // count above always reflects the full unfiltered list.
  const displayedFrontDeskRows = useMemo(() => {
    const q = reservationSearch.trim().toLowerCase();
    const filtered = q
      ? frontDeskRows.filter(
          ({ r }) =>
            r.guest.toLowerCase().includes(q) ||
            r.room.toLowerCase().includes(q) ||
            effectiveRoomNumber(r.room).toLowerCase().includes(q) ||
            r.number.toLowerCase().includes(q) ||
            (r.travel_agency_confirmation_number || "").toLowerCase().includes(q)
        )
      : frontDeskRows;
    const { key, dir } = reservationSort;
    const sign = dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (key) {
        case "status":
          return sign * a.status.label.localeCompare(b.status.label);
        case "guest":
          return sign * a.r.guest.localeCompare(b.r.guest);
        case "dates":
          return sign * a.r.check_in.localeCompare(b.r.check_in);
        case "room":
          return sign * effectiveRoomNumber(a.r.room).localeCompare(effectiveRoomNumber(b.r.room), undefined, { numeric: true });
        case "category":
          return sign * (a.r.category || "").localeCompare(b.r.category || "");
        default:
          return 0;
      }
    });
  }, [frontDeskRows, reservationSearch, reservationSort, effectiveRoomNumber]);

  const handleReservationSort = (key: ReservationSortKey) => {
    setReservationSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  };

  const reservationSortArrow = (key: ReservationSortKey) => {
    if (reservationSort.key !== key) return "";
    return reservationSort.dir === "asc" ? " ▲" : " ▼";
  };

  // Action Logs used to live in localStorage only - moved to Supabase
  // (bcp_action_logs) per feedback that it must never be lost to a device
  // change or a cleared browser. Rows are never pruned (unlike
  // bcp_snapshots' 1-hour history) - kept forever. Fetches every entry for
  // the property, not scoped to any one date: an unresolved (not yet
  // re-keyed into MEWS) action shouldn't stop being flagged, and shouldn't
  // disappear from the log, just because a day passed. A per-date filter
  // was tried and removed - it made yesterday's entries invisible the
  // moment the date rolled over, looking exactly like data loss even though
  // nothing was ever deleted.
  useEffect(() => {
    if (!snapshot) {
      setActions([]);
      return;
    }
    (async () => {
      try {
        const params = new URLSearchParams({ property_name: snapshot.property });
        const res = await fetch(`/api/bcp/action-logs?${params.toString()}`);
        const result = await res.json();
        setActions(result.status === "success" ? result.data || [] : []);
      } catch {
        setActions([]);
      }
    })();
  }, [snapshot?.property]);

  const logOfflineAction = async (entry: Omit<OfflineAction, "id" | "checked" | "userEmail">) => {
    if (!snapshot) return;
    try {
      const res = await fetch("/api/bcp/action-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_name: snapshot.property,
          report_date: snapshot.date,
          reservation_number: entry.reservationNumber,
          guest: entry.guest,
          room: entry.room,
          action: entry.action,
          detail: entry.detail,
          reason: entry.reason,
          user_email: currentUserEmail,
          reservation_snapshot: entry.reservationSnapshot,
          guest_profile_snapshot: entry.guestProfileSnapshot,
        }),
      });
      const result = await res.json();
      if (result.status === "success" && result.data) {
        setActions((prev) => [result.data, ...prev]);
      }
    } catch {
      /* action still happened locally (room status override, etc.) - only
         the audit-trail write failed. Nothing to roll back here. */
    }
  };

  // Same guest-matching rule used by the Manage view's detail panel (email
  // first, falling back to exact name) - shared here so Action Log entries
  // can freeze the matched profile at log time too.
  const findGuestProfile = useCallback(
    (r: ReservationRow | null | undefined): CustomerRow | null => {
      if (!r || !snapshot) return null;
      return snapshot.customers.find((c) => (r.email && c.email === r.email) || c.name === r.guest) || null;
    },
    [snapshot]
  );

  // The reservation currently checked into a room (if any) - used to attach
  // Reservation Detail/Guest Profile to room-level actions (Room Status,
  // Room Number) that have no reservation of their own, per explicit
  // request: attach the occupant's info when the room happens to be
  // occupied at the moment of the change.
  const findOccupantReservation = useCallback(
    (room: string): ReservationRow | undefined => (snapshot?.reservations || []).find((r) => r.room === room && r.state === "Started"),
    [snapshot]
  );

  const handleToggleActionChecked = async (id: string) => {
    const current = actions.find((a) => a.id === id);
    if (!current) return;
    const nextChecked = !current.checked;
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, checked: nextChecked } : a)));
    try {
      await fetch("/api/bcp/action-logs/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, checked: nextChecked }),
      });
    } catch {
      setActions((prev) => prev.map((a) => (a.id === id ? { ...a, checked: !nextChecked } : a)));
    }
  };

  // Most recent action for a reservation/room that's still unresolved (not
  // BCP-Checked) - once checked, that record stops flagging its source row
  // red, same as if nothing were outstanding.
  const latestActionFor = (number: string) => actions.find((a) => a.reservationNumber === number && !a.checked);
  const unresolvedActionsCount = actions.filter((a) => !a.checked).length;

  // Chronological sequence number (1 = the very first action ever logged,
  // increasing up to the most recent) - fixed to creation order regardless
  // of whatever sort/filter the table's currently displaying, since actions
  // itself is always server-ordered created_at desc (newest first), so the
  // entry at index i has sequence number (actions.length - i).
  const actionSeqNo = useMemo(() => {
    const map = new Map<string, number>();
    actions.forEach((a, i) => map.set(a.id, actions.length - i));
    return map;
  }, [actions]);

  const displayedActions = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    const filtered = q
      ? actions.filter(
          (a) =>
            a.guest.toLowerCase().includes(q) ||
            a.room.toLowerCase().includes(q) ||
            effectiveRoomNumber(a.room).toLowerCase().includes(q) ||
            a.action.toLowerCase().includes(q) ||
            a.detail.toLowerCase().includes(q) ||
            (a.userEmail || "").toLowerCase().includes(q)
        )
      : actions;
    const { key, dir } = logSort;
    const sign = dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (key) {
        case "time":
          return sign * a.at.localeCompare(b.at);
        case "guest":
          return sign * a.guest.localeCompare(b.guest);
        case "room":
          return sign * effectiveRoomNumber(a.room).localeCompare(effectiveRoomNumber(b.room), undefined, { numeric: true });
        case "action":
          return sign * a.action.localeCompare(b.action);
        case "detail":
          return sign * a.detail.localeCompare(b.detail);
        case "userEmail":
          return sign * (a.userEmail || "").localeCompare(b.userEmail || "");
        case "checked":
          return sign * (Number(a.checked) - Number(b.checked));
        default:
          return 0;
      }
    });
  }, [actions, logSearch, logSort, effectiveRoomNumber]);

  const handleLogSort = (key: ActionLogSortKey) => {
    setLogSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  };

  const logSortArrow = (key: ActionLogSortKey) => {
    if (logSort.key !== key) return "";
    return logSort.dir === "asc" ? " ▲" : " ▼";
  };

  // CSV rather than a real .xlsx - Excel opens it natively with no extra
  // library, matching the reused-browser-print-dialog precedent for Reg
  // Card (prefer what the browser/Excel already does over adding a new
  // dependency). Exports exactly what's currently visible - respects the
  // search box and column sort already applied to the table.
  const handleExportActionLogsToExcel = () => {
    const headers = ["No.", "Time", "Guest", "Room", "Action", "Detail", "User", "BCP Check"];
    const rows = displayedActions.map((a) => [
      actionSeqNo.get(a.id) ?? "",
      fmtDateTime(a.at),
      a.guest,
      effectiveRoomNumber(a.room),
      a.action,
      a.detail,
      a.userEmail || "-",
      a.checked ? "Yes" : "No",
    ]);
    const escapeCsv = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    // BOM so Excel reads guest/user names with Thai or other non-ASCII
    // characters as UTF-8 instead of guessing the wrong codepage.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safeProperty = (snapshot?.property || "property").replace(/[\\/:*?"<>|]/g, "").trim();
    link.download = `bcp-action-logs-${safeProperty}-${fmtYMD(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // knownRoomState lets a caller that just changed the room's status in this
  // same synchronous call (handleConfirmCheckIn below) pass the new value
  // directly - roomStateFor would otherwise re-read roomStatusOverrides
  // before React has applied that setState, seeing the stale pre-change
  // status instead.
  const handleCheckIn = (r: ReservationRow, knownRoomState?: string) => {
    logOfflineAction({
      at: new Date().toISOString(),
      reservationNumber: r.number,
      guest: r.guest,
      room: r.room,
      action: "Check In",
      detail: `Room ${effectiveRoomNumber(r.room)}`,
      reservationSnapshot: r,
      guestProfileSnapshot: findGuestProfile(r),
    });
    // Check-in occupies the room - MEWS marks it Dirty (needs housekeeping
    // service during the stay), distinct from Clean/Inspected which only
    // describe a vacant, ready-for-the-next-guest room. Skipped for
    // OutOfService/OutOfOrder so a genuine maintenance flag isn't silently
    // overwritten by a check-in that shouldn't be happening on that room
    // anyway.
    const currentRoomState = knownRoomState ?? roomStateFor(r.room);
    if (currentRoomState !== "Dirty" && currentRoomState !== "OutOfService" && currentRoomState !== "OutOfOrder") {
      handleRoomStatusChange(r.room, currentRoomState, "Dirty");
    }
  };
  const handleCheckOut = (r: ReservationRow) =>
    logOfflineAction({
      at: new Date().toISOString(),
      reservationNumber: r.number,
      guest: r.guest,
      room: r.room,
      action: "Check Out",
      detail: `Room ${effectiveRoomNumber(r.room)}`,
      reservationSnapshot: r,
      guestProfileSnapshot: findGuestProfile(r),
    });
  // Manage > Status tab's Undo Check In/Out - mirrors MEWS's own "Undo
  // check-in"/"Undo check-out" (both require a typed reason before MEWS
  // lets you proceed) - reason is required here the same way, and recorded
  // as its own field so the Action Log Detail page can show it even though
  // there's nowhere live to actually apply the undo while MEWS is down.
  const handleUndoCheckIn = (r: ReservationRow, reason: string) => {
    if (!reason.trim()) return;
    logOfflineAction({
      at: new Date().toISOString(),
      reservationNumber: r.number,
      guest: r.guest,
      room: r.room,
      action: "Undo Check In",
      detail: `Room ${effectiveRoomNumber(r.room)}`,
      reason: reason.trim(),
      reservationSnapshot: r,
      guestProfileSnapshot: findGuestProfile(r),
    });
    setUndoCheckInReason("");
  };
  const handleUndoCheckOut = (r: ReservationRow, reason: string) => {
    if (!reason.trim()) return;
    logOfflineAction({
      at: new Date().toISOString(),
      reservationNumber: r.number,
      guest: r.guest,
      room: r.room,
      action: "Undo Check Out",
      detail: `Room ${effectiveRoomNumber(r.room)}`,
      reason: reason.trim(),
      reservationSnapshot: r,
      guestProfileSnapshot: findGuestProfile(r),
    });
    setUndoCheckOutReason("");
  };
  // MEWS's own "Started"/"Processed" state is one source of truth, but while
  // MEWS is down a Check In/Out (or an Undo of either) logged just now only
  // exists in our own actions list - the snapshot's state field can't
  // reflect it. actions is always server-ordered newest-first, so the first
  // match among these four action types is the most recent one either way -
  // whichever it is takes priority over the stale snapshot state.
  const effectiveCheckStatus = (r: ReservationRow): "to_check_in" | "checked_in" | "checked_out" => {
    const latest = actions.find(
      (a) => a.reservationNumber === r.number && (a.action === "Check In" || a.action === "Check Out" || a.action === "Undo Check In" || a.action === "Undo Check Out")
    );
    if (latest) {
      if (latest.action === "Check In") return "checked_in";
      if (latest.action === "Check Out") return "checked_out";
      if (latest.action === "Undo Check In") return "to_check_in";
      return "checked_in"; // Undo Check Out reverts back to checked in
    }
    if (r.state === "Started") return "checked_in";
    if (r.state === "Processed") return "checked_out";
    return "to_check_in";
  };
  const isReservationCheckedIn = (r: ReservationRow): boolean => effectiveCheckStatus(r) !== "to_check_in";
  // Whether Check Out has already been logged locally for this stay - r.state
  // stays "Started" until MEWS is reachable again to actually process the
  // checkout, so isReservationCheckedIn above never flips on its own and the
  // Check Out button would otherwise stay clickable forever (letting the
  // front desk log the same checkout repeatedly). Disabling it once logged
  // is the visible confirmation that it's been recorded.
  const hasCheckedOutLocally = (r: ReservationRow): boolean => effectiveCheckStatus(r) === "checked_out";
  // Every live badge/Timeline-bar color that reads STATE_BADGE_CLS/
  // STATE_DISPLAY_LABEL should key off this instead of the raw r.state -
  // r.state can never actually change while MEWS is unreachable (that's the
  // whole premise of BCP), so a locally-logged Check In/Out used to leave
  // the badge/bar showing the stale pre-action state (e.g. still
  // "Confirmed"/grey after Check In). Action Log Detail's own `snap.state`
  // usages are deliberately NOT routed through this - those show the frozen
  // historical state at the time that log entry was recorded, not "now".
  const effectiveReservationState = (r: ReservationRow): string => {
    const status = effectiveCheckStatus(r);
    if (status === "checked_in") return "Started";
    if (status === "checked_out") return "Processed";
    return r.state;
  };

  const roomStateFor = (roomNumber: string): string => {
    const room = snapshot?.rooms.find((rm) => rm.room === roomNumber);
    return room ? effectiveRoomState(room) : "";
  };

  // Mirrors MEWS's own "Please inspect room before check in" prompt - Check
  // In on a Dirty room opens this instead of logging immediately, and only
  // lets the front desk proceed once they've ticked "Make inspected" (which
  // also flips the room's status to Inspected, same as ticking it would in
  // MEWS). Any other status checks in immediately, unchanged.
  const [checkInFor, setCheckInFor] = useState<ReservationRow | null>(null);
  const [checkInMakeInspected, setCheckInMakeInspected] = useState(false);
  const requestCheckIn = (r: ReservationRow) => {
    if (roomStateFor(r.room) === "Dirty") {
      setCheckInFor(r);
      setCheckInMakeInspected(false);
    } else {
      handleCheckIn(r);
    }
  };
  const handleConfirmCheckIn = () => {
    if (!checkInFor || !checkInMakeInspected) return;
    handleRoomStatusChange(checkInFor.room, "Dirty", "Inspected");
    handleCheckIn(checkInFor, "Inspected");
    setCheckInFor(null);
  };

  const handleChgRoomSave = () => {
    if (!chgRoomFor || !newRoomValue.trim() || !snapshot?.property) return;
    const newRoom = newRoomValue.trim();
    logOfflineAction({
      at: new Date().toISOString(),
      reservationNumber: chgRoomFor.number,
      guest: chgRoomFor.guest,
      room: chgRoomFor.room,
      action: "Chg Room",
      detail: `${effectiveRoomNumber(chgRoomFor.room)} -> ${newRoom}`,
      reservationSnapshot: chgRoomFor,
      guestProfileSnapshot: findGuestProfile(chgRoomFor),
    });
    setRoomChangeOverrides((prev) => ({ ...prev, [chgRoomFor.number]: newRoom }));
    fetch("/api/bcp/room-changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_name: snapshot.property, reservation_number: chgRoomFor.number, new_room: newRoom }),
    }).catch(() => {
      /* logOfflineAction above still records the intent even if this write failed */
    });
    setChgRoomFor(null);
    setNewRoomValue("");
  };

  const handleSaveRegCard = async () => {
    if (!regCardFor || !snapshot || !regCardOccupation.trim()) return;
    const guest = regCardGuestFor || ownerGuestIdentity(regCardFor);
    setSavingRegCard(true);
    setRegCardSaveResult(null);
    try {
      const res = await fetch("/api/bcp/reg-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_name: snapshot.property,
          reservation_number: regCardFor.number,
          // Keyed by mews_customer_id, not just reservation_number - a
          // reservation can have multiple guests (Owner + companions), each
          // with their own signed card, sharing the same stay.
          mews_customer_id: guest.mews_customer_id,
          guest: guest.name,
          nationality: guest.nationality,
          room: regCardFor.room,
          category: regCardFor.category,
          check_in: regCardFor.check_in,
          check_out: regCardFor.check_out,
          adults: regCardFor.adults,
          children: regCardFor.children,
          signature_data_url: guestSignature,
          occupation: regCardOccupation,
          email: regCardEmail,
          marketing_consent: regCardMarketingConsent,
          departure_option: regCardDepartureOption,
          departure_detail: regCardDepartureDetail,
          destination_option: regCardDestinationOption,
          destination_detail: regCardDestinationDetail,
        }),
      });
      const result = await res.json();
      if (result.status === "success") {
        setRegCardSaveResult({ ok: true, message: "Saved to our system" });
        logOfflineAction({
          at: new Date().toISOString(),
          reservationNumber: regCardFor.number,
          guest: guest.name,
          room: regCardFor.room,
          action: "Reg Card Saved",
          detail: guestSignature ? "Reg Card saved with signature" : "Reg Card saved (no signature)",
          reservationSnapshot: regCardFor,
          guestProfileSnapshot: { name: guest.name, tags: [], nationality: guest.nationality, email: guest.email, phone: guest.phone, notes: "" },
        });
      } else {
        setRegCardSaveResult({ ok: false, message: result.message || result.detail || "Save failed" });
      }
    } catch (err: any) {
      setRegCardSaveResult({ ok: false, message: err.message || "Save failed" });
    } finally {
      setSavingRegCard(false);
    }
  };

  // Chrome/Edge/Firefox's own "Save as PDF" destination in the print dialog
  // defaults its suggested filename to document.title - set to "Booking No
  // + guest name" right before printing (per explicit preference, over
  // building a separate client-side PDF export) so a front desk saving the
  // signed card gets a sensible filename without typing one, then restored
  // once the dialog closes (afterprint fires either way - printed or
  // cancelled) so it doesn't leak into the tab title afterwards.
  const handlePrintRegCard = () => {
    if (!regCardFor) return;
    const guest = regCardGuestFor || ownerGuestIdentity(regCardFor);
    const safeGuestName = (guest.name || "guest").replace(/[\\/:*?"<>|]/g, "").trim();
    const originalTitle = document.title;
    document.title = `${regCardFor.number}_${safeGuestName}`;
    const restoreTitle = () => {
      document.title = originalTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);
    window.print();
  };

  // Fetches our own notes for whichever reservation is currently open
  // (slide-over or Manage page both set selectedReservation) - merged with
  // MEWS's own res.notes for display in the Manage view.
  useEffect(() => {
    if (!selectedReservation || !snapshot?.property) {
      setReservationNotes([]);
      return;
    }
    const params = new URLSearchParams({ property_name: snapshot.property, reservation_number: selectedReservation.number });
    (async () => {
      try {
        const res = await fetch(`/api/bcp/reservation-notes?${params.toString()}`);
        const result = await res.json();
        setReservationNotes(result.status === "success" ? result.data || [] : []);
      } catch {
        setReservationNotes([]);
      }
    })();
  }, [selectedReservation?.number, snapshot?.property]);

  // Adds a note permanently to our own system and queues it to be written
  // into MEWS itself the next time a capture succeeds (see
  // sync_pending_reservation_notes on the backend) - the one BCP field
  // that writes back to MEWS automatically, and only ever as an addition.
  const handleAddReservationNote = async () => {
    if (!selectedReservation || !snapshot?.property || !newNoteText.trim() || !selectedReservation.mews_reservation_id) return;
    const text = newNoteText.trim();
    setSavingNote(true);
    try {
      const res = await fetch("/api/bcp/reservation-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_name: snapshot.property,
          reservation_number: selectedReservation.number,
          mews_reservation_id: selectedReservation.mews_reservation_id,
          text,
          user_email: currentUserEmail,
        }),
      });
      const result = await res.json();
      if (result.status === "success" && result.data) {
        setReservationNotes((prev) => [result.data, ...prev]);
        setNewNoteText("");
        logOfflineAction({
          at: new Date().toISOString(),
          reservationNumber: selectedReservation.number,
          guest: selectedReservation.guest,
          room: selectedReservation.room,
          action: "Note Added",
          detail: text,
          reservationSnapshot: selectedReservation,
          guestProfileSnapshot: findGuestProfile(selectedReservation),
        });
      }
    } catch {
      /* left in the textarea so the user can retry */
    } finally {
      setSavingNote(false);
    }
  };

  // Seeds the Properties tab's Arrival/Departure + Room Type editors from
  // whichever reservation is currently open - keyed on just the number (not
  // the whole object) so a later override-driven update to selectedReservation
  // itself (see handleSaveArrivalChange/handleSaveRoomTypeChange below)
  // doesn't stomp on an in-progress edit.
  useEffect(() => {
    if (!selectedReservation) return;
    setEditArrivalDate(toBangkokInputDate(selectedReservation.check_in));
    setEditArrivalTime(toBangkokInputTime(selectedReservation.check_in));
    setEditDepartureDate(toBangkokInputDate(selectedReservation.check_out));
    setEditDepartureTime(toBangkokInputTime(selectedReservation.check_out));
    setArrivalChangeReason("");
    setEditRoomType(selectedReservation.category || "");
    setRoomTypeChangeReason("");
    setShowProcessPaymentModal(false);
    setPaymentNoteDraft("");
  }, [selectedReservation?.number]);

  // Properties tab's Arrival/Departure Save - requires a typed reason (same
  // gating as Undo Check In/Out) and at least one of the two to have actually
  // changed. Persists to bcp_arrival_overrides, mirrors the change onto
  // selectedReservation immediately (so the open view reflects it without
  // requiring the reservation to be reselected, same as every other override
  // here), and logs it for the Action Log.
  const handleSaveArrivalChange = () => {
    if (!selectedReservation || !snapshot?.property || !arrivalChangeReason.trim()) return;
    const newCheckIn = fromBangkokInput(editArrivalDate, editArrivalTime);
    const newCheckOut = fromBangkokInput(editDepartureDate, editDepartureTime);
    if (!newCheckIn || !newCheckOut) return;
    // Compared at the input's own minute precision, not against the raw
    // stored ISO value (which can carry seconds, e.g. "...:45") - otherwise
    // every save would look "changed" purely from the round-trip's seconds
    // getting zeroed out, even with the date/time fields untouched.
    const arrivalChanged = editArrivalDate !== toBangkokInputDate(selectedReservation.check_in) || editArrivalTime !== toBangkokInputTime(selectedReservation.check_in);
    const departureChanged = editDepartureDate !== toBangkokInputDate(selectedReservation.check_out) || editDepartureTime !== toBangkokInputTime(selectedReservation.check_out);
    if (!arrivalChanged && !departureChanged) return;
    const reason = arrivalChangeReason.trim();
    const changes: string[] = [];
    if (arrivalChanged) changes.push(`Arrival: ${fmtFullDateTime(selectedReservation.check_in)} -> ${fmtFullDateTime(newCheckIn)}`);
    if (departureChanged) changes.push(`Departure: ${fmtFullDateTime(selectedReservation.check_out)} -> ${fmtFullDateTime(newCheckOut)}`);
    setSavingArrivalChange(true);
    setArrivalOverrides((prev) => ({ ...prev, [selectedReservation.number]: { check_in: newCheckIn, check_out: newCheckOut, reason } }));
    setSelectedReservation((prev) => (prev && prev.number === selectedReservation.number ? { ...prev, check_in: newCheckIn, check_out: newCheckOut } : prev));
    logOfflineAction({
      at: new Date().toISOString(),
      reservationNumber: selectedReservation.number,
      guest: selectedReservation.guest,
      room: selectedReservation.room,
      action: "Arrival Changed",
      detail: changes.join(" | "),
      reason,
      reservationSnapshot: selectedReservation,
      guestProfileSnapshot: findGuestProfile(selectedReservation),
    });
    fetch("/api/bcp/arrival-overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property_name: snapshot.property,
        reservation_number: selectedReservation.number,
        check_in: newCheckIn,
        check_out: newCheckOut,
        reason,
      }),
    })
      .catch(() => {
        /* logOfflineAction above still records the intent even if this write failed */
      })
      .finally(() => setSavingArrivalChange(false));
    setArrivalChangeReason("");
  };

  // Properties tab's Room Type Save - same reason-gating pattern, populated
  // from the property's own resource categories (snapshot.rooms) rather than
  // free text, so it always matches a category the property actually has.
  const handleSaveRoomTypeChange = () => {
    if (!selectedReservation || !snapshot?.property || !roomTypeChangeReason.trim() || !editRoomType.trim()) return;
    const previousCategory = selectedReservation.category || "-";
    if (editRoomType === previousCategory) return;
    const reason = roomTypeChangeReason.trim();
    const newCategory = editRoomType;
    setSavingRoomTypeChange(true);
    setRoomTypeOverrides((prev) => ({ ...prev, [selectedReservation.number]: { category: newCategory, reason } }));
    setSelectedReservation((prev) => (prev && prev.number === selectedReservation.number ? { ...prev, category: newCategory } : prev));
    logOfflineAction({
      at: new Date().toISOString(),
      reservationNumber: selectedReservation.number,
      guest: selectedReservation.guest,
      room: selectedReservation.room,
      action: "Room Type Changed",
      detail: `Room Type: ${previousCategory} -> ${newCategory}`,
      reason,
      reservationSnapshot: selectedReservation,
      guestProfileSnapshot: findGuestProfile(selectedReservation),
    });
    fetch("/api/bcp/room-type-overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property_name: snapshot.property,
        reservation_number: selectedReservation.number,
        category: newCategory,
        reason,
      }),
    })
      .catch(() => {
        /* logOfflineAction above still records the intent even if this write failed */
      })
      .finally(() => setSavingRoomTypeChange(false));
    setRoomTypeChangeReason("");
  };

  // Billing tab's Process Payment Save - one-way (no un-process), matching
  // MEWS's own behavior once a bill is actually settled. Payment Note is
  // optional (unlike the Arrival/Room Type reasons above, which are
  // required) since there's nothing ambiguous being overridden here.
  const handleProcessPayment = () => {
    if (!selectedReservation || !snapshot?.property) return;
    const note = paymentNoteDraft.trim();
    const processedAt = new Date().toISOString();
    setSavingPaymentProcess(true);
    setBillingProcessedOverrides((prev) => ({ ...prev, [selectedReservation.number]: { note: note || undefined, processedAt } }));
    logOfflineAction({
      at: processedAt,
      reservationNumber: selectedReservation.number,
      guest: selectedReservation.guest,
      room: selectedReservation.room,
      action: "Payment Processed",
      detail: `Processed: ${(selectedReservation.to_be_paid ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${selectedReservation.currency || ""}`,
      reason: note || undefined,
      reservationSnapshot: selectedReservation,
      guestProfileSnapshot: findGuestProfile(selectedReservation),
    });
    fetch("/api/bcp/billing-overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property_name: snapshot.property,
        reservation_number: selectedReservation.number,
        note: note || null,
      }),
    })
      .catch(() => {
        /* logOfflineAction above still records the intent even if this write failed */
      })
      .finally(() => setSavingPaymentProcess(false));
    setShowProcessPaymentModal(false);
    setPaymentNoteDraft("");
  };

  // Same fetch pattern as reservationNotes above, for the currently-open
  // reservation's guest edits/additions/removals.
  useEffect(() => {
    if (!selectedReservation || !snapshot?.property) {
      setGuestOverrides({});
      return;
    }
    const params = new URLSearchParams({ property_name: snapshot.property, reservation_number: selectedReservation.number });
    (async () => {
      try {
        const res = await fetch(`/api/bcp/guest-overrides?${params.toString()}`);
        const result = await res.json();
        if (result.status === "success") {
          const map: Record<string, { removed: boolean; data: GuestIdentity }> = {};
          (result.data || []).forEach((row: { guest_key: string; removed: boolean; data: GuestIdentity }) => {
            map[row.guest_key] = { removed: row.removed, data: row.data };
          });
          setGuestOverrides(map);
        } else {
          setGuestOverrides({});
        }
      } catch {
        setGuestOverrides({});
      }
    })();
  }, [selectedReservation?.number, snapshot?.property]);

  // Every guest actually shown for the currently-open reservation: the
  // Owner/companions from the frozen snapshot with any saved edits merged
  // in and any removed ones filtered out, plus guests added here that MEWS
  // never had at all. guest_key mirrors how overrides are stored - an
  // existing guest's own mews_customer_id, or the "local-..." id a locally
  // added guest was created with.
  const effectiveDrawerGuests = useMemo(() => {
    if (!selectedReservation) return [];
    const base = allReservationGuests(selectedReservation).map((g, i) => ({
      guestKey: g.mews_customer_id || `owner-${selectedReservation.number}`,
      guest: g,
      isOwner: i === 0,
    }));
    const merged = base
      .map((entry) => {
        const ov = guestOverrides[entry.guestKey];
        return ov ? { ...entry, guest: ov.data, removed: ov.removed } : { ...entry, removed: false };
      })
      .filter((entry) => !entry.removed);
    const added = Object.entries(guestOverrides)
      .filter(([key, ov]) => key.startsWith("local-") && !ov.removed)
      .map(([key, ov]) => ({ guestKey: key, guest: ov.data, isOwner: false }));
    return [...merged, ...added];
  }, [selectedReservation, guestOverrides]);

  const handleOpenEditGuest = (guestKey: string, guest: GuestIdentity) => {
    setEditGuestFor({ guestKey, isNew: false });
    setEditGuestForm({ ...guest });
    setEditGuestOriginal({ ...guest });
    setGuestEditError(null);
  };

  const handleAddGuest = () => {
    const guestKey = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const blank: GuestIdentity = { name: "", nationality: "", email: "", phone: "" };
    setEditGuestFor({ guestKey, isNew: true });
    setEditGuestForm(blank);
    setGuestEditError(null);
  };

  const handleSaveGuestEdit = async () => {
    if (!editGuestFor || !editGuestForm || !selectedReservation || !snapshot?.property) return;
    setSavingGuestEdit(true);
    setGuestEditError(null);
    try {
      const res = await fetch("/api/bcp/guest-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_name: snapshot.property,
          reservation_number: selectedReservation.number,
          guest_key: editGuestFor.guestKey,
          removed: false,
          data: editGuestForm,
        }),
      });
      const result = await res.json();
      if (result.status === "success") {
        setGuestOverrides((prev) => ({ ...prev, [editGuestFor.guestKey]: { removed: false, data: editGuestForm } }));
        logOfflineAction({
          at: new Date().toISOString(),
          reservationNumber: selectedReservation.number,
          guest: editGuestForm.name,
          room: selectedReservation.room,
          action: editGuestFor.isNew ? "Guest Added" : "Guest Edited",
          detail: summarizeGuestChanges(editGuestFor.isNew ? null : editGuestOriginal, editGuestForm, editGuestFor.isNew ? "added" : "edited"),
          reservationSnapshot: selectedReservation,
          guestProfileSnapshot: findGuestProfile(selectedReservation),
        });
        setEditGuestFor(null);
        setEditGuestForm(null);
        setEditGuestOriginal(null);
      } else {
        // Previously silent (empty catch, no status check) - a failed save
        // just left the modal sitting there with no sign anything went
        // wrong, indistinguishable from Save not working at all.
        setGuestEditError(result.detail || result.message || "Could not save this guest. Please try again.");
      }
    } catch {
      setGuestEditError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSavingGuestEdit(false);
    }
  };

  const handleRemoveGuest = async (guestKey: string, guest: GuestIdentity) => {
    if (!selectedReservation || !snapshot?.property) return;
    try {
      const res = await fetch("/api/bcp/guest-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_name: snapshot.property,
          reservation_number: selectedReservation.number,
          guest_key: guestKey,
          removed: true,
          data: guest,
        }),
      });
      const result = await res.json();
      if (result.status === "success") {
        setGuestOverrides((prev) => ({ ...prev, [guestKey]: { removed: true, data: guest } }));
        logOfflineAction({
          at: new Date().toISOString(),
          reservationNumber: selectedReservation.number,
          guest: guest.name,
          room: selectedReservation.room,
          action: "Guest Removed",
          detail: summarizeGuestChanges(null, guest, "removed"),
          reservationSnapshot: selectedReservation,
          guestProfileSnapshot: findGuestProfile(selectedReservation),
        });
      }
    } catch {
      /* no local state change on failure - front desk sees it's still there and can retry */
    }
  };

  // Reg Card button - restores a previously saved signature (if Save was
  // already used for this guest) instead of always starting blank, since
  // save_reg_card persists it but had no matching read until now. guest
  // defaults to the reservation's own Owner (matching the Reservations
  // table's existing single-guest button) but any guest on the stay - a
  // companion included - can open their own card.
  const handleOpenRegCard = async (r: ReservationRow, guest?: GuestIdentity) => {
    const g = guest || ownerGuestIdentity(r);
    setRegCardFor(r);
    setRegCardGuestFor(g);
    setGuestSignature(null);
    setRegCardSaveResult(null);
    // Reset both here, not just at declaration - every entry point calls
    // this function, so a stale return target from a previous Action Log
    // Detail or reservation-drawer visit can't leak into an unrelated Reg
    // Card opened afterwards. Whichever entry point actually applies sets
    // its own return target right back after this call.
    setRegCardReturnLogEntry(null);
    setRegCardReturnReservation(null);
    setRegCardDepartureOption("current");
    setRegCardDepartureDetail("");
    setRegCardDestinationOption("current");
    setRegCardDestinationDetail("");
    setRegCardOccupation(g.occupation || "");
    setRegCardEmail(g.email || "");
    setRegCardMarketingConsent(false);
    if (!snapshot) return;
    try {
      const params = new URLSearchParams({ property_name: snapshot.property, reservation_number: r.number, mews_customer_id: g.mews_customer_id || "" });
      const res = await fetch(`/api/bcp/reg-card?${params.toString()}`);
      const result = await res.json();
      if (result.status === "success" && result.data?.signature_data_url) {
        // Signatures saved before signature capture cropped to ink are still
        // the full blank canvas (off-center on the printed line) - crop on
        // read so older saved Reg Cards self-heal without re-signing.
        setGuestSignature(await cropSignatureDataUrlToInk(result.data.signature_data_url));
      }
      if (result.status === "success" && result.data) {
        if (result.data.departure_option === "other") setRegCardDepartureOption("other");
        if (result.data.departure_detail) setRegCardDepartureDetail(result.data.departure_detail);
        if (result.data.destination_option === "other") setRegCardDestinationOption("other");
        if (result.data.destination_detail) setRegCardDestinationDetail(result.data.destination_detail);
        if (result.data.occupation) setRegCardOccupation(result.data.occupation);
        if (result.data.email) setRegCardEmail(result.data.email);
        if (result.data.marketing_consent) setRegCardMarketingConsent(true);
      }
    } catch {
      /* no saved card yet, or fetch failed - start blank as before */
    }
  };

  useEffect(() => {
    if (!snapshot?.property) {
      setRoomStatusOverrides({});
      setRoomStatusReasons({});
      setRoomChangeOverrides({});
      setRoomNumberOverrides({});
      setArrivalOverrides({});
      setRoomTypeOverrides({});
      setBillingProcessedOverrides({});
      return;
    }
    const params = new URLSearchParams({ property_name: snapshot.property });
    (async () => {
      try {
        const res = await fetch(`/api/bcp/room-status?${params.toString()}`);
        const result = await res.json();
        const data: Record<string, { status: string; reason?: string | null }> = result.status === "success" ? result.data || {} : {};
        const statuses: Record<string, string> = {};
        const reasons: Record<string, string> = {};
        for (const [room, info] of Object.entries(data)) {
          statuses[room] = info.status;
          if (info.reason) reasons[room] = info.reason;
        }
        setRoomStatusOverrides(statuses);
        setRoomStatusReasons(reasons);
      } catch {
        setRoomStatusOverrides({});
        setRoomStatusReasons({});
      }
    })();
    (async () => {
      try {
        const res = await fetch(`/api/bcp/room-changes?${params.toString()}`);
        const result = await res.json();
        setRoomChangeOverrides(result.status === "success" ? result.data || {} : {});
      } catch {
        setRoomChangeOverrides({});
      }
    })();
    (async () => {
      try {
        const res = await fetch(`/api/bcp/room-numbers?${params.toString()}`);
        const result = await res.json();
        setRoomNumberOverrides(result.status === "success" ? result.data || {} : {});
      } catch {
        setRoomNumberOverrides({});
      }
    })();
    (async () => {
      try {
        const res = await fetch(`/api/bcp/arrival-overrides?${params.toString()}`);
        const result = await res.json();
        setArrivalOverrides(result.status === "success" ? result.data || {} : {});
      } catch {
        setArrivalOverrides({});
      }
    })();
    (async () => {
      try {
        const res = await fetch(`/api/bcp/room-type-overrides?${params.toString()}`);
        const result = await res.json();
        setRoomTypeOverrides(result.status === "success" ? result.data || {} : {});
      } catch {
        setRoomTypeOverrides({});
      }
    })();
    (async () => {
      try {
        const res = await fetch(`/api/bcp/billing-overrides?${params.toString()}`);
        const result = await res.json();
        setBillingProcessedOverrides(result.status === "success" ? result.data || {} : {});
      } catch {
        setBillingProcessedOverrides({});
      }
    })();
  }, [snapshot?.property]);

  const handleRoomStatusChange = (room: string, previousStatus: string, newStatus: string, reason?: string) => {
    if (!snapshot?.property || newStatus === previousStatus) return;
    setRoomStatusOverrides((prev) => ({ ...prev, [room]: newStatus }));
    setRoomStatusReasons((prev) => {
      if (reason) return { ...prev, [room]: reason };
      const next = { ...prev };
      delete next[room];
      return next;
    });
    fetch("/api/bcp/room-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_name: snapshot.property, room, status: newStatus, reason: reason || null }),
    }).catch(() => {
      /* logOfflineAction below still records the intent even if this write failed */
    });
    const occupant = findOccupantReservation(room);
    logOfflineAction({
      at: new Date().toISOString(),
      guest: "-",
      room,
      action: "Room Status",
      detail: `Room ${effectiveRoomNumber(room)}: ${previousStatus} -> ${newStatus}`,
      reason,
      reservationSnapshot: occupant,
      guestProfileSnapshot: findGuestProfile(occupant),
    });
  };

  // Renames how a room's number is DISPLAYED everywhere (Timeline, Rooms
  // (HK), Reservations, Reg Card, this page) without touching `room` (the
  // original MEWS number), which stays the key every other override
  // (status, reason, chg-room, action-log matching) is keyed by.
  const handleRoomNumberChange = (room: string, newDisplayNumber: string) => {
    if (!snapshot?.property) return;
    const trimmed = newDisplayNumber.trim();
    const previousDisplay = effectiveRoomNumber(room);
    if (!trimmed || trimmed === previousDisplay) return;
    setRoomNumberOverrides((prev) => ({ ...prev, [room]: trimmed }));
    fetch("/api/bcp/room-numbers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_name: snapshot.property, room, display_number: trimmed }),
    }).catch(() => {
      /* logOfflineAction below still records the intent even if this write failed */
    });
    const occupant = findOccupantReservation(room);
    logOfflineAction({
      at: new Date().toISOString(),
      guest: "-",
      room,
      action: "Room Number",
      detail: `Room ${previousDisplay}: renamed to ${trimmed}`,
      reservationSnapshot: occupant,
      guestProfileSnapshot: findGuestProfile(occupant),
    });
  };

  // OutOfService/OutOfOrder require a typed reason before the change is
  // actually applied - selecting one from the dropdown opens this instead
  // of calling handleRoomStatusChange directly; every other status still
  // applies immediately, same as before.
  const [roomStatusReasonFor, setRoomStatusReasonFor] = useState<{ room: string; previousStatus: string; newStatus: string } | null>(null);
  const [roomStatusReasonText, setRoomStatusReasonText] = useState("");
  const handleRoomStatusSelect = (room: string, previousStatus: string, newStatus: string) => {
    if (ROOM_STATUS_REQUIRES_REASON.has(newStatus)) {
      setRoomStatusReasonFor({ room, previousStatus, newStatus });
      setRoomStatusReasonText("");
    } else {
      handleRoomStatusChange(room, previousStatus, newStatus);
    }
  };
  const handleConfirmRoomStatusReason = () => {
    if (!roomStatusReasonFor || !roomStatusReasonText.trim()) return;
    handleRoomStatusChange(roomStatusReasonFor.room, roomStatusReasonFor.previousStatus, roomStatusReasonFor.newStatus, roomStatusReasonText.trim());
    setRoomStatusReasonFor(null);
    setRoomStatusReasonText("");
  };

  const matchedGuestProfile = useMemo(() => findGuestProfile(selectedReservation), [selectedReservation, findGuestProfile]);
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

  // Distinct room categories at this property (e.g. "The Duo | King"),
  // sourced from the room list itself so the Properties tab's Room Type
  // picker only ever offers categories that actually exist here.
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    (snapshot?.rooms || []).forEach((rm) => {
      if (rm.category) set.add(rm.category);
    });
    return Array.from(set).sort();
  }, [snapshot]);

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
  const highlightAndScrollToRoom = (room: string) => {
    setHighlightedRoom(room);
    scrollToRoom(room);
    setTimeout(() => setHighlightedRoom((cur) => (cur === room ? null : cur)), 1500);
  };
  // Room number first (matches the existing behavior exactly), then falls
  // back to reservation/confirmation number, travel agency confirmation
  // number, and guest name - same fields the Reservations list's own search
  // already matches on (see displayedFrontDeskRows above) - landing on
  // whichever room that reservation is in.
  const handleSpaceSearch = () => {
    const query = spaceSearch.trim().toLowerCase();
    if (!query || !snapshot) return;
    const roomMatch = snapshot.rooms.find((r) => r.room.toLowerCase().includes(query) || effectiveRoomNumber(r.room).toLowerCase().includes(query));
    if (roomMatch) {
      highlightAndScrollToRoom(roomMatch.room);
      return;
    }
    const resMatch = (snapshot.reservations || []).find(
      (r) =>
        r.number.toLowerCase().includes(query) ||
        (r.travel_agency_confirmation_number || "").toLowerCase().includes(query) ||
        r.guest.toLowerCase().includes(query) ||
        (r.companions || []).some((c) => (c.name || "").toLowerCase().includes(query))
    );
    if (resMatch?.room) highlightAndScrollToRoom(resMatch.room);
  };


  // Shared with the main return below (which this page's early return
  // bypasses entirely) so choosing OutOfService/OutOfOrder from the Status
  // dropdown on this page can open the same required-reason modal.
  const roomStatusReasonModal = roomStatusReasonFor && (
    <div className="no-print fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setRoomStatusReasonFor(null)}>
      <div className="bg-[var(--paper)] text-[var(--text-primary)] border border-[var(--text-primary)]/14 max-w-sm w-full shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="font-display text-xl mb-1">Reason Required</div>
        <div className="text-[12px] text-[var(--text-primary)]/60 mb-4">
          Room {effectiveRoomNumber(roomStatusReasonFor.room)} — marking as {roomStatusReasonFor.newStatus === "OutOfOrder" ? "Out of Order" : "Out of Service"}
        </div>
        <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">Reason</label>
        <textarea
          autoFocus
          rows={3}
          value={roomStatusReasonText}
          onChange={(e) => setRoomStatusReasonText(e.target.value)}
          placeholder="e.g. AC broken, awaiting maintenance"
          className="w-full mt-1 bg-[var(--bg-primary)] border border-[var(--text-primary)]/14 px-4 py-2 text-[13px] text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none resize-none"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => setRoomStatusReasonFor(null)} className="px-4 py-2 text-[11px] font-bold tracked-caps border border-[var(--text-primary)]/20 hover:bg-[var(--text-primary)]/5 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleConfirmRoomStatusReason}
            disabled={!roomStatusReasonText.trim()}
            className="px-4 py-2 text-[11px] font-bold tracked-caps bg-amber-400 text-[#152A00] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );

  // Mirrors MEWS's own Check In dialog for a Dirty room - "Check in" stays
  // disabled until "Make inspected" is ticked, which both flips the room to
  // Inspected and completes the check-in on confirm (see handleConfirmCheckIn).
  const checkInDirtyModal = checkInFor && (
    <div className="no-print fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setCheckInFor(null)}>
      <div className="bg-[var(--paper)] text-[var(--text-primary)] border border-[var(--text-primary)]/14 max-w-sm w-full shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="font-display text-xl mb-4">Check in</div>
        <div className="text-[13px] mb-3">Please inspect room before check in</div>
        <div className="flex items-center gap-2 mb-5">
          <span className="font-bold text-[14px]">{effectiveRoomNumber(checkInFor.room)}</span>
          <span className={`px-2 py-0.5 text-[10px] font-bold border rounded ${ROOM_STATE_BADGE_CLS.Dirty}`}>Dirty</span>
        </div>
        <label className="flex items-center gap-2 text-[13px] cursor-pointer">
          <input
            type="checkbox"
            checked={checkInMakeInspected}
            onChange={(e) => setCheckInMakeInspected(e.target.checked)}
            className="w-4 h-4"
          />
          Make inspected
        </label>
        <div className="flex justify-end items-center gap-4 mt-6">
          <button onClick={() => setCheckInFor(null)} className="text-[12px] font-bold tracked-caps text-[var(--text-primary)]/60 hover:text-[var(--text-primary)] transition-colors">
            Go back
          </button>
          <button
            onClick={handleConfirmCheckIn}
            disabled={!checkInMakeInspected}
            className="px-5 py-2.5 text-[11px] font-bold tracked-caps bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Check in
          </button>
        </div>
      </div>
    </div>
  );

  // Guest Profile - a full page (not a drawer), same "replace the whole BCP
  // view" pattern as Room Properties below, mirroring MEWS's own Profile
  // screen. Opened by clicking any guest name (reservation Owner or a
  // companion, see ownerGuestIdentity/selectedGuestProfile) - closing it
  // (back arrow) just clears selectedGuestProfile, which naturally falls
  // through back to the reservation panel below since selectedReservation
  // itself is untouched. Every Profile field MEWS's own screen shows is
  // captured now (Title/Sex/Date of birth/Country of birth/Place of birth,
  // confirmed against a live Customer record) except Loyalty and
  // Verification photo, which have no equivalent anywhere in our data -
  // those are left out entirely rather than shown as fake blanks.
  if (selectedGuestProfile) {
    const g = selectedGuestProfile;
    const fieldBoxCls = "px-3 py-2.5 rounded-lg bg-[var(--text-primary)]/5 text-[var(--text-primary)] text-[13px]";
    // MEWS's payment Type/sub-type are PascalCase enums ("ExternalPayment" +
    // "Prepayment") - split into words rather than showing the raw enum,
    // matching MEWS's own "External payment Prepayment" wording loosely.
    const fmtPaymentType = (p: GuestPayment) => {
      const base = p.type.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
      return p.sub_type ? `${base} ${p.sub_type}` : base;
    };
    return (
      <div className="flex-1 p-4 md:p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => setSelectedGuestProfile(null)} className="p-1 text-[var(--text-primary)]/50 hover:text-[var(--text-primary)] transition-colors shrink-0">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h1 className="font-display text-4xl text-[var(--text-primary)]">{g.name || "(no name)"}</h1>
          </div>

          <div className="flex gap-6 border-b border-[var(--text-primary)]/10 mb-8">
            {(["profile", "payments", "billing"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setGuestProfileTab(t)}
                className={`pb-3 text-[13px] font-bold capitalize border-b-2 -mb-px transition-all ${
                  guestProfileTab === t
                    ? "border-[var(--text-primary)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {guestProfileTab === "profile" && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6">
            <div className="border border-[var(--text-primary)]/14 rounded-xl p-5 flex flex-col gap-4">
              <div className="font-display text-xl text-[var(--text-primary)]">Profile</div>
              <div>
                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Email</div>
                <div className={fieldBoxCls}>{g.email || "-"}</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Title</div>
                  <div className={fieldBoxCls}>{g.title || "-"}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">First name</div>
                  <div className={fieldBoxCls}>{g.first_name || "-"}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Last name</div>
                  <div className={fieldBoxCls}>{g.last_name || "-"}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Second last name</div>
                  <div className={fieldBoxCls}>{g.second_last_name || "-"}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Nationality</div>
                  <div className={fieldBoxCls}>{g.nationality_name || g.nationality || "-"}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Language</div>
                  <div className={fieldBoxCls}>{g.language || "-"}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Telephone</div>
                  <div className={fieldBoxCls}>{g.phone || "-"}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Sex</div>
                  <div className={fieldBoxCls}>{g.sex || "-"}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Date of birth</div>
                  <div className={fieldBoxCls}>{fmtBirthDate(g.birth_date) || "-"}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Country of birth</div>
                  <div className={fieldBoxCls}>{g.birth_country_name || "-"}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Place of birth</div>
                  <div className={fieldBoxCls}>{g.birth_place || "-"}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Occupation</div>
                  <div className={fieldBoxCls}>{g.occupation || "-"}</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <div className="border border-[var(--text-primary)]/14 rounded-xl p-5">
                <div className="font-display text-lg text-[var(--text-primary)] mb-3">Identity documents</div>
                {g.passport_number || g.identity_card_number || g.alien_book ? (
                  <div className="flex flex-col gap-3">
                    {g.passport_number && (
                      <div>
                        <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Passport</div>
                        <div className={fieldBoxCls}>{g.passport_number}</div>
                      </div>
                    )}
                    {g.identity_card_number && (
                      <div>
                        <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">ID Card</div>
                        <div className={fieldBoxCls}>{g.identity_card_number}</div>
                      </div>
                    )}
                    {g.alien_book && (
                      <div>
                        <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Alien Book</div>
                        <div className={fieldBoxCls}>{g.alien_book}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[var(--text-primary)]/40 italic text-[13px]">No data available.</div>
                )}
              </div>

              <div className="border border-[var(--text-primary)]/14 rounded-xl p-5">
                <div className="font-display text-lg text-[var(--text-primary)] mb-3">Addresses</div>
                {g.address_details ? (
                  <div className="text-[13px] text-[var(--text-primary)]">{g.address_details}</div>
                ) : (
                  <div className="text-[var(--text-primary)]/40 italic text-[13px]">No data available.</div>
                )}
              </div>

              {/* Other guests on the same reservation (MEWS's own
                  equivalent lists guests it suggests might be related) -
                  clicking one navigates within the same fixed group
                  (guestProfileGroup) instead of needing to close this page
                  and reopen the reservation panel. */}
              <div className="border border-[var(--text-primary)]/14 rounded-xl p-5">
                <div className="font-display text-lg text-[var(--text-primary)] mb-3">Related guests</div>
                {guestProfileGroup.filter((rg) => rg !== g).length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {guestProfileGroup.filter((rg) => rg !== g).map((rg, i) => (
                      <button key={i} onClick={() => { setSelectedGuestProfile(rg); setGuestProfileTab("profile"); }} className="flex items-center gap-3 text-left">
                        <div className="w-8 h-8 rounded-full bg-[var(--text-primary)]/10 flex items-center justify-center text-[11px] font-bold shrink-0">
                          {guestInitials(rg.name || "?")}
                        </div>
                        <span className="font-bold text-[13px] underline decoration-1 underline-offset-2 hover:text-blue-600 transition-colors">
                          {rg.name || "(no name)"}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-[var(--text-primary)]/40 italic text-[13px]">No data available.</div>
                )}
              </div>

              {/* MEWS attaches uploaded scans/registration cards here - our
                  snapshot never fetches file attachments at all (a
                  different, much heavier endpoint than anything else the
                  Timeline needs), so this is always empty rather than
                  fabricating filenames MEWS never gave us. */}
              <div className="border border-[var(--text-primary)]/14 rounded-xl p-5">
                <div className="font-display text-lg text-[var(--text-primary)] mb-3">Files</div>
                <div className="text-[var(--text-primary)]/40 italic text-[13px]">No data available.</div>
              </div>
            </div>
          </div>
          )}

          {/* Payments - fetched per guest (see payments_by_customer in
              get_bcp_snapshot), since MEWS links a payment to the paying
              Customer's AccountId rather than a reservation. Preauthorizations
              are a different MEWS concept (card holds) we don't fetch at all,
              so that section is always the same empty state MEWS itself
              shows when there are none. */}
          {guestProfileTab === "payments" && (
            <div>
              <div className="font-display text-2xl text-[var(--text-primary)] mb-5">Payments</div>
              <div className="border border-[var(--text-primary)]/14 rounded-xl overflow-hidden mb-8">
                {g.payments && g.payments.length > 0 ? (
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[11px] text-[var(--text-primary)]/50 border-b border-[var(--text-primary)]/10">
                        <th className="p-3 font-normal">Type</th>
                        <th className="p-3 font-normal">Identifier</th>
                        <th className="p-3 font-normal">Created</th>
                        <th className="p-3 font-normal">State</th>
                        <th className="p-3 font-normal">Notes</th>
                        <th className="p-3 font-normal text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.payments.map((p, i) => (
                        <tr key={i} className="border-b border-[var(--text-primary)]/10 last:border-0">
                          <td className="p-3">{fmtPaymentType(p)}</td>
                          <td className="p-3">{p.identifier || "-"}</td>
                          <td className="p-3 whitespace-nowrap">{fmtDateTime(p.created)}</td>
                          <td className="p-3">{p.state}</td>
                          <td className="p-3">{p.notes || "-"}</td>
                          <td className="p-3 text-right font-bold">
                            {p.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} {p.currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-[var(--text-primary)]/10">
                        <td colSpan={5} className="p-3 text-right font-bold">Total</td>
                        <td className="p-3 text-right font-bold">
                          {g.payments.reduce((s, p) => s + p.amount, 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} {g.payments[0].currency}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <div className="p-5 text-[var(--text-primary)]/40 italic text-[13px]">No payments recorded.</div>
                )}
              </div>

              <div className="font-display text-2xl text-[var(--text-primary)] mb-5">Preauthorizations</div>
              <div className="border border-[var(--text-primary)]/14 rounded-xl p-10 text-center text-[var(--text-primary)]/40 italic text-[13px]">
                No preauthorizations yet.
              </div>
            </div>
          )}

          {/* Billing - reuses the same rate/item lines and total the
              Manage view's charge breakdown already shows for this
              reservation (fetched from orderItems for the whole window,
              not just today), since a guest has no bill independent of the
              stay they're attached to. Bill name (e.g. "LE-27-7-6043") is
              resolved from the BillId already present on those same order
              items via a dedicated bills/getAll lookup - MEWS's own
              "Number" field stays null until a bill is formally issued/
              closed (confirmed live against this exact still-open bill),
              so "Name" is used instead. Preview/Process payment/Issue
              proforma/Close (and the line-item/payment checkboxes) are
              disabled - decorative, matching every other action button in
              BCP, since there's no live connection to actually process
              anything from a stale snapshot. The top toolbar MEWS shows
              above "Owned bills" (grouping/search/Closed bills/Unpaid
              invoices) is for browsing MULTIPLE bills - not recreated,
              since this page only ever has the one bill for this stay. */}
          {guestProfileTab === "billing" && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <div className="font-display text-2xl text-[var(--text-primary)]">Owned bills</div>
                {guestProfileReservation && (
                  <span className="text-[12px] font-bold text-[var(--text-primary)]/50">
                    {(guestProfileReservation.to_be_paid ?? 0) === 0 ? "Balanced" : "Unbalanced"}
                  </span>
                )}
              </div>
              {guestProfileReservation ? (
                <div className="border border-[var(--text-primary)]/14 rounded-xl overflow-hidden">
                  <div className="p-5 flex items-center justify-between border-b border-[var(--text-primary)]/10 gap-4">
                    <div className="font-bold text-[15px]">{guestProfileReservation.bill_name || guestProfileReservation.number}</div>
                    <div className="flex items-center gap-8">
                      <div>
                        <div className="text-[10px] text-[var(--text-primary)]/50 tracked-caps mb-0.5">Reservation status</div>
                        <span className={`inline-block px-2.5 py-1 text-[10px] font-bold border rounded ${STATE_BADGE_CLS[effectiveReservationState(guestProfileReservation)] || STATE_BADGE_CLS.Processed}`}>
                          {STATE_DISPLAY_LABEL[effectiveReservationState(guestProfileReservation)] || effectiveReservationState(guestProfileReservation)}
                        </span>
                      </div>
                      <div>
                        <div className="text-[10px] text-[var(--text-primary)]/50 tracked-caps mb-0.5">Arrival</div>
                        <div className="text-[13px] font-bold">{fmtDateOnly(guestProfileReservation.check_in)}</div>
                      </div>
                      <div className="px-4 py-2 rounded-lg bg-[var(--text-primary)]/5 text-right shrink-0">
                        <div className="text-[10px] text-[var(--text-primary)]/50 tracked-caps mb-0.5">To be paid</div>
                        <div className="font-bold text-[14px]">
                          {(guestProfileReservation.to_be_paid ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} {guestProfileReservation.currency}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[1fr_220px]">
                    <div className="p-5 border-b md:border-b-0 md:border-r border-[var(--text-primary)]/10">
                      <div className="flex items-center gap-3 mb-4 text-[12px] text-[var(--text-primary)]/60">
                        <input type="checkbox" disabled className="w-4 h-4" />
                        <span>Select all ({(guestProfileReservation.rate_lines?.length || 0) + (guestProfileReservation.item_lines?.length || 0)})</span>
                        <button disabled className="ml-auto px-3 py-1.5 text-[10px] font-bold tracked-caps border border-[var(--text-primary)]/20 opacity-50 cursor-not-allowed">
                          + Add product
                        </button>
                      </div>
                      <div className="flex flex-col">
                        {guestProfileReservation.rate_lines?.map((line, i) => (
                          <div key={`r${i}`} className="flex items-center gap-3 text-[13px] py-2 border-b border-[var(--text-primary)]/5 last:border-0">
                            <input type="checkbox" disabled className="w-4 h-4 shrink-0" />
                            <span className="text-[var(--text-primary)]/70">{guestProfileReservation.guest} — {effectiveRoomNumber(guestProfileReservation.room)}</span>
                            <span className="text-[var(--text-primary)]/50">— Stay {line.label}</span>
                            <span className="ml-auto font-bold shrink-0">{line.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                        {guestProfileReservation.item_lines?.map((line, i) => (
                          <div key={`i${i}`} className="flex items-center gap-3 text-[13px] py-2 border-b border-[var(--text-primary)]/5 last:border-0">
                            <input type="checkbox" disabled className="w-4 h-4 shrink-0" />
                            <span className="text-[var(--text-primary)]/70">{line.label}</span>
                            <span className="ml-auto font-bold shrink-0">{line.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                        {!guestProfileReservation.rate_lines?.length && !guestProfileReservation.item_lines?.length && (
                          <div className="text-[var(--text-primary)]/40 italic text-[13px] py-2">No charges recorded.</div>
                        )}
                      </div>

                      {g.payments && g.payments.length > 0 && (
                        <>
                          <div className="text-[11px] font-bold tracked-caps text-[var(--text-primary)]/50 mt-5 mb-2">Payments</div>
                          <div className="flex flex-col">
                            {g.payments.map((p, i) => (
                              <div key={`p${i}`} className="flex items-center gap-3 text-[13px] py-2 border-b border-[var(--text-primary)]/5 last:border-0">
                                <input type="checkbox" disabled className="w-4 h-4 shrink-0" />
                                <span className="text-[var(--text-primary)]/70">{fmtPaymentType(p)}{p.identifier ? ` — ${p.identifier}` : ""}</span>
                                <span className="ml-auto font-bold shrink-0">{p.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="p-5 flex flex-col gap-2">
                      <button disabled className="w-full px-4 py-2.5 text-[11px] font-bold tracked-caps border border-[var(--text-primary)]/20 opacity-50 cursor-not-allowed">Preview</button>
                      <button disabled className="w-full px-4 py-2.5 text-[11px] font-bold tracked-caps bg-blue-600 text-white opacity-50 cursor-not-allowed">Process payment</button>
                      <button disabled className="w-full px-4 py-2.5 text-[11px] font-bold tracked-caps border border-[var(--text-primary)]/20 opacity-50 cursor-not-allowed">Issue proforma</button>
                      <button disabled className="w-full px-4 py-2.5 text-[11px] font-bold tracked-caps bg-blue-600 text-white opacity-50 cursor-not-allowed">Close</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-[var(--text-primary)]/40 italic text-[13px]">No data available.</div>
              )}
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-[var(--text-primary)]/10 text-[13px] text-[var(--text-primary)]/40 italic">
            Read-only snapshot - no live connection to MEWS, so nothing here can actually be changed.
          </div>
        </div>
      </div>
    );
  }

  // Room Properties - a full page (not a drawer), replacing the whole BCP
  // view exactly like MEWS's own Room Properties screen does (their icon
  // rail stays, but everything to its right becomes this page). Read-only:
  // the "Clean"/"Out of service"/"Out of order" buttons are disabled -
  // decorative, matching MEWS's layout, but there's nothing live to action
  // from a stale snapshot (same reasoning as every other disabled action in
  // BCP). Status is the one exception - it's our own durable override (see
  // roomStatusOverrides), so it's a real editable dropdown here too, same
  // as the Rooms (HK) tab. "Reason for status" shows our own recorded
  // reason if there is one (see roomStatusReasons), otherwise the same
  // explanation as before: MEWS's StateReason is write-only to
  // resources/update, never returned by resources/getAll. "Recent space
  // changes" also keeps its layout slot but stays a fixed explanation -
  // there is no resource-history/activity-log endpoint anywhere in the
  // Connector API - confirmed against MEWS's own docs, not a missing join.
  if (selectedRoom) {
    const room = selectedRoom;
    const disabledBtnCls = "opacity-50 cursor-not-allowed";
    const fieldBoxCls = "px-3 py-2.5 rounded-lg bg-[var(--text-primary)]/5 text-[var(--text-primary)] text-[13px] flex items-center justify-between";
    const chevron = (
      <svg className="w-4 h-4 text-[var(--text-primary)]/30 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
    );
    return (
      <div className="flex-1 p-4 md:p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedRoom(null)} className="p-1 text-[var(--text-primary)]/50 hover:text-[var(--text-primary)] transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
              <h1 className="font-display text-4xl text-[var(--text-primary)]">{effectiveRoomNumber(room.room)}</h1>
            </div>
            <button
              disabled
              title="No live connection to MEWS to manage this room from here"
              className={`p-2.5 rounded-lg border border-[var(--text-primary)]/14 text-[var(--text-primary)]/40 ${disabledBtnCls}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {/* Left column: Properties */}
            <div>
              <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <h2 className="font-display text-2xl text-[var(--text-primary)]">Properties</h2>
                <div className="flex gap-2">
                  <button disabled title="No live connection to MEWS to manage this room from here" className={`px-4 py-2 rounded-lg bg-blue-600 text-white text-[13px] font-bold ${disabledBtnCls}`}>Clean</button>
                  <button disabled title="No live connection to MEWS to manage this room from here" className={`px-4 py-2 rounded-lg border border-[var(--text-primary)]/20 text-[var(--text-primary)]/60 text-[13px] font-bold ${disabledBtnCls}`}>Out of service</button>
                </div>
              </div>
              <div className="border border-[var(--text-primary)]/14 rounded-xl p-5 flex flex-col gap-4">
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Number</div>
                  <input
                    value={roomNumberDraft}
                    onChange={(e) => setRoomNumberDraft(e.target.value)}
                    onBlur={() => handleRoomNumberChange(room.room, roomNumberDraft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className={`${fieldBoxCls} w-full focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)]/30`}
                  />
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Floor number</div>
                  <div className={fieldBoxCls}>{room.floor || "-"}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Status</div>
                  <select
                    value={effectiveRoomState(room)}
                    onChange={(e) => handleRoomStatusSelect(room.room, effectiveRoomState(room), e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-[var(--text-primary)]/5 text-[var(--text-primary)] text-[13px] cursor-pointer focus:outline-none"
                  >
                    {ROOM_STATUS_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Reason for status</div>
                  {roomStatusReasons[room.room] ? (
                    <div className={fieldBoxCls}>{roomStatusReasons[room.room]}</div>
                  ) : (
                    <div className={`${fieldBoxCls} text-[var(--text-primary)]/35 italic`}>Not available via the MEWS API</div>
                  )}
                </div>
                {room.parent_room && (
                  <div>
                    <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Parent room</div>
                    <div className={fieldBoxCls}>{room.parent_room}</div>
                  </div>
                )}
                {room.category && (
                  <div className="pt-3 border-t border-[var(--text-primary)]/10">
                    <div className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)] mb-2">
                      Category
                      <svg className="w-3.5 h-3.5 text-[var(--text-primary)]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    {room.service && <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">{room.service}</div>}
                    <div className={fieldBoxCls}>{room.category}{chevron}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Right column: Out of order + Recent space changes */}
            <div className="flex flex-col gap-8">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-display text-2xl text-[var(--text-primary)]">Out of order</h2>
                  <button disabled title="No live connection to MEWS to manage this room from here" className={`px-4 py-2 rounded-lg bg-indigo-500 text-white text-[13px] font-bold ${disabledBtnCls}`}>Out of order</button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-display text-2xl text-[var(--text-primary)]">Recent space changes</h2>
                  <button disabled className={`px-3 py-1.5 rounded-lg border border-[var(--text-primary)]/14 text-[10px] font-bold tracked-caps text-[var(--text-primary)]/40 ${disabledBtnCls}`}>All</button>
                </div>
                <div className="border border-[var(--text-primary)]/14 rounded-xl p-5 text-[13px] text-[var(--text-primary)]/45 italic leading-relaxed">
                  Space-change history isn&apos;t exposed by the MEWS Connector API - there&apos;s no resource-history/activity-log endpoint at all, so this can&apos;t be shown here even from a live connection.
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 text-[11px] text-[var(--text-primary)]/40 italic pt-4 border-t border-[var(--text-primary)]/10">
            Read-only snapshot from {isLiveFallback ? "a live MEWS check" : "the last capture"} - no live connection to MEWS to manage this room from here. Status is the exception: it saves to our own system, same as the Rooms (HK) tab.
          </div>
        </div>
        {roomStatusReasonModal}
      </div>
    );
  }

  // "Manage" full page - mirrors MEWS's own reservation Manage screen
  // (Properties tab). Reuses fields already fetched for the drawer above
  // (rate_lines/item_lines already carry the per-night and per-product
  // breakdowns MEWS shows here) - no new backend calls needed. Read-only:
  // note delete, "Add note"/OK, Arrival/Departure edit, "Create billing
  // automation" and "Unlock" are all disabled, same reasoning as every
  // other disabled action in BCP. Only the Properties tab has real content;
  // the rest of MEWS's tab bar (Status/Group/Pricing/Items/Mailing/Action
  // log/Summary/Billing/Contracting) keeps its layout position but is
  // disabled rather than faked. "Companions" is omitted entirely (not just
  // hidden-if-empty): checked against a real reservation whose MEWS screen
  // showed 2 named companions - CompanionIds was an empty array even though
  // AdultCount was 2, so the Connector API doesn't reliably expose this.
  if (selectedReservation && showManagePage) {
    const res = selectedReservation;
    const disabledBtnCls = "opacity-50 cursor-not-allowed";
    const fieldBoxCls = "px-3 py-2.5 rounded-lg bg-[var(--text-primary)]/5 text-[var(--text-primary)] text-[13px]";
    const detailRow = (label: string, value: ReactNode) => (
      <>
        <div className="text-[var(--text-primary)]/50">{label}</div>
        <div className="text-right">{value}</div>
      </>
    );
    // Status, Properties and Billing are the tabs actually built - every
    // other tab MEWS's own Manage screen has (Group/Pricing/Items/Mailing/
    // Action log/Summary/Contracting) had nothing behind it but a disabled
    // placeholder, so they're removed entirely rather than left
    // clickable-looking with no real content.
    const tabs = ["Status", "Properties", "Billing"] as const;
    const checkStatus = effectiveCheckStatus(res);
    // Mirrors MEWS's own "Reservations" detail sidebar, which stays visible
    // across every tab (Status/Properties/...) of its Manage screen - shared
    // here between our Status and Properties tabs for the same reason,
    // rather than only living inside Properties.
    const reservationDetailPanel = (
      <div>
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="font-display text-xl text-[var(--text-primary)]">Reservations</h2>
          <div className="flex gap-2">
            <button disabled title="No live connection to MEWS to manage this reservation from here" className={`px-3 py-1.5 rounded-lg border border-[var(--text-primary)]/20 text-[11px] font-bold text-[var(--text-primary)]/50 ${disabledBtnCls}`}>Create billing automation</button>
            <button disabled title="No live connection to MEWS to manage this reservation from here" className={`px-3 py-1.5 rounded-lg border border-[var(--text-primary)]/20 text-[11px] font-bold text-[var(--text-primary)]/50 ${disabledBtnCls}`}>Unlock</button>
          </div>
        </div>

        <div className="border border-[var(--text-primary)]/14 rounded-xl p-4 mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[var(--text-primary)]/10 flex items-center justify-center text-[11px] font-bold shrink-0">{guestInitials(res.guest || "?")}</div>
            <div className="font-bold text-[14px] truncate">{res.guest || "(no name)"}</div>
            <span className={`shrink-0 px-2 py-0.5 text-[10px] font-bold border rounded ${STATE_BADGE_CLS[effectiveReservationState(res)] || STATE_BADGE_CLS.Processed}`}>
              {STATE_DISPLAY_LABEL[effectiveReservationState(res)] || effectiveReservationState(res)}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-bold text-[13px]">
              {selectedRoomInfo?.category_short ? `${selectedRoomInfo.category_short} ` : ""}{effectiveRoomNumber(res.room)}
            </span>
            {typeof res.room_locked === "boolean" && (
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${res.room_locked ? "bg-indigo-500 text-white" : "bg-slate-200 text-slate-400"}`}>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px]">
          {detailRow("Service", res.service || "-")}
          {detailRow("Confirmation number", res.number || "-")}
          {res.group_name && detailRow("Group name", res.group_name)}
          {detailRow("Status", (
            <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border rounded ${STATE_BADGE_CLS[effectiveReservationState(res)] || STATE_BADGE_CLS.Processed}`}>
              {STATE_DISPLAY_LABEL[effectiveReservationState(res)] || effectiveReservationState(res)}
            </span>
          ))}
          {detailRow("Arrival", fmtFullDateTime(res.check_in))}
          {detailRow("Departure", fmtFullDateTime(res.check_out))}
          {res.purpose && detailRow("Booking purpose", res.purpose)}
          {res.segment && detailRow("Segment", res.segment)}
          {detailRow("Guests", `${res.adults} × Adult${res.adults !== 1 ? "s" : ""}${res.children ? `, ${res.children} × Child${res.children !== 1 ? "ren" : ""}` : ""}`)}
          {typeof res.total_amount === "number" && (
            <>
              {detailRow("Avg. rate (nightly)", ((res.rate_amount ?? 0) / (selectedNights || 1)).toLocaleString("en-US", { minimumFractionDigits: 2 }))}
              {detailRow("Avg. price with products (nightly)", (res.total_amount / (selectedNights || 1)).toLocaleString("en-US", { minimumFractionDigits: 2 }))}
              {detailRow("Total amount", `${res.total_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${res.currency || ""}`)}
            </>
          )}
          {typeof res.total_amount_gross === "number" && detailRow("Total amount (Gross)", res.total_amount_gross.toLocaleString("en-US", { minimumFractionDigits: 2 }))}
          {res.category && detailRow("Requested category", res.category)}
          {detailRow("Assigned space", (
            <span className="inline-flex items-center gap-1.5">
              <span className="font-bold">{res.room ? effectiveRoomNumber(res.room) : "-"}</span>
              {selectedRoomInfo && (
                <span className={`px-1.5 py-0.5 text-[9px] font-bold border rounded ${ROOM_STATE_BADGE_CLS[effectiveRoomState(selectedRoomInfo)] || "bg-slate-100 text-slate-600 border-slate-300"}`}>
                  {effectiveRoomState(selectedRoomInfo)}
                </span>
              )}
            </span>
          ))}
          {res.rate && detailRow("Rate", res.rate)}
          {res.travel_agency && detailRow("Travel agency", <span className="underline decoration-1 underline-offset-2">{res.travel_agency}</span>)}
          {res.travel_agency_confirmation_number && detailRow("Travel agency confirmation number", res.travel_agency_confirmation_number)}
        </div>

        {!!res.rate_lines?.length && (
          <div className="mt-4 pt-4 border-t border-[var(--text-primary)]/10">
            <div className="text-[11px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-2">Nights</div>
            <div className="flex flex-col gap-1">
              {res.rate_lines.map((line, i) => (
                <div key={i} className="flex items-center justify-between text-[13px]">
                  <span className="text-[var(--text-primary)]/60">{line.label}</span>
                  <span>{line.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!!res.item_lines?.length && (
          <div className="mt-4 pt-4 border-t border-[var(--text-primary)]/10">
            <div className="text-[11px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-2">Products</div>
            <div className="flex flex-col gap-1">
              {res.item_lines.map((line, i) => (
                <div key={i} className="flex items-center justify-between text-[13px]">
                  <span className="text-[var(--text-primary)]/60">{line.label}</span>
                  <span>{line.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px] mt-4 pt-4 border-t border-[var(--text-primary)]/10">
          {res.origin && detailRow("Origin", res.origin)}
          {res.reservation_source && detailRow("Reservation source", res.reservation_source)}
          {res.created_utc && detailRow("Created", fmtDateTime(res.created_utc))}
        </div>
      </div>
    );
    return (
      <div className="flex-1 p-4 md:p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => setShowManagePage(false)} className="p-1 text-[var(--text-primary)]/50 hover:text-[var(--text-primary)] transition-colors shrink-0">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h1 className="font-display text-3xl text-[var(--text-primary)] truncate">{res.group_name || res.guest || "(no name)"}</h1>
          </div>

          <div className="flex items-center gap-5 border-b border-[var(--text-primary)]/10 mb-8 overflow-x-auto overflow-y-hidden">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setManagePageTab(t.toLowerCase() as "status" | "properties" | "billing")}
                className={`py-3 text-[13px] font-bold whitespace-nowrap border-b-2 -mb-px transition-all ${
                  managePageTab === t.toLowerCase()
                    ? "border-[var(--text-primary)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Status - mirrors MEWS's own Status tab's Check in/Undo check-in/
              Undo check-out actions (Undo requires a typed reason, same as
              MEWS's own dialog) - everything here is local-only (see
              logOfflineAction), re-entered into MEWS once it's reachable
              again, same premise as every other BCP action. */}
          {managePageTab === "status" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="flex flex-col gap-6">
                <div className="border border-[var(--text-primary)]/14 rounded-xl p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[var(--text-primary)]/10 flex items-center justify-center text-[11px] font-bold shrink-0">{guestInitials(res.guest || "?")}</div>
                    <div className="font-bold text-[14px] truncate">{res.guest || "(no name)"}</div>
                    <span
                      className={`shrink-0 px-2 py-0.5 text-[10px] font-bold border rounded ${
                        checkStatus === "checked_in" ? STATE_BADGE_CLS.Started : checkStatus === "checked_out" ? STATE_BADGE_CLS.Processed : STATE_BADGE_CLS.Confirmed
                      }`}
                    >
                      {checkStatus === "checked_in" ? "Checked in" : checkStatus === "checked_out" ? "Checked out" : "To check in"}
                    </span>
                  </div>
                  <span className="font-bold text-[13px]">{effectiveRoomNumber(res.room)}</span>
                </div>

                {checkStatus === "to_check_in" && (
                  <button
                    onClick={() => requestCheckIn(res)}
                    className="self-start px-6 py-2.5 rounded-lg bg-emerald-600 text-white text-[13px] font-bold hover:bg-emerald-700 transition-colors"
                  >
                    Check In
                  </button>
                )}

                {checkStatus === "checked_in" && (
                  <>
                    <button
                      onClick={() => handleCheckOut(res)}
                      className="self-start px-6 py-2.5 rounded-lg bg-[#152A00] text-[#FFEFD2] text-[13px] font-bold hover:opacity-90 transition-opacity"
                    >
                      Check Out
                    </button>
                    <div className="border border-[var(--text-primary)]/14 rounded-xl p-5">
                      <div className="font-display text-lg mb-3">Undo check-in</div>
                      <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Reason *</div>
                      <div className="flex gap-2">
                        <input
                          value={undoCheckInReason}
                          onChange={(e) => setUndoCheckInReason(e.target.value)}
                          placeholder="Reason for undoing check-in"
                          className={`${fieldBoxCls} flex-1 focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)]/30`}
                        />
                        <button
                          onClick={() => handleUndoCheckIn(res, undoCheckInReason)}
                          disabled={!undoCheckInReason.trim()}
                          className="px-5 py-2 rounded-lg bg-amber-400 text-[#152A00] text-[12px] font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                        >
                          Undo
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {checkStatus === "checked_out" && (
                  <div className="border border-[var(--text-primary)]/14 rounded-xl p-5">
                    <div className="font-display text-lg mb-3">Undo check-out</div>
                    <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Reason *</div>
                    <div className="flex gap-2">
                      <input
                        value={undoCheckOutReason}
                        onChange={(e) => setUndoCheckOutReason(e.target.value)}
                        placeholder="Reason for undoing check-out"
                        className={`${fieldBoxCls} flex-1 focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)]/30`}
                      />
                      <button
                        onClick={() => handleUndoCheckOut(res, undoCheckOutReason)}
                        disabled={!undoCheckOutReason.trim()}
                        className="px-5 py-2 rounded-lg bg-amber-400 text-[#152A00] text-[12px] font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                      >
                        Undo
                      </button>
                    </div>
                  </div>
                )}

                <div className="text-[11px] text-[var(--text-primary)]/40 italic pt-4 border-t border-[var(--text-primary)]/10">
                  Recorded in our own system only - no live connection to MEWS, so re-enter this change there once it&apos;s back online.
                </div>

                {(() => {
                  const history = actions
                    .filter(
                      (a) =>
                        a.reservationNumber === res.number &&
                        (a.action === "Check In" || a.action === "Check Out" || a.action === "Undo Check In" || a.action === "Undo Check Out")
                    )
                    .sort((a, b) => b.at.localeCompare(a.at));
                  if (!history.length) return null;
                  return (
                    <div className="pt-4 border-t border-[var(--text-primary)]/10">
                      <div className="text-[11px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-2">History</div>
                      <div className="flex flex-col gap-2">
                        {history.map((a) => (
                          <div key={a.id} className="flex items-start justify-between gap-3 text-[12px] pb-2 border-b border-[var(--text-primary)]/10 last:border-0 last:pb-0">
                            <div>
                              <span
                                className={`inline-block px-2 py-0.5 text-[10px] font-bold border rounded ${
                                  a.action === "Check In"
                                    ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                                    : a.action === "Check Out"
                                    ? "bg-slate-800 text-white border-slate-800"
                                    : "bg-amber-100 text-amber-700 border-amber-300"
                                }`}
                              >
                                {a.action}
                              </span>
                              {a.reason && <div className="text-[var(--text-primary)]/60 mt-1">Reason: {a.reason}</div>}
                            </div>
                            <div className="text-[var(--text-primary)]/40 shrink-0 whitespace-nowrap">{fmtNoteTimestamp(a.at)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div>{reservationDetailPanel}</div>
            </div>
          )}

          {managePageTab === "properties" && (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {/* Left column: Notes + Arrival/Departure */}
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="font-display text-xl text-[var(--text-primary)] mb-3">Notes</h2>
                <div className="flex flex-col gap-4">
                  {[
                    ...res.notes.map((n) => ({ text: n.text, label: n.type, created: n.created_utc, ours: false, synced: false })),
                    ...reservationNotes.map((n) => ({ text: n.text, label: "Front Desk", created: n.created_at, ours: true, synced: n.synced_to_mews })),
                  ]
                    .sort((a, b) => b.created.localeCompare(a.created))
                    .map((n, i) => (
                      <div key={i}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[11px] text-[var(--text-primary)]/50">
                            Note ({n.label}), {fmtNoteTimestamp(n.created)}
                            {n.ours && (
                              <span className={`ml-2 ${n.synced ? "text-emerald-600" : "text-amber-600"}`}>
                                {n.synced ? "· synced to MEWS" : "· pending sync to MEWS"}
                              </span>
                            )}
                          </div>
                          <svg className="w-4 h-4 text-[var(--text-primary)]/20 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </div>
                        <div className={`${fieldBoxCls} whitespace-pre-line`}>{n.text}</div>
                      </div>
                    ))}
                  <div>
                    <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Add note</div>
                    <textarea
                      value={newNoteText}
                      onChange={(e) => setNewNoteText(e.target.value)}
                      placeholder="-"
                      rows={2}
                      className={`${fieldBoxCls} w-full min-h-[52px] resize-y focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)]/30`}
                    />
                    <button
                      onClick={handleAddReservationNote}
                      disabled={!newNoteText.trim() || savingNote || !res.mews_reservation_id}
                      title={!res.mews_reservation_id ? "This snapshot predates the note feature - Capture Now to enable it" : undefined}
                      className="mt-2 px-5 py-2 rounded-lg bg-blue-600 text-white text-[12px] font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
                    >
                      {savingNote ? "Saving..." : "OK"}
                    </button>
                    <div className="text-[10px] text-[var(--text-primary)]/40 italic mt-1">
                      Saved to our system now, and written into MEWS automatically once it&apos;s back online.
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Arrival *</div>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={editArrivalDate}
                    onChange={(e) => setEditArrivalDate(e.target.value)}
                    className={`${fieldBoxCls} flex-1 focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)]/30`}
                  />
                  <input
                    type="time"
                    value={editArrivalTime}
                    onChange={(e) => setEditArrivalTime(e.target.value)}
                    className={`${fieldBoxCls} w-28 text-center focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)]/30`}
                  />
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Departure *</div>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={editDepartureDate}
                    onChange={(e) => setEditDepartureDate(e.target.value)}
                    className={`${fieldBoxCls} flex-1 focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)]/30`}
                  />
                  <input
                    type="time"
                    value={editDepartureTime}
                    onChange={(e) => setEditDepartureTime(e.target.value)}
                    className={`${fieldBoxCls} w-28 text-center focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)]/30`}
                  />
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Reason *</div>
                <input
                  value={arrivalChangeReason}
                  onChange={(e) => setArrivalChangeReason(e.target.value)}
                  placeholder="Reason for changing arrival/departure"
                  className={`${fieldBoxCls} w-full focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)]/30`}
                />
              </div>
              <button
                onClick={handleSaveArrivalChange}
                disabled={
                  savingArrivalChange ||
                  !arrivalChangeReason.trim() ||
                  (editArrivalDate === toBangkokInputDate(res.check_in) &&
                    editArrivalTime === toBangkokInputTime(res.check_in) &&
                    editDepartureDate === toBangkokInputDate(res.check_out) &&
                    editDepartureTime === toBangkokInputTime(res.check_out))
                }
                className="self-start px-6 py-2 rounded-lg bg-blue-600 text-white text-[13px] font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
              >
                {savingArrivalChange ? "Saving..." : "OK"}
              </button>
              {arrivalOverrides[res.number]?.reason && (
                <div className="text-[11px] text-[var(--text-primary)]/50 -mt-3">Last change reason: {arrivalOverrides[res.number]?.reason}</div>
              )}

              <div className="pt-2 border-t border-[var(--text-primary)]/10">
                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Room Type</div>
                <select
                  value={editRoomType}
                  onChange={(e) => setEditRoomType(e.target.value)}
                  className={`${fieldBoxCls} w-full focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)]/30`}
                >
                  {!editRoomType && <option value="">-</option>}
                  {availableCategories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Reason *</div>
                <input
                  value={roomTypeChangeReason}
                  onChange={(e) => setRoomTypeChangeReason(e.target.value)}
                  placeholder="Reason for changing room type"
                  className={`${fieldBoxCls} w-full focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)]/30`}
                />
              </div>
              <button
                onClick={handleSaveRoomTypeChange}
                disabled={savingRoomTypeChange || !roomTypeChangeReason.trim() || !editRoomType.trim() || editRoomType === (res.category || "")}
                className="self-start px-6 py-2 rounded-lg bg-blue-600 text-white text-[13px] font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
              >
                {savingRoomTypeChange ? "Saving..." : "OK"}
              </button>
              {roomTypeOverrides[res.number]?.reason && (
                <div className="text-[11px] text-[var(--text-primary)]/50 -mt-3">Last change reason: {roomTypeOverrides[res.number]?.reason}</div>
              )}
            </div>

            {/* Right column: Reservations - shared with the Status tab above */}
            <div>{reservationDetailPanel}</div>
          </div>

          <div className="mt-10 text-[11px] text-[var(--text-primary)]/40 italic pt-4 border-t border-[var(--text-primary)]/10">
            Read-only snapshot from {isLiveFallback ? "a live MEWS check" : "the last capture"} - no live connection to MEWS. Notes, Arrival/Departure and Room Type changes are recorded in our own system only - re-enter them there once it&apos;s back online. Billing and unlock actions stay disabled.
          </div>
          </>
          )}

          {/* Billing - same rate/item lines + payments every other bill view
              in BCP already reads (orderItems for the whole window,
              payments_by_customer), just grouped and expandable per product
              the way MEWS's own Billing screen shows it (Night ×N, one
              group per distinct item_lines product name). MEWS further
              nests item groups under a "category" (e.g. Accomodation
              Extras) our flat item_lines data has no equivalent field for,
              so each product is its own top-level group here instead of
              adding a fabricated middle tier. Process payment/Issue
              proforma disabled - decorative, matching every other action
              button in BCP, since there's nothing live to process from a
              stale snapshot. */}
          {managePageTab === "billing" && (() => {
            const fmtPaymentType = (p: GuestPayment) => {
              const base = p.type.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
              return p.sub_type ? `${base} ${p.sub_type}` : base;
            };
            const itemGroups: { label: string; lines: { label: string; amount: number }[]; total: number }[] = [];
            (res.item_lines || []).forEach((line) => {
              let group = itemGroups.find((g) => g.label === line.label);
              if (!group) {
                group = { label: line.label, lines: [], total: 0 };
                itemGroups.push(group);
              }
              group.lines.push(line);
              group.total += line.amount;
            });
            const nightsTotal = (res.rate_lines || []).reduce((s, l) => s + l.amount, 0);
            const totalCount = (res.rate_lines?.length || 0) + (res.item_lines?.length || 0);
            const processed = billingProcessedOverrides[res.number];
            const isProcessed = !!processed;

            return (
              <div className="max-w-3xl flex flex-col gap-6">
                <div className="border border-[var(--text-primary)]/14 rounded-xl overflow-hidden">
                  <div className="p-4 flex items-center justify-between gap-4 flex-wrap border-b border-[var(--text-primary)]/10">
                    <div className="flex items-center gap-3 min-w-0 flex-wrap text-[12px]">
                      <span className={`shrink-0 px-2 py-0.5 text-[10px] font-bold border rounded ${STATE_BADGE_CLS[effectiveReservationState(res)] || STATE_BADGE_CLS.Processed}`}>
                        {STATE_DISPLAY_LABEL[effectiveReservationState(res)] || effectiveReservationState(res)}
                      </span>
                      <span className="font-bold text-[13px]">{res.guest || "(no name)"}</span>
                      <span className="text-[var(--text-primary)]/60">{effectiveRoomNumber(res.room)}</span>
                      <span className="text-[var(--text-primary)]/50">{fmtDateOnly(res.check_in)} – {fmtDateOnly(res.check_out)}</span>
                      <span className="text-[var(--text-primary)]/50">Stay (Accommodation) {res.number}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[11px] text-[var(--text-primary)]/50">{totalCount}×</span>
                      <span className="font-bold text-[14px]">
                        {(res.total_amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} {res.currency}
                      </span>
                    </div>
                  </div>

                  {!!res.rate_lines?.length && (
                    <div className="border-b border-[var(--text-primary)]/10">
                      <button onClick={() => setManageNightsOpen((v) => !v)} className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[var(--text-primary)]/5 transition-colors">
                        <div className="flex items-center gap-1.5 text-[12px] font-bold">
                          <svg className={`w-3 h-3 transition-transform ${manageNightsOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                          Night — {res.rate_lines.length}×
                        </div>
                        <div className="font-bold text-[13px]">{nightsTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                      </button>
                      {manageNightsOpen && res.rate_lines.map((line, i) => (
                        <div key={i} className="px-8 py-2 flex items-center justify-between text-[13px] text-[var(--text-primary)]/70 border-t border-[var(--text-primary)]/5">
                          <div>Night — {line.label} — 1×</div>
                          <div>{line.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {itemGroups.map((group) => (
                    <div key={group.label} className="border-b border-[var(--text-primary)]/10 last:border-0">
                      <button
                        onClick={() => setManageItemGroupsOpen((prev) => ({ ...prev, [group.label]: !prev[group.label] }))}
                        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[var(--text-primary)]/5 transition-colors"
                      >
                        <div className="flex items-center gap-1.5 text-[12px] font-bold">
                          <svg className={`w-3 h-3 transition-transform ${manageItemGroupsOpen[group.label] ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                          {group.label} — {group.lines.length}×
                        </div>
                        <div className="font-bold text-[13px]">{group.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                      </button>
                      {manageItemGroupsOpen[group.label] && group.lines.map((line, i) => (
                        <div key={i} className="px-8 py-2 flex items-center justify-between text-[13px] text-[var(--text-primary)]/70 border-t border-[var(--text-primary)]/5">
                          <div>{group.label} — {line.label} — 1×</div>
                          <div>{line.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                        </div>
                      ))}
                    </div>
                  ))}

                  {!res.rate_lines?.length && !itemGroups.length && (
                    <div className="p-5 text-[var(--text-primary)]/40 italic text-[13px]">No charges recorded.</div>
                  )}
                </div>

                <div>
                  <div className="font-display text-lg mb-3">Payments</div>
                  <div className="border border-[var(--text-primary)]/14 rounded-xl overflow-hidden">
                    {res.payments && res.payments.length > 0 ? (
                      res.payments.map((p, i) => (
                        <div key={i} className={`px-4 py-3 flex items-center justify-between gap-3 text-[13px] ${i > 0 ? "border-t border-[var(--text-primary)]/10" : ""}`}>
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold border rounded bg-emerald-50 text-emerald-700 border-emerald-200">Charged</span>
                            <span className="truncate">{fmtPaymentType(p)}{p.identifier ? ` — ${p.identifier}` : ""}</span>
                          </div>
                          <div className="font-bold shrink-0">{p.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} {p.currency}</div>
                        </div>
                      ))
                    ) : (
                      <div className="p-5 text-[var(--text-primary)]/40 italic text-[13px]">No payments recorded.</div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 flex-wrap pt-4 border-t border-[var(--text-primary)]/10">
                  <div>
                    <div className="text-[10px] text-[var(--text-primary)]/50 tracked-caps mb-0.5">Billing Status</div>
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 text-[10px] font-bold border rounded ${isProcessed ? "bg-emerald-100 text-emerald-700 border-emerald-300" : "bg-slate-100 text-slate-600 border-slate-300"}`}>
                        {isProcessed ? "Paid" : "To be paid"}
                      </span>
                      <div className="font-bold text-[18px]">{(res.to_be_paid ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} {res.currency}</div>
                    </div>
                    {isProcessed && processed.note && <div className="text-[11px] text-[var(--text-primary)]/50 mt-1">Note: {processed.note}</div>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setPaymentNoteDraft(""); setShowProcessPaymentModal(true); }}
                      disabled={isProcessed}
                      title={isProcessed ? "Already processed" : undefined}
                      className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-[12px] font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
                    >
                      Process payment
                    </button>
                    <button disabled title="No live connection to MEWS to manage this reservation from here" className="px-4 py-2.5 rounded-lg border border-[var(--text-primary)]/20 text-[12px] font-bold text-[var(--text-primary)]/50 opacity-50 cursor-not-allowed">Issue proforma</button>
                  </div>
                </div>

                <div className="text-[11px] text-[var(--text-primary)]/40 italic pt-2 border-t border-[var(--text-primary)]/10">
                  Read-only snapshot - no live connection to MEWS. Process payment is recorded in our own system only - re-process it there once it&apos;s back online. Issue proforma stays disabled.
                </div>
              </div>
            );
          })()}
        </div>

        {managePageTab === "billing" && showProcessPaymentModal && selectedReservation && (() => {
          const res = selectedReservation;
          const itemGroups: { label: string; lines: { label: string; amount: number }[]; total: number }[] = [];
          (res.item_lines || []).forEach((line) => {
            let group = itemGroups.find((g) => g.label === line.label);
            if (!group) {
              group = { label: line.label, lines: [], total: 0 };
              itemGroups.push(group);
            }
            group.lines.push(line);
            group.total += line.amount;
          });
          return (
            <div className="no-print fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowProcessPaymentModal(false)}>
              <div
                className="bg-[var(--paper)] text-[var(--text-primary)] border border-[var(--text-primary)]/14 max-w-lg w-full max-h-[85vh] overflow-y-auto shadow-2xl p-6"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="font-display text-xl mb-1">Process Payment</div>
                <div className="text-[12px] text-[var(--text-primary)]/60 mb-4">{res.guest || "(no name)"} — {effectiveRoomNumber(res.room)}</div>

                <div className="border border-[var(--text-primary)]/14 rounded-lg overflow-hidden mb-4">
                  {res.rate_lines?.map((line, i) => (
                    <div key={`night-${i}`} className={`px-4 py-2 flex items-center justify-between text-[13px] ${i > 0 ? "border-t border-[var(--text-primary)]/10" : ""}`}>
                      <div>Night — {line.label}</div>
                      <div>{line.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                    </div>
                  ))}
                  {itemGroups.map((group) =>
                    group.lines.map((line, i) => (
                      <div key={`${group.label}-${i}`} className="px-4 py-2 flex items-center justify-between text-[13px] border-t border-[var(--text-primary)]/10">
                        <div>{group.label} — {line.label}</div>
                        <div>{line.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                      </div>
                    ))
                  )}
                  {!res.rate_lines?.length && !itemGroups.length && (
                    <div className="p-4 text-[var(--text-primary)]/40 italic text-[13px]">No charges recorded.</div>
                  )}
                  <div className="px-4 py-3 flex items-center justify-between text-[14px] font-bold border-t border-[var(--text-primary)]/20 bg-[var(--text-primary)]/5">
                    <div>Total</div>
                    <div>{(res.to_be_paid ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} {res.currency}</div>
                  </div>
                </div>

                <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">Payment Note</label>
                <textarea
                  autoFocus
                  rows={3}
                  value={paymentNoteDraft}
                  onChange={(e) => setPaymentNoteDraft(e.target.value)}
                  placeholder="e.g. Paid by cash at front desk"
                  className="w-full mt-1 bg-[var(--bg-primary)] border border-[var(--text-primary)]/14 px-4 py-2 text-[13px] text-[var(--text-primary)] focus:border-[var(--text-primary)] outline-none resize-none"
                />

                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowProcessPaymentModal(false)} className="px-4 py-2 text-[11px] font-bold tracked-caps border border-[var(--text-primary)]/20 hover:bg-[var(--text-primary)]/5 transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={handleProcessPayment}
                    disabled={savingPaymentProcess}
                    className="px-4 py-2 text-[11px] font-bold tracked-caps bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingPaymentProcess ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
      <div className="max-w-7xl mx-auto">
        <div className="no-print">
        <PageHeader
          title={
            <span className="inline-flex items-center gap-4">
              Business Continuity Plan (BCP)
              <button
                onClick={() => setShowReadme(true)}
                className="font-sans inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold tracked-caps border border-[var(--text-primary)]/30 text-[var(--text-primary)]/70 hover:text-[var(--text-primary)] hover:border-[var(--text-primary)] transition-colors align-middle"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Read Me
              </button>
            </span>
          }
        >
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--text-primary)]/14 bg-[var(--paper)]"
            title="BCP Auto Capture runs every 5 minutes - this shows whether the last one for this property landed on time"
          >
            <div className={`w-2 h-2 rounded-full shrink-0 ${
              bcpHealthLevel === "green" ? "bg-emerald-600" : bcpHealthLevel === "amber" ? "bg-amber-500" : "bg-red-600"
            }`} />
            <span className="text-[10px] font-bold tracked-caps text-[var(--text-primary)]/70 whitespace-nowrap">
              Auto Capture: {bcpHealthLabel}
            </span>
          </div>
        </PageHeader>

        <CollapsibleSection
          open={headerOpen}
          onToggle={() => setHeaderOpen((o) => !o)}
          label={`Details — ${selectedProperty || "no property selected"}${
            snapshot ? ` · Data as of ${fmtDateTime(snapshot.captured_utc)}${stale && !isLiveFallback ? " ⚠ stale" : ""}` : ""
          }`}
        >
          <p className="text-[var(--text-primary)] text-sm opacity-70 leading-relaxed max-w-4xl">
            Mews Business Continuity Plan - snapshots (captured every 5 minutes) of a 15-day reservation timeline, front-desk actions and room status, so the front desk can keep operating from the latest copy if MEWS goes down.
          </p>
        </CollapsibleSection>

        {showReadme && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowReadme(false)}>
            <div
              className="bg-[var(--paper)] text-[var(--text-primary)] border border-[var(--text-primary)]/14 max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-[var(--paper)] border-b border-[var(--text-primary)]/10 px-6 py-4 flex items-center justify-between gap-3">
                <div className="font-display text-2xl">
                  {readmeLang === "en" ? "What is BCP / How to use it" : readmeLang === "th" ? "BCP คืออะไร / วิธีใช้งาน" : "Ano ang BCP / Paano Gamitin"}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center border border-[var(--text-primary)]/20 overflow-hidden">
                    {(["en", "th", "fil"] as const).map((l) => (
                      <button
                        key={l}
                        onClick={() => setReadmeLang(l)}
                        className={`px-2.5 py-1.5 text-[10px] font-bold tracked-caps transition-colors ${
                          readmeLang === l
                            ? "bg-[var(--text-primary)] text-[var(--paper)]"
                            : "hover:bg-[var(--text-primary)]/5"
                        }`}
                      >
                        {l === "en" ? "English" : l === "th" ? "ไทย" : "Filipino"}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setShowReadme(false)} className="p-1 text-[var(--text-primary)]/50 hover:text-[var(--text-primary)] transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
              {readmeLang === "en" ? (
              <div className="px-6 py-5 text-[13px] leading-relaxed flex flex-col gap-4">
                <div>
                  <div className="font-bold mb-1">What is BCP (Business Continuity Plan)</div>
                  <p>A front-desk backup system for when <b>MEWS goes down</b> — it saves a copy of the 15-day reservation timeline (7 days back + 7 days forward) from MEWS <b>automatically every 5 minutes</b> (keeping the latest 48 hours per property), along with housekeeping room status and today&apos;s payments.</p>
                </div>
                <div>
                  <div className="font-bold mb-1">Normal operation (MEWS still working)</div>
                  <p>Nothing to do — snapshots save automatically every 5 minutes. Need the very latest copy right now? Click <b>Capture Now</b>. Browse older copies from the <b>Snapshot</b> dropdown.</p>
                </div>
                <div>
                  <div className="font-bold mb-1">When MEWS goes down, follow these steps</div>
                  <ol className="list-decimal list-inside flex flex-col gap-1">
                    <li>Open this page, pick the property, then pick the <b>latest snapshot</b> (check the &quot;Data as of&quot; time - if it&apos;s older than 2 hours, the page shows an orange warning).</li>
                    <li>Browse the <b>Timeline</b> table just like the normal MEWS screen - click a reservation bar for guest details/notes. Take photos of passports / scan documents to your computer first, then register guests on paper or a PDF on an iPad instead.</li>
                    <li>Check the color dot next to each room number to tell housekeeping which rooms are occupied - print a housekeeping worksheet from your browser&apos;s Print command (Ctrl/Cmd+P) while on the Timeline or Rooms (HK) tab (has a Cleaned ✓ box to tick on paper).</li>
                    <li>Money: you can record a <b>charge</b> now, but it <b>can&apos;t be processed</b> until MEWS is back - use the <b>Payments</b> tab to compare against what&apos;s already gone through today.</li>
                    <li><b>Check In / Check Out / Undo Check In / Undo Check Out</b>: open a reservation → <b>Manage</b> → <b>Status</b> tab. Every action here is recorded permanently in this system (see Action Logs below) - Undo actions require typing a reason first.</li>
                    <li><b>Reg Card</b>: open a reservation, click the <b>Reg Card</b> button next to any guest&apos;s name (Owner or a companion) to fill in and print their ร.ร.๓ Lodger Registration Card - Occupation is required before it can be saved or printed, Place of Departure/Next Destination default to &quot;current address&quot; (switch to Other accommodation and type the address if needed), and the guest can sign right on screen. Save keeps a copy here; Delete Signature clears a mistaken one.</li>
                    <li><b>Write down everything</b> done while MEWS is down (check-in/out, room change, charges) - the actions above are already recorded automatically (see Action Logs), so note anything else on paper or your branch&apos;s Activity report.</li>
                    <li>Once MEWS is back: re-enter everything recorded (here and on paper) back into MEWS (branches with AdriaScan can scan documents straight into MEWS).</li>
                  </ol>
                </div>
                <div>
                  <div className="font-bold mb-1">Good to know</div>
                  <ul className="list-disc list-inside flex flex-col gap-1">
                    <li>Everything on this page is &quot;a copy from when it was captured,&quot; not live data - the green <b>LIVE</b> badge only appears when the system can actually reach MEWS right now (meaning MEWS isn&apos;t down).</li>
                    <li>Vouch kiosk check-in goes through MEWS - if MEWS is down, assume the kiosk is down too.</li>
                    <li>If MEWS stays down for more than an hour, snapshots stop updating (can&apos;t capture from a source that&apos;s down) - just use the latest one you have.</li>
                    <li><b>Action Logs</b> (the third tab) keeps a permanent record of everything done from this page (Check In/Out, Undo, room changes, Reg Card saves, notes) - tick <b>BCP Check</b> once that action has been re-entered into MEWS, and use <b>Export to Excel</b> to save or share the list.</li>
                  </ul>
                </div>
                <div className="pt-2 border-t border-[var(--text-primary)]/10 flex justify-end">
                  <button onClick={() => setShowReadme(false)} className="btn-brand btn-primary">Close</button>
                </div>
              </div>
              ) : readmeLang === "th" ? (
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
                    <li>ดูจุดสีหน้าเลขห้องเพื่อประสานแม่บ้านว่าให้แขกเข้าห้องไหน — พิมพ์ใบงานแจกแม่บ้านได้จากคำสั่ง Print ของเบราว์เซอร์ (Ctrl/Cmd+P) ตอนอยู่แท็บ Timeline หรือ Rooms (HK) (มีช่อง Cleaned ✓ ให้ติ๊กบนกระดาษ)</li>
                    <li>การเงิน: ชาร์จ Payment ไว้ก่อนได้ แต่<b>ยังตัดจ่ายไม่ได้</b>จนกว่า MEWS จะกลับมา — ใช้แท็บ <b>Payments</b> เทียบรายการที่เข้าแล้ววันนี้</li>
                    <li><b>เช็คอิน/เช็คเอาท์/ยกเลิกเช็คอิน/ยกเลิกเช็คเอาท์</b>: เปิดการจอง → กด <b>Manage</b> → แท็บ <b>Status</b> — ทุกการกระทำที่นี่ถูกบันทึกถาวรในระบบ (ดู Action Logs ด้านล่าง) การยกเลิก (Undo) ต้องพิมพ์เหตุผลก่อนถึงจะกดได้</li>
                    <li><b>Reg Card</b>: เปิดการจอง กดปุ่ม <b>Reg Card</b> ข้างชื่อแขกคนใดก็ได้ (Owner หรือผู้ติดตาม) เพื่อกรอกและพิมพ์บัตร ร.ร.๓ ของแขกคนนั้น — ต้องกรอก <b>Occupation</b> (อาชีพ) ก่อนถึงจะบันทึก/พิมพ์ได้ ส่วน Place of Departure/Next Destination ตั้งค่าเริ่มต้นเป็น &quot;ที่อยู่ปัจจุบัน&quot; ไว้ให้แล้ว (เปลี่ยนเป็น Other accommodation แล้วพิมพ์ที่อยู่ได้ถ้าจำเป็น) และให้แขกเซ็นชื่อบนหน้าจอก่อนพิมพ์ได้เลย กด Save เพื่อเก็บสำเนาไว้ในระบบ ปุ่ม Delete Signature ใช้ลบลายเซ็นต์ที่เซ็นผิด</li>
                    <li><b>จดบันทึกทุกรายการ</b>ที่ทำระหว่าง MEWS ล่ม (เช็คอิน/เช็คเอาท์/ย้ายห้อง/ชาร์จเงิน) — รายการข้างต้นระบบบันทึกให้อัตโนมัติแล้ว (ดู Action Logs) ส่วนอย่างอื่นให้จดลงกระดาษหรือไฟล์ Activity report ของสาขา</li>
                    <li>เมื่อ MEWS กลับมาใช้ได้: นำบันทึกทั้งหมด (ทั้งในระบบและบนกระดาษ) ไปคีย์ย้อนเข้า MEWS ให้ครบ (สาขาที่มี AdriaScan ใช้สแกนเอกสารเข้า MEWS ได้เลย)</li>
                  </ol>
                </div>
                <div>
                  <div className="font-bold mb-1">ข้อควรรู้</div>
                  <ul className="list-disc list-inside flex flex-col gap-1">
                    <li>ข้อมูลในหน้านี้เป็น &quot;สำเนา ณ เวลาที่เก็บ&quot; ไม่ใช่ข้อมูลสด — ป้าย <b>LIVE</b> สีเขียวจะขึ้นเฉพาะตอนที่ระบบดึงสดจาก MEWS ได้ (แปลว่า MEWS ยังไม่ล่ม)</li>
                    <li>Vouch kiosk เช็คอินผ่าน MEWS — ถ้า MEWS ล่ม ให้ถือว่า kiosk ใช้ไม่ได้ไปด้วย</li>
                    <li>หาก MEWS ล่มนานข้ามชั่วโมง snapshot จะไม่อัปเดตเพิ่ม (เก็บไม่ได้เพราะต้นทางล่ม) — ใช้อันล่าสุดที่มีเป็นหลัก</li>
                    <li><b>Action Logs</b> (แท็บที่ 3) เก็บบันทึกถาวรของทุกอย่างที่ทำจากหน้านี้ (เช็คอิน/เอาท์, Undo, ย้ายห้อง, บันทึก Reg Card, โน้ต) — ติ๊ก <b>BCP Check</b> เมื่อคีย์รายการนั้นเข้า MEWS แล้ว และใช้ปุ่ม <b>Export to Excel</b> เพื่อบันทึก/ส่งต่อรายการทั้งหมดได้</li>
                  </ul>
                </div>
                <div className="pt-2 border-t border-[var(--text-primary)]/10 flex justify-end">
                  <button onClick={() => setShowReadme(false)} className="btn-brand btn-primary">ปิด</button>
                </div>
              </div>
              ) : (
              <div className="px-6 py-5 text-[13px] leading-relaxed flex flex-col gap-4">
                <div>
                  <div className="font-bold mb-1">Ano ang BCP (Business Continuity Plan)</div>
                  <p>Isang backup system para sa front desk kapag <b>bumagsak ang MEWS</b> — awtomatikong nagse-save ang system ng kopya ng 15-araw na reservation timeline (7 araw na nakaraan + 7 araw na susunod) mula sa MEWS <b>tuwing 5 minuto</b> (huling 48 oras lang ang naka-save sa bawat property), kasama ang housekeeping status ng mga kuwarto at listahan ng payments ngayong araw</p>
                </div>
                <div>
                  <div className="font-bold mb-1">Normal na operasyon (gumagana ang MEWS)</div>
                  <p>Walang kailangang gawin — awtomatikong nagse-save ang system ng snapshot tuwing 5 minuto. Kung kailangan mo agad ng pinakabagong kopya, pindutin ang <b>Capture Now</b>. Puwede ring piliin ang mga nakaraang snapshot sa <b>Snapshot</b> dropdown</p>
                </div>
                <div>
                  <div className="font-bold mb-1">Kapag bumagsak ang MEWS, sundin ang mga hakbang na ito</div>
                  <ol className="list-decimal list-inside flex flex-col gap-1">
                    <li>Buksan ang page na ito, piliin ang property, pagkatapos piliin ang <b>pinakabagong snapshot</b> (tingnan ang oras na &quot;Data as of&quot; — kung mas matagal na sa 2 oras, magpapakita ng babalang kulay-orange ang system)</li>
                    <li>Tingnan ang <b>Timeline</b> tulad ng karaniwang MEWS — i-click ang reservation bar para makita ang detalye/notes ng bisita: kumuha muna ng litrato ng pasaporte / i-scan ang mga dokumento at i-save sa computer, pagkatapos mag-rehistro gamit ang papel o PDF sa iPad</li>
                    <li>Tingnan ang kulay na tuldok sa bandang numero ng kuwarto para malaman ng housekeeping kung aling kuwarto ang gagamitin ng bisita — puwedeng i-print ang housekeeping worksheet gamit ang Print command ng browser (Ctrl/Cmd+P) habang nasa tab na Timeline o Rooms (HK) (may checkbox na Cleaned ✓ para tsekan sa papel)</li>
                    <li>Pananalapi: puwedeng i-record na muna ang mga singil, pero <b>hindi pa puwedeng i-process</b> hangga&#39;t hindi bumabalik ang MEWS — gamitin ang tab na <b>Payments</b> para itugma sa mga entry na naipasok na ngayong araw</li>
                    <li><b>Check In/Check Out/Undo Check In/Undo Check Out</b>: buksan ang reservation → pindutin ang <b>Manage</b> → tab na <b>Status</b> — lahat ng aksyon dito ay permanenteng naka-log sa system (tingnan ang Action Logs sa ibaba). Kailangan munang magsulat ng dahilan bago maisagawa ang Undo</li>
                    <li><b>Reg Card</b>: buksan ang reservation, pindutin ang button na <b>Reg Card</b> sa tabi ng pangalan ng kahit sinong bisita (Owner man o kasama) para punan at i-print ang ร.ร.๓ lodger registration card ng bisitang iyon — kailangang punan ang <b>Occupation</b> (trabaho) bago makapag-save/i-print. Ang Place of Departure/Next Destination ay naka-default na sa &quot;kasalukuyang address&quot; (puwedeng palitan sa Other accommodation at i-type ang address kung kailangan), at puwedeng pumirma agad ang bisita sa screen bago i-print. Pindutin ang Save para ma-imbak ang kopya sa system. Ang button na Delete Signature ay para burahin ang maling pirma</li>
                    <li><b>Isulat ang lahat ng ginawa</b> habang bumabagsak ang MEWS (check in/check out/paglipat ng kuwarto/singil) — awtomatiko nang naka-log ang mga aksyon sa itaas (tingnan ang Action Logs); isulat ang iba pang bagay na wala rito sa papel o sa Activity report ng branch</li>
                    <li>Kapag bumalik na ang MEWS: ipasok pabalik sa MEWS ang lahat ng naitala (kapwa nasa system at nasa papel) (ang mga branch na may AdriaScan ay puwede nang direktang i-scan ang mga dokumento papunta sa MEWS)</li>
                  </ol>
                </div>
                <div>
                  <div className="font-bold mb-1">Mahalagang malaman</div>
                  <ul className="list-disc list-inside flex flex-col gap-1">
                    <li>Ang datos sa page na ito ay &quot;kopya noong huling na-save&quot;, hindi live data — lalabas lang ang berdeng <b>LIVE</b> badge kapag matagumpay na nakakakuha ang system ng live data mula sa MEWS (ibig sabihin, hindi bumabagsak ang MEWS)</li>
                    <li>Ang Vouch kiosk ay dumadaan sa MEWS para mag-check in — kung bumagsak ang MEWS, ituring na hindi rin gumagana ang kiosk</li>
                    <li>Kung matagal bumagsak ang MEWS ng mahigit isang oras, hindi na mag-a-update ang snapshot (hindi na makakakuha ng bagong datos dahil bumagsak ang pinagmumulan) — gamitin na lang ang pinakabagong mayroon</li>
                    <li>Ang <b>Action Logs</b> (ika-3 tab) ay permanenteng talaan ng lahat ng ginawa mula sa page na ito (check in/out, Undo, paglipat ng kuwarto, pag-save ng Reg Card, notes) — tsekan ang <b>BCP Check</b> kapag naipasok na ang entry na iyon sa MEWS, at gamitin ang button na <b>Export to Excel</b> para i-save o ipasa ang buong listahan</li>
                  </ul>
                </div>
                <div className="pt-2 border-t border-[var(--text-primary)]/10 flex justify-end">
                  <button onClick={() => setShowReadme(false)} className="btn-brand btn-primary">Isara</button>
                </div>
              </div>
              )}
            </div>
          </div>
        )}

        <CollapsibleSection open={headerOpen}>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
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
            {isSuperAdminRole && (
              <button
                onClick={handleCapture}
                disabled={capturing || !selectedProperty}
                className="btn-brand btn-primary h-[46px] disabled:opacity-60"
              >
                {capturing ? "Capturing..." : "Capture Now"}
              </button>
            )}
          </div>
        </CollapsibleSection>

        {error && (
          <div className="no-print p-4 bg-[var(--paper)] border border-red-200 text-red-700 text-sm leading-relaxed mb-6">{error}</div>
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
            <CollapsibleSection open={headerOpen}>
              <div className={`flex flex-wrap items-center gap-3 text-[11px] px-4 py-3 border ${
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
                {(mainTab === "timeline" || mainTab === "rooms") && (
                  <>
                    <span>Arrivals today: {todayStats.arrivals}</span>
                    <span>Departures today: {todayStats.departures}</span>
                    <span>In-house today: {todayStats.inHouse}</span>
                  </>
                )}
              </div>
            </CollapsibleSection>

            <div className="no-print flex flex-wrap items-center gap-4 mb-4">
              <div className="flex border-b border-[var(--text-primary)]/14 overflow-x-auto overflow-y-hidden max-w-full">
                {(
                  [
                    ["timeline", `Timeline (${snapshot.window?.start} – ${snapshot.window?.end})`],
                    ["rooms", "Rooms (HK)"],
                    ["logs", `Action Logs${unresolvedActionsCount ? ` (${unresolvedActionsCount})` : ""}`],
                  ] as [MainTab, string][]
                )
                  .filter(([t]) => !isHousekeepingRole || t === "rooms")
                  .map(([t, label]) => (
                  <button
                    key={t}
                    onClick={() => setMainTab(t)}
                    className={`px-3 sm:px-5 py-2.5 sm:py-3 text-[11px] font-bold tracked-caps border-b-2 -mb-px transition-all whitespace-nowrap ${
                      mainTab === t
                        ? "border-[var(--text-primary)] text-[var(--text-primary)]"
                        : "border-transparent text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {mainTab === "rooms" && (
                <input
                  type="text"
                  value={roomSearch}
                  onChange={(e) => setRoomSearch(e.target.value)}
                  placeholder="Search room or occupant"
                  className="w-full sm:w-80 sm:ml-auto px-3 py-2.5 sm:py-2 text-[13px] sm:text-[12px] border border-[var(--text-primary)]/20 bg-white text-black focus:outline-none focus:border-[var(--text-primary)]/50 placeholder:text-black/40"
                />
              )}
              {mainTab === "logs" && (
                <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleExportActionLogsToExcel}
                    disabled={displayedActions.length === 0}
                    title="Export the rows currently shown (respects search and sort) to a .csv file Excel opens directly"
                    className="px-3 py-2 text-[11px] font-bold tracked-caps border border-[var(--text-primary)]/20 hover:bg-[var(--text-primary)]/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    Export to Excel
                  </button>
                  <input
                    type="text"
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    placeholder="Search guest, room, action, or user"
                    className="flex-1 min-w-[200px] sm:flex-none sm:w-80 px-3 py-2 text-[12px] border border-[var(--text-primary)]/20 bg-white text-black focus:outline-none focus:border-[var(--text-primary)]/50 placeholder:text-black/40"
                  />
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
                  placeholder="Search room, guest, or confirmation # (press Enter)"
                  title="Matches room number, guest name, confirmation number, or travel agency confirmation number"
                  className="w-full sm:w-64 px-3 py-2.5 sm:py-2 text-[13px] sm:text-[12px] border border-[var(--text-primary)]/20 bg-transparent focus:outline-none focus:border-[var(--text-primary)]/50 placeholder:text-[var(--text-primary)]/40"
                />
                <div className="w-full sm:w-auto flex items-center justify-between sm:justify-start border border-[var(--text-primary)]/20 divide-x divide-[var(--text-primary)]/20">
                  <button onClick={goToWindowStart} title={`First day with data (${snapshot.window.start})`} className="flex-1 sm:flex-none px-3 py-2.5 sm:py-2 text-[14px] font-bold hover:bg-[var(--text-primary)]/5 transition-colors">«</button>
                  <button onClick={() => shiftFocusedDate(-1)} title="Previous day" className="flex-1 sm:flex-none px-3 py-2.5 sm:py-2 text-[14px] font-bold hover:bg-[var(--text-primary)]/5 transition-colors">‹</button>
                  <button onClick={goToToday} title="Today" className="flex-1 sm:flex-none px-4 py-2.5 sm:py-2 text-[10px] font-bold tracked-caps hover:bg-[var(--text-primary)]/5 transition-colors whitespace-nowrap">Today</button>
                  <button onClick={() => shiftFocusedDate(1)} title="Next day" className="flex-1 sm:flex-none px-3 py-2.5 sm:py-2 text-[14px] font-bold hover:bg-[var(--text-primary)]/5 transition-colors">›</button>
                  <button onClick={goToWindowEnd} title={`Last day with data (${snapshot.window.end})`} className="flex-1 sm:flex-none px-3 py-2.5 sm:py-2 text-[14px] font-bold hover:bg-[var(--text-primary)]/5 transition-colors">»</button>
                </div>
              </div>
            )}

            {mainTab === "timeline" && (
              <div ref={timelineScrollRef} className="no-print bg-[var(--paper)] border border-[var(--text-primary)]/14 mb-8 shadow-[20px_20px_60px_rgba(21,42,0,0.03)] overflow-auto max-h-[70vh]">
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
                      matching MEWS's own vertical grouping strip - MEWS shows
                      the full category name here, not a short code (confirmed
                      against a live screenshot), so this does too. */}
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
                        {g.category}
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
                      title={!room.is_child ? (room.category ? `Room ${effectiveRoomNumber(room.room)}\n${room.category}` : `Room ${effectiveRoomNumber(room.room)}`) : undefined}
                      className={`sticky left-[28px] z-10 border-b border-r border-[var(--text-primary)]/10 p-2 text-[12px] font-bold text-[var(--text-primary)] flex items-center gap-2 whitespace-nowrap transition-colors ${highlightedRoom === room.room ? "bg-amber-200" : "bg-[var(--paper)]"}`}
                      style={{ gridColumn: 2, gridRow: i + 2 }}
                    >
                      {!room.is_child && (
                        <>
                          <span className={`w-2 h-2 rounded-full shrink-0 ${ROOM_DOT_CLS[effectiveRoomState(room)] || "bg-slate-300"}`} title={effectiveRoomState(room)}></span>
                          <span>{effectiveRoomNumber(room.room)}</span>
                        </>
                      )}
                    </div>
                  ))}
                  {snapshot.rooms.map((room, i) => (
                    <div
                      key={"childcol" + room.room + i}
                      ref={room.is_child ? (el) => { if (el) roomRowRefs.current.set(room.room, el); else roomRowRefs.current.delete(room.room); } : undefined}
                      title={room.is_child ? (room.category ? `Room ${effectiveRoomNumber(room.room)}\n${room.category}` : `Room ${effectiveRoomNumber(room.room)}`) : undefined}
                      className={`sticky left-[98px] z-10 border-b border-r border-[var(--text-primary)]/10 p-2 text-[12px] text-[var(--text-primary)] flex items-center gap-2 whitespace-nowrap transition-colors ${highlightedRoom === room.room ? "bg-amber-200" : "bg-[var(--paper)]"}`}
                      style={{ gridColumn: 3, gridRow: i + 2 }}
                    >
                      {room.is_child && (
                        <>
                          <span className={`w-2 h-2 rounded-full shrink-0 ${ROOM_DOT_CLS[effectiveRoomState(room)] || "bg-slate-300"}`} title={effectiveRoomState(room)}></span>
                          <span>{effectiveRoomNumber(room.room)}</span>
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
                    const started = effectiveReservationState(res) === "Started";
                    const cls = STATE_BADGE_CLS[effectiveReservationState(res)] || STATE_BADGE_CLS.Processed;
                    return (
                      <button
                        key={res.number + i}
                        onClick={() => { setSelectedReservation(res); setShowManagePage(false); setManageTab("reservation"); setManageNotesOpen(false); setSelectedGuestProfile(null); setGuestProfileGroup([]); setGuestProfileReservation(null); setRateLinesOpen(false); setItemLinesOpen(false); }}
                        className={`m-1 px-2 py-1 text-[11px] font-bold text-left truncate rounded border transition-all hover:brightness-95 flex items-center gap-1 ${cls} ${started ? "shadow-sm" : "border-dashed"}`}
                        style={{ gridColumn: `${colStart} / span ${colSpan}`, gridRow: roomIdx + 2, zIndex: 5 }}
                        title={`${res.guest} — ${STATE_DISPLAY_LABEL[effectiveReservationState(res)] || effectiveReservationState(res)}${res.room_locked ? " (room locked)" : ""}`}
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
            )}

            {mainTab === "timeline" && (
            <CollapsibleSection
              label={`Reservations (${frontDeskRows.length})`}
              open={reservationsOpen}
              onToggle={() => setReservationsOpen((v) => !v)}
            >
              <div className="no-print flex justify-end mb-3">
                <input
                  type="text"
                  value={reservationSearch}
                  onChange={(e) => setReservationSearch(e.target.value)}
                  placeholder="Search name, room, or confirmation # (incl. travel agency)"
                  className="px-3 py-2 text-[12px] border border-[var(--text-primary)]/20 bg-white text-black w-80 focus:outline-none focus:border-[var(--text-primary)]/50 placeholder:text-black/40"
                />
              </div>
              <div className="no-print bg-[var(--paper)] border border-[var(--text-primary)]/14 mb-8 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <thead>
                    <tr className="border-b border-[var(--text-primary)]/14 bg-[var(--text-primary)]/[0.03]">
                      {(
                        [
                          ["status", "Status"],
                          ["guest", "Guest Name"],
                          ["dates", "Dates"],
                          ["room", "Room"],
                          ["category", "Category"],
                        ] as [ReservationSortKey, string][]
                      ).map(([key, label]) => (
                        <th
                          key={key}
                          onClick={() => handleReservationSort(key)}
                          className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50 cursor-pointer select-none hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
                        >
                          {label}{reservationSortArrow(key)}
                        </th>
                      ))}
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedFrontDeskRows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">
                          {reservationSearch ? "No matching reservations." : "No arrivals or in-house guests for today."}
                        </td>
                      </tr>
                    )}
                    {displayedFrontDeskRows.map(({ r, status }) => {
                      const done = latestActionFor(r.number);
                      return (
                        <tr
                          key={r.number}
                          className={`border-b last:border-0 ${done ? "bg-red-50 border-red-100 hover:bg-red-100" : "border-[var(--text-primary)]/8 hover:bg-[var(--text-primary)]/[0.02]"}`}
                        >
                          <td className="p-3 px-4 align-top">
                            <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border rounded ${status.cls}`}>{status.label}</span>
                          </td>
                          <td className="p-3 px-4 align-top">
                            <div className="font-bold text-[13px] text-[var(--text-primary)]">{r.guest || "(no name)"}</div>
                            <div className="text-[11px] text-[var(--text-primary)]/50">{r.nationality || "-"}</div>
                            {done && (
                              <button onClick={() => setSelectedLogEntry(done)} className="text-[10px] text-red-700 font-bold mt-1 underline decoration-dotted hover:decoration-solid">
                                ● Updated in our system — {done.action} {fmtDateTime(done.at)}
                              </button>
                            )}
                          </td>
                          <td className="p-3 px-4 align-top text-[12px] text-[var(--text-primary)]/80 whitespace-nowrap">
                            {fmtDateOnly(r.check_in)} – {fmtDateOnly(r.check_out)}
                          </td>
                          <td className="p-3 px-4 align-top text-[13px] font-bold text-[var(--text-primary)]">{effectiveRoomNumber(r.room)}</td>
                          <td className="p-3 px-4 align-top text-[12px] text-[var(--text-primary)]/70">{r.category || "-"}</td>
                          <td className="p-3 px-4 align-top">
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => handleOpenRegCard(r)}
                                className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity"
                              >
                                Reg Card
                              </button>
                              {status.label === "Arrival" ? (
                                <button
                                  onClick={() => requestCheckIn(r)}
                                  className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-emerald-600 text-white hover:opacity-90 transition-opacity"
                                >
                                  Check In
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleCheckOut(r)}
                                  disabled={hasCheckedOutLocally(r)}
                                  title={hasCheckedOutLocally(r) ? "Already checked out" : undefined}
                                  className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:hover:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Check Out
                                </button>
                              )}
                              <button
                                onClick={() => { setChgRoomFor(r); setNewRoomValue(effectiveRoomNumber(r.room)); }}
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
            </CollapsibleSection>
            )}

            {mainTab === "rooms" && (
              <>
              <div className="no-print text-[10px] text-[var(--text-primary)]/40 italic mb-3">
                Changing a status below only updates our own system — it is never sent to MEWS.
              </div>
              <div className="no-print grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
                {displayedHousekeepingRows.length === 0 && (
                  <div className="col-span-full p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">No matching rooms.</div>
                )}
                {displayedHousekeepingRows.map((rm, i) => {
                  const effectiveState = effectiveRoomState(rm);
                  const occupancy = effectiveState === "OutOfOrder" || effectiveState === "OutOfService"
                    ? "Out of Order"
                    : rm.occupant ? "Occupied" : "Vacant";
                  const lastRoomLog = actions.find((a) => a.action === "Room Status" && a.room === rm.room && !a.checked);
                  return (
                    <div
                      key={rm.room + i}
                      className={`border p-5 sm:p-4 flex flex-col gap-1.5 sm:gap-1 ${ROOM_STATUS_CARD_CLS[effectiveState] || "bg-[var(--paper)] border-[var(--text-primary)]/14"} ${
                        lastRoomLog ? "ring-2 ring-red-500 ring-offset-1" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-2xl sm:text-xl font-display text-[var(--text-primary)]">{effectiveRoomNumber(rm.room)}</div>
                        {lastRoomLog && (
                          <button
                            onClick={() => setSelectedLogEntry(lastRoomLog)}
                            className="text-[10px] sm:text-[9px] font-bold tracked-caps text-red-700 underline decoration-dotted hover:decoration-solid shrink-0 mt-1"
                          >
                            ● Updated
                          </button>
                        )}
                      </div>
                      <div className="text-[12px] sm:text-[11px] font-bold tracked-caps text-[var(--text-primary)]/50">{occupancy}</div>
                      {rm.occupant && <div className="text-[13px] sm:text-[11px] text-[var(--text-primary)]/70 truncate">{rm.occupant}</div>}
                      <select
                        value={effectiveState}
                        onChange={(e) => handleRoomStatusSelect(rm.room, effectiveState, e.target.value)}
                        className="mt-2 w-full bg-white border border-black/10 px-3 sm:px-2 py-3 sm:py-1.5 text-[15px] sm:text-[12px] font-bold text-[var(--text-primary)] cursor-pointer focus:outline-none"
                      >
                        {ROOM_STATUS_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      {roomStatusReasons[rm.room] && (
                        <div className="text-[12px] sm:text-[11px] text-[var(--text-primary)]/70 italic">{roomStatusReasons[rm.room]}</div>
                      )}
                    </div>
                  );
                })}
              </div>
              </>
            )}

            {mainTab === "logs" && (
              <div className="no-print bg-[var(--paper)] border border-[var(--text-primary)]/14 mb-8 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr className="border-b border-[var(--text-primary)]/14 bg-[var(--text-primary)]/[0.03]">
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50 whitespace-nowrap">No.</th>
                      {(
                        [
                          ["time", "Time"],
                          ["guest", "Guest"],
                          ["room", "Room"],
                          ["action", "Action"],
                          ["detail", "Detail"],
                          ["userEmail", "User"],
                        ] as [ActionLogSortKey, string][]
                      ).map(([key, label]) => (
                        <th
                          key={key}
                          onClick={() => handleLogSort(key)}
                          className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50 cursor-pointer select-none hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
                        >
                          {label}{logSortArrow(key)}
                        </th>
                      ))}
                      <th className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50"></th>
                      <th
                        onClick={() => handleLogSort("checked")}
                        className="p-3 px-4 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]/50 text-center cursor-pointer select-none hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
                      >
                        BCP Check{logSortArrow("checked")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedActions.length === 0 && (
                      <tr>
                        <td colSpan={9} className="p-10 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">
                          {logSearch ? "No matching actions." : "No actions logged yet."}
                        </td>
                      </tr>
                    )}
                    {displayedActions.map((a) => (
                      <tr
                        key={a.id}
                        onClick={() => setSelectedLogEntry(a)}
                        className={`border-b last:border-0 cursor-pointer transition-colors ${
                          a.checked
                            ? "border-emerald-100 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                            : "border-red-100 bg-red-50 text-red-900 hover:bg-red-100"
                        }`}
                      >
                        <td className="p-3 px-4 text-[12px] opacity-70">{actionSeqNo.get(a.id) ?? "-"}</td>
                        <td className="p-3 px-4 text-[12px] whitespace-nowrap opacity-70">{fmtDateTime(a.at)}</td>
                        <td className="p-3 px-4 text-[13px] font-bold">{a.guest}</td>
                        <td className="p-3 px-4 text-[13px]">{effectiveRoomNumber(a.room)}</td>
                        <td className="p-3 px-4 text-[12px] font-bold">{a.action}</td>
                        <td className="p-3 px-4 text-[12px] opacity-80">{a.detail}</td>
                        <td className="p-3 px-4 text-[11px] opacity-70 whitespace-nowrap">{a.userEmail || "-"}</td>
                        <td className="p-3 px-4" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setSelectedLogEntry(a)}
                            className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity whitespace-nowrap"
                          >
                            Detail
                          </button>
                        </td>
                        <td className="p-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={!!a.checked}
                            onChange={() => handleToggleActionChecked(a.id)}
                            className="w-4 h-4 cursor-pointer accent-[var(--text-primary)]"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="p-3 px-4 text-[10px] text-[var(--text-primary)]/40 italic border-t border-[var(--text-primary)]/8">
                  Saved permanently, not just on this device — every entry ever logged for this property stays here (use search above to narrow it down). Use as a reference to re-enter these actions into MEWS once it&apos;s back online, and tick BCP Check once an action has been re-keyed into MEWS.
                </div>
              </div>
            )}

            {/* Print-only housekeeping sheet - not the on-screen Timeline grid,
                which doesn't paginate; a plain table prints reliably instead.
                Hidden while Reg Card is open (regCardFor set) so the two
                print-only blocks on this page can't both fire from one Print
                click - without this, printing from inside the Reg Card modal
                printed the housekeeping sheet first and the RR3 form second,
                easy to miss/mistake for "the signature didn't print". */}
            {!regCardFor && (
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
                      <td className="p-2 px-3 text-[13px] font-bold">{effectiveRoomNumber(r.room)}</td>
                      <td className="p-2 px-3 text-[13px]">{effectiveRoomState(r)}</td>
                      <td className="p-2 px-3 text-[13px]">{r.occupant || "-"}</td>
                      <td className="p-2 px-3 text-[13px]">{r.arriving || "-"}</td>
                      <td className="p-2 px-3 text-[13px]">{r.departing || "-"}</td>
                      <td className="p-2 px-3 text-[13px]">☐</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </>
        )}

        {/* Print-only registration card - renders on the exact same
            admin-editable ร.ร.๓ template as /rr3 (rr3_templates table),
            just populated from cached snapshot fields instead of a live
            MEWS customer-profile fetch. The interactive Reg Card modal
            below is marked no-print (fixed-position overlays don't
            paginate reliably), so this plain in-flow duplicate is what
            actually prints, same pattern as the housekeeping sheet above. */}
        {regCardFor && rr3Template && (
          <div
            className="hidden print:block"
            dangerouslySetInnerHTML={{
              __html: renderRr3Template(rr3Template, {
                ...buildRegCardTokens(regCardGuestFor || ownerGuestIdentity(regCardFor), regCardFor, snapshot?.property || "", effectiveRoomNumber(regCardFor.room)),
                Occupation: regCardOccupation,
                Email: regCardEmail,
                MarketingConsentChk: regCardMarketingConsent ? "X" : "",
                DepartureCurrentChk: regCardDepartureOption === "current" ? "X" : "",
                DepartureOtherChk: regCardDepartureOption === "other" ? "X" : "",
                DepartureDetail: regCardDepartureDetail,
                DestinationCurrentChk: regCardDestinationOption === "current" ? "X" : "",
                DestinationOtherChk: regCardDestinationOption === "other" ? "X" : "",
                DestinationDetail: regCardDestinationDetail,
                GuestSignatureDataUrl: guestSignature || undefined,
              }),
            }}
          />
        )}

        {/* Reg Card preview - shows the actual ร.ร.๓ form on screen (not a
            summary of it), same look as /print-rr3's dark viewer, so what
            the guest sees and signs is exactly what prints. The signature
            pad is a real <canvas> floating over it (dangerouslySetInnerHTML
            can't host a live React canvas inline); every stroke re-renders
            the form preview behind it with the signature already placed in
            its <<GuestSign>> slot, so placement is confirmed before printing. */}
        {regCardFor && (
          <div className="no-print fixed inset-0 z-50 overflow-auto" style={{ background: "#525659" }}>
            <div className="fixed top-4 right-4 z-10 flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setRegCardFor(null);
                    setRegCardGuestFor(null);
                    if (regCardReturnLogEntry) {
                      setSelectedLogEntry(regCardReturnLogEntry);
                      setRegCardReturnLogEntry(null);
                    }
                    if (regCardReturnReservation) {
                      setSelectedReservation(regCardReturnReservation);
                      setRegCardReturnReservation(null);
                    }
                  }}
                  className="px-4 py-2 text-[11px] font-bold tracked-caps border border-white/30 text-white bg-black/30 hover:bg-black/50 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={handleSaveRegCard}
                  disabled={savingRegCard || !regCardOccupation.trim()}
                  title={!regCardOccupation.trim() ? "Occupation is required" : undefined}
                  className="px-4 py-2 text-[11px] font-bold tracked-caps bg-amber-400 text-[#152A00] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingRegCard ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={handlePrintRegCard}
                  disabled={!rr3Template || !regCardOccupation.trim()}
                  title={!regCardOccupation.trim() ? "Occupation is required" : undefined}
                  className="px-4 py-2 text-[11px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Print
                </button>
              </div>
              {regCardSaveResult && (
                <span className={`px-3 py-1.5 text-[11px] font-bold tracked-caps bg-black/50 rounded ${regCardSaveResult.ok ? "text-emerald-300" : "text-red-300"}`}>
                  {regCardSaveResult.ok ? "✓ " : "✕ "}{regCardSaveResult.message}
                </span>
              )}
            </div>

            {/* pr-[380px] reserves the fixed-position side panel's own
                width (340px) + gap on the right, so centering the form in
                the remaining space keeps it from sliding underneath the
                panel instead of actually avoiding it. */}
            <div className="flex justify-center py-10 pr-[380px]">
              {rr3Template ? (
                <div
                  dangerouslySetInnerHTML={{
                    __html: renderRr3Template(rr3Template, {
                      ...buildRegCardTokens(regCardGuestFor || ownerGuestIdentity(regCardFor), regCardFor, snapshot?.property || "", effectiveRoomNumber(regCardFor.room)),
                      Occupation: regCardOccupation,
                      Email: regCardEmail,
                      MarketingConsentChk: regCardMarketingConsent ? "X" : "",
                      DepartureCurrentChk: regCardDepartureOption === "current" ? "X" : "",
                      DepartureOtherChk: regCardDepartureOption === "other" ? "X" : "",
                      DepartureDetail: regCardDepartureDetail,
                      DestinationCurrentChk: regCardDestinationOption === "current" ? "X" : "",
                      DestinationOtherChk: regCardDestinationOption === "other" ? "X" : "",
                      DestinationDetail: regCardDestinationDetail,
                      GuestSignatureDataUrl: guestSignature || undefined,
                    }),
                  }}
                />
              ) : (
                <div className="text-white/70 text-sm italic mt-20">Loading the ร.ร.๓ template...</div>
              )}
            </div>

            <div className="fixed bottom-4 right-4 z-10 bg-white text-black border border-black/10 shadow-2xl p-4 w-[340px] max-h-[92vh] overflow-y-auto">
              {/* Occupation - MEWS's own customer profile very often has no
                  Occupation at all; printing a fabricated default in that
                  case misrepresented data MEWS never provided (see
                  buildRegCardTokens). A required field instead: pre-filled
                  from MEWS when present, but always front-desk-editable, and
                  Save/Print stay disabled until it's non-empty. */}
              <div className="text-[10px] font-bold tracked-caps text-black/50 mb-1.5">
                Occupation <span className="text-red-500">*</span>
              </div>
              <input
                value={regCardOccupation}
                onChange={(e) => setRegCardOccupation(e.target.value)}
                placeholder="e.g. Businessman, Engineer, Student"
                className={`w-full mb-3 px-2 py-1.5 text-[12px] border rounded focus:outline-none focus:border-black/40 ${
                  regCardOccupation.trim() ? "border-black/15" : "border-red-300"
                }`}
              />

              {/* ร.ร.๓ sections 1/2 - filled in before the guest signs, so
                  they're captured on the same printed form (see the
                  <<Departure*>>/<<Destination*>> tokens in DEFAULT_RR3_TEMPLATE)
                  instead of being left for the guest to hand-write. Each
                  section is a "current address" vs. "other address" choice -
                  toggling one option always unchecks the other, so exactly
                  one is checked at all times (the form's own "answer at
                  least one" requirement, satisfied by construction). */}
              <div className="text-[10px] font-bold tracked-caps text-black/50 mb-1.5">1. Place of Departure</div>
              <div className="flex flex-col gap-1 mb-2 text-[12px]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={regCardDepartureOption === "current"} onChange={() => setRegCardDepartureOption("current")} />
                  Current address (above)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={regCardDepartureOption === "other"} onChange={() => setRegCardDepartureOption("other")} />
                  Other accommodation
                </label>
              </div>
              <input
                value={regCardDepartureDetail}
                onChange={(e) => setRegCardDepartureDetail(e.target.value)}
                placeholder="House no., sub-district, district, province, country"
                className="w-full mb-3 px-2 py-1.5 text-[12px] border border-black/15 rounded focus:outline-none focus:border-black/40"
              />

              <div className="text-[10px] font-bold tracked-caps text-black/50 mb-1.5">2. Next Destination</div>
              <div className="flex flex-col gap-1 mb-2 text-[12px]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={regCardDestinationOption === "current"} onChange={() => setRegCardDestinationOption("current")} />
                  Current address (above)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={regCardDestinationOption === "other"} onChange={() => setRegCardDestinationOption("other")} />
                  Other accommodation
                </label>
              </div>
              <input
                value={regCardDestinationDetail}
                onChange={(e) => setRegCardDestinationDetail(e.target.value)}
                placeholder="House no., sub-district, district, province, country"
                className="w-full mb-4 px-2 py-1.5 text-[12px] border border-black/15 rounded focus:outline-none focus:border-black/40"
              />

              <div className="text-[10px] font-bold tracked-caps text-black/50 mb-1.5 pt-3 border-t border-black/10">Email Address</div>
              <input
                value={regCardEmail}
                onChange={(e) => setRegCardEmail(e.target.value)}
                placeholder="guest@example.com"
                className="w-full mb-2 px-2 py-1.5 text-[12px] border border-black/15 rounded focus:outline-none focus:border-black/40"
              />
              {/* Opt-in, never assumed - starts unchecked regardless of
                  whether MEWS had an email on file, unlike Departure/
                  Destination above which always have a default answer. */}
              <label className="flex items-start gap-2 cursor-pointer text-[11px] mb-4">
                <input
                  type="checkbox"
                  checked={regCardMarketingConsent}
                  onChange={(e) => setRegCardMarketingConsent(e.target.checked)}
                  className="mt-0.5 shrink-0"
                />
                I&apos;d like to occasionally receive marketing updates from {snapshot?.property || "this hotel"}
              </label>

              <div className="text-[10px] font-bold tracked-caps text-black/50 mb-1 pt-3 border-t border-black/10">Guest Signature</div>
              <SignaturePad value={guestSignature} onChange={setGuestSignature} />
              <div className="mt-2 text-[10px] text-black/40 italic">
                ID/passport, address, occupation and telephone come from MEWS&apos;s customer profile, cached at capture time - prints blank only if the guest&apos;s own MEWS profile is missing that field.
              </div>
              {!regCardOccupation.trim() && (
                <div className="mt-3 px-3 py-2 text-[11px] font-bold tracked-caps bg-amber-50 border border-amber-200 rounded text-amber-700">
                  Occupation is required before saving or printing
                </div>
              )}
            </div>
          </div>
        )}

        {chgRoomFor && (
          <div className="no-print fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setChgRoomFor(null)}>
            <div className="bg-[var(--paper)] text-[var(--text-primary)] border border-[var(--text-primary)]/14 max-w-sm w-full shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
              <div className="font-display text-xl mb-1">Change Room</div>
              <div className="text-[12px] text-[var(--text-primary)]/60 mb-4">{chgRoomFor.guest} — currently in {effectiveRoomNumber(chgRoomFor.room)}</div>
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

        {/* Edit/Add Guest - editGuestFor.isNew distinguishes a brand new
            guest (blank form, no MEWS record at all) from correcting an
            existing one; both save to the same bcp_guest_overrides upsert
            (see handleSaveGuestEdit), local-only like everything else here. */}
        {editGuestFor && editGuestForm && (
          <div className="no-print fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => { setEditGuestFor(null); setEditGuestForm(null); setEditGuestOriginal(null); setGuestEditError(null); }}>
            <div
              className="bg-[var(--paper)] text-[var(--text-primary)] border border-[var(--text-primary)]/14 max-w-3xl w-full max-h-[92vh] overflow-y-auto shadow-2xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="font-display text-xl mb-1">{editGuestFor.isNew ? "Add Guest" : "Edit Guest"}</div>
              <div className="text-[11px] text-[var(--text-primary)]/50 mb-4">
                <span className="text-red-600 font-bold">*</span> Required
              </div>
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ["name", "Full name", true],
                    ["title", "Title", false],
                    ["first_name", "First name", false],
                    ["last_name", "Last name", false],
                    ["second_last_name", "Second last name", false],
                    ["nationality_name", "Nationality", false],
                    ["language", "Language", false],
                    ["phone", "Telephone", false],
                    ["sex", "Sex", false],
                    ["birth_date", "Date of birth (YYYY-MM-DD)", false],
                    ["birth_country_name", "Country of birth", false],
                    ["birth_place", "Place of birth", false],
                    ["occupation", "Occupation", false],
                    ["passport_number", "Passport", false],
                    ["identity_card_number", "ID Card", false],
                    ["alien_book", "Alien Book", false],
                    ["email", "Email", false],
                  ] as [keyof GuestIdentity, string, boolean][]
                ).map(([field, label, required]) => (
                  <div key={field}>
                    <div className="text-[10px] text-[var(--text-primary)]/50 mb-1">
                      {label}{required && <span className="text-red-600 font-bold ml-0.5">*</span>}
                    </div>
                    <input
                      value={(editGuestForm[field] as string) || ""}
                      onChange={(e) => setEditGuestForm((prev) => (prev ? { ...prev, [field]: e.target.value } : prev))}
                      className="w-full px-2.5 py-1.5 text-[13px] rounded-lg bg-[var(--text-primary)]/5 focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)]/30"
                    />
                  </div>
                ))}
                <div className="col-span-3">
                  <div className="text-[10px] text-[var(--text-primary)]/50 mb-1">Address</div>
                  <input
                    value={editGuestForm.address_details || ""}
                    onChange={(e) => setEditGuestForm((prev) => (prev ? { ...prev, address_details: e.target.value } : prev))}
                    className="w-full px-2.5 py-1.5 text-[13px] rounded-lg bg-[var(--text-primary)]/5 focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)]/30"
                  />
                </div>
              </div>
              <div className="text-[10px] text-[var(--text-primary)]/40 italic mt-3">
                This only updates the guest list shown here (Guest Profile, Reg Card) - it does not change anything in MEWS.
              </div>
              {guestEditError && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-bold">
                  {guestEditError}
                </div>
              )}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => { setEditGuestFor(null); setEditGuestForm(null); setEditGuestOriginal(null); setGuestEditError(null); }} className="px-4 py-2 text-[11px] font-bold tracked-caps border border-[var(--text-primary)]/20 hover:bg-[var(--text-primary)]/5 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSaveGuestEdit}
                  disabled={savingGuestEdit || !editGuestForm.name.trim()}
                  className="px-4 py-2 text-[11px] font-bold tracked-caps bg-amber-400 text-[#152A00] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingGuestEdit ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}

        {removeGuestFor && (
          <div className="no-print fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setRemoveGuestFor(null)}>
            <div className="bg-[var(--paper)] text-[var(--text-primary)] border border-[var(--text-primary)]/14 max-w-sm w-full shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
              <div className="font-display text-xl mb-1">Remove Guest</div>
              <div className="text-[13px] text-[var(--text-primary)]/70 mb-4">
                Remove <span className="font-bold">{removeGuestFor.guest.name || "this guest"}</span> from this reservation&#39;s guest list? This only updates the list shown here - it does not change anything in MEWS.
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setRemoveGuestFor(null)} className="px-4 py-2 text-[11px] font-bold tracked-caps border border-[var(--text-primary)]/20 hover:bg-[var(--text-primary)]/5 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => {
                    handleRemoveGuest(removeGuestFor.guestKey, removeGuestFor.guest);
                    setRemoveGuestFor(null);
                  }}
                  className="px-4 py-2 text-[11px] font-bold tracked-caps border border-red-300 text-red-700 hover:bg-red-50 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}

        {roomStatusReasonModal}
        {checkInDirtyModal}

        {/* Action Log Detail - every entry here is by definition a local-only
            change (there's nowhere to write these back to while MEWS is
            down), so the Status field always reads the same thing: it's a
            record of something updated in our system, not MEWS. Three tabs,
            all built exclusively from selectedLogEntry.reservationSnapshot -
            the copy frozen the instant this action was logged - never from
            selectedReservation/bcp_snapshots (the 1-hour rotating history),
            so this page keeps showing the booking exactly as it looked back
            then even after the live Timeline moves on. Local logDetailTab/
            logGuestProfile/logGuestProfileTab state (not showManagePage or
            selectedGuestProfile) keeps this fully independent of the live
            Manage/Guest Profile pages. */}
        {selectedLogEntry && (() => {
          const entry = selectedLogEntry;
          const snap = entry.reservationSnapshot;
          const fieldBoxCls = "px-3 py-2.5 rounded-lg bg-[var(--text-primary)]/5 text-[var(--text-primary)] text-[13px]";
          const propRow = (label: string, value: ReactNode) => (
            <>
              <div className="text-[var(--text-primary)]/50">{label}</div>
              <div className="text-right">{value}</div>
            </>
          );
          // Re-derives a structured before/after out of the plain detail
          // string each action already logs (see handleRoomStatusChange /
          // handleChgRoomSave / handleRoomNumberChange / handleSaveRegCard)
          // rather than adding new fields to OfflineAction - every existing
          // log entry, old or new, benefits immediately.
          let changeDetailNode: ReactNode = <div className={`${fieldBoxCls} whitespace-pre-line`}>{entry.detail}</div>;
          if (entry.action === "Room Status") {
            const m = entry.detail.match(/^Room (.+): (.+) -> (.+)$/);
            if (m) {
              changeDetailNode = (
                <div className="flex items-center gap-3 text-[14px] flex-wrap">
                  <span className="text-[11px] text-[var(--text-primary)]/50 tracked-caps">Room {m[1]}</span>
                  <span className="px-2.5 py-1 rounded border border-[var(--text-primary)]/20">{m[2]}</span>
                  <span className="text-[var(--text-primary)]/40">→</span>
                  <span className="px-2.5 py-1 rounded bg-[#152A00] text-[#FFEFD2] font-bold">{m[3]}</span>
                </div>
              );
            }
          } else if (entry.action === "Chg Room") {
            const m = entry.detail.match(/^(.+) -> (.+)$/);
            if (m) {
              changeDetailNode = (
                <div className="flex items-center gap-3 text-[14px] flex-wrap">
                  <span className="text-[11px] text-[var(--text-primary)]/50 tracked-caps">Room</span>
                  <span className="px-2.5 py-1 rounded border border-[var(--text-primary)]/20">{m[1]}</span>
                  <span className="text-[var(--text-primary)]/40">→</span>
                  <span className="px-2.5 py-1 rounded bg-[#152A00] text-[#FFEFD2] font-bold">{m[2]}</span>
                </div>
              );
            }
          } else if (entry.action === "Room Number") {
            const m = entry.detail.match(/^Room (.+): renamed to (.+)$/);
            if (m) {
              changeDetailNode = (
                <div className="flex items-center gap-3 text-[14px] flex-wrap">
                  <span className="text-[11px] text-[var(--text-primary)]/50 tracked-caps">Display number</span>
                  <span className="px-2.5 py-1 rounded border border-[var(--text-primary)]/20">{m[1]}</span>
                  <span className="text-[var(--text-primary)]/40">→</span>
                  <span className="px-2.5 py-1 rounded bg-[#152A00] text-[#FFEFD2] font-bold">{m[2]}</span>
                </div>
              );
            }
          } else if (entry.action === "Reg Card Saved") {
            const signed = entry.detail.includes("with signature");
            changeDetailNode = (
              <div className="flex items-center gap-2 text-[14px]">
                <span>Signature</span>
                <span className={`px-2.5 py-1 rounded text-[11px] font-bold ${signed ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {signed ? "✓ Signed" : "Not signed"}
                </span>
              </div>
            );
          } else if (entry.action === "Arrival Changed") {
            // detail can hold one or both of Arrival/Departure (only the
            // field(s) actually changed - see handleSaveArrivalChange), so
            // each " | "-separated segment gets its own before/after row.
            const rows = entry.detail
              .split(" | ")
              .map((seg) => seg.match(/^(Arrival|Departure): (.+) -> (.+)$/))
              .filter((m): m is RegExpMatchArray => !!m);
            if (rows.length) {
              changeDetailNode = (
                <div className="flex flex-col gap-2">
                  {rows.map((m, i) => (
                    <div key={i} className="flex items-center gap-3 text-[13px] flex-wrap">
                      <span className="text-[11px] text-[var(--text-primary)]/50 tracked-caps w-16 shrink-0">{m[1]}</span>
                      <span className="px-2.5 py-1 rounded border border-[var(--text-primary)]/20">{m[2]}</span>
                      <span className="text-[var(--text-primary)]/40">→</span>
                      <span className="px-2.5 py-1 rounded bg-[#152A00] text-[#FFEFD2] font-bold">{m[3]}</span>
                    </div>
                  ))}
                </div>
              );
            }
          } else if (entry.action === "Room Type Changed") {
            const m = entry.detail.match(/^Room Type: (.+) -> (.+)$/);
            if (m) {
              changeDetailNode = (
                <div className="flex items-center gap-3 text-[14px] flex-wrap">
                  <span className="text-[11px] text-[var(--text-primary)]/50 tracked-caps">Room Type</span>
                  <span className="px-2.5 py-1 rounded border border-[var(--text-primary)]/20">{m[1]}</span>
                  <span className="text-[var(--text-primary)]/40">→</span>
                  <span className="px-2.5 py-1 rounded bg-[#152A00] text-[#FFEFD2] font-bold">{m[2]}</span>
                </div>
              );
            }
          } else if (entry.action === "Payment Processed") {
            changeDetailNode = (
              <div className="flex items-center gap-2 text-[14px]">
                <span className="px-2.5 py-1 rounded text-[11px] font-bold bg-emerald-100 text-emerald-700">Paid</span>
                <span>{entry.detail}</span>
              </div>
            );
          }
          // Whoever this specific action was actually about (e.g. the
          // companion a Reg Card was saved for) - falls back to the Owner
          // for room-level actions (guest === "-") - shared by the Guest
          // Profile tab's default guest and the header's Reg Card button.
          const actionGuest = snap ? (allReservationGuests(snap).find((gg) => gg.name === entry.guest) || ownerGuestIdentity(snap)) : null;

          return (
            <div className="no-print fixed inset-0 z-50 bg-[var(--paper)] text-[var(--text-primary)] flex flex-col">
              <div className="flex-1 overflow-y-auto p-10 md:p-16">
                <div className="font-display text-4xl md:text-5xl mb-6 max-w-6xl">Action Log Detail</div>

                <div className="flex items-center gap-6 border-b border-[var(--text-primary)]/10 mb-8 max-w-6xl overflow-x-auto overflow-y-hidden">
                  {(["log", "properties", "guestProfile"] as const)
                    .filter((t) => t === "log" || !!snap)
                    .map((t) => (
                      <button
                        key={t}
                        onClick={() => setLogDetailTab(t)}
                        className={`py-3 text-[13px] font-bold whitespace-nowrap border-b-2 -mb-px transition-all ${
                          logDetailTab === t
                            ? "border-[var(--text-primary)] text-[var(--text-primary)]"
                            : "border-transparent text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {t === "log" ? "Log" : t === "properties" ? "Properties" : "Guest Profile"}
                      </button>
                    ))}
                </div>

                {logDetailTab === "log" && (
                  <div className="max-w-2xl">
                    <div className="border border-[var(--text-primary)]/14 rounded-xl p-6 mb-6">
                      <div className="grid grid-cols-[140px_1fr] gap-y-4 text-[15px]">
                        <div className="text-[var(--text-primary)]/50">Status</div>
                        <div className="font-bold text-red-700">● Updated in our system</div>
                        <div className="text-[var(--text-primary)]/50">Time</div>
                        <div>{fmtDateTime(entry.at)}</div>
                        <div className="text-[var(--text-primary)]/50">Guest</div>
                        <div>{entry.guest || "-"}</div>
                        <div className="text-[var(--text-primary)]/50">Room</div>
                        <div className="font-bold">{effectiveRoomNumber(entry.room)}</div>
                        <div className="text-[var(--text-primary)]/50">Action</div>
                        <div className="font-bold">{entry.action}</div>
                        {snap?.number && (
                          <>
                            <div className="text-[var(--text-primary)]/50">Reservation #</div>
                            <div>{snap.number}</div>
                          </>
                        )}
                        {snap && (
                          <>
                            <div className="text-[var(--text-primary)]/50">Stay</div>
                            <div>{fmtDateOnly(snap.check_in)} – {fmtDateOnly(snap.check_out)}</div>
                          </>
                        )}
                        {entry.reason && (
                          <>
                            <div className="text-[var(--text-primary)]/50">Reason</div>
                            <div>{entry.reason}</div>
                          </>
                        )}
                        <div className="text-[var(--text-primary)]/50">User</div>
                        <div>{entry.userEmail || "-"}</div>
                        {snap && actionGuest && (
                          <>
                            <div className="text-[var(--text-primary)]/50">Reg Card</div>
                            <div>
                              <button
                                onClick={() => {
                                  handleOpenRegCard(snap, actionGuest);
                                  setRegCardReturnLogEntry(entry);
                                  setSelectedLogEntry(null);
                                }}
                                title={`Open ${actionGuest.name || "this guest"}'s Reg Card`}
                                className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity"
                              >
                                Open Reg Card
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="border border-[var(--text-primary)]/14 rounded-xl p-6">
                      <div className="font-display text-lg mb-3">Change Detail</div>
                      {changeDetailNode}
                    </div>
                  </div>
                )}

                {logDetailTab === "properties" && snap && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10 max-w-6xl items-start">
                    <div className="flex flex-col gap-6">
                      <div>
                        <div className="font-display text-xl mb-3">Notes</div>
                        {snap.notes.length > 0 ? (
                          <div className="flex flex-col gap-4">
                            {snap.notes.map((n, i) => (
                              <div key={i}>
                                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Note ({n.type}), {fmtNoteTimestamp(n.created_utc)}</div>
                                <div className={`${fieldBoxCls} whitespace-pre-line`}>{n.text}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[var(--text-primary)]/40 italic text-[13px]">No notes recorded.</div>
                        )}
                      </div>
                      <div>
                        <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Arrival</div>
                        <div className="flex gap-2">
                          <div className={`${fieldBoxCls} flex-1`}>{fmtDateOnly(snap.check_in)}</div>
                          <div className={`${fieldBoxCls} w-24 text-center`}>{fmtWeekdayTime(snap.check_in).split(" ")[1]}</div>
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Departure</div>
                        <div className="flex gap-2">
                          <div className={`${fieldBoxCls} flex-1`}>{fmtDateOnly(snap.check_out)}</div>
                          <div className={`${fieldBoxCls} w-24 text-center`}>{fmtWeekdayTime(snap.check_out).split(" ")[1]}</div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                        <div className="font-display text-xl">Reservations</div>
                        <div className="flex gap-2">
                          <button disabled title="No live connection to MEWS to manage this reservation from here" className="px-3 py-1.5 rounded-lg border border-[var(--text-primary)]/20 text-[11px] font-bold text-[var(--text-primary)]/50 opacity-50 cursor-not-allowed">Create billing automation</button>
                          <button disabled title="No live connection to MEWS to manage this reservation from here" className="px-3 py-1.5 rounded-lg border border-[var(--text-primary)]/20 text-[11px] font-bold text-[var(--text-primary)]/50 opacity-50 cursor-not-allowed">Unlock</button>
                        </div>
                      </div>
                      <div className="border border-[var(--text-primary)]/14 rounded-xl p-4 mb-5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-[var(--text-primary)]/10 flex items-center justify-center text-[11px] font-bold shrink-0">{guestInitials(snap.guest || "?")}</div>
                          <div className="font-bold text-[14px] truncate">{snap.guest || "(no name)"}</div>
                          <span className={`shrink-0 px-2 py-0.5 text-[10px] font-bold border rounded ${STATE_BADGE_CLS[snap.state] || STATE_BADGE_CLS.Processed}`}>
                            {STATE_DISPLAY_LABEL[snap.state] || snap.state}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-bold text-[13px]">{effectiveRoomNumber(snap.room)}</span>
                          {typeof snap.room_locked === "boolean" && (
                            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${snap.room_locked ? "bg-indigo-500 text-white" : "bg-slate-200 text-slate-400"}`}>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px]">
                        {propRow("Service", snap.service || "-")}
                        {propRow("Confirmation number", snap.number || "-")}
                        {snap.group_name && propRow("Group name", snap.group_name)}
                        {propRow("Status", (
                          <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border rounded ${STATE_BADGE_CLS[snap.state] || STATE_BADGE_CLS.Processed}`}>
                            {STATE_DISPLAY_LABEL[snap.state] || snap.state}
                          </span>
                        ))}
                        {propRow("Arrival", fmtFullDateTime(snap.check_in))}
                        {propRow("Departure", fmtFullDateTime(snap.check_out))}
                        {snap.purpose && propRow("Booking purpose", snap.purpose)}
                        {snap.segment && propRow("Segment", snap.segment)}
                        {propRow("Guests", `${snap.adults} × Adult${snap.adults !== 1 ? "s" : ""}${snap.children ? `, ${snap.children} × Child${snap.children !== 1 ? "ren" : ""}` : ""}`)}
                        {typeof snap.total_amount === "number" && (() => {
                          const nights = Math.max(1, Math.round((new Date(snap.check_out).getTime() - new Date(snap.check_in).getTime()) / 86400000));
                          return (
                            <>
                              {propRow("Avg. rate (nightly)", ((snap.rate_amount ?? 0) / nights).toLocaleString("en-US", { minimumFractionDigits: 2 }))}
                              {propRow("Avg. price with products (nightly)", (snap.total_amount / nights).toLocaleString("en-US", { minimumFractionDigits: 2 }))}
                            </>
                          );
                        })()}
                        {typeof snap.total_amount === "number" && propRow("Total amount", `${snap.total_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${snap.currency || ""}`)}
                        {typeof snap.total_amount_gross === "number" && propRow("Total amount (Gross)", snap.total_amount_gross.toLocaleString("en-US", { minimumFractionDigits: 2 }))}
                        {snap.category && propRow("Requested category", snap.category)}
                        {propRow("Assigned space", <span className="font-bold">{snap.room ? effectiveRoomNumber(snap.room) : "-"}</span>)}
                        {snap.rate && propRow("Rate", snap.rate)}
                        {snap.travel_agency && propRow("Travel agency", <span className="underline decoration-1 underline-offset-2">{snap.travel_agency}</span>)}
                        {snap.travel_agency_confirmation_number && propRow("Travel agency confirmation number", snap.travel_agency_confirmation_number)}
                      </div>

                      {!!snap.rate_lines?.length && (
                        <div className="mt-4 pt-4 border-t border-[var(--text-primary)]/10">
                          <div className="text-[11px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-2">Nights</div>
                          <div className="flex flex-col gap-1">
                            {snap.rate_lines.map((line, i) => (
                              <div key={i} className="flex items-center justify-between text-[13px]">
                                <span className="text-[var(--text-primary)]/60">{line.label}</span>
                                <span>{line.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {!!snap.item_lines?.length && (
                        <div className="mt-4 pt-4 border-t border-[var(--text-primary)]/10">
                          <div className="text-[11px] font-bold text-[var(--text-primary)]/50 tracked-caps mb-2">Products</div>
                          <div className="flex flex-col gap-1">
                            {snap.item_lines.map((line, i) => (
                              <div key={i} className="flex items-center justify-between text-[13px]">
                                <span className="text-[var(--text-primary)]/60">{line.label}</span>
                                <span>{line.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px] mt-4 pt-4 border-t border-[var(--text-primary)]/10">
                        {snap.origin && propRow("Origin", snap.origin)}
                        {snap.reservation_source && propRow("Reservation source", snap.reservation_source)}
                        {snap.created_utc && propRow("Created", fmtDateTime(snap.created_utc))}
                      </div>
                    </div>
                  </div>
                )}

                {logDetailTab === "guestProfile" && snap && logGuestProfile && (() => {
                  const g = logGuestProfile;
                  const group = allReservationGuests(snap);
                  const fmtPaymentType = (p: GuestPayment) => {
                    const base = p.type.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
                    return p.sub_type ? `${base} ${p.sub_type}` : base;
                  };
                  return (
                    <div className="max-w-5xl">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-full bg-[var(--text-primary)]/10 flex items-center justify-center text-[13px] font-bold shrink-0">{guestInitials(g.name || "?")}</div>
                        <div>
                          <div className="font-display text-2xl">{g.name || "(no name)"}</div>
                          {group[0] === g && <div className="text-[10px] text-[var(--text-primary)]/50">Owner</div>}
                        </div>
                      </div>

                      <div className="flex gap-6 border-b border-[var(--text-primary)]/10 mb-6">
                        {(["profile", "payments", "billing"] as const).map((t) => (
                          <button
                            key={t}
                            onClick={() => setLogGuestProfileTab(t)}
                            className={`pb-3 text-[13px] font-bold capitalize border-b-2 -mb-px transition-all ${
                              logGuestProfileTab === t
                                ? "border-[var(--text-primary)] text-[var(--text-primary)]"
                                : "border-transparent text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>

                      {logGuestProfileTab === "profile" && (
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6">
                          <div className="border border-[var(--text-primary)]/14 rounded-xl p-5 flex flex-col gap-4">
                            <div className="font-display text-xl text-[var(--text-primary)]">Profile</div>
                            <div>
                              <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Email</div>
                              <div className={fieldBoxCls}>{g.email || "-"}</div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Title</div>
                                <div className={fieldBoxCls}>{g.title || "-"}</div>
                              </div>
                              <div>
                                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">First name</div>
                                <div className={fieldBoxCls}>{g.first_name || "-"}</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Last name</div>
                                <div className={fieldBoxCls}>{g.last_name || "-"}</div>
                              </div>
                              <div>
                                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Second last name</div>
                                <div className={fieldBoxCls}>{g.second_last_name || "-"}</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Nationality</div>
                                <div className={fieldBoxCls}>{g.nationality_name || g.nationality || "-"}</div>
                              </div>
                              <div>
                                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Language</div>
                                <div className={fieldBoxCls}>{g.language || "-"}</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Telephone</div>
                                <div className={fieldBoxCls}>{g.phone || "-"}</div>
                              </div>
                              <div>
                                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Sex</div>
                                <div className={fieldBoxCls}>{g.sex || "-"}</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Date of birth</div>
                                <div className={fieldBoxCls}>{fmtBirthDate(g.birth_date) || "-"}</div>
                              </div>
                              <div>
                                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Country of birth</div>
                                <div className={fieldBoxCls}>{g.birth_country_name || "-"}</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Place of birth</div>
                                <div className={fieldBoxCls}>{g.birth_place || "-"}</div>
                              </div>
                              <div>
                                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Occupation</div>
                                <div className={fieldBoxCls}>{g.occupation || "-"}</div>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col gap-6">
                            <div className="border border-[var(--text-primary)]/14 rounded-xl p-5">
                              <div className="font-display text-lg text-[var(--text-primary)] mb-3">Identity documents</div>
                              {g.passport_number || g.identity_card_number || g.alien_book ? (
                                <div className="flex flex-col gap-3">
                                  {g.passport_number && (
                                    <div>
                                      <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Passport</div>
                                      <div className={fieldBoxCls}>{g.passport_number}</div>
                                    </div>
                                  )}
                                  {g.identity_card_number && (
                                    <div>
                                      <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">ID Card</div>
                                      <div className={fieldBoxCls}>{g.identity_card_number}</div>
                                    </div>
                                  )}
                                  {g.alien_book && (
                                    <div>
                                      <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Alien Book</div>
                                      <div className={fieldBoxCls}>{g.alien_book}</div>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-[var(--text-primary)]/40 italic text-[13px]">No data available.</div>
                              )}
                            </div>

                            <div className="border border-[var(--text-primary)]/14 rounded-xl p-5">
                              <div className="font-display text-lg text-[var(--text-primary)] mb-3">Addresses</div>
                              {g.address_details ? (
                                <div className="text-[13px] text-[var(--text-primary)]">{g.address_details}</div>
                              ) : (
                                <div className="text-[var(--text-primary)]/40 italic text-[13px]">No data available.</div>
                              )}
                            </div>

                            <div className="border border-[var(--text-primary)]/14 rounded-xl p-5">
                              <div className="font-display text-lg text-[var(--text-primary)] mb-3">Related guests</div>
                              {group.filter((rg) => rg !== g).length > 0 ? (
                                <div className="flex flex-col gap-3">
                                  {group.filter((rg) => rg !== g).map((rg, i) => (
                                    <button key={i} onClick={() => { setLogGuestProfile(rg); setLogGuestProfileTab("profile"); }} className="flex items-center gap-3 text-left">
                                      <div className="w-8 h-8 rounded-full bg-[var(--text-primary)]/10 flex items-center justify-center text-[11px] font-bold shrink-0">
                                        {guestInitials(rg.name || "?")}
                                      </div>
                                      <span className="font-bold text-[13px] underline decoration-1 underline-offset-2 hover:text-blue-600 transition-colors">
                                        {rg.name || "(no name)"}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-[var(--text-primary)]/40 italic text-[13px]">No data available.</div>
                              )}
                            </div>

                            <div className="border border-[var(--text-primary)]/14 rounded-xl p-5">
                              <div className="font-display text-lg text-[var(--text-primary)] mb-3">Files</div>
                              <div className="text-[var(--text-primary)]/40 italic text-[13px]">No data available.</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {logGuestProfileTab === "payments" && (
                        <div>
                          <div className="font-display text-2xl text-[var(--text-primary)] mb-5">Payments</div>
                          <div className="border border-[var(--text-primary)]/14 rounded-xl overflow-hidden mb-8">
                            {g.payments && g.payments.length > 0 ? (
                              <table className="w-full text-[13px]">
                                <thead>
                                  <tr className="text-left text-[11px] text-[var(--text-primary)]/50 border-b border-[var(--text-primary)]/10">
                                    <th className="p-3 font-normal">Type</th>
                                    <th className="p-3 font-normal">Identifier</th>
                                    <th className="p-3 font-normal">Created</th>
                                    <th className="p-3 font-normal">State</th>
                                    <th className="p-3 font-normal">Notes</th>
                                    <th className="p-3 font-normal text-right">Value</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.payments.map((p, i) => (
                                    <tr key={i} className="border-b border-[var(--text-primary)]/10 last:border-0">
                                      <td className="p-3">{fmtPaymentType(p)}</td>
                                      <td className="p-3">{p.identifier || "-"}</td>
                                      <td className="p-3 whitespace-nowrap">{fmtDateTime(p.created)}</td>
                                      <td className="p-3">{p.state}</td>
                                      <td className="p-3">{p.notes || "-"}</td>
                                      <td className="p-3 text-right font-bold">
                                        {p.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} {p.currency}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t border-[var(--text-primary)]/10">
                                    <td colSpan={5} className="p-3 text-right font-bold">Total</td>
                                    <td className="p-3 text-right font-bold">
                                      {g.payments.reduce((s, p) => s + p.amount, 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} {g.payments[0].currency}
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            ) : (
                              <div className="p-5 text-[var(--text-primary)]/40 italic text-[13px]">No payments recorded.</div>
                            )}
                          </div>

                          <div className="font-display text-2xl text-[var(--text-primary)] mb-5">Preauthorizations</div>
                          <div className="border border-[var(--text-primary)]/14 rounded-xl p-10 text-center text-[var(--text-primary)]/40 italic text-[13px]">
                            No preauthorizations yet.
                          </div>
                        </div>
                      )}

                      {logGuestProfileTab === "billing" && (
                        <div>
                          <div className="flex items-center justify-between mb-5">
                            <div className="font-display text-2xl text-[var(--text-primary)]">Owned bills</div>
                            <span className="text-[12px] font-bold text-[var(--text-primary)]/50">
                              {(snap.to_be_paid ?? 0) === 0 ? "Balanced" : "Unbalanced"}
                            </span>
                          </div>
                          <div className="border border-[var(--text-primary)]/14 rounded-xl overflow-hidden">
                            <div className="p-5 flex items-center justify-between border-b border-[var(--text-primary)]/10 gap-4">
                              <div className="font-bold text-[15px]">{snap.bill_name || snap.number}</div>
                              <div className="flex items-center gap-8">
                                <div>
                                  <div className="text-[10px] text-[var(--text-primary)]/50 tracked-caps mb-0.5">Reservation status</div>
                                  <span className={`inline-block px-2.5 py-1 text-[10px] font-bold border rounded ${STATE_BADGE_CLS[snap.state] || STATE_BADGE_CLS.Processed}`}>
                                    {STATE_DISPLAY_LABEL[snap.state] || snap.state}
                                  </span>
                                </div>
                                <div>
                                  <div className="text-[10px] text-[var(--text-primary)]/50 tracked-caps mb-0.5">Arrival</div>
                                  <div className="text-[13px] font-bold">{fmtDateOnly(snap.check_in)}</div>
                                </div>
                                <div className="px-4 py-2 rounded-lg bg-[var(--text-primary)]/5 text-right shrink-0">
                                  <div className="text-[10px] text-[var(--text-primary)]/50 tracked-caps mb-0.5">To be paid</div>
                                  <div className="font-bold text-[14px]">
                                    {(snap.to_be_paid ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} {snap.currency}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-[1fr_220px]">
                              <div className="p-5 border-b md:border-b-0 md:border-r border-[var(--text-primary)]/10">
                                <div className="flex items-center gap-3 mb-4 text-[12px] text-[var(--text-primary)]/60">
                                  <input type="checkbox" disabled className="w-4 h-4" />
                                  <span>Select all ({(snap.rate_lines?.length || 0) + (snap.item_lines?.length || 0)})</span>
                                  <button disabled className="ml-auto px-3 py-1.5 text-[10px] font-bold tracked-caps border border-[var(--text-primary)]/20 opacity-50 cursor-not-allowed">
                                    + Add product
                                  </button>
                                </div>
                                <div className="flex flex-col">
                                  {snap.rate_lines?.map((line, i) => (
                                    <div key={`r${i}`} className="flex items-center gap-3 text-[13px] py-2 border-b border-[var(--text-primary)]/5 last:border-0">
                                      <input type="checkbox" disabled className="w-4 h-4 shrink-0" />
                                      <span className="text-[var(--text-primary)]/70">{snap.guest} — {effectiveRoomNumber(snap.room)}</span>
                                      <span className="text-[var(--text-primary)]/50">— Stay {line.label}</span>
                                      <span className="ml-auto font-bold shrink-0">{line.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                                    </div>
                                  ))}
                                  {snap.item_lines?.map((line, i) => (
                                    <div key={`i${i}`} className="flex items-center gap-3 text-[13px] py-2 border-b border-[var(--text-primary)]/5 last:border-0">
                                      <input type="checkbox" disabled className="w-4 h-4 shrink-0" />
                                      <span className="text-[var(--text-primary)]/70">{line.label}</span>
                                      <span className="ml-auto font-bold shrink-0">{line.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                                    </div>
                                  ))}
                                  {!snap.rate_lines?.length && !snap.item_lines?.length && (
                                    <div className="text-[var(--text-primary)]/40 italic text-[13px] py-2">No charges recorded.</div>
                                  )}
                                </div>

                                {g.payments && g.payments.length > 0 && (
                                  <>
                                    <div className="text-[11px] font-bold tracked-caps text-[var(--text-primary)]/50 mt-5 mb-2">Payments</div>
                                    <div className="flex flex-col">
                                      {g.payments.map((p, i) => (
                                        <div key={`p${i}`} className="flex items-center gap-3 text-[13px] py-2 border-b border-[var(--text-primary)]/5 last:border-0">
                                          <input type="checkbox" disabled className="w-4 h-4 shrink-0" />
                                          <span className="text-[var(--text-primary)]/70">{fmtPaymentType(p)}{p.identifier ? ` — ${p.identifier}` : ""}</span>
                                          <span className="ml-auto font-bold shrink-0">{p.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>

                              <div className="p-5 flex flex-col gap-2">
                                <button disabled className="w-full px-4 py-2.5 text-[11px] font-bold tracked-caps border border-[var(--text-primary)]/20 opacity-50 cursor-not-allowed">Preview</button>
                                <button disabled className="w-full px-4 py-2.5 text-[11px] font-bold tracked-caps bg-blue-600 text-white opacity-50 cursor-not-allowed">Process payment</button>
                                <button disabled className="w-full px-4 py-2.5 text-[11px] font-bold tracked-caps border border-[var(--text-primary)]/20 opacity-50 cursor-not-allowed">Issue proforma</button>
                                <button disabled className="w-full px-4 py-2.5 text-[11px] font-bold tracked-caps bg-blue-600 text-white opacity-50 cursor-not-allowed">Close</button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="mt-10 pt-6 border-t border-[var(--text-primary)]/10 text-[13px] text-[var(--text-primary)]/40 italic max-w-6xl">
                  Not synced to MEWS — re-enter this change in MEWS once it&apos;s back online.
                </div>
              </div>
              <div className="flex justify-end gap-2 p-6 border-t border-[var(--text-primary)]/10">
                <button onClick={() => setSelectedLogEntry(null)} className="px-6 py-3 text-[12px] font-bold tracked-caps border border-[var(--text-primary)]/20 hover:bg-[var(--text-primary)]/5 transition-colors">
                  Close
                </button>
              </div>
            </div>
          );
        })()}

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
                        <span className={`shrink-0 inline-block px-2.5 py-1 text-[10px] font-bold border rounded ${STATE_BADGE_CLS[effectiveReservationState(selectedReservation)] || STATE_BADGE_CLS.Processed}`}>
                          {STATE_DISPLAY_LABEL[effectiveReservationState(selectedReservation)] || effectiveReservationState(selectedReservation)}
                        </span>
                      </div>

                      <div
                        className={`px-4 py-3 border-t border-[var(--text-primary)]/10 flex items-center justify-between ${selectedRoomInfo ? "cursor-pointer hover:bg-[var(--text-primary)]/5" : ""}`}
                        onClick={() => { if (selectedRoomInfo) setSelectedRoom(selectedRoomInfo); }}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`font-bold ${selectedRoomInfo ? "underline decoration-1 underline-offset-2" : ""}`}>
                            {selectedRoomInfo?.category_short ? `${selectedRoomInfo.category_short} ` : ""}{selectedReservation.room ? effectiveRoomNumber(selectedReservation.room) : "-"}
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
                          <span className={`shrink-0 inline-block px-2.5 py-1 text-[10px] font-bold border rounded ${ROOM_STATE_BADGE_CLS[effectiveRoomState(selectedRoomInfo)] || "bg-slate-100 text-slate-600 border-slate-300"}`}>
                            {effectiveRoomState(selectedRoomInfo)}
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => setManageNotesOpen((v) => !v)}
                        disabled={selectedReservation.notes.length === 0}
                        className="w-full px-4 py-3 border-t border-[var(--text-primary)]/10 flex items-center justify-between text-left disabled:cursor-default"
                      >
                        <span className="flex items-center gap-2">
                          Notes
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] font-bold">
                            {selectedReservation.notes.length}
                          </span>
                        </span>
                        {selectedReservation.notes.length > 0 && (
                          <svg className={`w-4 h-4 text-[var(--text-primary)]/50 transition-transform ${manageNotesOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        )}
                      </button>
                      {manageNotesOpen && selectedReservation.notes.length > 0 && (
                        <div className="px-4 pb-3 flex flex-col divide-y divide-[var(--text-primary)]/10">
                          {selectedReservation.notes.map((n, i) => (
                            <div key={i} className={i === 0 ? "pb-2.5" : "py-2.5"}>
                              <div className="text-[var(--text-primary)]/80 whitespace-pre-line">{n.text}</div>
                              <div className="text-[11px] text-[var(--text-primary)]/40 mt-1">Note ({n.type}), {fmtNoteTimestamp(n.created_utc)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Box 2: guests - editing/adding/removing is local-only
                        (bcp_guest_overrides), same premise as everything else
                        in BCP: nothing here can push back to MEWS while it's
                        down, but it's recorded permanently (see Action Logs)
                        and reflected everywhere this guest list is used
                        (Guest Profile, Reg Card) from this point on. */}
                    <div className="border border-[var(--text-primary)]/14 rounded-lg overflow-hidden">
                      <div className="px-4 py-3 flex items-center justify-between gap-2">
                        <div className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps">Guests</div>
                        <div className="flex items-center gap-3">
                          <div className="text-[11px] text-[var(--text-primary)]/50">
                            {selectedReservation.adults} × Adults{selectedReservation.children > 0 ? `, ${selectedReservation.children} × Children` : ""}
                          </div>
                          <button
                            onClick={handleAddGuest}
                            className="shrink-0 px-2.5 py-1 text-[10px] font-bold tracked-caps border border-[var(--text-primary)]/20 hover:bg-[var(--text-primary)]/5 transition-colors"
                          >
                            + Add Guest
                          </button>
                        </div>
                      </div>
                      {effectiveDrawerGuests.map(({ guestKey, guest, isOwner }) => (
                        <div key={guestKey} className="px-4 py-3 border-t border-[var(--text-primary)]/10 flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-[var(--text-primary)]/10 flex items-center justify-center text-[11px] font-bold shrink-0">
                              {guestInitials(guest.name || "?")}
                            </div>
                            <div className="min-w-0">
                              <button
                                onClick={() => {
                                  const group = effectiveDrawerGuests.map((e) => e.guest);
                                  setSelectedGuestProfile(guest);
                                  setGuestProfileGroup(group);
                                  setGuestProfileReservation(selectedReservation);
                                  setGuestProfileTab("profile");
                                }}
                                className="font-bold underline decoration-1 underline-offset-2 hover:text-blue-600 transition-colors text-left truncate"
                              >
                                {guest.name || "(no name)"}
                              </button>
                              {isOwner && <span className="text-[10px] text-[var(--text-primary)]/50"> Owner</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => handleOpenEditGuest(guestKey, guest)}
                              className="px-2.5 py-1.5 text-[10px] font-bold tracked-caps border border-[var(--text-primary)]/20 hover:bg-[var(--text-primary)]/5 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setRemoveGuestFor({ guestKey, guest })}
                              title={`Remove ${guest.name || "this guest"}`}
                              className="px-2.5 py-1.5 text-[10px] font-bold tracked-caps border border-red-300 text-red-700 hover:bg-red-50 transition-colors"
                            >
                              −
                            </button>
                            <button
                              onClick={() => {
                                handleOpenRegCard(selectedReservation, guest);
                                setRegCardReturnReservation(selectedReservation);
                                setSelectedReservation(null);
                              }}
                              className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity"
                            >
                              Reg Card
                            </button>
                          </div>
                        </div>
                      ))}
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
                  Read-only snapshot from {isLiveFallback ? "a live MEWS check" : "the last capture"} - no live connection to MEWS, so nothing here can actually be changed.
                </div>
              </div>
                </>
              <div className="sticky bottom-0 bg-[var(--paper)] border-t border-[var(--text-primary)]/10 px-6 py-4 flex items-center justify-between">
                <button
                  onClick={() => {
                    setShowManagePage(true);
                    setManagePageTab("status");
                    setUndoCheckInReason("");
                    setUndoCheckOutReason("");
                    setManageNightsOpen(false);
                    setManageItemGroupsOpen({});
                  }}
                  className="w-[30%] py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-colors"
                >
                  Manage
                </button>
                {isReservationCheckedIn(selectedReservation) ? (
                  <button
                    onClick={() => handleCheckOut(selectedReservation)}
                    disabled={hasCheckedOutLocally(selectedReservation)}
                    title={hasCheckedOutLocally(selectedReservation) ? "Already checked out" : undefined}
                    className="w-[30%] py-2.5 rounded-lg bg-[#152A00] text-[#FFEFD2] text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:hover:opacity-40 disabled:cursor-not-allowed"
                  >
                    Check Out
                  </button>
                ) : (
                  <button
                    onClick={() => requestCheckIn(selectedReservation)}
                    className="w-[30%] py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors"
                  >
                    Check In
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
