"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Plus, Trash2 } from "lucide-react";
import { useSelectedProperty } from "@/lib/propertyContext";
import SignaturePad from "@/components/SignaturePad";
import KioskTopBar from "../KioskTopBar";
import { useKioskLanguage } from "../kioskLanguage";
import { guestLabel, useKioskArrival, type KioskArrival } from "../arrivals";

/**
 * Registration: who is on the booking, and each of them signing their own
 * ร.ร.๓ card. Two panels, matched to a reference screenshot of the terminal -
 * the guest list on the left, "Enter your details" for whichever guest is
 * selected on the right.
 *
 * The guest list is real (GET /api/kiosks/registration): MEWS's own owner and
 * companions first, then anyone added at this terminal. Adding and removing
 * are **local to NHGOne** - `customers/add` and `reservations/addCompanion`
 * both answer 401 for our Connector token, so a guest added here cannot be
 * pushed into MEWS until that scope is enabled. A guest who came FROM MEWS
 * therefore has no Remove button: removing them here would only hide them
 * from this screen while the booking still carries them.
 *
 * The signature is real too, and it is the point of the screen: the same
 * SignaturePad the BCP Reg Card uses, saved to kiosk_reg_cards, and merged
 * onto that guest's ร.ร.๓ card by sync_service._attach_kiosk_signatures - so
 * signing here is what puts a signature on the statutory form. A short note
 * goes back onto the MEWS reservation as well (the Connector API has no
 * attachment endpoint at all; a note is the one write it allows).
 *
 * Terms must be ticked and a signature drawn before Next moves on, which is
 * consent and a signature actually being required rather than styling.
 */

interface RegistrationGuest {
  guest_key: string;
  first_name: string;
  last_name: string;
  email: string;
  is_owner: boolean;
  source: "mews" | "kiosk";
  signed_at: string | null;
}

function RegistrationContent() {
  const searchParams = useSearchParams();
  const { t } = useKioskLanguage();
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

  return <RegistrationForm arrival={arrival} />;
}

function RegistrationForm({ arrival }: { arrival: KioskArrival }) {
  const router = useRouter();
  const { selectedProperty } = useSelectedProperty();
  const { t } = useKioskLanguage();

  const [guests, setGuests] = useState<RegistrationGuest[] | null>(null);
  const [reservationNumber, setReservationNumber] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [email, setEmail] = useState("");
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [signature, setSignature] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");

  const propertyName = selectedProperty || "this property";

  const load = useCallback(async () => {
    if (!selectedProperty) return;
    const params = new URLSearchParams({ property_name: selectedProperty, reservation_id: arrival.id });
    const response = await fetch(`/api/kiosks/registration?${params}`);
    const res = await response.json();
    if (!response.ok || res.status !== "success") throw new Error(res.detail || "load failed");
    setReservationNumber(res.reservation_number || "");
    setGuests(res.data || []);
    return res.data as RegistrationGuest[];
  }, [selectedProperty, arrival.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await load();
        if (cancelled || !list) return;
        // Start on the first guest who still has to sign, so a second guest
        // is never left behind just because the owner finished first.
        const next = list.find((g) => !g.signed_at) || list[0];
        if (next) {
          setSelectedKey(next.guest_key);
          setEmail(next.email || arrival.guest_email || "");
        }
      } catch {
        if (!cancelled) setError(t.loadError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, arrival.guest_email, t.loadError]);

  const selected = guests?.find((g) => g.guest_key === selectedKey) || null;

  const selectGuest = (guest: RegistrationGuest) => {
    setSelectedKey(guest.guest_key);
    setEmail(guest.email || (guest.is_owner ? arrival.guest_email || "" : ""));
    setAgreedTerms(false);
    setMarketingOptIn(true);
    setSignature(null);
    setError(null);
  };

  const addGuest = async () => {
    setError(null);
    try {
      const response = await fetch("/api/kiosks/registration/guests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_name: selectedProperty,
          reservation_number: reservationNumber,
          first_name: newFirst,
          last_name: newLast,
        }),
      });
      const res = await response.json();
      if (!response.ok || res.status !== "success") throw new Error(res.detail || "add failed");
      setAdding(false);
      setNewFirst("");
      setNewLast("");
      await load();
    } catch {
      setError(t.saveFailed);
    }
  };

  const removeGuest = async (guest: RegistrationGuest) => {
    setError(null);
    try {
      const params = new URLSearchParams({
        property_name: selectedProperty,
        reservation_number: reservationNumber,
        guest_key: guest.guest_key,
      });
      const response = await fetch(`/api/kiosks/registration/guests?${params}`, { method: "DELETE" });
      const res = await response.json();
      if (!response.ok || res.status !== "success") throw new Error(res.detail || "delete failed");
      const list = await load();
      if (selectedKey === guest.guest_key && list?.length) selectGuest(list[0]);
    } catch {
      setError(t.saveFailed);
    }
  };

  const handleNext = async () => {
    if (!selected || !signature || !agreedTerms) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/kiosks/registration/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_name: selectedProperty,
          reservation_number: reservationNumber,
          reservation_id: arrival.id,
          guest_key: selected.guest_key,
          first_name: selected.first_name,
          last_name: selected.last_name,
          email,
          marketing_consent: marketingOptIn,
          terms_accepted: agreedTerms,
          signature_data_url: signature,
        }),
      });
      const res = await response.json();
      if (!response.ok || res.status !== "success") throw new Error(res.detail || "save failed");
      const list = await load();
      const stillToSign = (list || []).find((g) => !g.signed_at && g.guest_key !== selected.guest_key);
      if (stillToSign) {
        selectGuest(stillToSign);
      } else {
        router.push("/kiosk/ekyc");
      }
    } catch {
      setError(t.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const signedCount = (guests || []).filter((g) => g.signed_at).length;
  const total = (guests || []).length || 1;

  return (
    <div className="flex h-full w-full flex-col bg-[var(--kiosk-bg)] font-sans text-[var(--kiosk-text)]">
      <KioskTopBar />

      <main className="flex flex-1 gap-[7px] overflow-hidden px-8 pb-4">
        {/* Left: who is on this booking */}
        <div className="flex w-[34%] min-w-[320px] flex-col rounded-[32px] bg-[var(--kiosk-surface)] p-10">
          <p className="text-base font-medium text-[var(--kiosk-text-muted)]">{t.guests}</p>

          <div className="mt-4 flex-1 space-y-2 overflow-y-auto">
            {(guests || []).map((guest) => {
              const isSelected = guest.guest_key === selectedKey;
              return (
                <div
                  key={guest.guest_key}
                  className={`flex items-center gap-3 rounded-2xl p-4 transition-colors ${
                    isSelected ? "bg-[var(--kiosk-accent-soft)]" : "bg-[var(--kiosk-surface-alt)]"
                  }`}
                >
                  <button type="button" onClick={() => selectGuest(guest)} className="flex-1 text-left">
                    <p className="text-lg font-semibold">
                      {`${guest.first_name} ${guest.last_name}`.trim() || guestLabel(arrival)}
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--kiosk-text-muted)]">
                      {guest.is_owner ? t.reservationOwner : guest.source === "kiosk" ? t.addGuest : t.guests}
                    </p>
                  </button>
                  {guest.signed_at && (
                    <span className="flex items-center gap-1 text-sm font-semibold text-[var(--kiosk-accent)]">
                      <Check size={16} aria-hidden="true" />
                      {t.signed}
                    </span>
                  )}
                  {/* Only a guest added at this terminal can be removed - one
                      that came from MEWS has to be changed in MEWS. */}
                  {guest.source === "kiosk" && (
                    <button
                      type="button"
                      onClick={() => removeGuest(guest)}
                      aria-label={t.remove}
                      className="rounded-full p-2 text-[var(--kiosk-text-muted)] transition-colors hover:bg-[var(--kiosk-hover)]"
                    >
                      <Trash2 size={18} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}

            {adding ? (
              <div className="rounded-2xl bg-[var(--kiosk-surface-alt)] p-4">
                <input
                  value={newFirst}
                  onChange={(e) => setNewFirst(e.target.value)}
                  placeholder={t.firstName}
                  className="w-full rounded-xl border border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] px-4 py-3 text-base text-[var(--kiosk-text)] outline-none focus:border-[var(--kiosk-accent)]"
                />
                <input
                  value={newLast}
                  onChange={(e) => setNewLast(e.target.value)}
                  placeholder={t.lastName}
                  className="mt-2 w-full rounded-xl border border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] px-4 py-3 text-base text-[var(--kiosk-text)] outline-none focus:border-[var(--kiosk-accent)]"
                />
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={addGuest}
                    disabled={!newFirst.trim() && !newLast.trim()}
                    className="flex-1 rounded-full bg-[var(--kiosk-inverse-bg)] py-3 text-base font-semibold text-[var(--kiosk-inverse-text)] disabled:bg-[var(--kiosk-inverse-bg-disabled)]"
                  >
                    {t.save}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdding(false)}
                    className="flex-1 rounded-full border border-[var(--kiosk-border-strong)] py-3 text-base font-semibold"
                  >
                    {t.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--kiosk-border-strong)] p-4 text-base font-medium text-[var(--kiosk-text-muted)] transition-colors hover:border-[var(--kiosk-accent)] hover:text-[var(--kiosk-accent)]"
              >
                <Plus size={18} aria-hidden="true" />
                {t.addGuest}
              </button>
            )}
          </div>

          <div className="mt-6">
            <p className="text-base font-medium text-[var(--kiosk-text-muted)]">{t.progress}</p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--kiosk-border)]">
              <div
                className="h-full rounded-full bg-[var(--kiosk-accent)] transition-all"
                style={{ width: `${Math.round((signedCount / total) * 100)}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            disabled={!agreedTerms || !signature || saving || !selected}
            onClick={handleNext}
            className="mt-6 w-full rounded-full bg-[var(--kiosk-inverse-bg)] py-5 text-xl font-semibold text-[var(--kiosk-inverse-text)] transition-colors hover:bg-[var(--kiosk-inverse-bg-hover)] disabled:cursor-not-allowed disabled:bg-[var(--kiosk-inverse-bg-disabled)]"
          >
            {saving ? t.loading : t.next}
          </button>
        </div>

        {/* Right: the selected guest's own details and signature */}
        <div className="flex flex-1 flex-col overflow-y-auto rounded-[32px] bg-[var(--kiosk-surface)] p-12">
          <h1 className="text-center text-4xl font-bold tracking-tight">{t.enterYourDetails}</h1>

          <div className="mx-auto mt-8 flex w-full max-w-xl flex-1 flex-col">
            {error && (
              <p className="mb-4 rounded-2xl bg-[var(--kiosk-surface-alt)] px-5 py-4 text-base font-medium text-[var(--kiosk-text)]">
                {error}
              </p>
            )}

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
                  <span className="font-semibold text-[var(--kiosk-accent)] underline">{t.agreeTerms.link}</span>
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
            <div className="mt-2 rounded-2xl border-2 border-dashed border-[var(--kiosk-border-strong)] p-3">
              <SignaturePad value={signature} onChange={setSignature} />
            </div>

            <p className="mt-6 text-center text-sm text-[var(--kiosk-text-faint)]">
              {t.privacyFooter.pre}
              <span className="font-semibold text-[var(--kiosk-accent)] underline">{t.privacyFooter.link}</span>
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
