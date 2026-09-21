"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
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

/**
 * The reference terminal draws its own checkbox - a large rounded square,
 * white with a grey border when off and solid dark with a white tick when on
 * - rather than the browser's. Big enough to hit with a finger, which the
 * native 20px one is not, and it theme-switches with the rest of the screen.
 * The real <input> stays, visually hidden, so the label, keyboard and
 * screen-reader behaviour are the browser's own.
 */
function KioskCheckbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-4">
      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute h-0 w-0 opacity-0"
        />
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 items-center justify-center rounded-lg border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--kiosk-accent)] ${
            checked
              ? "border-[var(--kiosk-inverse-bg)] bg-[var(--kiosk-inverse-bg)] text-[var(--kiosk-inverse-text)]"
              : "border-[var(--kiosk-border-strong)] bg-[var(--kiosk-surface)]"
          }`}
        >
          {checked && <Check size={22} strokeWidth={3} aria-hidden="true" />}
        </span>
      </span>
      <span className="pt-1.5 text-lg leading-snug text-[var(--kiosk-text-secondary)]">{children}</span>
    </label>
  );
}

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
  // False when the reservation loaded but api/sql/kiosk_registration.sql
  // hasn't been run, so there is nowhere to save a signature or an added
  // guest. The guest list still shows (it comes from MEWS); only saving is
  // switched off, with a message that says so.
  const [storageReady, setStorageReady] = useState(true);
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
    setStorageReady(res.storage_ready !== false);
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

  // The signature pad takes whatever height is left once everything else on
  // the right is laid out, so the screen never scrolls whatever the tablet.
  // It is measured rather than CSS-sized because the canvas needs real pixel
  // numbers: the displayed height, and a drawing buffer kept in proportion to
  // the fixed 400px buffer width so strokes aren't smeared sideways.
  //
  // Only re-measured while nothing is signed - resizing a canvas wipes it, and
  // a pad that silently empties itself after the guest signed would still
  // leave Next enabled on a signature they can no longer see.
  const padBoxRef = useRef<HTMLDivElement>(null);
  const [padSize, setPadSize] = useState({ width: 400, height: 200 });
  useEffect(() => {
    const box = padBoxRef.current;
    if (!box) return;
    const measure = () => {
      if (signature) return;
      const { clientWidth, clientHeight } = box;
      if (clientWidth > 0 && clientHeight > 0) {
        setPadSize((prev) =>
          prev.width === clientWidth && prev.height === clientHeight
            ? prev
            : { width: clientWidth, height: clientHeight });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [signature]);

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
        <div className="flex w-[34%] min-w-[320px] flex-col rounded-[32px] bg-[var(--kiosk-surface)] p-8">
          <div className="flex-1 space-y-3 overflow-y-auto">
            {(guests || []).map((guest) => {
              const isSelected = guest.guest_key === selectedKey;
              return (
                // One bordered card per guest, carrying its own name, role,
                // dotted rule and progress bar - the shape the reference
                // terminal draws for the guest being signed. The selected one
                // is filled rather than outlined, which is the only thing
                // distinguishing it once there is more than one.
                <div
                  key={guest.guest_key}
                  className={`rounded-2xl border p-5 transition-colors ${
                    isSelected
                      ? "border-[var(--kiosk-border-strong)] bg-[var(--kiosk-surface-alt)]"
                      : "border-[var(--kiosk-border)] bg-[var(--kiosk-surface)]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button type="button" onClick={() => selectGuest(guest)} className="flex-1 text-left">
                      <p className="text-2xl font-semibold leading-tight">
                        {`${guest.first_name} ${guest.last_name}`.trim() || guestLabel(arrival)}
                      </p>
                      <p className="mt-1 text-base text-[var(--kiosk-text-muted)]">
                        {guest.is_owner ? t.reservationOwner : guest.source === "kiosk" ? t.addGuest : t.guests}
                      </p>
                    </button>
                    {guest.signed_at && (
                      <span className="flex items-center gap-1 pt-1 text-sm font-semibold text-[var(--kiosk-accent)]">
                        <Check size={16} aria-hidden="true" />
                        {t.signed}
                      </span>
                    )}
                    {/* Only a guest added at this terminal can be removed -
                        one that came from MEWS has to be changed in MEWS. */}
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

                  {/* Dotted rule then the progress bar, both inside the card.
                      border-dotted rather than a row of characters so it
                      stretches to whatever width the panel has. */}
                  <div className="mt-4 border-t-2 border-dotted border-[var(--kiosk-border-strong)]" />
                  <p className="mt-3 text-right text-base text-[var(--kiosk-text-muted)]">{t.progress}</p>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--kiosk-border)]">
                    <div
                      className="h-full rounded-full bg-[var(--kiosk-accent)] transition-all"
                      style={{ width: guest.signed_at ? "100%" : "0%" }}
                    />
                  </div>
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
              // The reference terminal puts a solid grey tap-card here, icon
              // above the text ("Tap to return skipped guest"). That action
              // has nothing behind it in this flow, so the slot carries the
              // one that does - Add guest - in the same shape.
              <button
                type="button"
                onClick={() => setAdding(true)}
                disabled={!storageReady}
                className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl bg-[var(--kiosk-surface-alt)] py-8 text-lg text-[var(--kiosk-text)] transition-colors hover:bg-[var(--kiosk-hover)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[var(--kiosk-surface-alt)]"
              >
                <Plus size={30} strokeWidth={1.75} aria-hidden="true" />
                {t.addGuest}
              </button>
            )}
          </div>

          {/* How far through the whole booking this is - only worth a line
              once there is more than one guest to be through. */}
          {total > 1 && (
            <p className="mt-4 text-center text-base text-[var(--kiosk-text-muted)]">
              {signedCount}/{total}
            </p>
          )}

          <button
            type="button"
            disabled={!agreedTerms || !signature || saving || !selected || !storageReady}
            onClick={handleNext}
            className="mt-4 w-full rounded-2xl bg-[var(--kiosk-inverse-bg)] py-6 text-xl font-semibold text-[var(--kiosk-inverse-text)] transition-colors hover:bg-[var(--kiosk-inverse-bg-hover)] disabled:cursor-not-allowed disabled:bg-[var(--kiosk-inverse-bg-disabled)]"
          >
            {saving ? t.loading : t.next}
          </button>
        </div>

        {/* Right: the selected guest's own details and signature */}
        {/* A bounded flex column: every block keeps its natural height and
            the signature pad takes the rest, so the panel fills the screen
            exactly instead of scrolling. overflow-y-auto stays only as a
            safety net for a screen too short to hold even the smallest pad. */}
        <div className="flex flex-1 flex-col overflow-y-auto rounded-[32px] bg-[var(--kiosk-surface)] px-12 py-8">
          <h1 className="text-center text-4xl font-semibold tracking-tight">{t.enterYourDetails}</h1>

          <div className="mx-auto mt-6 flex min-h-0 w-full max-w-3xl flex-1 flex-col">
            {(error || !storageReady) && (
              <p className="mb-4 rounded-2xl bg-[var(--kiosk-surface-alt)] px-5 py-3 text-base font-medium text-[var(--kiosk-text)]">
                {error || t.signingUnavailable}
              </p>
            )}

            {/* One bordered box with its small label INSIDE it, above the
                value - the way the terminal draws it - rather than a label
                floating above a separate field. The whole box is the label,
                so tapping anywhere in it focuses the input. */}
            <label
              htmlFor="guest-email"
              className="block shrink-0 cursor-text rounded-2xl border-2 border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] px-8 pb-3 pt-3 transition-colors focus-within:border-[var(--kiosk-accent)]"
            >
              <span className="block text-sm text-[var(--kiosk-text-muted)]">{t.email}</span>
              <input
                id="guest-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full bg-transparent text-xl text-[var(--kiosk-text)] outline-none"
              />
            </label>

            <div className="mt-6 flex shrink-0 flex-col gap-4">
              <KioskCheckbox checked={agreedTerms} onChange={setAgreedTerms}>
                {t.agreeTerms.pre}
                <span className="text-[var(--kiosk-accent)]">{t.agreeTerms.link}</span>
                {t.agreeTerms.post}
              </KioskCheckbox>

              <KioskCheckbox checked={marketingOptIn} onChange={setMarketingOptIn}>
                {t.marketingOptInPrefix}
                {propertyName}
                {t.marketingOptInSuffix}
              </KioskCheckbox>
            </div>

            <p className="mt-5 shrink-0 text-lg text-[var(--kiosk-text-muted)]">{t.signature}</p>
            {/* Solid-bordered, reading "Tap to sign" until something is drawn,
                and as tall as the space left - see padSize above. The pad is
                the shared SignaturePad, so what is captured here is exactly
                what lands on the guest's ร.ร.๓ card; only its size and chrome
                are the kiosk's own. Positioned absolutely inside the box so
                the canvas can never push the box taller than its flex share.
                Clear sits over the pad's corner instead of below it, which
                would cost the pad that much height. */}
            <div ref={padBoxRef} className="relative mt-2 min-h-[140px] flex-1">
              <div className="absolute inset-0">
                <SignaturePad
                  value={signature}
                  onChange={setSignature}
                  height={padSize.height}
                  bufferHeight={Math.max(1, Math.round((400 * padSize.height) / padSize.width))}
                  canvasClassName="rounded-2xl border-2 border-[var(--kiosk-border)] bg-[var(--kiosk-surface)]"
                  placeholder={
                    <span className="flex items-center gap-4 text-4xl text-[var(--kiosk-text-faint)]">
                      <Pencil size={34} strokeWidth={1.75} aria-hidden="true" />
                      {t.tapToSign}
                    </span>
                  }
                  clearClassName="hidden"
                />
              </div>
              {signature && (
                <button
                  type="button"
                  onClick={() => setSignature(null)}
                  className="absolute right-3 top-3 rounded-full bg-[var(--kiosk-surface-alt)] px-4 py-2 text-base font-medium text-[var(--kiosk-text-muted)] transition-colors hover:bg-[var(--kiosk-hover)]"
                >
                  {t.clearSignature}
                </button>
              )}
            </div>

            <p className="mt-4 shrink-0 text-lg text-[var(--kiosk-text-secondary)]">
              {t.privacyFooter.pre}
              <span className="text-[var(--kiosk-accent)]">{t.privacyFooter.link}</span>
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
