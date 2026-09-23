"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSelectedProperty } from "@/lib/propertyContext";

/**
 * The guest's chosen display currency for the light-theme flow's top bar.
 *
 * It comes from MEWS, not a fixed list: `GET /api/kiosks/currencies` ->
 * `sync_service.get_kiosk_currencies`, which returns the property's own
 * DEFAULT accounting currency. THB for the six Thai properties, PHP for
 * Makati, USD for Siem Reap - confirmed 23-Sep-2026 against what each
 * property actually prices in.
 *
 * Two wrong versions preceded it, both worth not repeating: a hardcoded
 * THB/USD/PHP set (Marasca showed PHP, which it does not use at all), then
 * MEWS's IsEnabled list (which is "accepted for payment" and let four
 * properties offer a USD they do not quote in). IsDefault matched all eight;
 * IsEnabled matched four.
 *
 * The value stays a LIST so the endpoint and the pill keep their shape if a
 * property is ever genuinely multi-currency here - KioskTopBar renders a
 * single entry as a plain label rather than a one-option dropdown.
 *
 * The CHOICE itself stays the same as before: a per-session pick that lives
 * only in memory and resets on a hard refresh, and doesn't change what
 * anything actually charges - nothing behind these screens prices anything
 * yet to convert, this is only the label a guest would expect to see.
 */

export interface KioskCurrencyOption {
  code: string;
  label: string;
}

// Only for turning a code MEWS returns into a human label - this is NOT
// where "which currencies exist" comes from any more. A code with no entry
// here still works; the code itself is shown instead of a blank label.
const CURRENCY_LABELS: Record<string, string> = {
  THB: "Thai Baht",
  USD: "US Dollar",
  PHP: "Philippine Peso",
  EUR: "Euro",
  GBP: "British Pound",
  KHR: "Cambodian Riel",
  SGD: "Singapore Dollar",
  JPY: "Japanese Yen",
  AUD: "Australian Dollar",
  CNY: "Chinese Yuan",
  HKD: "Hong Kong Dollar",
  MYR: "Malaysian Ringgit",
  VND: "Vietnamese Dong",
  KRW: "South Korean Won",
  INR: "Indian Rupee",
  IDR: "Indonesian Rupiah",
};

const FALLBACK_CURRENCIES: KioskCurrencyOption[] = [{ code: "THB", label: CURRENCY_LABELS.THB }];

interface KioskCurrencyValue {
  currency: string;
  setCurrency: (code: string) => void;
  /** Normally one entry: this property's own currency. THB before the
   * fetch resolves or if it fails - right for six of the eight, and the one
   * property it is wrong for (Siem Reap, USD) is corrected the moment the
   * fetch lands. */
  currencies: KioskCurrencyOption[];
}

const KioskCurrencyContext = createContext<KioskCurrencyValue | null>(null);

export function useKioskCurrency(): KioskCurrencyValue {
  const ctx = useContext(KioskCurrencyContext);
  if (!ctx) return { currency: "THB", setCurrency: () => {}, currencies: FALLBACK_CURRENCIES };
  return ctx;
}

export function KioskCurrencyProvider({ children }: { children: React.ReactNode }) {
  const { selectedProperty, loaded: propertyLoaded } = useSelectedProperty();
  const [currencies, setCurrencies] = useState<KioskCurrencyOption[]>(FALLBACK_CURRENCIES);
  const [currency, setCurrencyState] = useState("THB");
  // Whether the guest has picked a currency THIS session - once true, a
  // property switch (Home screen's staff-only switcher) must not silently
  // overwrite what they chose.
  const [touched, setTouched] = useState(false);

  const setCurrency = useCallback((code: string) => {
    setTouched(true);
    setCurrencyState(code);
  }, []);

  const load = useCallback(async (property: string) => {
    if (!property) return;
    try {
      // Hardcoded same-origin /api, deliberately NOT NEXT_PUBLIC_API_URL -
      // that points at a stale deployment without newer endpoints.
      const response = await fetch(`/api/kiosks/currencies?property_name=${encodeURIComponent(property)}`);
      const res = await response.json();
      const data: { code: string; is_default: boolean }[] =
        response.ok && res.status === "success" ? res.data || [] : [];
      if (!data.length) return;

      const options = data.map((c) => ({ code: c.code, label: CURRENCY_LABELS[c.code] || c.code }));
      setCurrencies(options);
      setCurrencyState((prev) => {
        // A currency the guest deliberately chose survives a background
        // refresh as long as this property still offers it. Otherwise (a
        // fresh load, or a property switch that dropped it) fall back to
        // MEWS's own default currency for this property.
        if (touched && options.some((o) => o.code === prev)) return prev;
        return data.find((c) => c.is_default)?.code || options[0].code;
      });
    } catch {
      // A terminal that can't reach the API still has to show a currency
      // pill, so it keeps whatever was already there (the THB fallback on
      // first load) rather than blocking.
    }
  }, [touched]);

  useEffect(() => {
    if (!propertyLoaded) return;
    void load(selectedProperty);
    // Deliberately not depending on `load` (which changes with `touched`) -
    // this effect exists to react to the PROPERTY changing, not to re-fetch
    // every time the guest picks a currency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProperty, propertyLoaded]);

  const value = useMemo(() => ({ currency, setCurrency, currencies }), [currency, setCurrency, currencies]);
  return <KioskCurrencyContext.Provider value={value}>{children}</KioskCurrencyContext.Provider>;
}
