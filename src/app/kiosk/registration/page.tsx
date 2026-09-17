"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Hand, PenLine } from "lucide-react";
import { useSelectedProperty } from "@/lib/propertyContext";
import KioskTopBar from "../KioskTopBar";
import { findMockGuest } from "../mockGuests";
import { useKioskLanguage } from "../kioskLanguage";

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
  const { t } = useKioskLanguage();
  const guest = findMockGuest(searchParams.get("guest"));
  const [email, setEmail] = useState(guest?.email || "");
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const propertyName = selectedProperty || "this property";

  if (!guest) {
    return (
      <div className="flex h-full w-full flex-col bg-[var(--kiosk-bg)] font-sans text-[var(--kiosk-text)]">
        <KioskTopBar />
        <main className="flex flex-1 items-center justify-center">
          <p className="text-lg font-medium text-[var(--kiosk-text-muted)]">{t.guestNotFound}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-[var(--kiosk-bg)] font-sans text-[var(--kiosk-text)]">
      <KioskTopBar />

      <main className="flex flex-1 gap-6 px-8 pb-4">
        {/* Left: guest + progress card */}
        <div className="flex w-[30%] min-w-[300px] flex-col rounded-[32px] bg-[var(--kiosk-surface)] p-10">
          <div>
            <p className="text-2xl font-semibold">{guest.name}</p>
            <p className="mt-1 text-base text-[var(--kiosk-text-muted)]">{t.reservationOwner}</p>
          </div>

          <div className="my-8 border-t border-dotted border-[var(--kiosk-border-strong)]" />

          <div>
            <p className="text-base font-medium text-[var(--kiosk-text-muted)]">{t.progress}</p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--kiosk-border)]">
              <div className="h-full w-[8%] rounded-full bg-[var(--kiosk-accent)]" />
            </div>
          </div>

          <div className="mt-8 flex items-center gap-4 rounded-2xl bg-[var(--kiosk-surface-alt)] p-5">
            <Hand size={22} className="shrink-0 text-[var(--kiosk-text-muted)]" aria-hidden="true" />
            <p className="text-base font-medium text-[var(--kiosk-text-muted)]">
              {t.tapToReturnSkipped}
            </p>
          </div>

          <button
            type="button"
            disabled={!agreedTerms}
            onClick={() => router.push("/kiosk/ekyc")}
            className="mt-auto w-full rounded-full bg-[var(--kiosk-inverse-bg)] py-5 text-xl font-semibold text-[var(--kiosk-inverse-text)] transition-colors hover:bg-[var(--kiosk-inverse-bg-hover)] disabled:cursor-not-allowed disabled:bg-[var(--kiosk-inverse-bg-disabled)]"
          >
            {t.next}
          </button>
        </div>

        {/* Right: details form card */}
        <div className="flex flex-1 flex-col rounded-[32px] bg-[var(--kiosk-surface)] p-12">
          <h1 className="text-center text-4xl font-bold tracking-tight">{t.enterYourDetails}</h1>

          <div className="mx-auto mt-10 flex w-full max-w-xl flex-1 flex-col">
            <label className="text-base font-medium text-[var(--kiosk-text-muted)]" htmlFor="guest-email">
              {t.email}
            </label>
            <input
              id="guest-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] px-5 py-4 text-lg text-[var(--kiosk-text)] outline-none focus:border-[var(--kiosk-accent)]"
            />

            <div className="mt-6 flex flex-col gap-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-[var(--kiosk-border-strong)] accent-[var(--kiosk-accent)]"
                />
                <span className="text-base text-[var(--kiosk-text-secondary)]">
                  {t.agreeTerms.pre}
                  <span className="font-semibold text-[var(--kiosk-accent)] underline">
                    {t.agreeTerms.link}
                  </span>
                  {t.agreeTerms.post}
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={marketingOptIn}
                  onChange={(e) => setMarketingOptIn(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-[var(--kiosk-border-strong)] accent-[var(--kiosk-accent)]"
                />
                <span className="text-base text-[var(--kiosk-text-secondary)]">
                  {t.marketingOptInPrefix}
                  <span className="font-semibold">{propertyName}</span>
                  {t.marketingOptInSuffix}
                </span>
              </label>
            </div>

            <p className="mt-8 text-base font-medium text-[var(--kiosk-text-muted)]">{t.signature}</p>
            <button
              type="button"
              className="mt-2 flex flex-1 min-h-[140px] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[var(--kiosk-border-strong)] text-[var(--kiosk-text-faint)] transition-colors hover:border-[var(--kiosk-accent)] hover:text-[var(--kiosk-accent)]"
            >
              <PenLine size={28} aria-hidden="true" />
              <span className="text-base font-medium">{t.tapToSign}</span>
            </button>

            <p className="mt-6 text-center text-sm text-[var(--kiosk-text-faint)]">
              {t.privacyFooter.pre}
              <span className="font-semibold text-[var(--kiosk-accent)] underline">
                {t.privacyFooter.link}
              </span>
              {t.privacyFooter.post}
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
