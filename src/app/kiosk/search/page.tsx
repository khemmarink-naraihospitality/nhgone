"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, Users } from "lucide-react";
import KioskTopBar from "../KioskTopBar";
import { MOCK_GUESTS } from "../mockGuests";

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
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MOCK_GUESTS;
    return MOCK_GUESTS.filter((g) => g.name.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="flex h-full w-full flex-col bg-[#F4F4F5] font-sans text-[#0B0B0F]">
      <KioskTopBar />

      <main className="flex flex-1 flex-col gap-8 rounded-[32px] bg-white mx-8 mb-8 p-10">
        <div className="relative">
          <Search
            size={22}
            className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-[#0B0B0F]/30"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            className="w-full rounded-2xl border border-[#0B0B0F]/15 bg-white py-5 pl-16 pr-6 text-lg text-[#0B0B0F] outline-none placeholder:text-[#0B0B0F]/35 focus:border-[#4F46E5]/40"
          />
        </div>

        <div>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-medium text-[#0B0B0F]/60">Stay</h2>
            <div className="flex items-center gap-2 text-[#0B0B0F]/60">
              <span className="text-lg font-medium">{results.length}</span>
              <ChevronDown size={20} aria-hidden="true" />
            </div>
          </div>

          {results.length === 0 ? (
            <p className="py-10 text-center text-base font-medium text-[#0B0B0F]/40">
              No guests match &quot;{query}&quot;.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-5">
              {results.map((guest) => (
                <button
                  key={guest.id}
                  type="button"
                  onClick={() => router.push(`/kiosk/confirm?guest=${guest.id}`)}
                  className="flex flex-col gap-8 rounded-2xl bg-[#F4F4F5] p-6 text-left transition-colors hover:bg-[#0B0B0F]/[0.06]"
                >
                  <div>
                    <p className="text-lg font-semibold">{guest.name}</p>
                    <div className="mt-2 flex items-center gap-1.5 text-[#0B0B0F]/50">
                      <Users size={16} aria-hidden="true" />
                      <span className="text-sm font-medium">{guest.guestCount}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm font-medium text-[#0B0B0F]/70">
                    <span>{guest.arrivalShort}</span>
                    <span className="mx-2 flex-1 border-t border-dotted border-[#0B0B0F]/25" />
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
