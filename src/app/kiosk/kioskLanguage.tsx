"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useKioskConfig } from "./kioskConfig";
import { KIOSK_COPY, KioskCopy, KioskLanguageCode, resolveDefaultLanguage } from "./i18n";

/**
 * The guest's chosen language for the light-theme flow (welcome/search/
 * confirm/registration), picked from KioskTopBar's language selector.
 *
 * This is a per-session choice, not a saved setting: it starts from the
 * kiosk's configured `default_language` once that loads, lives only in
 * memory, and resets on a hard refresh - the same way a guest picking a
 * language on a real self-service terminal doesn't change what the next
 * guest sees. Mounted above the routed pages in layout.tsx so the choice
 * survives client-side navigation between them.
 */

interface KioskLanguageValue {
  language: KioskLanguageCode;
  setLanguage: (code: KioskLanguageCode) => void;
  t: KioskCopy;
}

const KioskLanguageContext = createContext<KioskLanguageValue | null>(null);

export function useKioskLanguage(): KioskLanguageValue {
  const ctx = useContext(KioskLanguageContext);
  if (!ctx) {
    // Defensive fallback rather than throwing - a screen rendered outside
    // the provider (unlikely, but cheap to guard) still gets English.
    return { language: "en", setLanguage: () => {}, t: KIOSK_COPY.en };
  }
  return ctx;
}

export function KioskLanguageProvider({ children }: { children: React.ReactNode }) {
  const { config, loaded } = useKioskConfig();
  const [language, setLanguage] = useState<KioskLanguageCode>("en");
  const [guestPicked, setGuestPicked] = useState(false);

  useEffect(() => {
    // Only apply the kiosk's configured default before the guest has picked
    // one themselves - otherwise this would stomp on their choice every time
    // `config` re-renders (e.g. a property switch elsewhere in the app).
    if (guestPicked || !loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLanguage(resolveDefaultLanguage(config?.default_language));
  }, [config, loaded, guestPicked]);

  const value = useMemo<KioskLanguageValue>(
    () => ({
      language,
      setLanguage: (code) => {
        setGuestPicked(true);
        setLanguage(code);
      },
      t: KIOSK_COPY[language],
    }),
    [language]
  );

  return <KioskLanguageContext.Provider value={value}>{children}</KioskLanguageContext.Provider>;
}
