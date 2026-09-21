"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { BookUser, CarFront, Check, ChevronDown, IdCard, Search, X, type LucideIcon } from "lucide-react";
import { useKioskLanguage } from "../kioskLanguage";

/**
 * The full profile a guest ADDED AT THE TERMINAL fills in - the fields MEWS's
 * own kiosk asks for on its Add guest form, in the same order and sections
 * (checked against screenshots of it, 17-Sep-2026). A guest already on the
 * MEWS booking doesn't get this form: MEWS has their profile, so they only
 * confirm an email, accept the terms and sign.
 *
 * Presentational only - the parent owns the values, saves them through
 * POST /api/kiosks/registration/guests, and decides when Next is allowed.
 */

export type DocumentType = "passport" | "identity_card" | "drivers_license";

export interface GuestProfile {
  first_name: string;
  last_name: string;
  nationality: string;
  telephone: string;
  occupation: string;
  address_line1: string;
  address_line2: string;
  city: string;
  postal_code: string;
  country: string;
  document_type: DocumentType;
  document_number: string;
  issue_date: string;
  issuing_country: string;
  issuing_city: string;
  expiration_date: string;
}

export interface OwnerAddress {
  address_line1: string;
  address_line2: string;
  city: string;
  postal_code: string;
  country: string;
}

export interface CountryOption {
  code: string;
  name: string;
}

// A country as the picker shows it: its name in the guest's language, plus
// the English one so a search typed in English still finds it on a Thai
// screen.
interface LocalisedCountry {
  code: string;
  name: string;
  english: string;
}

export const EMPTY_PROFILE: GuestProfile = {
  first_name: "",
  last_name: "",
  nationality: "",
  telephone: "",
  occupation: "",
  address_line1: "",
  address_line2: "",
  city: "",
  postal_code: "",
  country: "",
  document_type: "passport",
  document_number: "",
  issue_date: "",
  issuing_country: "",
  issuing_city: "",
  expiration_date: "",
};

/** The profile fields marked * - mirrored server-side in add_kiosk_guest. */
export const REQUIRED_PROFILE_FIELDS: (keyof GuestProfile)[] = [
  "first_name",
  "last_name",
  "nationality",
  "country",
  "document_number",
];

// One bordered box per field with its small label INSIDE it above the value -
// the same shape as the owner form's Email box, so both forms read alike. The
// whole box is the label, so a tap anywhere in it focuses the control.
const BOX =
  "block shrink-0 cursor-text rounded-2xl border-2 border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] px-8 pb-3 pt-3 transition-colors focus-within:border-[var(--kiosk-accent)]";
const LABEL = "block text-sm text-[var(--kiosk-text-muted)]";
const CONTROL = "mt-1 w-full bg-transparent text-xl text-[var(--kiosk-text)] outline-none";

function Field({
  label,
  required,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "tel" | "email" | "date";
  autoComplete?: string;
}) {
  return (
    <label className={BOX}>
      <span className={LABEL}>
        {label}
        {required && " *"}
      </span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className={CONTROL}
      />
    </label>
  );
}

// A country's flag. The SVGs are served from our own origin (public/flags,
// from the MIT-licensed flag-icons package - see public/flags/LICENSE) rather
// than a flag CDN: a lobby terminal has no business telling a third party
// which countries its guests are scrolling past. Image fetches them lazily,
// so opening the list loads only the rows actually on screen. Emoji flags
// were not an option - Windows renders them as bare letters ("TH").
function Flag({ code, size = 32 }: { code: string; size?: number }) {
  return (
    <Image
      src={`/flags/${code.toLowerCase()}.svg`}
      alt=""
      width={size}
      height={Math.round((size * 3) / 4)}
      unoptimized
      className="shrink-0 rounded-[3px] shadow-[0_0_0_1px_rgba(0,0,0,0.08)]"
    />
  );
}

// Folds case and accents, so "cote" finds Côte d'Ivoire and "turkiye" finds
// Türkiye. Thai, Khmer and Japanese are unaffected - they have neither.
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

function CountryField({
  label,
  required,
  value,
  onChange,
  options,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: LocalisedCountry[];
}) {
  const { t } = useKioskLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((c) => c.code === value) || null;

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const pick = (code: string) => {
    onChange(code);
    close();
  };

  // Matches the name in the guest's own language, the English one, and the
  // code - so "japan", "ญี่ปุ่น" and "JP" all find the same row whatever
  // language the screen is in.
  const filtered = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return options;
    return options.filter(
      (c) => fold(c.name).includes(q) || fold(c.english).includes(q) || c.code.toLowerCase() === q,
    );
  }, [options, query]);

  // Open on the country already chosen rather than at Afghanistan, and let
  // Escape close the dialog on a terminal with a keyboard attached.
  useEffect(() => {
    if (!open) return;
    selectedRef.current?.scrollIntoView({ block: "center" });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* The same bordered box as every other field, so the form reads as
          one piece; it opens the picker instead of taking typing. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="block w-full shrink-0 rounded-2xl border-2 border-[var(--kiosk-border)] bg-[var(--kiosk-surface)] px-8 pb-3 pt-3 text-left transition-colors focus-visible:border-[var(--kiosk-accent)] focus-visible:outline-none"
      >
        <span className={LABEL}>
          {label}
          {required && " *"}
        </span>
        <span className="mt-1 flex min-h-[28px] items-center gap-3 text-xl text-[var(--kiosk-text)]">
          {selected && (
            <>
              <Flag code={selected.code} size={30} />
              <span className="truncate">{selected.name}</span>
            </>
          )}
          <ChevronDown size={22} className="ml-auto shrink-0 text-[var(--kiosk-text-muted)]" aria-hidden="true" />
        </span>
      </button>

      {open && (
        // Anchored near the top rather than centred: on the tablet the
        // on-screen keyboard rises from the bottom as soon as someone taps
        // the search box, and a centred dialog would lose its lower half to
        // it. Capped at 82% of the screen, with only the list scrolling, so
        // it can never run off the page however long the list is.
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-6 pt-[6vh]"
          onClick={close}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-[var(--kiosk-surface)] text-[var(--kiosk-text)] shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4 px-7 pb-4 pt-6">
              <h2 className="text-2xl font-semibold">{label}</h2>
              <div className="flex items-center gap-2">
                {/* Only an optional field can be emptied again - a required
                    one just gets changed. */}
                {!required && value && (
                  <button
                    type="button"
                    onClick={() => pick("")}
                    className="rounded-full px-4 py-2 text-base font-medium text-[var(--kiosk-text-muted)] transition-colors hover:bg-[var(--kiosk-hover)]"
                  >
                    {t.clearSignature}
                  </button>
                )}
                <button
                  type="button"
                  onClick={close}
                  aria-label={t.cancel}
                  className="rounded-xl border-2 border-[var(--kiosk-text)] p-2 transition-colors hover:bg-[var(--kiosk-hover)]"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="px-7 pb-3">
              <label className="flex items-center gap-3 rounded-2xl border-2 border-[var(--kiosk-border)] px-5 py-3 transition-colors focus-within:border-[var(--kiosk-accent)]">
                <Search size={20} className="shrink-0 text-[var(--kiosk-text-muted)]" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.searchCountry}
                  className="w-full bg-transparent text-lg text-[var(--kiosk-text)] outline-none placeholder:text-[var(--kiosk-text-faint)]"
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4" role="listbox" aria-label={label}>
              {filtered.map((c) => {
                const isSelected = c.code === value;
                return (
                  <button
                    key={c.code}
                    ref={isSelected ? selectedRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => pick(c.code)}
                    className={`flex w-full items-center gap-4 rounded-2xl px-4 py-3 text-left text-lg transition-colors ${
                      isSelected
                        ? "bg-[var(--kiosk-surface-alt)] font-semibold"
                        : "hover:bg-[var(--kiosk-hover)]"
                    }`}
                  >
                    <Flag code={c.code} />
                    <span className="flex-1">{c.name}</span>
                    {isSelected && <Check size={20} className="shrink-0 text-[var(--kiosk-accent)]" aria-hidden="true" />}
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="px-4 py-8 text-center text-base text-[var(--kiosk-text-muted)]">{t.noCountryMatch}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// "———— PERSONAL ADDRESS ————" - a centred caps label with a rule either side,
// the way MEWS's form separates its sections.
function Section({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-4 pt-4">
      <span className="h-px flex-1 bg-[var(--kiosk-border-strong)]" />
      <span className="text-lg font-medium uppercase tracking-wide text-[var(--kiosk-text-muted)]">{title}</span>
      <span className="h-px flex-1 bg-[var(--kiosk-border-strong)]" />
    </div>
  );
}

export default function GuestProfileForm({
  profile,
  onChange,
  email,
  onEmailChange,
  countries,
  ownerAddress,
}: {
  profile: GuestProfile;
  onChange: (profile: GuestProfile) => void;
  email: string;
  onEmailChange: (email: string) => void;
  countries: CountryOption[];
  ownerAddress: OwnerAddress | null;
}) {
  const { t, language } = useKioskLanguage();
  const set = (field: keyof GuestProfile) => (value: string) => onChange({ ...profile, [field]: value });

  // Personal-address country defaults to nationality, since most guests give
  // an address in the country they're a citizen of - one fewer picker to
  // open. Only applied while the country field is still empty or still
  // mirroring the PREVIOUS nationality (i.e. nobody has deliberately typed a
  // different country in yet), so picking a nationality never clobbers an
  // address the guest already chose on their own.
  const setNationality = (nationality: string) => {
    const countryMirrorsNationality = !profile.country || profile.country === profile.nationality;
    onChange({
      ...profile,
      nationality,
      country: countryMirrorsNationality ? nationality : profile.country,
    });
  };

  // Country names in the guest's own language - the browser already knows
  // every one of them (Intl.DisplayNames), so the list reads in Thai for a
  // Thai-speaking guest without a translation table. Falls back to the
  // English name the server sent if the browser doesn't know a code.
  const countryOptions = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([language], { type: "region" });
    } catch {
      names = null;
    }
    return countries
      .map((c) => {
        let name = c.name;
        try {
          name = names?.of(c.code) || c.name;
        } catch {
          name = c.name;
        }
        return { code: c.code, name, english: c.name };
      })
      .sort((a, b) => a.name.localeCompare(b.name, language));
  }, [countries, language]);

  const countryName = (code: string) => countryOptions.find((c) => c.code === code)?.name || code;

  // What the "Use address" card shows, and copies in when tapped. Only the
  // parts MEWS actually has - a blank line is left out, not printed as ", ,".
  const ownerAddressText = ownerAddress
    ? [
        ownerAddress.address_line1,
        ownerAddress.address_line2,
        ownerAddress.city,
        ownerAddress.postal_code,
        ownerAddress.country ? countryName(ownerAddress.country) : "",
      ]
        .filter((part) => part && part.trim())
        .join(", ")
    : "";

  const docTypes: { value: DocumentType; label: string; icon: LucideIcon }[] = [
    { value: "passport", label: t.passport, icon: BookUser },
    { value: "identity_card", label: t.identityCard, icon: IdCard },
    { value: "drivers_license", label: t.driversLicense, icon: CarFront },
  ];
  const docTitle = docTypes.find((d) => d.value === profile.document_type)?.label || t.passport;

  return (
    <div className="flex flex-col gap-5">
      <Field label={t.firstName} required value={profile.first_name} onChange={set("first_name")} autoComplete="given-name" />
      <Field label={t.lastName} required value={profile.last_name} onChange={set("last_name")} autoComplete="family-name" />
      <CountryField label={t.nationality} required value={profile.nationality} onChange={setNationality} options={countryOptions} />
      <Field label={t.telephone} type="tel" value={profile.telephone} onChange={set("telephone")} autoComplete="tel" />
      <Field label={t.occupation} value={profile.occupation} onChange={set("occupation")} />
      <Field label={t.email} type="email" value={email} onChange={onEmailChange} autoComplete="email" />

      <Section title={t.personalAddress} />
      {ownerAddressText && (
        // People travelling together usually share a home address, so the
        // owner's is offered as a one-tap fill - the same card MEWS shows.
        <div className="flex items-center gap-4 rounded-2xl bg-[var(--kiosk-surface-alt)] px-6 py-4">
          <p className="flex-1 text-lg leading-snug text-[var(--kiosk-text-secondary)]">{ownerAddressText}</p>
          <button
            type="button"
            onClick={() => onChange({ ...profile, ...ownerAddress! })}
            className="shrink-0 rounded-xl bg-[var(--kiosk-inverse-bg)] px-6 py-3 text-lg font-medium text-[var(--kiosk-inverse-text)] transition-colors hover:bg-[var(--kiosk-inverse-bg-hover)]"
          >
            {t.useAddress}
          </button>
        </div>
      )}
      <Field label={t.addressLine1} value={profile.address_line1} onChange={set("address_line1")} autoComplete="address-line1" />
      <Field label={t.addressLine2} value={profile.address_line2} onChange={set("address_line2")} autoComplete="address-line2" />
      <Field label={t.city} value={profile.city} onChange={set("city")} autoComplete="address-level2" />
      <Field label={t.postalCode} value={profile.postal_code} onChange={set("postal_code")} autoComplete="postal-code" />
      <CountryField label={t.country} required value={profile.country} onChange={set("country")} options={countryOptions} />

      <Section title={t.identityDocument} />
      <div>
        <p className="text-lg text-[var(--kiosk-text-muted)]">{t.documentType} *</p>
        <div className="mt-3 flex flex-wrap gap-3" role="radiogroup" aria-label={t.documentType}>
          {docTypes.map(({ value, label, icon: Icon }) => {
            const active = profile.document_type === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange({ ...profile, document_type: value })}
                className={`flex items-center gap-3 rounded-2xl px-6 py-4 text-lg transition-colors ${
                  active
                    ? "bg-[var(--kiosk-inverse-bg)] text-[var(--kiosk-inverse-text)]"
                    : "bg-[var(--kiosk-surface-alt)] text-[var(--kiosk-text)] hover:bg-[var(--kiosk-hover)]"
                }`}
              >
                <Icon size={24} strokeWidth={1.75} aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* The section is named after the document picked, as on MEWS's form.
          Only an identity card asks where it was issued as well. */}
      <Section title={docTitle} />
      <Field label={t.documentNumber} required value={profile.document_number} onChange={set("document_number")} />
      <Field label={t.issueDate} type="date" value={profile.issue_date} onChange={set("issue_date")} />
      <CountryField label={t.issuingCountry} value={profile.issuing_country} onChange={set("issuing_country")} options={countryOptions} />
      {profile.document_type === "identity_card" && (
        <Field label={t.issuingCity} value={profile.issuing_city} onChange={set("issuing_city")} />
      )}
      <Field label={t.expirationDate} type="date" value={profile.expiration_date} onChange={set("expiration_date")} />
    </div>
  );
}
