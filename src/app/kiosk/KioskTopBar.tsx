"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Coins, Settings, Users } from "lucide-react";
import { useState } from "react";
import { useKioskConfig } from "./kioskConfig";

/**
 * The light-theme top bar every kiosk screen from the welcome page onward
 * uses, extracted out of page.tsx once search/confirm/registration needed
 * the exact same bar - see each page for why it renders its own full-screen
 * light layout rather than KioskLayout's shared (dark, flow-specific)
 * header. `showBack` is false only on the welcome screen: everywhere else
 * there is somewhere to actually go back to.
 *
 * Staff Mode/Switch to guest mode and the language/currency/settings pills
 * are decorative - same "screens first" scope as the rest of this prototype,
 * just a highlighted-pill toggle with no different behavior wired yet.
 */

// The prototype's own hand-drawn flag mock (a generic red/blue stripe block,
// not a real national flag) - decorative, not tied to `default_language`,
// which the text next to it already states in full.
function FlagMock() {
  return (
    <div className="relative h-4 w-6 shrink-0 overflow-hidden rounded-sm bg-blue-900">
      <div className="absolute left-0 top-0 h-1/2 w-full bg-red-600" />
      <div className="absolute left-0 top-0 h-full w-1/3 bg-blue-800" />
    </div>
  );
}

export default function KioskTopBar({ showBack = true }: { showBack?: boolean }) {
  const router = useRouter();
  const { config } = useKioskConfig();
  const [staffMode, setStaffMode] = useState(true);

  return (
    <header className="flex items-center justify-between gap-4 px-8 py-6">
      <div className="flex items-center gap-3">
        {showBack && (
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Go back"
            className="rounded-full border border-[#0B0B0F]/10 bg-white p-3.5 text-[#0B0B0F] transition-colors hover:bg-[#0B0B0F]/5"
          >
            <ArrowLeft size={22} aria-hidden="true" />
          </button>
        )}
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
  );
}
