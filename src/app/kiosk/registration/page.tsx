"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronsRight, Pencil, Pointer, Trash2 } from "lucide-react";
import { useSelectedProperty } from "@/lib/propertyContext";
import SignaturePad from "@/components/SignaturePad";
import KioskTopBar from "../KioskTopBar";
import { useKioskLanguage } from "../kioskLanguage";
import { guestLabel, useKioskArrival, type KioskArrival } from "../arrivals";
import GuestProfileForm, {
  EMPTY_PROFILE,
  REQUIRED_PROFILE_FIELDS,
  type CountryOption,
  type GuestProfile,
  type OwnerAddress,
} from "./GuestProfileForm";

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

interface RegistrationGuest {
  guest_key: string;
  first_name: string;
  last_name: string;
  email: string;
  is_owner: boolean;
  source: "mews" | "kiosk";
  signed_at: string | null;
  // Added at this terminal and not saved yet - it exists only on this screen
  // until Next stores it, so abandoning it leaves nothing behind.
  draft?: boolean;
  // A saved kiosk-added guest's profile, so re-opening them refills the form.
  profile?: Partial<GuestProfile>;
  // The owner's home address, for the added guest's "Use address" card.
  address?: OwnerAddress;
}

// Everything one guest has entered on this screen. Kept per guest, so moving
// between guests never loses what someone already typed - and so every card
// on the left can show its own progress, not just the selected one.
interface GuestForm {
  profile: GuestProfile;
  email: string;
  agreedTerms: boolean;
  marketingOptIn: boolean;
  signature: string | null;
}

function newDraftKey(): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `draft:${id}`;
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await response.json();
  if (!response.ok || res.status !== "success") throw new Error(res.detail || "request failed");
  return res;
}

function RegistrationForm({ arrival }: { arrival: KioskArrival }) {
  const router = useRouter();
  const { selectedProperty } = useSelectedProperty();
  const { t } = useKioskLanguage();

  const [saved, setSaved] = useState<RegistrationGuest[] | null>(null);
  const [drafts, setDrafts] = useState<RegistrationGuest[]>([]);
  const [forms, setForms] = useState<Record<string, GuestForm>>({});
  const [reservationNumber, setReservationNumber] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // False when the reservation loaded but api/sql/kiosk_registration.sql
  // hasn't been run, so there is nowhere to save a signature or an added
  // guest. The guest list still shows (it comes from MEWS); only saving is
  // switched off, with a message that says so.
  const [storageReady, setStorageReady] = useState(true);
  const [saving, setSaving] = useState(false);
  const [countries, setCountries] = useState<CountryOption[]>([]);

  const propertyName = selectedProperty || "this property";
  // MEWS's own guests and the saved kiosk ones first, then anyone added here
  // but not yet saved - the order MEWS's kiosk lists them in.
  const guests = useMemo(() => [...(saved || []), ...drafts], [saved, drafts]);
  const owner = guests.find((g) => g.is_owner) || null;
  const selected = guests.find((g) => g.guest_key === selectedKey) || null;
  // Only a guest added at this terminal gets the full profile form: MEWS
  // already holds the profile of everyone on the booking.
  const fullForm = selected?.source === "kiosk";

  const defaultForm = useCallback(
    (guest: RegistrationGuest): GuestForm => ({
      profile: {
        ...EMPTY_PROFILE,
        ...(guest.profile || {}),
        first_name: guest.profile?.first_name ?? guest.first_name ?? "",
        last_name: guest.profile?.last_name ?? guest.last_name ?? "",
      },
      email: guest.email || (guest.is_owner ? arrival.guest_email || "" : ""),
      agreedTerms: false,
      marketingOptIn: true,
      signature: null,
    }),
    [arrival.guest_email],
  );
  const formFor = useCallback(
    (guest: RegistrationGuest): GuestForm => forms[guest.guest_key] || defaultForm(guest),
    [forms, defaultForm],
  );
  const updateForm = (guest: RegistrationGuest, patch: Partial<GuestForm>) =>
    setForms((prev) => ({
      ...prev,
      [guest.guest_key]: { ...(prev[guest.guest_key] || defaultForm(guest)), ...patch },
    }));

  const form = selected ? formFor(selected) : null;

  // What still has to be done before Next: the terms and a signature for
  // everyone, plus the starred profile fields for a guest added here. The
  // same list drives each card's progress bar.
  const checksFor = (guest: RegistrationGuest, f: GuestForm): boolean[] => {
    const checks = [f.agreedTerms, !!f.signature];
    if (guest.source === "kiosk") {
      for (const field of REQUIRED_PROFILE_FIELDS) checks.push(!!String(f.profile[field] || "").trim());
    }
    return checks;
  };
  const progressOf = (guest: RegistrationGuest): number => {
    if (guest.signed_at) return 1;
    const checks = checksFor(guest, formFor(guest));
    return checks.filter(Boolean).length / checks.length;
  };
  const canSubmit =
    !!selected && !!form && !saving && storageReady && checksFor(selected, form).every(Boolean);

  const load = useCallback(async () => {
    if (!selectedProperty) return;
    const params = new URLSearchParams({ property_name: selectedProperty, reservation_id: arrival.id });
    const response = await fetch(`/api/kiosks/registration?${params}`);
    const res = await response.json();
    if (!response.ok || res.status !== "success") throw new Error(res.detail || "load failed");
    setReservationNumber(res.reservation_number || "");
    setStorageReady(res.storage_ready !== false);
    setSaved(res.data || []);
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
        if (next) setSelectedKey(next.guest_key);
      } catch {
        if (!cancelled) setError(t.loadError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, t.loadError]);

  // The country list behind every nationality / country picker - fetched once.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/kiosks/countries")
      .then((r) => r.json())
      .then((res) => {
        if (!cancelled && res.status === "success") setCountries(res.data || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // The signature pad's size, measured from the box it sits in. On the short
  // form that box takes whatever height is left so the screen never scrolls;
  // on the long form it is a fixed height inside a panel that does. Measured
  // rather than CSS-sized because a canvas needs real pixels - the displayed
  // height, and a drawing buffer in proportion to its fixed 400px width so
  // strokes aren't smeared sideways. The pad is keyed on this size below, so
  // a resize remounts it and redraws the signature rather than wiping it.
  const padBoxRef = useRef<HTMLDivElement>(null);
  const [padSize, setPadSize] = useState({ width: 400, height: 200 });
  useEffect(() => {
    const box = padBoxRef.current;
    if (!box) return;
    const measure = () => {
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
  }, [selectedKey, fullForm]);

  const selectGuest = (guest: RegistrationGuest) => {
    setSelectedKey(guest.guest_key);
    setError(null);
  };

  // Add guest opens a blank profile straight away, the way MEWS's kiosk does -
  // "Guest 2" appears on the left and its form on the right. Nothing is
  // stored until Next, so a guest started and abandoned leaves no row behind.
  const addGuest = () => {
    const draft: RegistrationGuest = {
      guest_key: newDraftKey(),
      first_name: "",
      last_name: "",
      email: "",
      is_owner: false,
      source: "kiosk",
      signed_at: null,
      draft: true,
    };
    setDrafts((prev) => [...prev, draft]);
    setSelectedKey(draft.guest_key);
    setError(null);
  };

  const removeGuest = async (guest: RegistrationGuest) => {
    setError(null);
    const selectFirstOf = (list: RegistrationGuest[]) => {
      if (selectedKey === guest.guest_key) setSelectedKey(list[0]?.guest_key ?? null);
    };
    if (guest.draft) {
      setDrafts((prev) => prev.filter((d) => d.guest_key !== guest.guest_key));
      setForms((prev) => {
        const next = { ...prev };
        delete next[guest.guest_key];
        return next;
      });
      selectFirstOf(guests.filter((g) => g.guest_key !== guest.guest_key));
      return;
    }
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
      selectFirstOf([...(list || []), ...drafts]);
    } catch {
      setError(t.saveFailed);
    }
  };

  const handleNext = async () => {
    if (!selected || !form || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      let guestKey = selected.guest_key;
      let first = selected.first_name;
      let last = selected.last_name;

      if (selected.source === "kiosk") {
        // The profile is stored first. A draft gets its real key here, and is
        // turned into a saved guest at once - so if the signature step below
        // then fails, pressing Next again updates this guest rather than
        // creating a second copy of them.
        const res = await postJson("/api/kiosks/registration/guests", {
          property_name: selectedProperty,
          reservation_number: reservationNumber,
          guest_key: selected.draft ? undefined : selected.guest_key,
          ...form.profile,
          email: form.email,
        });
        first = form.profile.first_name;
        last = form.profile.last_name;
        if (selected.draft) {
          const draftKey = selected.guest_key;
          guestKey = res.guest_key;
          setForms((prev) => {
            const next = { ...prev, [guestKey]: prev[draftKey] || form };
            delete next[draftKey];
            return next;
          });
          setDrafts((prev) => prev.filter((d) => d.guest_key !== draftKey));
          await load();
          setSelectedKey(guestKey);
        }
      }

      await postJson("/api/kiosks/registration/sign", {
        property_name: selectedProperty,
        reservation_number: reservationNumber,
        reservation_id: arrival.id,
        guest_key: guestKey,
        first_name: first,
        last_name: last,
        email: form.email,
        marketing_consent: form.marketingOptIn,
        terms_accepted: form.agreedTerms,
        signature_data_url: form.signature,
      });

      const list = await load();
      const remainingDrafts = drafts.filter((d) => d.guest_key !== selected.guest_key);
      const stillToSign = [...(list || []), ...remainingDrafts].find(
        (g) => !g.signed_at && g.guest_key !== guestKey,
      );
      if (stillToSign) {
        setSelectedKey(stillToSign.guest_key);
      } else {
        router.push("/kiosk/ekyc");
      }
    } catch {
      setError(t.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const signedCount = guests.filter((g) => g.signed_at).length;
  const total = guests.length || 1;

  return (
    <div className="flex h-full w-full flex-col bg-[var(--kiosk-bg)] font-sans text-[var(--kiosk-text)]">
      <KioskTopBar />

      <main className="flex flex-1 gap-[7px] overflow-hidden px-8 pb-4">
        {/* Left: who is on this booking */}
        <div className="flex w-[34%] min-w-[320px] flex-col rounded-[32px] bg-[var(--kiosk-surface)] p-8">
          <div className="flex-1 space-y-3 overflow-y-auto">
            {guests.map((guest, index) => {
              const isSelected = guest.guest_key === selectedKey;
              const f = formFor(guest);
              // A guest added here is named by what has been typed for them so
              // far, and "Guest 2" until then - numbered by position, owner 1.
              const name =
                guest.source === "kiosk"
                  ? `${f.profile.first_name} ${f.profile.last_name}`.trim() || t.guestN(index + 1)
                  : `${guest.first_name} ${guest.last_name}`.trim() || guestLabel(arrival);
              const progress = progressOf(guest);
              return (
                // One bordered card per guest, carrying its own name, role,
                // dotted rule and progress bar - the shape the reference
                // terminal draws. The selected one is filled rather than
                // outlined, which is what tells them apart.
                <div
                  key={guest.guest_key}
                  className={`rounded-2xl border p-5 transition-colors ${
                    isSelected
                      ? "border-[var(--kiosk-border-strong)] bg-[var(--kiosk-surface-alt)]"
                      : "border-[var(--kiosk-border)] bg-[var(--kiosk-surface)]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button type="button" onClick={() => selectGuest(guest)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-2xl font-semibold leading-tight">{name}</p>
                      <p className="mt-1 text-base text-[var(--kiosk-text-muted)]">
                        {guest.is_owner ? t.reservationOwner : t.adult}
                      </p>
                    </button>
                    {/* Open this guest, then remove - both as square outlined
                        buttons, as on MEWS's cards. Remove only for a guest
                        added at this terminal: one on the MEWS booking has to
                        be changed in MEWS. */}
                    <button
                      type="button"
                      onClick={() => selectGuest(guest)}
                      aria-label={t.selectGuest}
                      className="shrink-0 rounded-xl border-2 border-[var(--kiosk-text)] p-2 text-[var(--kiosk-text)] transition-colors hover:bg-[var(--kiosk-hover)]"
                    >
                      <ChevronsRight size={20} aria-hidden="true" />
                    </button>
                    {guest.source === "kiosk" && (
                      <button
                        type="button"
                        onClick={() => removeGuest(guest)}
                        aria-label={t.remove}
                        className="shrink-0 rounded-xl border-2 border-[var(--kiosk-text)] p-2 text-[var(--kiosk-text)] transition-colors hover:bg-[var(--kiosk-hover)]"
                      >
                        <Trash2 size={20} aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  {/* Dotted rule then the progress bar, both inside the card.
                      border-dotted rather than a row of characters so it
                      stretches to whatever width the panel has. */}
                  <div className="mt-4 border-t-2 border-dotted border-[var(--kiosk-border-strong)]" />
                  <p className="mt-3 text-right text-base text-[var(--kiosk-text-muted)]">
                    {guest.signed_at ? t.complete : t.progress}
                  </p>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--kiosk-border)]">
                    <div
                      className="h-full rounded-full bg-[var(--kiosk-inverse-bg)] transition-all"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {/* The reference terminal puts a solid grey tap-card here, a
                hand-tap icon above the text. It adds a guest and opens their
                profile form straight away. */}
            <button
              type="button"
              onClick={addGuest}
              disabled={!storageReady}
              className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl bg-[var(--kiosk-surface-alt)] py-8 text-lg text-[var(--kiosk-text)] transition-colors hover:bg-[var(--kiosk-hover)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[var(--kiosk-surface-alt)]"
            >
              <Pointer size={30} strokeWidth={1.75} aria-hidden="true" />
              {t.addGuest}
            </button>
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
            disabled={!canSubmit}
            onClick={handleNext}
            className="mt-4 w-full rounded-2xl bg-[var(--kiosk-inverse-bg)] py-6 text-xl font-semibold text-[var(--kiosk-inverse-text)] transition-colors hover:bg-[var(--kiosk-inverse-bg-hover)] disabled:cursor-not-allowed disabled:bg-[var(--kiosk-inverse-bg-disabled)]"
          >
            {saving ? t.loading : t.next}
          </button>
        </div>

        {/* Right: the selected guest's own details and signature.
            The short form (a guest MEWS already knows) is a bounded column
            that fills the screen exactly: every block keeps its natural
            height and the signature pad takes the rest, so it never scrolls.
            The long form (a guest added here) has ~17 fields and cannot fit
            any tablet, so there the panel scrolls - as MEWS's own does.
            Keyed on the guest so switching guests starts back at the top. */}
        <div
          key={selectedKey || "none"}
          className="flex flex-1 flex-col overflow-y-auto rounded-[32px] bg-[var(--kiosk-surface)] px-12 py-8"
        >
          <h1 className="text-center text-4xl font-semibold tracking-tight">{t.enterYourDetails}</h1>

          <div className={`mx-auto mt-6 flex w-full max-w-3xl flex-col ${fullForm ? "" : "min-h-0 flex-1"}`}>
            {(error || !storageReady) && (
              <p className="mb-4 shrink-0 rounded-2xl bg-[var(--kiosk-surface-alt)] px-5 py-3 text-base font-medium text-[var(--kiosk-text)]">
                {error || t.signingUnavailable}
              </p>
            )}

            {selected && form && fullForm && (
              <GuestProfileForm
                profile={form.profile}
                onChange={(profile) => updateForm(selected, { profile })}
                email={form.email}
                onEmailChange={(email) => updateForm(selected, { email })}
                countries={countries}
                ownerAddress={owner?.address || null}
              />
            )}

            {selected && form && !fullForm && (
              // One bordered box with its small label INSIDE it, above the
              // value - the way the terminal draws it. The whole box is the
              // label, so tapping anywhere in it focuses the input.
              <label
                htmlFor="guest-email"
                className="block shrink-0 cursor-text rounded-2xl border-2 border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] px-8 pb-3 pt-3 transition-colors focus-within:border-[var(--kiosk-accent)]"
              >
                <span className="block text-sm text-[var(--kiosk-text-muted)]">{t.email}</span>
                <input
                  id="guest-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => updateForm(selected, { email: e.target.value })}
                  className="mt-1 w-full bg-transparent text-xl text-[var(--kiosk-text)] outline-none"
                />
              </label>
            )}

            {selected && form && (
              <>
                <div className="mt-6 flex shrink-0 flex-col gap-4">
                  <KioskCheckbox
                    checked={form.agreedTerms}
                    onChange={(agreedTerms) => updateForm(selected, { agreedTerms })}
                  >
                    {t.agreeTerms.pre}
                    <span className="text-[var(--kiosk-accent)]">{t.agreeTerms.link}</span>
                    {t.agreeTerms.post}
                  </KioskCheckbox>

                  <KioskCheckbox
                    checked={form.marketingOptIn}
                    onChange={(marketingOptIn) => updateForm(selected, { marketingOptIn })}
                  >
                    {t.marketingOptInPrefix}
                    {propertyName}
                    {t.marketingOptInSuffix}
                  </KioskCheckbox>
                </div>

                <p className="mt-5 shrink-0 text-lg text-[var(--kiosk-text-muted)]">{t.signature}</p>
                {/* Solid-bordered, reading "Tap to sign" until something is
                    drawn. The shared SignaturePad, so what is captured here is
                    exactly what lands on the guest's ร.ร.๓ card; only its size
                    and chrome are the kiosk's own. Absolutely positioned inside
                    its box so the canvas can never push the box taller than
                    its share, and keyed on guest + size so a resize or a
                    change of guest redraws that guest's signature. Clear sits
                    over the pad's corner rather than costing it height. */}
                <div
                  ref={padBoxRef}
                  className={`relative mt-2 ${fullForm ? "h-[300px] shrink-0" : "min-h-[140px] flex-1"}`}
                >
                  <div className="absolute inset-0">
                    <SignaturePad
                      key={`${selected.guest_key}:${padSize.width}x${padSize.height}`}
                      value={form.signature}
                      onChange={(signature) => updateForm(selected, { signature })}
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
                  {form.signature && (
                    <button
                      type="button"
                      onClick={() => updateForm(selected, { signature: null })}
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
              </>
            )}
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
