"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Hand, PenLine } from "lucide-react";
import { useSelectedProperty } from "@/lib/propertyContext";
import KioskTopBar from "../KioskTopBar";
import { findMockGuest } from "../mockGuests";

/**
 * Rebuilt 17-Sep-2026 against a real reference screenshot: this replaces the
 * old dark "Review & Signing" design (PDPA consent block + hardcoded "John
 * Smith") with a two-panel layout - a left guest/progress card and a right
 * "Enter your details" form - matching the terminal in the field. Still mock
 * data: the guest comes from mockGuests.ts via the same ?guest=<id> pattern
 * confirm/page.tsx uses, and there's no real signature capture or submission
 * behind either button yet.
 *
 * "Tap to return skipped guest" and the progress bar are reproduced as
 * static UI - the reference shows them but doesn't demonstrate what they do,
 * and this flow only ever has one guest in it (no multi-guest queue exists
 * to skip between).
 *
 * The Terms checkbox keeps the old page's gating behavior (Next is disabled
 * until it's checked) since that's a real consent requirement, not styling.
 */

function RegistrationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedProperty } = useSelectedProperty();
  const guest = findMockGuest(searchParams.get("guest"));
  const [email, setEmail] = useState(guest?.email || "");
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const propertyName = selectedProperty || "this property";

  if (!guest) {
    return (
      <div className="flex h-full w-full flex-col bg-[#F4F4F5] font-sans text-[#0B0B0F]">
        <KioskTopBar />
        <main className="flex flex-1 items-center justify-center">
          <p className="text-lg font-medium text-[#0B0B0F]/50">
            That guest wasn&apos;t found. Go back and pick one from the list.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-[#F4F4F5] font-sans text-[#0B0B0F]">
      <KioskTopBar />

      <main className="flex flex-1 gap-6 px-8 pb-4">
        {/* Left: guest + progress card */}
        <div className="flex w-[30%] min-w-[300px] flex-col rounded-[32px] bg-white p-10">
          <div>
            <p className="text-2xl font-semibold">{guest.name}</p>
            <p className="mt-1 text-base text-[#0B0B0F]/50">Reservation owner</p>
          </div>

          <div className="my-8 border-t border-dotted border-[#0B0B0F]/20" />

          <div>
            <p className="text-base font-medium text-[#0B0B0F]/50">Progress</p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#0B0B0F]/10">
              <div className="h-full w-[8%] rounded-full bg-[#4F46E5]" />
            </div>
          </div>

          <div className="mt-8 flex items-center gap-4 rounded-2xl bg-[#F4F4F5] p-5">
            <Hand size={22} className="shrink-0 text-[#0B0B0F]/50" aria-hidden="true" />
            <p className="text-base font-medium text-[#0B0B0F]/60">
              Tap to return skipped guest
            </p>
          </div>

          <button
            type="button"
            disabled={!agreedTerms}
            onClick={() => router.push("/kiosk/ekyc")}
            className="mt-auto w-full rounded-full bg-[#0B0B0F] py-5 text-xl font-semibold text-white transition-colors hover:bg-[#0B0B0F]/90 disabled:cursor-not-allowed disabled:bg-[#0B0B0F]/20"
          >
            Next
          </button>
        </div>

        {/* Right: details form card */}
        <div className="flex flex-1 flex-col rounded-[32px] bg-white p-12">
          <h1 className="text-center text-4xl font-bold tracking-tight">Enter your details</h1>

          <div className="mx-auto mt-10 flex w-full max-w-xl flex-1 flex-col">
            <label className="text-base font-medium text-[#0B0B0F]/60" htmlFor="guest-email">
              Email
            </label>
            <input
              id="guest-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-[#0B0B0F]/15 px-5 py-4 text-lg outline-none focus:border-[#4F46E5]/40"
            />

            <div className="mt-6 flex flex-col gap-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-[#0B0B0F]/25 accent-[#0B0B0F]"
                />
                <span className="text-base text-[#0B0B0F]/70">
                  I agree with <span className="font-semibold text-[#4F46E5] underline">Property Terms and Conditions</span>. *
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={marketingOptIn}
                  onChange={(e) => setMarketingOptIn(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-[#0B0B0F]/25 accent-[#0B0B0F]"
                />
                <span className="text-base text-[#0B0B0F]/70">
                  I&apos;d like to occasionally receive marketing emails from{" "}
                  <span className="font-semibold">{propertyName}</span>.
                </span>
              </label>
            </div>

            <p className="mt-8 text-base font-medium text-[#0B0B0F]/60">Signature *</p>
            <button
              type="button"
              className="mt-2 flex flex-1 min-h-[140px] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[#0B0B0F]/20 text-[#0B0B0F]/40 transition-colors hover:border-[#4F46E5]/40 hover:text-[#4F46E5]/70"
            >
              <PenLine size={28} aria-hidden="true" />
              <span className="text-base font-medium">Tap to sign</span>
            </button>

            <p className="mt-6 text-center text-sm text-[#0B0B0F]/45">
              Read more about personal data processing in{" "}
              <span className="font-semibold text-[#4F46E5] underline">Property Privacy Policy</span>.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function RegistrationPage() {
  return (
    <Suspense fallback={null}>
      <RegistrationContent />
    </Suspense>
  );
}
