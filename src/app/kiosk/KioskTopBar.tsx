"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronDown, Coins, Languages, Settings } from "lucide-react";
import { useState } from "react";
import { KIOSK_LANGUAGES } from "./i18n";
import { useKioskLanguage } from "./kioskLanguage";
import { useKioskCurrency } from "./kioskCurrency";

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
 */

export default function KioskTopBar({ showBack = true }: { showBack?: boolean }) {
  const router = useRouter();
  const { language, setLanguage } = useKioskLanguage();
  const { currency, setCurrency, currencies } = useKioskCurrency();
  const [langOpen, setLangOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const current = KIOSK_LANGUAGES.find((l) => l.code === language) || KIOSK_LANGUAGES[0];

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
          <button
            type="button"
            onClick={() => setCurrencyOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full border border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] px-4 py-2.5 text-[var(--kiosk-text)] transition-colors hover:bg-[var(--kiosk-hover)]"
          >
            <Coins size={18} className="text-[var(--kiosk-text-muted)]" aria-hidden="true" />
            <span className="text-sm font-medium">{currency}</span>
            <ChevronDown size={16} className="text-[var(--kiosk-text-muted)]" aria-hidden="true" />
          </button>

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
        <button
          type="button"
          className="rounded-full border border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] p-2.5 text-[var(--kiosk-text-muted)] transition-colors hover:bg-[var(--kiosk-hover)]"
          aria-label="Settings"
        >
          <Settings size={20} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
