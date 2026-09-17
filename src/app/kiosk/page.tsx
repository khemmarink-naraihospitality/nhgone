"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Coins, Settings, Users } from "lucide-react";
import { useSelectedProperty } from "@/lib/propertyContext";
import { useKioskConfig } from "./kioskConfig";

/**
 * The kiosk welcome screen. Rewritten 17-Sep-2026 to a light theme matching a
 * real reference screenshot of the terminal in the field - this is now the
 * ONE screen in the flow that does not share KioskLayout's dark header/
 * footer chrome (see the `isWelcome` branch there): the reference shows an
 * entirely different top bar (Staff/Guest mode, language/currency/settings,
 * no back button or progress dots, since there's nowhere to go back to and
 * nothing has started yet).
 *
 * Font: set explicitly to font-sans (IBM Plex Sans, already loaded site-wide)
 * rather than left to inherit. That is the closest honest match available -
 * there is no way to read an exact font name off a screenshot, and if the
 * real terminal is specifically SF Pro (likely, since it's a native iPad
 * app) that would need a named font to load, not a guess.
 *
 * "Staff Mode" / "Switch to guest mode" and the language/currency/settings
 * controls are decorative, same "screens first" scope as everything else
 * here - the toggle swaps which pill is highlighted and nothing else.
 *
 * The bottom-left caption deliberately does NOT reproduce the reference's
 * "v4.53.0 (25001955)" - that is MEWS's own real build number, and copying
 * it would misrepresent this prototype as running MEWS's software. It shows
 * this kiosk's own configured name instead (Admin Console > Kiosks), which
 * is the concrete answer to "config must always relate to the front end."
 */

const FALLBACK_IMAGE = "/images/lub_d_chinatown_entrance.png";

// Same hand-drawn flag mock the prototype arrived with (a generic red/blue
// stripe block, not a real national flag) - decorative, not tied to
// `default_language`, which the text next to it already states in full.
function FlagMock() {
  return (
    <div className="relative h-4 w-6 shrink-0 overflow-hidden rounded-sm bg-blue-900">
      <div className="absolute left-0 top-0 h-1/2 w-full bg-red-600" />
      <div className="absolute left-0 top-0 h-full w-1/3 bg-blue-800" />
    </div>
  );
}

export default function KioskWelcomePage() {
  const router = useRouter();
  const { selectedProperty } = useSelectedProperty();
  const { config } = useKioskConfig();
  const propertyName = selectedProperty || "NHG";
  const heroImage = config?.images?.[0]?.url || FALLBACK_IMAGE;
  const [staffMode, setStaffMode] = useState(true);

  return (
    <div className="flex h-full w-full flex-col bg-[#F4F4F5] font-sans text-[#0B0B0F]">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 px-8 py-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStaffMode(true)}
            className={`rounded-full px-6 py-3 text-base font-bold transition-colors ${
              staffMode ? "bg-[#4F46E5] text-white" : "bg-white text-[#0B0B0F]/70 hover:bg-[#0B0B0F]/5"
            }`}
          >
            Staff Mode
          </button>
          <button
            type="button"
            onClick={() => setStaffMode(false)}
            className={`inline-flex items-center gap-2 rounded-full border px-6 py-3 text-base font-bold transition-colors ${
              staffMode
                ? "border-[#0B0B0F]/10 bg-white text-[#0B0B0F] hover:bg-[#0B0B0F]/5"
                : "border-transparent bg-[#4F46E5] text-white"
            }`}
          >
            <Users size={20} aria-hidden="true" />
            Switch to guest mode
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 rounded-full border border-[#0B0B0F]/10 bg-white px-5 py-3">
            <FlagMock />
            <span className="text-base font-medium">{config?.default_language || "English (United States)"}</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#0B0B0F]/10 bg-white px-5 py-3">
            <Coins size={20} className="text-[#0B0B0F]/60" aria-hidden="true" />
            <span className="text-base font-medium">THB</span>
          </div>
          <button
            type="button"
            className="rounded-full border border-[#0B0B0F]/10 bg-white p-3.5 text-[#0B0B0F]/60 transition-colors hover:bg-[#0B0B0F]/5"
            aria-label="Settings"
          >
            <Settings size={22} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Two floating cards */}
      <main className="flex flex-1 gap-6 px-8 pb-4">
        {/* Left: content card */}
        <div className="flex w-[42%] min-w-[360px] flex-col rounded-[32px] bg-white p-12 shadow-sm">
          <h1 className="text-5xl font-bold leading-tight tracking-tight">
            Welcome to {propertyName}
          </h1>

          <div className="mt-auto flex flex-col gap-4 pt-12">
            <button
              type="button"
              onClick={() => router.push("/kiosk/registration")}
              className="w-full rounded-full bg-[#0B0B0F] py-5 text-xl font-semibold text-white transition-colors hover:bg-[#0B0B0F]/90"
            >
              Check in
            </button>
            <button
              type="button"
              className="w-full rounded-full border-2 border-[#0B0B0F] py-5 text-xl font-semibold text-[#0B0B0F] transition-colors hover:bg-[#0B0B0F]/5"
            >
              Check out
            </button>
          </div>
        </div>

        {/* Right: image card */}
        <div className="relative flex-1 overflow-hidden rounded-[32px]">
          {/* Plain <img>: the configured photo is a remote Supabase Storage
              URL, and next/image would need that host whitelisted in
              next.config for no benefit on a fixed-size kiosk panel. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
        </div>
      </main>

      {/* This kiosk's own configured name (Admin Console > Kiosks) - see the
          file-level note on why this isn't a fake MEWS version string. */}
      <p className="px-8 pb-4 text-sm text-[#0B0B0F]/40">
        {config?.name || `${propertyName} Kiosk`}
      </p>
    </div>
  );
}
