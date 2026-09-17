import { useEffect, useState } from "react";
import { useSelectedProperty } from "@/lib/propertyContext";
import type { KioskLanguageCode } from "./i18n";

/**
 * Today's check-in list, read from GET /api/kiosks/arrivals - the backend's
 * per-minute mirror of MEWS (kiosk_reservations_sync), never MEWS directly.
 * The list omits guest emails; the single-reservation read the confirm and
 * registration screens use includes it.
 */

export interface KioskArrival {
  id: string;
  number: string;
  state: string;
  guest_name: string;
  person_count: number;
  scheduled_start_utc: string | null;
  scheduled_end_utc: string | null;
  time_zone: string | null;
  room_category: string;
  guest_email?: string;
}

// The mirror refreshes once a minute; polling at half that keeps a check-in
// or cancellation made at the front desk off this screen within ~90 seconds.
export const ARRIVALS_POLL_MS = 30_000;

const LOCALES: Record<KioskLanguageCode, string> = {
  en: "en-US",
  th: "th-TH",
  fil: "fil-PH",
  km: "km-KH",
  ja: "ja-JP",
};

export function guestLabel(arrival: KioskArrival): string {
  return arrival.guest_name || `#${arrival.number}`;
}

/** "Thu, Sep 17" - the property's own calendar day, in the guest's language. */
export function formatShortDate(utc: string | null, timeZone: string | null, language: KioskLanguageCode): string {
  if (!utc) return "";
  return new Intl.DateTimeFormat(LOCALES[language], {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timeZone || undefined,
  }).format(new Date(utc));
}

/** "Friday, September 18, 12:00 PM" - date and time formatted separately so
 * English reads the way MEWS's own kiosk writes it, not "... at 12:00 PM". */
export function formatCheckout(utc: string | null, timeZone: string | null, language: KioskLanguageCode): string {
  if (!utc) return "";
  const at = new Date(utc);
  const zone = timeZone || undefined;
  const date = new Intl.DateTimeFormat(LOCALES[language], {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: zone,
  }).format(at);
  const time = new Intl.DateTimeFormat(LOCALES[language], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(at);
  return `${date}, ${time}`;
}

type DetailStatus = "loading" | "ready" | "missing" | "error";

interface DetailState {
  key: string;
  status: Exclude<DetailStatus, "loading">;
  arrival: KioskArrival | null;
}

/** One reservation by id for the selected property. Loaded once - a guest
 * mid-way through confirming shouldn't see the booking reshuffle under them. */
export function useKioskArrival(id: string | null): { status: DetailStatus; arrival: KioskArrival | null } {
  const { selectedProperty } = useSelectedProperty();
  const key = `${selectedProperty}:${id}`;
  const [loaded, setLoaded] = useState<DetailState | null>(null);

  useEffect(() => {
    if (!selectedProperty || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ property_name: selectedProperty });
        const response = await fetch(`/api/kiosks/arrivals/${encodeURIComponent(id)}?${params}`);
        const res = await response.json();
        if (cancelled) return;
        if (response.status === 404) {
          setLoaded({ key, status: "missing", arrival: null });
        } else if (!response.ok || res.status !== "success") {
          setLoaded({ key, status: "error", arrival: null });
        } else {
          setLoaded({ key, status: "ready", arrival: res.data });
        }
      } catch {
        if (!cancelled) setLoaded({ key, status: "error", arrival: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProperty, id, key]);

  if (!id) return { status: "missing", arrival: null };
  if (!loaded || loaded.key !== key) return { status: "loading", arrival: null };
  return { status: loaded.status, arrival: loaded.arrival };
}
