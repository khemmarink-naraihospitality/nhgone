"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useSelectedProperty } from "@/lib/propertyContext";

/**
 * The kiosk's own configuration, as set at Admin Console > Kiosks.
 *
 * Fetched once by the kiosk layout and shared with every screen, so a
 * check-in flow can't change its mind about which kiosk it is halfway
 * through. It comes from `GET /api/kiosks/config`, which deliberately
 * withholds `pin_code` - the terminal asking is the one standing in the
 * lobby.
 *
 * `config` is null when the property has no kiosk configured (or the fetch
 * failed). Every screen must still render in that case, falling back to its
 * built-in defaults: a terminal nobody has set up yet should still work,
 * not show an error to a guest.
 */

export interface KioskImage {
  url: string;
  path: string;
}

export interface KioskConfig {
  id: string;
  property_name: string;
  name: string;
  theme: string;
  /** `#rrggbb`, or null meaning "use this property's logo colour". */
  accent_color: string | null;
  default_language: string;
  payment_method: string | null;
  options_enabled: string[] | null;
  checkin_grace_hours: number;
  checkin_grace_minutes: number;
  checkout_grace_hours: number;
  checkout_grace_minutes: number;
  early_checkin_fee: string | null;
  reservation_lookup: string;
  take_key_instructions: string | null;
  cut_key_instructions: string | null;
  thank_you_message: string | null;
  contact_instructions: string | null;
  checkout_instructions: string | null;
  cut_key_video_url: string | null;
  screen_saver_video_url: string | null;
  images: KioskImage[] | null;
}

interface KioskConfigValue {
  config: KioskConfig | null;
  loaded: boolean;
}

const KioskConfigContext = createContext<KioskConfigValue>({ config: null, loaded: false });

export function useKioskConfig() {
  return useContext(KioskConfigContext);
}

/**
 * MEWS stores these instruction texts wrapped in their own quotation marks
 * (the Thank you message in the reference form reads `"Your check-in is all
 * set! ..."` with the quotes inside the field). Rendering those verbatim on a
 * 60-inch screen looks like a mistake, so a fully-quoted value is unwrapped.
 */
export function kioskText(value: string | null | undefined, fallback: string): string {
  const text = (value || "").trim();
  if (!text) return fallback;
  const unwrapped =
    text.length > 1 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1).trim() : text;
  return unwrapped || fallback;
}

export function KioskConfigProvider({ children }: { children: React.ReactNode }) {
  const { selectedProperty, loaded: propertyLoaded } = useSelectedProperty();
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (property: string) => {
    if (!property) {
      // No property selected yet - the screens fall back to their defaults.
      setConfig(null);
      setLoaded(true);
      return;
    }

    // Read from location rather than useSearchParams: this runs inside the
    // kiosk layout, and useSearchParams would drag a Suspense boundary
    // requirement into a shell that has no other reason for one.
    let kioskId = "";
    try {
      kioskId = new URLSearchParams(window.location.search).get("kiosk") || "";
    } catch {
      kioskId = "";
    }

    const params = new URLSearchParams({ property_name: property });
    if (kioskId) params.set("kiosk_id", kioskId);

    try {
      // Hardcoded same-origin /api, deliberately NOT NEXT_PUBLIC_API_URL -
      // that points at a stale deployment without newer endpoints.
      const response = await fetch(`/api/kiosks/config?${params}`);
      const res = await response.json();
      setConfig(response.ok && res.status === "success" ? res.data : null);
    } catch {
      // A terminal that can't reach the API still has to let someone check
      // in, so this degrades to the built-in defaults rather than blocking.
      setConfig(null);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!propertyLoaded) return;
    // Fetching this terminal's own configuration is exactly the "subscribe to
    // an external system" case the rule allows for; the flag is only raised
    // because `load` settles synchronously when there is no property to fetch
    // for. Same justified exception as src/lib/propertyContext.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(selectedProperty);
  }, [selectedProperty, propertyLoaded, load]);

  return (
    <KioskConfigContext.Provider value={{ config, loaded }}>{children}</KioskConfigContext.Provider>
  );
}
