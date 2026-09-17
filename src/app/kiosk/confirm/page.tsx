"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import KioskTopBar from "../KioskTopBar";
import { findMockGuest } from "../mockGuests";
import { useKioskLanguage } from "../kioskLanguage";

/**
 * New 17-Sep-2026, against a real reference screenshot: after picking a
 * guest on /kiosk/search, this confirms who they are and what they're
 * checking into/out of before the registration form. Still mock data - the
 * guest's booking summary comes from mockGuests.ts, looked up by the
 * ?guest=<id> query param search set on the way here.
 *
 * useSearchParams needs a Suspense boundary in the App Router, which is why
 * this file is a thin wrapper around the real page component.
 */

const FALLBACK_IMAGE = "/images/lub_d_chinatown_entrance.png";

function ConfirmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useKioskLanguage();
  const guest = findMockGuest(searchParams.get("guest"));

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
        {/* Left: content card */}
        <div className="flex w-[42%] min-w-[360px] flex-col rounded-[32px] bg-[var(--kiosk-surface)] p-12">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            {t.helloGreeting(guest.name)}
          </h1>
          <p className="mt-2 text-lg text-[var(--kiosk-text-muted)]">{t.confirmSubtitle}</p>

          <div className="mt-10 space-y-8">
            <div>
              <p className="text-base text-[var(--kiosk-text-muted)]">{t.yourBooking}</p>
              <p className="text-2xl font-semibold">{guest.room}</p>
            </div>
            <div>
              <p className="text-base text-[var(--kiosk-text-muted)]">{t.checkOutLabel}</p>
              <p className="text-2xl font-semibold">{guest.checkoutFull}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => router.push(`/kiosk/registration?guest=${guest.id}`)}
            className="mt-auto flex w-full items-center justify-between rounded-full bg-[var(--kiosk-inverse-bg)] px-8 py-5 text-xl font-semibold text-[var(--kiosk-inverse-text)] transition-colors hover:bg-[var(--kiosk-inverse-bg-hover)]"
          >
            {t.confirmButton}
            <ArrowRight size={24} aria-hidden="true" />
          </button>
        </div>

        {/* Right: image card */}
        <div className="relative flex-1 overflow-hidden rounded-[32px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={FALLBACK_IMAGE} alt="" className="absolute inset-0 h-full w-full object-cover" />
        </div>
      </main>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmContent />
    </Suspense>
  );
}
