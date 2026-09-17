"use client";

import { useRouter } from "next/navigation";
import { useSelectedProperty } from "@/lib/propertyContext";
import { useKioskConfig } from "./kioskConfig";
import KioskTopBar from "./KioskTopBar";

/**
 * The kiosk welcome screen. Rewritten 17-Sep-2026 to a light theme matching a
 * real reference screenshot of the terminal in the field - this is now the
 * first of several screens that do not share KioskLayout's dark header/
 * footer chrome (see the `LIGHT_THEME_ROUTES` check there): the reference
 * shows an entirely different top bar (KioskTopBar - Staff/Guest mode,
 * language/currency/settings), no back button here specifically since
 * there's nowhere to go back to from home.
 *
 * Font: set explicitly to font-sans (IBM Plex Sans, already loaded site-wide)
 * rather than left to inherit. That is the closest honest match available -
 * there is no way to read an exact font name off a screenshot, and if the
 * real terminal is specifically SF Pro (likely, since it's a native iPad
 * app) that would need a named font to load, not a guess.
 *
 * The bottom-left caption deliberately does NOT reproduce the reference's
 * "v4.53.0 (25001955)" - that is MEWS's own real build number, and copying
 * it would misrepresent this prototype as running MEWS's software. It shows
 * this kiosk's own configured name instead (Admin Console > Kiosks), which
 * is the concrete answer to "config must always relate to the front end."
 *
 * Check In goes to /kiosk/search - reversing the 17-Sep-2026 "skip search"
 * decision, because search itself was redesigned that same day from a
 * find-my-booking form into a browse-today's-arrivals list (see that page),
 * which is worth keeping in the flow rather than skipping.
 */

const FALLBACK_IMAGE = "/images/lub_d_chinatown_entrance.png";

export default function KioskWelcomePage() {
  const router = useRouter();
  const { selectedProperty } = useSelectedProperty();
  const { config } = useKioskConfig();
  const propertyName = selectedProperty || "NHG";
  const heroImage = config?.images?.[0]?.url || FALLBACK_IMAGE;

  return (
    <div className="flex h-full w-full flex-col bg-[#F4F4F5] font-sans text-[#0B0B0F]">
      <KioskTopBar showBack={false} />

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
              onClick={() => router.push("/kiosk/search")}
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
