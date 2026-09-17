"use client";

import { createContext, useContext, useMemo, useState } from "react";

/**
 * The guest's chosen display currency for the light-theme flow's top bar.
 * Added 17-Sep-2026 alongside Japanese in the language switcher, at the
 * same user request. Same shape as kioskLanguage.tsx: a per-session choice
 * that lives only in memory and resets on a hard refresh - nothing behind
 * these screens prices anything yet, so there's no real amount to convert,
 * just the label a guest would expect to see.
 */

export interface KioskCurrencyOption {
  code: string;
  label: string;
}

export const KIOSK_CURRENCIES: KioskCurrencyOption[] = [
  { code: "THB", label: "Thai Baht" },
  { code: "USD", label: "US Dollar" },
  { code: "PHP", label: "Philippine Peso" },
];

interface KioskCurrencyValue {
  currency: string;
  setCurrency: (code: string) => void;
}

const KioskCurrencyContext = createContext<KioskCurrencyValue | null>(null);

export function useKioskCurrency(): KioskCurrencyValue {
  const ctx = useContext(KioskCurrencyContext);
  if (!ctx) return { currency: "THB", setCurrency: () => {} };
  return ctx;
}

export function KioskCurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrency] = useState("THB");
  const value = useMemo(() => ({ currency, setCurrency }), [currency]);
  return <KioskCurrencyContext.Provider value={value}>{children}</KioskCurrencyContext.Provider>;
}
