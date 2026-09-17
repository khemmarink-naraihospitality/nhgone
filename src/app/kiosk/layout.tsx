"use client";

import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useSelectedProperty } from "@/lib/propertyContext";
import { KioskConfigProvider, useKioskConfig } from "./kioskConfig";
import { KioskLanguageProvider } from "./kioskLanguage";
import { KioskCurrencyProvider } from "./kioskCurrency";
import ScreenSaver from "./ScreenSaver";

/**
 * The kiosk terminal shell - ported from the NHGKiosk prototype
 * (github.com/kitti2424/Kiosk). Three things changed on the way in:
 *
 * - The property name came from a `properties` table that only existed in
 *   that project's own Supabase. Here it comes from the app-wide property
 *   switcher (useSelectedProperty), so the kiosk shows whatever property is
 *   selected in NHGOne and no new table is needed.
 * - `.kiosk-root` carries the prototype's dark palette and no-select rule,
 *   which its own stylesheet declared on <body> - see globals.css for why
 *   that had to be scoped here instead.
 * - The clock starts null and is filled in on mount: rendering `new Date()`
 *   during the server pass and again on the client is a guaranteed
 *   hydration mismatch.
 *
 * The prototype's own device-pairing screen (/kiosk/lock, a demo PIN/QR gate
 * over localStorage) was cut after it shipped: it gated only the header's
 * property label, not any real content or route. If device pairing is wanted
 * for real it belongs keyed to kiosk_settings, not a browser flag - and the
 * `?kiosk=<id>` parameter that KioskConfigProvider reads is the seam for it.
 *
 * Navigation.tsx renders /kiosk/* without the app sidebar (the same
 * bypass /reset-password uses), because a check-in terminal is a full-screen
 * device UI, not a back-office page.
 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <KioskConfigProvider>
      <KioskLanguageProvider>
        <KioskCurrencyProvider>
          <KioskShell>{children}</KioskShell>
        </KioskCurrencyProvider>
      </KioskLanguageProvider>
    </KioskConfigProvider>
  );
}

/**
 * The language button's label. `default_language` is stored the way the
 * admin form (and MEWS) writes it - "English (United States)" - so the
 * two-letter code a terminal header shows is derived rather than stored
 * separately, which would be one more thing to keep in step.
 */
function languageCode(language: string | null | undefined): string {
  const name = (language || "").toLowerCase();
  if (name.startsWith("thai")) return "TH";
  if (name.startsWith("english")) return "EN";
  return (language || "EN").slice(0, 2).toUpperCase();
}

function KioskShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { selectedProperty } = useSelectedProperty();
  const { config } = useKioskConfig();
  const [time, setTime] = useState<Date | null>(null);
  const orgName = "Narai Group";

  // Screens redesigned against a real reference screenshot render their own
  // full-screen light UI (KioskTopBar - Staff/Guest mode, language/currency/
  // settings) and must bypass this shell's dark header/footer/progress-bar
  // chrome entirely, rather than being wrapped in it. ekyc/upsell/payment/
  // success have no reference screenshot yet and deliberately keep the old
  // dark shell below - their white-on-dark classes would break on light.
  const LIGHT_THEME_ROUTES = ["/kiosk", "/kiosk/search", "/kiosk/confirm", "/kiosk/registration"];
  const isLightTheme = LIGHT_THEME_ROUTES.includes(pathname);

  useEffect(() => {
    // The first value has to be produced on the client and nowhere else:
    // rendering `new Date()` during the server pass and again on hydration
    // is a guaranteed hydration mismatch, so the clock starts null and is
    // filled in here. That is exactly the "synchronize with an external
    // system" case the rule below exists to allow room for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTime(new Date());
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // The property, not the kiosk's own name: the header answers "where am I",
  // which is what a guest standing in front of it is asking. The kiosk name
  // ("Lobby Kiosk (Open at 6AM)") is an operations label, not a guest one.
  const propertyName = selectedProperty || "Select a property";

  // Search/Confirm/Registration all render under isLightTheme above, so this
  // progress bar (part of the dark shell) never actually appears for them -
  // it only ever renders for ekyc/upsell/payment, which have no reference
  // screenshot yet. Registration stays listed so an ekyc/upsell/payment bar
  // correctly shows it as already-done.
  const steps = [
    { path: "/kiosk/registration", label: "Registration" },
    { path: "/kiosk/ekyc", label: "Identity Verification" },
    { path: "/kiosk/upsell", label: "Customize" },
    { path: "/kiosk/payment", label: "Payment" },
  ];

  const currentStepIndex = steps.findIndex((step) => pathname.includes(step.path));

  if (isLightTheme) {
    // `kiosk-scheme` + `data-kiosk-theme` (globals.css) is what actually
    // makes Admin Console > Kiosks' Theme field (Light/Dark) do something -
    // it was previously stored and read nowhere. Scoped to these four
    // screens only: ekyc/upsell/payment/success hardcode their own dark
    // palette directly in Tailwind classes and don't read these tokens.
    const themeAttr = config?.theme === "Dark" ? "dark" : "light";
    return (
      <div
        className="kiosk-root kiosk-scheme h-screen w-full relative overflow-hidden"
        data-kiosk-theme={themeAttr}
      >
        <ScreenSaver videoUrl={config?.screen_saver_video_url} />
        {children}
      </div>
    );
  }

  return (
    <div className="kiosk-root flex flex-col h-screen w-full relative overflow-hidden bg-[var(--color-background)]">
      <ScreenSaver videoUrl={config?.screen_saver_video_url} />

      {/* Top Navigation Bar */}
      <header className="h-24 w-full glass z-50 flex items-center justify-between px-8 absolute top-0 left-0 border-b border-white/10">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-3 bg-white/5 hover:bg-white/10 rounded-full transition"
            aria-label="Go back"
          >
            <ChevronLeft size={28} className="text-white" />
          </button>
          <div className="text-xl font-black text-white tracking-[0.2em] pl-4 border-l border-white/20 uppercase flex flex-col leading-none select-none">
            <span className="text-[10px] text-[var(--color-brand)] mb-1">{orgName}</span>
            {propertyName}
          </div>
        </div>

        <div className="flex items-center gap-8">
          {/* Progress Indicator */}
          {currentStepIndex >= 0 && (
            <div className="hidden md:flex gap-2">
              {steps.map((step, idx) => (
                <div
                  key={step.path}
                  className={`h-2 rounded-full transition-all duration-500 ${
                    idx <= currentStepIndex
                      ? "bg-[var(--color-brand)] w-12"
                      : "bg-white/20 w-4"
                  }`}
                />
              ))}
            </div>
          )}

          {/* Clock & Locale */}
          <div className="flex items-center gap-6">
            <div className="text-xl text-white/80 font-mono tracking-wider">
              {time ? time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}
            </div>
            <button className="px-5 py-2 border border-white/20 rounded-full text-white hover:bg-white/10 transition uppercase font-semibold tracking-wider">
              {languageCode(config?.default_language)}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 mt-24 mb-16 relative z-10 w-full max-w-7xl mx-auto px-4 py-8">
        {children}
      </main>

      {/* Persistent Footer / Branding */}
      <footer className="h-16 absolute bottom-0 left-0 w-full bg-black/50 z-50 flex items-center justify-center border-t border-white/5">
        <p className="text-white/40 text-sm tracking-wider uppercase">
          Powered by Narai Hospitality Group
        </p>
      </footer>
    </div>
  );
}
