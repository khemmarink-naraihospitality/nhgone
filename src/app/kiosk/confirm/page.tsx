"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import KioskTopBar from "../KioskTopBar";
import { useKioskLanguage } from "../kioskLanguage";
import { formatCheckout, guestLabel, useKioskArrival } from "../arrivals";

/**
 * After picking a guest on /kiosk/search, confirms who they are and what
 * they're checking into before the registration form - matched to a real
 * reference screenshot of MEWS's kiosk. The reservation comes from
 * GET /api/kiosks/arrivals/{id} (the per-minute MEWS mirror): "Your booking"
 * is its requested space category, "Check-out" its scheduled departure in
 * the property's own timezone.
 *
 * A booking that's no longer Confirmed (checked in at the front desk, or
 * canceled, since the guest tapped it) says so instead of carrying on.
 *
 * useSearchParams needs a Suspense boundary in the App Router, which is why
 * this file is a thin wrapper around the real page component.
 */

const FALLBACK_IMAGE = "/images/lub_d_chinatown_entrance.png";

function ConfirmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, language } = useKioskLanguage();
  const { status, arrival } = useKioskArrival(searchParams.get("guest"));

  let message: string | null = null;
  if (status === "loading") message = t.loading;
  else if (status === "missing") message = t.guestNotFound;
  else if (status === "error") message = t.loadError;
  else if (arrival && arrival.state !== "Confirmed") message = t.unavailable;

  if (message || !arrival) {
    return (
      <div className="flex h-full w-full flex-col bg-[var(--kiosk-bg)] font-sans text-[var(--kiosk-text)]">
        <KioskTopBar />
        <main className="flex flex-1 items-center justify-center px-8">
          <p className="text-center text-lg font-medium text-[var(--kiosk-text-muted)]">{message}</p>
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
            {t.helloGreeting(guestLabel(arrival))}
          </h1>
          <p className="mt-2 text-lg text-[var(--kiosk-text-muted)]">{t.confirmSubtitle}</p>

          <div className="mt-10 space-y-8">
            <div>
              <p className="text-base text-[var(--kiosk-text-muted)]">{t.yourBooking}</p>
              <p className="text-2xl font-semibold">{arrival.room_category}</p>
            </div>
            <div>
              <p className="text-base text-[var(--kiosk-text-muted)]">{t.checkOutLabel}</p>
              <p className="text-2xl font-semibold">
                {formatCheckout(arrival.scheduled_end_utc, arrival.time_zone, language)}
              </p>
            </div>

            {arrival.included && arrival.included.length > 0 && (
              <div>
                <p className="text-base text-[var(--kiosk-text-muted)]">{t.included}</p>
                <ul className="mt-1 space-y-0.5">
                  {arrival.included.map((item) => (
                    <li key={item.label} className="text-lg font-semibold">
                      {item.count}x {item.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => router.push(`/kiosk/registration?guest=${encodeURIComponent(arrival.id)}`)}
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
