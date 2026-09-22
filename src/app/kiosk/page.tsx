"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useSelectedProperty } from "@/lib/propertyContext";
import { useKioskConfig } from "./kioskConfig";
import { useKioskLanguage } from "./kioskLanguage";
import KioskTopBar from "./KioskTopBar";
import KioskPropertySwitcher from "./KioskPropertySwitcher";

/**
 * The kiosk welcome screen. Rewritten 17-Sep-2026 to a light theme matching a
 * real reference screenshot of the terminal in the field - this is now the
 * first of several screens that do not share KioskLayout's dark header/
 * footer chrome (see the `LIGHT_THEME_ROUTES` check there): the reference
 * shows an entirely different top bar (KioskTopBar - Staff/Guest mode,
 * language/currency/settings); KioskTopBar's own back arrow is off here
 * (`showBack={false}`) since there's nowhere further back in the CHECK-IN
 * FLOW to go from home. The bottom-right "‹ Back to NHGOne" is a different
 * thing entirely - a staff-only exit out of the kiosk terminal altogether,
 * back to the main app shell, which is why it lives down by the property
 * switcher rather than up in KioskTopBar with the flow's own navigation.
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
  const { t } = useKioskLanguage();
  const propertyName = selectedProperty || "NHG";
  const heroImage = config?.images?.[0]?.url || FALLBACK_IMAGE;

  return (
    <div className="flex h-full w-full flex-col bg-[var(--kiosk-bg)] font-sans text-[var(--kiosk-text)]">
      <KioskTopBar showBack={false} />

      {/* Two floating cards */}
      <main className="flex flex-1 gap-[7px] px-8 pb-4">
        {/* Left: content card - flex-1, so it runs right up to the image */}
        <div className="flex min-w-[360px] flex-1 flex-col rounded-[32px] bg-[var(--kiosk-surface)] p-12 shadow-sm">
          <h1 className="text-5xl font-bold leading-tight tracking-tight">
            {t.welcomeTitle(propertyName)}
          </h1>

          <div className="mt-auto flex flex-col gap-4 pt-12">
            <button
              type="button"
              onClick={() => router.push("/kiosk/search")}
              className="w-full rounded-full bg-[var(--kiosk-inverse-bg)] py-5 text-xl font-semibold text-[var(--kiosk-inverse-text)] transition-colors hover:bg-[var(--kiosk-inverse-bg-hover)]"
            >
              {t.checkIn}
            </button>
            <button
              type="button"
              className="w-full rounded-full border-2 border-[var(--kiosk-text)] py-5 text-xl font-semibold text-[var(--kiosk-text)] transition-colors hover:bg-[var(--kiosk-hover)]"
            >
              {t.checkOut}
            </button>
          </div>
        </div>

        {/* Right: image card - same layout as confirm/page.tsx: a fixed
            narrow width at the right edge, with the white card beside it
            taking all the remaining width. */}
        <div className="relative w-[30%] min-w-[280px] shrink-0 overflow-hidden rounded-[32px]">
          {/* Plain <img>: the configured photo is a remote Supabase Storage
              URL, and next/image would need that host whitelisted in
              next.config for no benefit on a fixed-size kiosk panel. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
        </div>
      </main>

      <div className="flex items-center justify-between px-8 pb-4">
        {/* This kiosk's own configured name (Admin Console > Kiosks) - see
            the file-level note on why this isn't a fake MEWS version string.
            Also the switcher for which property this terminal is showing,
            limited to the ones the signed-in staff member may see. */}
        <KioskPropertySwitcher />

        {/* Staff-only exit out of the terminal entirely, back to the main
            NHGOne app shell (/dashboard). Kept to the same quiet weight as
            the property caption it sits beside - this is a staff control on
            a screen a guest also stands in front of, not an invitation to
            leave mid check-in. No confirmation dialog: leaving the welcome
            screen loses nothing, unlike navigating away mid-registration. */}
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-1 rounded-md text-sm text-[var(--kiosk-text-faint)] transition-colors hover:text-[var(--kiosk-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--kiosk-accent)]"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          {t.backToNHGOne}
        </button>
      </div>
    </div>
  );
}
