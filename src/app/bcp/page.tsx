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
interface GuestIdentity {
  name: string;
  nationality: string;
  nationality_name?: string;
  email: string;
  phone: string;
  identity_card_number?: string;
  passport_number?: string;
  occupation?: string;
  address_details?: string;
  alien_book?: string;
}

interface ReservationRow {
  number: string;
  guest: string;
  nationality: string;
  nationality_name?: string;
  email: string;
  phone: string;
  identity_card_number?: string;
  passport_number?: string;
  occupation?: string;
  address_details?: string;
  alien_book?: string;
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
    nationality: r.nationality,
    nationality_name: r.nationality_name,
    email: r.email,
    phone: r.phone,
    identity_card_number: r.identity_card_number,
    passport_number: r.passport_number,
    occupation: r.occupation,
    address_details: r.address_details,
    alien_book: r.alien_book,
  };
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
  action: "Check In" | "Check Out" | "Chg Room" | "Room Status" | "Room Number" | "Reg Card Saved";
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

// roomNumberDisplay lets the caller (the component, where the display-name
// override lives) pass in the room number as the user actually sees it -
// this function is module-level, outside the component, so it can't reach
// roomNumberOverrides/effectiveRoomNumber itself. Falls back to r.room
// (the raw MEWS number) if not given.
function buildRegCardTokens(r: ReservationRow, hotelName: string, roomNumberDisplay?: string): Rr3TokenData {
  const nameParts = (r.guest || "").trim().split(/\s+/);
  const fmtTimeOnly = (iso: string) => {
    if (!iso) return "";
    const d = toBangkokDateTime(iso);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  return {
    HotelName: hotelName,
    FirstName: nameParts[0] || "",
    LastName: nameParts.slice(1).join(" "),
    ReservationsNumber: r.number,
    RoomNumber: roomNumberDisplay ?? r.room,
    CheckIn: fmtRr3Date(r.check_in),
    CheckInTime: fmtTimeOnly(r.check_in),
    CheckOut: fmtRr3Date(r.check_out),
    CheckOutTime: fmtTimeOnly(r.check_out),
    NationalityCode: r.nationality,
    NationalityName: r.nationality_name || r.nationality,
    IdentityCardNumber: r.identity_card_number,
    PassportNumber: r.passport_number,
    Occupation: r.occupation,
    AddressDetails: r.address_details,
    Telephone: r.phone,
    AlienBook: r.alien_book,
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
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>("");
  const [snapshot, setSnapshot] = useState<BcpSnapshot | null>(null);
  const [isLiveFallback, setIsLiveFallback] = useState(false);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("timeline");
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
  const [manageNotesOpen, setManageNotesOpen] = useState(false);
  const [rateLinesOpen, setRateLinesOpen] = useState(false);
  const [itemLinesOpen, setItemLinesOpen] = useState(false);
  // Full-page Guest Profile view (mirrors MEWS's own Profile screen), opened
  // by clicking ANY guest name - the reservation's Owner or a companion -
  // set to that specific guest's GuestIdentity so each opens its own data,
  // not always the reservation's primary guest.
  const [selectedGuestProfile, setSelectedGuestProfile] = useState<GuestIdentity | null>(null);

  // Reservations tab (front-desk action list) - Check In/Out and Chg Room
  // can't write back to MEWS (that's the whole premise of this page: MEWS
  // is down), so they only log locally as the front desk's own paper trail
  // to re-key into MEWS once it's back. Persisted per property+date so it
  // survives a refresh during a long outage.
  const [actions, setActions] = useState<OfflineAction[]>([]);
  const [regCardFor, setRegCardFor] = useState<ReservationRow | null>(null);
  // Captured on-screen at print time (SignaturePad), reset per guest. Not
  // persisted automatically - the front desk chooses to via the Save button,
  // which unlike Check In/Out/Chg Room/Room Status actually writes to
  // Supabase (bcp_reg_cards): a signed Reg Card is new data we're creating,
  // not something that needs to be reconciled back into MEWS later.
  const [guestSignature, setGuestSignature] = useState<string | null>(null);
  const [savingRegCard, setSavingRegCard] = useState(false);
  const [regCardSaveResult, setRegCardSaveResult] = useState<{ ok: boolean; message: string } | null>(null);
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
        // pre-change one, without each needing its own fix.
        const overriddenRoom = roomChangeOverrides[raw.number];
        const r = overriddenRoom && overriddenRoom !== raw.room ? { ...raw, room: overriddenRoom } : raw;
        return { r, status: frontDeskStatus(r, today) };
      })
      .filter((x): x is { r: ReservationRow; status: { label: string; cls: string } } => x.status !== null)
      .sort((a, b) => a.r.room.localeCompare(b.r.room, undefined, { numeric: true }));
  }, [snapshot, roomChangeOverrides]);

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

  const handleCheckIn = (r: ReservationRow) =>
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
  // MEWS's own "Started" state is one source of truth, but while MEWS is
  // down a Check In logged just now only exists in our own actions list -
  // the snapshot's state field can't reflect it. actions is always
  // server-ordered newest-first, so the first Check In/Check Out match is
  // the most recent one either way.
  const isReservationCheckedIn = (r: ReservationRow): boolean => {
    if (r.state === "Started") return true;
    const latest = actions.find((a) => a.reservationNumber === r.number && (a.action === "Check In" || a.action === "Check Out"));
    return latest?.action === "Check In";
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
    handleCheckIn(checkInFor);
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
    if (!regCardFor || !snapshot) return;
    setSavingRegCard(true);
    setRegCardSaveResult(null);
    try {
      const res = await fetch("/api/bcp/reg-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_name: snapshot.property,
          reservation_number: regCardFor.number,
          guest: regCardFor.guest,
          nationality: regCardFor.nationality,
          room: regCardFor.room,
          category: regCardFor.category,
          check_in: regCardFor.check_in,
          check_out: regCardFor.check_out,
          adults: regCardFor.adults,
          children: regCardFor.children,
          signature_data_url: guestSignature,
        }),
      });
      const result = await res.json();
      if (result.status === "success") {
        setRegCardSaveResult({ ok: true, message: "Saved to our system" });
        logOfflineAction({
          at: new Date().toISOString(),
          reservationNumber: regCardFor.number,
          guest: regCardFor.guest,
          room: regCardFor.room,
          action: "Reg Card Saved",
          detail: guestSignature ? "Reg Card saved with signature" : "Reg Card saved (no signature)",
          reservationSnapshot: regCardFor,
          guestProfileSnapshot: findGuestProfile(regCardFor),
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

  // Reg Card button - restores a previously saved signature (if Save was
  // already used for this reservation) instead of always starting blank,
  // since save_reg_card persists it but had no matching read until now.
  const handleOpenRegCard = async (r: ReservationRow) => {
    setRegCardFor(r);
    setGuestSignature(null);
    setRegCardSaveResult(null);
    if (!snapshot) return;
    try {
      const params = new URLSearchParams({ property_name: snapshot.property, reservation_number: r.number });
      const res = await fetch(`/api/bcp/reg-card?${params.toString()}`);
      const result = await res.json();
      if (result.status === "success" && result.data?.signature_data_url) {
        // Signatures saved before signature capture cropped to ink are still
        // the full blank canvas (off-center on the printed line) - crop on
        // read so older saved Reg Cards self-heal without re-signing.
        setGuestSignature(await cropSignatureDataUrlToInk(result.data.signature_data_url));
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
    const match = snapshot.rooms.find((r) => r.room.toLowerCase().includes(query) || effectiveRoomNumber(r.room).toLowerCase().includes(query));
    if (!match) return;
    setHighlightedRoom(match.room);
    scrollToRoom(match.room);
    setTimeout(() => setHighlightedRoom((cur) => (cur === match.room ? null : cur)), 1500);
  };


  // Shared with the main return below (which this page's early return
  // bypasses entirely) so choosing OutOfService/OutOfOrder from the Status
  // dropdown on this page can open the same required-reason modal.
  const roomStatusReasonModal = roomStatusReasonFor && (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRoomStatusReasonFor(null)}>
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
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCheckInFor(null)}>
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
  // itself is untouched. We only ever captured a handful of MEWS's own
  // Profile fields (for the Reg Card/RR3 form) - Title, Sex, Date of birth,
  // Country of birth, Loyalty, and Verification photo have no equivalent in
  // our data at all, so unlike Room Properties' decorative-but-present
  // fields, those are left out entirely rather than shown as fake blanks.
  if (selectedGuestProfile) {
    const g = selectedGuestProfile;
    const fieldBoxCls = "px-3 py-2.5 rounded-lg bg-[var(--text-primary)]/5 text-[var(--text-primary)] text-[13px]";
    const nameParts = (g.name || "").trim().split(/\s+/);
    const firstName = nameParts[0] || "-";
    const lastName = nameParts.slice(1).join(" ") || "-";
    return (
      <div className="flex-1 p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <button onClick={() => setSelectedGuestProfile(null)} className="p-1 text-[var(--text-primary)]/50 hover:text-[var(--text-primary)] transition-colors shrink-0">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h1 className="font-display text-4xl text-[var(--text-primary)]">{g.name || "(no name)"}</h1>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6">
            <div className="border border-[var(--text-primary)]/14 rounded-xl p-5 flex flex-col gap-4">
              <div className="font-display text-xl text-[var(--text-primary)]">Profile</div>
              <div>
                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Email</div>
                <div className={fieldBoxCls}>{g.email || "-"}</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">First name</div>
                  <div className={fieldBoxCls}>{firstName}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Last name</div>
                  <div className={fieldBoxCls}>{lastName}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Nationality</div>
                  <div className={fieldBoxCls}>{g.nationality_name || g.nationality || "-"}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Telephone</div>
                  <div className={fieldBoxCls}>{g.phone || "-"}</div>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Occupation</div>
                <div className={fieldBoxCls}>{g.occupation || "-"}</div>
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
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-[var(--text-primary)]/10 text-[13px] text-[var(--text-primary)]/40 italic">
            Read-only snapshot, captured for the Reg Card at check-in time - not a live MEWS profile. Title, Sex, Date of birth, Country of birth, Loyalty and Verification photo aren&apos;t captured here.
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
      <div className="flex-1 p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
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
    const tabs = ["Status", "Properties", "Group", "Pricing", "Items", "Mailing", "Action log", "Summary", "Billing", "Contracting"];
    return (
      <div className="flex-1 p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => setShowManagePage(false)} className="p-1 text-[var(--text-primary)]/50 hover:text-[var(--text-primary)] transition-colors shrink-0">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h1 className="font-display text-3xl text-[var(--text-primary)] truncate">{res.group_name || res.guest || "(no name)"}</h1>
          </div>

          <div className="flex items-center gap-5 border-b border-[var(--text-primary)]/10 mb-8 overflow-x-auto">
            {tabs.map((t) => (
              <div
                key={t}
                title={t === "Properties" ? undefined : "Not available in this snapshot"}
                className={`py-3 text-[13px] font-bold whitespace-nowrap border-b-2 -mb-px ${
                  t === "Properties" ? "border-[var(--text-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-primary)]/25 cursor-not-allowed"
                }`}
              >
                {t}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {/* Left column: Notes + Arrival/Departure */}
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="font-display text-xl text-[var(--text-primary)] mb-3">Notes</h2>
                <div className="flex flex-col gap-4">
                  {res.notes.map((n, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[11px] text-[var(--text-primary)]/50">Note ({n.type}), {fmtNoteTimestamp(n.created_utc)}</div>
                        <svg className="w-4 h-4 text-[var(--text-primary)]/20 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </div>
                      <div className={`${fieldBoxCls} whitespace-pre-line`}>{n.text}</div>
                    </div>
                  ))}
                  <div>
                    <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Add note</div>
                    <div className={`${fieldBoxCls} text-[var(--text-primary)]/30 italic min-h-[52px]`}>-</div>
                    <button disabled title="No live connection to MEWS to manage this reservation from here" className={`mt-2 px-5 py-2 rounded-lg bg-blue-600 text-white text-[12px] font-bold ${disabledBtnCls}`}>OK</button>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Arrival *</div>
                <div className="flex gap-2">
                  <div className={`${fieldBoxCls} flex-1`}>{fmtDateOnly(res.check_in)}</div>
                  <div className={`${fieldBoxCls} w-24 text-center`}>{fmtWeekdayTime(res.check_in).split(" ")[1]}</div>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-primary)]/50 mb-1">Departure *</div>
                <div className="flex gap-2">
                  <div className={`${fieldBoxCls} flex-1`}>{fmtDateOnly(res.check_out)}</div>
                  <div className={`${fieldBoxCls} w-24 text-center`}>{fmtWeekdayTime(res.check_out).split(" ")[1]}</div>
                </div>
              </div>
              <button disabled title="No live connection to MEWS to manage this reservation from here" className={`self-start px-6 py-2 rounded-lg border border-[var(--text-primary)]/20 text-[var(--text-primary)]/40 text-[13px] font-bold ${disabledBtnCls}`}>OK</button>
            </div>

            {/* Right column: Reservations */}
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
                  <span className={`shrink-0 px-2 py-0.5 text-[10px] font-bold border rounded ${STATE_BADGE_CLS[res.state] || STATE_BADGE_CLS.Processed}`}>
                    {STATE_DISPLAY_LABEL[res.state] || res.state}
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
                  <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border rounded ${STATE_BADGE_CLS[res.state] || STATE_BADGE_CLS.Processed}`}>
                    {STATE_DISPLAY_LABEL[res.state] || res.state}
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
          </div>

          <div className="mt-10 text-[11px] text-[var(--text-primary)]/40 italic pt-4 border-t border-[var(--text-primary)]/10">
            Read-only snapshot from {isLiveFallback ? "a live MEWS check" : "the last capture"} - no live connection to MEWS, so notes, dates, billing and unlock actions are disabled here.
          </div>
        </div>
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
        />

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
                    <li>ดูจุดสีหน้าเลขห้องเพื่อประสานแม่บ้านว่าให้แขกเข้าห้องไหน — พิมพ์ใบงานแจกแม่บ้านได้จากคำสั่ง Print ของเบราว์เซอร์ (Ctrl/Cmd+P) ตอนอยู่แท็บ Timeline หรือ Rooms (HK) (มีช่อง Cleaned ✓ ให้ติ๊กบนกระดาษ)</li>
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
            <button
              onClick={handleCapture}
              disabled={capturing || !selectedProperty}
              className="btn-brand btn-primary h-[46px] disabled:opacity-60"
            >
              {capturing ? "Capturing..." : "Capture Now"}
            </button>
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
              <div className="flex border-b border-[var(--text-primary)]/14">
                {(
                  [
                    ["timeline", `Timeline (${snapshot.window?.start} – ${snapshot.window?.end})`],
                    ["rooms", "Rooms (HK)"],
                    ["logs", `Action Logs${unresolvedActionsCount ? ` (${unresolvedActionsCount})` : ""}`],
                  ] as [MainTab, string][]
                ).map(([t, label]) => (
                  <button
                    key={t}
                    onClick={() => setMainTab(t)}
                    className={`px-5 py-3 text-[11px] font-bold tracked-caps border-b-2 -mb-px transition-all ${
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
                  className="ml-auto px-3 py-2 text-[12px] border border-[var(--text-primary)]/20 bg-white text-black w-80 focus:outline-none focus:border-[var(--text-primary)]/50 placeholder:text-black/40"
                />
              )}
              {mainTab === "logs" && (
                <input
                  type="text"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder="Search guest, room, action, or user"
                  className="ml-auto px-3 py-2 text-[12px] border border-[var(--text-primary)]/20 bg-white text-black w-80 focus:outline-none focus:border-[var(--text-primary)]/50 placeholder:text-black/40"
                />
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
                      onClick={room.is_child ? undefined : () => setSelectedRoom(room)}
                      title={!room.is_child ? (room.category ? `Room ${effectiveRoomNumber(room.room)}\n${room.category}` : `Room ${effectiveRoomNumber(room.room)}`) : undefined}
                      className={`sticky left-[28px] z-10 border-b border-r border-[var(--text-primary)]/10 p-2 text-[12px] font-bold text-[var(--text-primary)] flex items-center gap-2 whitespace-nowrap transition-colors ${!room.is_child ? "cursor-pointer hover:bg-[var(--text-primary)]/5" : ""} ${highlightedRoom === room.room ? "bg-amber-200" : "bg-[var(--paper)]"}`}
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
                      onClick={room.is_child ? () => setSelectedRoom(room) : undefined}
                      title={room.is_child ? (room.category ? `Room ${effectiveRoomNumber(room.room)}\n${room.category}` : `Room ${effectiveRoomNumber(room.room)}`) : undefined}
                      className={`sticky left-[98px] z-10 border-b border-r border-[var(--text-primary)]/10 p-2 text-[12px] text-[var(--text-primary)] flex items-center gap-2 whitespace-nowrap transition-colors ${room.is_child ? "cursor-pointer hover:bg-[var(--text-primary)]/5" : ""} ${highlightedRoom === room.room ? "bg-amber-200" : "bg-[var(--paper)]"}`}
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
                    const started = res.state === "Started";
                    const cls = STATE_BADGE_CLS[res.state] || STATE_BADGE_CLS.Processed;
                    return (
                      <button
                        key={res.number + i}
                        onClick={() => { setSelectedReservation(res); setShowManagePage(false); setManageTab("reservation"); setManageNotesOpen(false); setSelectedGuestProfile(null); setRateLinesOpen(false); setItemLinesOpen(false); }}
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
            )}

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
                                  className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-[#152A00] text-[#FFEFD2] hover:opacity-90 transition-opacity"
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

            {mainTab === "rooms" && (
              <>
              <div className="no-print text-[10px] text-[var(--text-primary)]/40 italic mb-3">
                Changing a status below only updates our own system — it is never sent to MEWS.
              </div>
              <div className="no-print grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
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
                      className={`border p-4 flex flex-col gap-1 ${ROOM_STATUS_CARD_CLS[effectiveState] || "bg-[var(--paper)] border-[var(--text-primary)]/14"} ${
                        lastRoomLog ? "ring-2 ring-red-500 ring-offset-1" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xl font-display text-[var(--text-primary)]">{effectiveRoomNumber(rm.room)}</div>
                        {lastRoomLog && (
                          <button
                            onClick={() => setSelectedLogEntry(lastRoomLog)}
                            className="text-[9px] font-bold tracked-caps text-red-700 underline decoration-dotted hover:decoration-solid shrink-0 mt-1"
                          >
                            ● Updated
                          </button>
                        )}
                      </div>
                      <div className="text-[11px] font-bold tracked-caps text-[var(--text-primary)]/50">{occupancy}</div>
                      {rm.occupant && <div className="text-[11px] text-[var(--text-primary)]/70 truncate">{rm.occupant}</div>}
                      <select
                        value={effectiveState}
                        onChange={(e) => handleRoomStatusSelect(rm.room, effectiveState, e.target.value)}
                        className="mt-2 w-full bg-white border border-black/10 px-2 py-1.5 text-[12px] font-bold text-[var(--text-primary)] cursor-pointer focus:outline-none"
                      >
                        {ROOM_STATUS_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      {roomStatusReasons[rm.room] && (
                        <div className="text-[11px] text-[var(--text-primary)]/70 italic">{roomStatusReasons[rm.room]}</div>
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
                            ? "border-[var(--text-primary)]/8 text-[var(--text-primary)] hover:bg-[var(--text-primary)]/[0.03]"
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
                ...buildRegCardTokens(regCardFor, snapshot?.property || "", effectiveRoomNumber(regCardFor.room)),
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
                <button onClick={() => setRegCardFor(null)} className="px-4 py-2 text-[11px] font-bold tracked-caps border border-white/30 text-white bg-black/30 hover:bg-black/50 transition-colors">
                  Close
                </button>
                <button
                  onClick={handleSaveRegCard}
                  disabled={savingRegCard}
                  className="px-4 py-2 text-[11px] font-bold tracked-caps bg-amber-400 text-[#152A00] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingRegCard ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => window.print()}
                  disabled={!rr3Template}
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

            <div className="flex justify-center py-10">
              {rr3Template ? (
                <div
                  dangerouslySetInnerHTML={{
                    __html: renderRr3Template(rr3Template, {
                      ...buildRegCardTokens(regCardFor, snapshot?.property || "", effectiveRoomNumber(regCardFor.room)),
                      GuestSignatureDataUrl: guestSignature || undefined,
                    }),
                  }}
                />
              ) : (
                <div className="text-white/70 text-sm italic mt-20">Loading the ร.ร.๓ template...</div>
              )}
            </div>

            <div className="fixed bottom-4 right-4 z-10 bg-white text-black border border-black/10 shadow-2xl p-4 w-[340px]">
              <div className="text-[10px] font-bold tracked-caps text-black/50 mb-1">Guest Signature</div>
              <SignaturePad value={guestSignature} onChange={setGuestSignature} />
              <div className="mt-2 text-[10px] text-black/40 italic">
                ID/passport, address, occupation and telephone come from MEWS&apos;s customer profile, cached at capture time - prints blank only if the guest&apos;s own MEWS profile is missing that field.
              </div>
            </div>
          </div>
        )}

        {chgRoomFor && (
          <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setChgRoomFor(null)}>
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

        {roomStatusReasonModal}
        {checkInDirtyModal}

        {/* Action Log Detail - every entry here is by definition a local-only
            change (there's nowhere to write these back to while MEWS is
            down), so the Status field always reads the same thing: it's a
            record of something updated in our system, not MEWS. */}
        {selectedLogEntry && (
          <div className="no-print fixed inset-0 z-50 bg-[var(--paper)] text-[var(--text-primary)] flex flex-col">
            <div className="flex-1 overflow-y-auto p-10 md:p-16">
              <div className="font-display text-4xl md:text-5xl mb-8">Action Log Detail</div>
              <div className="grid grid-cols-[160px_1fr] md:grid-cols-[200px_1fr] gap-y-5 text-[16px] max-w-2xl">
                <div className="text-[var(--text-primary)]/50">Status</div>
                <div className="font-bold text-red-700">● Updated in our system</div>
                <div className="text-[var(--text-primary)]/50">Time</div>
                <div>{fmtDateTime(selectedLogEntry.at)}</div>
                <div className="text-[var(--text-primary)]/50">Guest</div>
                <div>{selectedLogEntry.guest || "-"}</div>
                <div className="text-[var(--text-primary)]/50">Room</div>
                <div className="font-bold">{effectiveRoomNumber(selectedLogEntry.room)}</div>
                <div className="text-[var(--text-primary)]/50">Action</div>
                <div className="font-bold">{selectedLogEntry.action}</div>
                <div className="text-[var(--text-primary)]/50">Detail</div>
                <div>{selectedLogEntry.detail}</div>
                {selectedLogEntry.reason && (
                  <>
                    <div className="text-[var(--text-primary)]/50">Reason</div>
                    <div>{selectedLogEntry.reason}</div>
                  </>
                )}
                <div className="text-[var(--text-primary)]/50">User</div>
                <div>{selectedLogEntry.userEmail || "-"}</div>
              </div>

              {/* Frozen at the moment this action was logged (see
                  reservationSnapshot/guestProfileSnapshot on OfflineAction) -
                  always shows what the booking/guest looked like back then,
                  even if it's since checked out, moved rooms again, or aged
                  out of the live Timeline's ±7 day window. Absent entirely
                  for room-level actions logged while the room was vacant. */}
              {selectedLogEntry.reservationSnapshot && (
                <>
                  <div className="font-display text-2xl mt-12 mb-5 max-w-2xl">Reservation Detail</div>
                  <div className="grid grid-cols-[160px_1fr] md:grid-cols-[200px_1fr] gap-y-5 text-[16px] max-w-2xl">
                    <div className="text-[var(--text-primary)]/50">Reservation #</div>
                    <div className="font-bold">{selectedLogEntry.reservationSnapshot.number || "-"}</div>
                    <div className="text-[var(--text-primary)]/50">Stay</div>
                    <div>
                      {fmtDateOnly(selectedLogEntry.reservationSnapshot.check_in)} – {fmtDateOnly(selectedLogEntry.reservationSnapshot.check_out)}
                    </div>
                    <div className="text-[var(--text-primary)]/50">Status</div>
                    <div>{STATE_DISPLAY_LABEL[selectedLogEntry.reservationSnapshot.state] || selectedLogEntry.reservationSnapshot.state || "-"}</div>
                    <div className="text-[var(--text-primary)]/50">Room</div>
                    <div>{effectiveRoomNumber(selectedLogEntry.reservationSnapshot.room) || "-"}</div>
                    {selectedLogEntry.reservationSnapshot.category && (
                      <>
                        <div className="text-[var(--text-primary)]/50">Category</div>
                        <div>{selectedLogEntry.reservationSnapshot.category}</div>
                      </>
                    )}
                    <div className="text-[var(--text-primary)]/50">Occupancy</div>
                    <div>
                      {selectedLogEntry.reservationSnapshot.adults} × Adults
                      {selectedLogEntry.reservationSnapshot.children > 0 ? `, ${selectedLogEntry.reservationSnapshot.children} × Children` : ""}
                    </div>
                    {selectedLogEntry.reservationSnapshot.rate && (
                      <>
                        <div className="text-[var(--text-primary)]/50">Rate</div>
                        <div>{selectedLogEntry.reservationSnapshot.rate}</div>
                      </>
                    )}
                    {typeof selectedLogEntry.reservationSnapshot.total_amount === "number" && (
                      <>
                        <div className="text-[var(--text-primary)]/50">Total</div>
                        <div>
                          {selectedLogEntry.reservationSnapshot.total_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}{" "}
                          {selectedLogEntry.reservationSnapshot.currency}
                        </div>
                      </>
                    )}
                    {selectedLogEntry.reservationSnapshot.company && (
                      <>
                        <div className="text-[var(--text-primary)]/50">Company</div>
                        <div>{selectedLogEntry.reservationSnapshot.company}</div>
                      </>
                    )}
                    {selectedLogEntry.reservationSnapshot.travel_agency && (
                      <>
                        <div className="text-[var(--text-primary)]/50">Travel agency</div>
                        <div>
                          {selectedLogEntry.reservationSnapshot.travel_agency}
                          {selectedLogEntry.reservationSnapshot.travel_agency_confirmation_number
                            ? ` (${selectedLogEntry.reservationSnapshot.travel_agency_confirmation_number})`
                            : ""}
                        </div>
                      </>
                    )}
                    {selectedLogEntry.reservationSnapshot.segment && (
                      <>
                        <div className="text-[var(--text-primary)]/50">Segment</div>
                        <div>{selectedLogEntry.reservationSnapshot.segment}</div>
                      </>
                    )}
                    {(selectedLogEntry.reservationSnapshot.reservation_source || selectedLogEntry.reservationSnapshot.origin) && (
                      <>
                        <div className="text-[var(--text-primary)]/50">Source</div>
                        <div>{selectedLogEntry.reservationSnapshot.reservation_source || selectedLogEntry.reservationSnapshot.origin}</div>
                      </>
                    )}
                    {selectedLogEntry.reservationSnapshot.notes.length > 0 && (
                      <>
                        <div className="text-[var(--text-primary)]/50">Notes</div>
                        <div className="space-y-1">
                          {selectedLogEntry.reservationSnapshot.notes.map((n, i) => (
                            <div key={i}>{n.text}</div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="font-display text-2xl mt-12 mb-5 max-w-2xl">Guest Profile</div>
                  <div className="grid grid-cols-[160px_1fr] md:grid-cols-[200px_1fr] gap-y-5 text-[16px] max-w-2xl">
                    <div className="text-[var(--text-primary)]/50">Name</div>
                    <div className="font-bold">
                      {selectedLogEntry.guestProfileSnapshot?.name || selectedLogEntry.reservationSnapshot.guest || "-"}
                    </div>
                    <div className="text-[var(--text-primary)]/50">Nationality</div>
                    <div>{selectedLogEntry.guestProfileSnapshot?.nationality || selectedLogEntry.reservationSnapshot.nationality || "-"}</div>
                    <div className="text-[var(--text-primary)]/50">Email</div>
                    <div>{selectedLogEntry.guestProfileSnapshot?.email || selectedLogEntry.reservationSnapshot.email || "-"}</div>
                    <div className="text-[var(--text-primary)]/50">Phone</div>
                    <div>{selectedLogEntry.guestProfileSnapshot?.phone || selectedLogEntry.reservationSnapshot.phone || "-"}</div>
                    {!!selectedLogEntry.guestProfileSnapshot?.tags?.length && (
                      <>
                        <div className="text-[var(--text-primary)]/50">Tags</div>
                        <div>{selectedLogEntry.guestProfileSnapshot.tags.join(", ")}</div>
                      </>
                    )}
                    {selectedLogEntry.guestProfileSnapshot?.notes && (
                      <>
                        <div className="text-[var(--text-primary)]/50">Guest Notes</div>
                        <div>{selectedLogEntry.guestProfileSnapshot.notes}</div>
                      </>
                    )}
                  </div>
                </>
              )}

              <div className="mt-10 pt-6 border-t border-[var(--text-primary)]/10 text-[13px] text-[var(--text-primary)]/40 italic max-w-2xl">
                Not synced to MEWS — re-enter this change in MEWS once it&apos;s back online.
              </div>
            </div>
            <div className="flex justify-end gap-2 p-6 border-t border-[var(--text-primary)]/10">
              <button onClick={() => setSelectedLogEntry(null)} className="px-6 py-3 text-[12px] font-bold tracked-caps border border-[var(--text-primary)]/20 hover:bg-[var(--text-primary)]/5 transition-colors">
                Close
              </button>
            </div>
          </div>
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
                              onClick={() => setSelectedGuestProfile(ownerGuestIdentity(selectedReservation))}
                              className="font-bold underline decoration-1 underline-offset-2 hover:text-blue-600 transition-colors"
                            >
                              {selectedReservation.guest || "(no name)"}
                            </button>
                            <span className="text-[10px] text-[var(--text-primary)]/50"> Owner</span>
                          </div>
                        </div>
                      </div>
                      {selectedReservation.companions?.map((c, i) => (
                        <div key={i} className="px-4 py-3 border-t border-[var(--text-primary)]/10 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[var(--text-primary)]/10 flex items-center justify-center text-[11px] font-bold shrink-0">
                            {guestInitials(c.name || "?")}
                          </div>
                          <button
                            onClick={() => setSelectedGuestProfile(c)}
                            className="font-bold underline decoration-1 underline-offset-2 hover:text-blue-600 transition-colors text-left"
                          >
                            {c.name || "(no name)"}
                          </button>
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
              <div className="sticky bottom-0 bg-[var(--paper)] border-t border-[var(--text-primary)]/10 px-6 py-4 flex gap-3">
                <button
                  onClick={() => setShowManagePage(true)}
                  className="w-[30%] py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-colors"
                >
                  Manage
                </button>
                {isReservationCheckedIn(selectedReservation) ? (
                  <button
                    onClick={() => handleCheckOut(selectedReservation)}
                    className="w-[30%] py-2.5 rounded-lg bg-[#152A00] text-[#FFEFD2] text-sm font-bold hover:opacity-90 transition-opacity"
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
