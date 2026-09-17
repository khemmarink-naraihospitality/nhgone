"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, Users } from "lucide-react";
import KioskTopBar from "../KioskTopBar";
import { MOCK_GUESTS } from "../mockGuests";
import { useKioskLanguage } from "../kioskLanguage";

/**
 * Rebuilt 17-Sep-2026 against a real reference screenshot: this used to be a
 * find-my-booking form (confirmation number / last name, or a QR scan). The
 * real terminal instead lists today's arrivals up front - a "Stay" section
 * of guest cards a staff member (or the guest themselves) picks from
 * directly - filtered by the search box, not looked up by typing a
 * reference. Still mock data (MOCK_GUESTS) - nothing here calls MEWS yet.
 *
 * Picking a card carries only the guest's id forward via a query param
 * (?guest=<id>) to /kiosk/confirm, which looks the rest up from the same
 * mock list - there is no real backend to fetch a reservation from yet.
 */
export default function SearchGuestsPage() {
  const router = useRouter();
  const { t } = useKioskLanguage();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MOCK_GUESTS;
    return MOCK_GUESTS.filter((g) => g.name.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="flex h-full w-full flex-col bg-[var(--kiosk-bg)] font-sans text-[var(--kiosk-text)]">
      <KioskTopBar />

      <main className="flex flex-1 flex-col gap-8 rounded-[32px] bg-[var(--kiosk-surface)] mx-8 mb-8 p-10">
        <div className="relative">
          <Search
            size={22}
            className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-[var(--kiosk-text-faint)]"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full rounded-2xl border border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] py-5 pl-16 pr-6 text-lg text-[var(--kiosk-text)] outline-none placeholder:text-[var(--kiosk-text-faint)] focus:border-[var(--kiosk-accent)]"
          />
        </div>

        <div>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-medium text-[var(--kiosk-text-muted)]">{t.stay}</h2>
            <div className="flex items-center gap-2 text-[var(--kiosk-text-muted)]">
              <span className="text-lg font-medium">{results.length}</span>
              <ChevronDown size={20} aria-hidden="true" />
            </div>
          </div>

          {results.length === 0 ? (
            <p className="py-10 text-center text-base font-medium text-[var(--kiosk-text-faint)]">
              {t.noGuestsMatch} &quot;{query}&quot;.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-5">
              {results.map((guest) => (
                <button
                  key={guest.id}
                  type="button"
                  onClick={() => router.push(`/kiosk/confirm?guest=${guest.id}`)}
                  className="flex flex-col gap-8 rounded-2xl bg-[var(--kiosk-surface-alt)] p-6 text-left transition-colors hover:bg-[var(--kiosk-hover)]"
                >
                  <div>
                    <p className="text-lg font-semibold">{guest.name}</p>
                    <div className="mt-2 flex items-center gap-1.5 text-[var(--kiosk-text-muted)]">
                      <Users size={16} aria-hidden="true" />
                      <span className="text-sm font-medium">{guest.guestCount}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm font-medium text-[var(--kiosk-text-secondary)]">
                    <span>{guest.arrivalShort}</span>
                    <span className="mx-2 flex-1 border-t border-dotted border-[var(--kiosk-border-strong)]" />
                    <span>{guest.departureShort}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
