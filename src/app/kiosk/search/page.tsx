"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, Users } from "lucide-react";
import { useSelectedProperty } from "@/lib/propertyContext";
import KioskTopBar from "../KioskTopBar";
import { useKioskLanguage } from "../kioskLanguage";
import { ARRIVALS_POLL_MS, formatShortDate, guestLabel, type KioskArrival } from "../arrivals";

/**
 * Today's arrivals, the way MEWS's own kiosk lists them: a "Stay" section of
 * guest cards, newest reservation first, filtered by the search box rather
 * than looked up by typing a reference.
 *
 * Real reservations since 17-Sep-2026 - GET /api/kiosks/arrivals reads the
 * backend's per-minute mirror of MEWS, which only offers Confirmed bookings
 * scheduled for today (see sync_service.get_kiosk_arrivals for how that rule
 * was matched to MEWS's own kiosk). Re-polled every ARRIVALS_POLL_MS so a
 * guest checked in at the front desk drops off without anyone reloading.
 *
 * Picking a card carries only the reservation id forward (?guest=<id>);
 * confirm and registration read the rest themselves.
 *
 * "Show all reservations" (off by default, beside the count) widens the list
 * to every one of today's arrivals - checked in, canceled and so on - for
 * staff looking over the day. Those cards carry a status badge and can't be
 * picked, since only a Confirmed booking can be checked in. The switch lives
 * in this page's own state rather than a context, so leaving the screen
 * always brings a lobby terminal back to the check-in-only default.
 */

type ListStatus = "ready" | "disabled" | "error";

interface ListState {
  key: string;
  status: ListStatus;
  arrivals: KioskArrival[];
}

export default function SearchGuestsPage() {
  const router = useRouter();
  const { selectedProperty, loaded: propertyLoaded } = useSelectedProperty();
  const { t, language } = useKioskLanguage();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [list, setList] = useState<ListState | null>(null);
  const listKey = `${selectedProperty}|${showAll}`;

  useEffect(() => {
    if (!selectedProperty) return;
    const property = selectedProperty;
    const key = `${property}|${showAll}`;
    let cancelled = false;

    const load = async () => {
      try {
        const params = new URLSearchParams({ property_name: property });
        if (showAll) params.set("include_all", "true");
        const response = await fetch(`/api/kiosks/arrivals?${params}`);
        const res = await response.json();
        if (cancelled) return;
        if (!response.ok || res.status !== "success") throw new Error(res.detail || "load failed");
        setList({ key, status: res.enabled ? "ready" : "disabled", arrivals: res.data || [] });
      } catch {
        if (cancelled) return;
        // A failed refresh keeps the list already on screen - it is at most
        // one poll old, and blanking a guest's name mid-tap is worse.
        setList((prev) =>
          prev && prev.key === key && prev.status === "ready"
            ? prev
            : { key, status: "error", arrivals: [] }
        );
      }
    };

    void load();
    const timer = setInterval(load, ARRIVALS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedProperty, showAll]);

  const current = list && list.key === listKey ? list : null;
  const arrivals = useMemo(() => current?.arrivals ?? [], [current]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return arrivals;
    return arrivals.filter((a) => a.guest_name.toLowerCase().includes(q));
  }, [arrivals, query]);

  let message: string | null = null;
  if (propertyLoaded && !selectedProperty) message = t.notEnabled;
  else if (!current) message = t.loading;
  else if (current.status === "disabled") message = t.notEnabled;
  else if (current.status === "error") message = t.loadError;
  else if (arrivals.length === 0) message = t.noArrivals;
  else if (results.length === 0) message = t.noGuestsMatch(query);

  return (
    <div className="flex h-full w-full flex-col bg-[var(--kiosk-bg)] font-sans text-[var(--kiosk-text)]">
      <KioskTopBar />

      <main className="mx-8 mb-8 flex flex-1 flex-col gap-8 overflow-y-auto rounded-[32px] bg-[var(--kiosk-surface)] p-10">
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
            <div className="flex items-center gap-6 text-[var(--kiosk-text-muted)]">
              <button
                type="button"
                role="switch"
                aria-checked={showAll}
                onClick={() => setShowAll((v) => !v)}
                className="flex items-center gap-3"
              >
                <span className="text-base font-medium">{t.showAll}</span>
                <span
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                    showAll ? "bg-[var(--kiosk-accent)]" : "bg-[var(--kiosk-border-strong)]"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      showAll ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </span>
              </button>
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium">{results.length}</span>
                <ChevronDown size={20} aria-hidden="true" />
              </div>
            </div>
          </div>

          {message ? (
            <p className="py-10 text-center text-base font-medium text-[var(--kiosk-text-faint)]">{message}</p>
          ) : (
            <div className="grid grid-cols-3 gap-5">
              {results.map((arrival) => {
                const checkInable = arrival.state === "Confirmed";
                return (
                  <button
                    key={arrival.id}
                    type="button"
                    disabled={!checkInable}
                    onClick={() => router.push(`/kiosk/confirm?guest=${encodeURIComponent(arrival.id)}`)}
                    className="flex flex-col gap-8 rounded-2xl bg-[var(--kiosk-surface-alt)] p-6 text-left transition-colors enabled:hover:bg-[var(--kiosk-hover)] disabled:cursor-default disabled:opacity-55"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-lg font-semibold">{guestLabel(arrival)}</p>
                        {!checkInable && (
                          <span className="shrink-0 rounded-full border border-[var(--kiosk-border-strong)] px-3 py-1 text-xs font-semibold text-[var(--kiosk-text-muted)]">
                            {t.stateLabel[arrival.state] || arrival.state}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-[var(--kiosk-text-muted)]">
                        <Users size={16} aria-hidden="true" />
                        <span className="text-sm font-medium">{arrival.person_count}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm font-medium text-[var(--kiosk-text-secondary)]">
                      <span>{formatShortDate(arrival.scheduled_start_utc, arrival.time_zone, language)}</span>
                      <span className="mx-2 flex-1 border-t border-dotted border-[var(--kiosk-border-strong)]" />
                      <span>{formatShortDate(arrival.scheduled_end_utc, arrival.time_zone, language)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
