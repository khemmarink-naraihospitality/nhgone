"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronDown, Coins, Languages, Maximize, Minimize } from "lucide-react";
import { useEffect, useState } from "react";
import { KIOSK_LANGUAGES } from "./i18n";
import { useKioskLanguage } from "./kioskLanguage";
import { useKioskCurrency } from "./kioskCurrency";

// iOS Safari (the realistic kiosk browser on an iPad) only gained
// unprefixed Fullscreen API support in 16.4 - the webkit-prefixed names are
// kept alongside the standard ones so an older device still gets the button
// rather than a silent no-op.
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
  webkitFullscreenEnabled?: boolean;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
};

function fullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as FullscreenDocument;
  return Boolean(document.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

function fullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement || doc.webkitFullscreenElement || null;
}

/**
 * The light-theme top bar every kiosk screen from the welcome page onward
 * uses, extracted out of page.tsx once search/confirm/registration needed
 * the exact same bar - see each page for why it renders its own full-screen
 * light layout rather than KioskLayout's shared (dark, flow-specific)
 * header. `showBack` is false only on the welcome screen: everywhere else
 * there is somewhere to actually go back to.
 *
 * The "Switch to guest mode" toggle from the first cut of this bar was
 * removed 17-Sep-2026 at the user's request - it had no real behavior wired
 * to it yet (Staff Mode was the only mode anything actually rendered), so it
 * stays as a plain non-interactive "Staff Mode" badge until there's a real
 * guest-mode view to switch to.
 *
 * The language pill is real, not decorative: it's a working switcher over
 * the five languages in i18n.ts (KioskLanguageProvider, mounted in
 * layout.tsx), and changes what the four light-theme screens actually say -
 * see kioskLanguage.tsx for why the choice is per-session, not saved. The
 * currency pill is the same pattern over kioskCurrency.tsx's three
 * currencies, added at the same time - it only changes the displayed code,
 * since nothing behind these screens prices anything yet to convert.
 *
 * Compact on purpose (~66px, down from ~100px on 21-Sep-2026): every pixel it
 * gives back goes to the screen below - on Registration straight into the
 * signature pad, which is sized to whatever height is left. The buttons stay
 * ~42px, still a comfortable finger target; only the non-interactive Staff
 * Mode badge is smaller than that.
 *
 * The Settings gear that used to sit here was replaced 23-Sep-2026 with a
 * full-screen toggle - the gear opened nothing (no settings screen exists
 * yet), where full screen is a real, immediate need for a lobby terminal
 * running in an ordinary browser tab: it hides the address bar and browser
 * chrome, which is what actually makes the terminal read as a fixed device
 * rather than a laptop with a webpage open. Rendered only where the
 * Fullscreen API is actually available (`fullscreenSupported()`) - the same
 * "hide it rather than ship a dead button" rule the eyedropper in Admin
 * Console > Kiosks follows.
 */

export default function KioskTopBar({ showBack = true }: { showBack?: boolean }) {
  const router = useRouter();
  const { language, setLanguage } = useKioskLanguage();
  const { currency, setCurrency, currencies } = useKioskCurrency();
  const [langOpen, setLangOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const current = KIOSK_LANGUAGES.find((l) => l.code === language) || KIOSK_LANGUAGES[0];

  // Whether the API exists at all is read once on mount (a browser
  // capability, not something to touch during render); whether the PAGE is
  // currently fullscreen is tracked via the standard event so the icon stays
  // correct even when something else changes it - Escape, for instance,
  // always exits fullscreen without going through this button.
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    // A browser capability, read once - the same justified exception
    // kioskConfig.tsx and the layout's clock use for "synchronize with an
    // external system".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanFullscreen(fullscreenSupported());
    const onChange = () => setIsFullscreen(!!fullscreenElement());
    onChange();
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    const doc = document as FullscreenDocument;
    try {
      if (fullscreenElement()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await doc.webkitExitFullscreen?.();
      } else {
        const root = document.documentElement as FullscreenElement;
        if (root.requestFullscreen) await root.requestFullscreen();
        else await root.webkitRequestFullscreen?.();
      }
    } catch {
      // A permission policy or an in-app browser can refuse this outright -
      // the terminal just stays as it was, with nothing to tell a guest
      // over a cosmetic toggle.
    }
  };

  return (
    <header className="relative flex items-center justify-between gap-4 px-8 py-3">
      <div className="flex items-center gap-2">
        {showBack && (
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Go back"
            className="rounded-full border border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] p-2.5 text-[var(--kiosk-text)] transition-colors hover:bg-[var(--kiosk-hover)]"
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
        )}
        <div className="rounded-full bg-[var(--kiosk-accent)] px-5 py-2 text-sm font-bold text-white">
          Staff Mode
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setLangOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full border border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] px-4 py-2.5 text-[var(--kiosk-text)] transition-colors hover:bg-[var(--kiosk-hover)]"
          >
            <Languages size={18} className="text-[var(--kiosk-text-muted)]" aria-hidden="true" />
            <span className="text-sm font-medium">{current.nativeLabel}</span>
            <ChevronDown size={16} className="text-[var(--kiosk-text-muted)]" aria-hidden="true" />
          </button>

          {langOpen && (
            <>
              {/* Click-outside catcher - a plain full-screen button is the
                  simplest way to close a touch-kiosk popover without a
                  separate outside-click hook. */}
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Close language menu"
                onClick={() => setLangOpen(false)}
              />
              <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] py-2 shadow-xl">
                {KIOSK_LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => {
                      setLanguage(l.code);
                      setLangOpen(false);
                    }}
                    className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-[var(--kiosk-hover)]"
                  >
                    <span>
                      <span className="block text-base font-semibold text-[var(--kiosk-text)]">
                        {l.nativeLabel}
                      </span>
                      <span className="block text-sm text-[var(--kiosk-text-faint)]">{l.label}</span>
                    </span>
                    {l.code === language && (
                      <Check size={18} className="text-[var(--kiosk-accent)]" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="relative">
          {/* A property prices in ONE currency (MEWS's default accounting
              currency), so there is normally nothing to choose and this is a
              plain label - a dropdown holding a single option invites a tap
              that changes nothing. It becomes a real picker only if a
              property ever returns more than one. */}
          {currencies.length <= 1 ? (
            <div className="flex items-center gap-2 rounded-full border border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] px-4 py-2.5 text-[var(--kiosk-text)]">
              <Coins size={18} className="text-[var(--kiosk-text-muted)]" aria-hidden="true" />
              <span className="text-sm font-medium">{currency}</span>
            </div>
          ) : (
          <button
            type="button"
            onClick={() => setCurrencyOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full border border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] px-4 py-2.5 text-[var(--kiosk-text)] transition-colors hover:bg-[var(--kiosk-hover)]"
          >
            <Coins size={18} className="text-[var(--kiosk-text-muted)]" aria-hidden="true" />
            <span className="text-sm font-medium">{currency}</span>
            <ChevronDown size={16} className="text-[var(--kiosk-text-muted)]" aria-hidden="true" />
          </button>
          )}

          {currencyOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Close currency menu"
                onClick={() => setCurrencyOpen(false)}
              />
              <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] py-2 shadow-xl">
                {currencies.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => {
                      setCurrency(c.code);
                      setCurrencyOpen(false);
                    }}
                    className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-[var(--kiosk-hover)]"
                  >
                    <span>
                      <span className="block text-base font-semibold text-[var(--kiosk-text)]">
                        {c.code}
                      </span>
                      <span className="block text-sm text-[var(--kiosk-text-faint)]">{c.label}</span>
                    </span>
                    {c.code === currency && (
                      <Check size={18} className="text-[var(--kiosk-accent)]" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {canFullscreen && (
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
            className="rounded-full border border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] p-2.5 text-[var(--kiosk-text-muted)] transition-colors hover:bg-[var(--kiosk-hover)]"
          >
            {isFullscreen ? <Minimize size={20} aria-hidden="true" /> : <Maximize size={20} aria-hidden="true" />}
          </button>
        )}
      </div>
    </header>
  );
}
