"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { BookUser, CarFront, Check, ChevronDown, IdCard, Search, X, type LucideIcon } from "lucide-react";
import { useKioskLanguage } from "../kioskLanguage";
import {
  documentSettings,
  effectiveState,
  type EffectiveState,
  type FieldsValue,
  type GuestType,
  type KioskDocumentType,
} from "@/lib/checkinFormFields";

/**
 * The full profile a guest ADDED AT THE TERMINAL fills in - the fields MEWS's
 * own kiosk asks for on its Add guest form, in the same order and sections
 * (checked against screenshots of it, 17-Sep-2026). A guest already on the
 * MEWS booking doesn't get this form: MEWS has their profile, so they only
 * confirm an email, accept the terms and sign.
 *
 * WHICH fields appear, and which are starred, is the property's own choice:
 * Admin Console > Kiosks > Check In Form, resolved through
 * `@/lib/checkinFormFields`. Hidden takes a field off the screen entirely,
 * Required stars it and blocks Next until it is filled, Optional does
 * neither. The same resolution runs again server-side in add_kiosk_guest, so
 * a field this screen never showed can't arrive filled in from anywhere else.
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

/**
 * Which cell of the Check In Form table governs each field on this form.
 * The two naming schemes differ (`address_line1` here, `address_line_1` in
 * the admin table, which copies MEWS's own label) - this is the one place
 * they are tied together, rather than each call site guessing.
 *
 * The identity-document fields aren't here: they are governed as a block by
 * the Documents tab's own Visibility, which has no per-field split.
 */
export const PROFILE_FIELD_SOURCE: Partial<Record<keyof GuestProfile, [string, string]>> = {
  first_name: ["general", "first_name"],
  last_name: ["general", "last_name"],
  nationality: ["general", "nationality"],
  telephone: ["general", "telephone"],
  occupation: ["general", "occupation"],
  address_line1: ["address", "address_line_1"],
  address_line2: ["address", "address_line_2"],
  city: ["address", "city"],
  postal_code: ["address", "postal_code"],
  country: ["address", "country"],
};

/** The fields of GuestProfile whose section is the Personal address one. */
const ADDRESS_FIELDS: (keyof GuestProfile)[] = [
  "address_line1",
  "address_line2",
  "city",
  "postal_code",
  "country",
];

/** The profile fields this property stars - mirrored server-side in
 * add_kiosk_guest, so the two can't disagree about what a saved guest needs.
 * Email is NOT here: the parent owns it (a MEWS guest fills only an email)
 * and checks it itself. */
export function requiredProfileFields(fields: FieldsValue, guestType: GuestType): (keyof GuestProfile)[] {
  const required = (Object.keys(PROFILE_FIELD_SOURCE) as (keyof GuestProfile)[]).filter((field) => {
    const [category, key] = PROFILE_FIELD_SOURCE[field]!;
    return effectiveState(fields, category, key, guestType) === "Required";
  });
  if (documentSettings(fields).visibility === "Required") required.push("document_number");
  return required;
}

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
  const searchRef = useRef<HTMLInputElement>(null);
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
    // Focus the search box on open, so a guest can start typing straight
    // away and iPad's on-screen keyboard rises without a second tap. A bare
    // focus() the instant the dialog mounts can miss the tap gesture on iOS
    // Safari (the keyboard needs the focus to still read as caused by the
    // tap), so it's done a frame later, once the input has actually
    // painted - still well inside that window in practice.
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
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
                  ref={searchRef}
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
  fields,
  guestType,
}: {
  profile: GuestProfile;
  onChange: (profile: GuestProfile) => void;
  email: string;
  onEmailChange: (email: string) => void;
  countries: CountryOption[];
  ownerAddress: OwnerAddress | null;
  /** checkin_form_settings.fields for this property - `{}` while it loads,
   * or if it never does, which resolves every field to MEWS's own default
   * rather than blocking a check-in on a settings fetch. */
  fields: FieldsValue;
  guestType: GuestType;
}) {
  const { t, language } = useKioskLanguage();
  const set = (field: keyof GuestProfile) => (value: string) => onChange({ ...profile, [field]: value });

  // What the property asked for, per field. `state` answers the whole
  // question - `show`/`star` are just the two readings of it this form needs.
  const state = (field: keyof GuestProfile): EffectiveState => {
    const source = PROFILE_FIELD_SOURCE[field];
    if (!source) return "Optional";
    return effectiveState(fields, source[0], source[1], guestType);
  };
  const show = (field: keyof GuestProfile) => state(field) !== "Hidden";
  const star = (field: keyof GuestProfile) => state(field) === "Required";

  const emailState = effectiveState(fields, "general", "email", guestType);
  // The heading and the owner's "Use address" card belong to the address
  // block - with every address field hidden there is no block for them to
  // head, so they go too rather than leaving a rule across an empty gap.
  const showAddress = ADDRESS_FIELDS.some(show);
  const documents = documentSettings(fields);

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

  // The card waits for Nationality to be filled in first, rather than
  // appearing the instant the form opens - it's a suggestion for THIS
  // guest's address, and offering it before anything about this guest is
  // known reads as if it were already theirs. A property that hides the
  // Nationality field entirely has nothing to wait for, so the card behaves
  // as before there.
  const readyForAddressSuggestion = !show("nationality") || !!profile.nationality.trim();

  // Only the document types the property accepts get a button - "Guest fills
  // one of these documents" in MEWS's own wording means exactly one.
  const docTypeMeta: Record<KioskDocumentType, { label: string; icon: LucideIcon }> = {
    passport: { label: t.passport, icon: BookUser },
    identity_card: { label: t.identityCard, icon: IdCard },
    drivers_license: { label: t.driversLicense, icon: CarFront },
  };
  const docTypes = documents.allowed.map((value) => ({ value, ...docTypeMeta[value] }));
  const activeDocType = documents.allowed.includes(profile.document_type)
    ? profile.document_type
    : documents.allowed[0];
  const docTitle = activeDocType ? docTypeMeta[activeDocType].label : t.passport;

  // A profile carrying a type the property no longer accepts (the setting
  // changed while a form was half filled) is corrected to the first one it
  // does, so what gets saved is what was on the screen rather than a type
  // with no button beside it.
  useEffect(() => {
    if (activeDocType && activeDocType !== profile.document_type) {
      onChange({ ...profile, document_type: activeDocType });
    }
  }, [activeDocType, profile, onChange]);

  return (
    <div className="flex flex-col gap-5">
      {show("first_name") && (
        <Field label={t.firstName} required={star("first_name")} value={profile.first_name} onChange={set("first_name")} autoComplete="given-name" />
      )}
      {show("last_name") && (
        <Field label={t.lastName} required={star("last_name")} value={profile.last_name} onChange={set("last_name")} autoComplete="family-name" />
      )}
      {show("nationality") && (
        <CountryField label={t.nationality} required={star("nationality")} value={profile.nationality} onChange={setNationality} options={countryOptions} />
      )}
      {show("telephone") && (
        <Field label={t.telephone} required={star("telephone")} type="tel" value={profile.telephone} onChange={set("telephone")} autoComplete="tel" />
      )}
      {show("occupation") && (
        <Field label={t.occupation} required={star("occupation")} value={profile.occupation} onChange={set("occupation")} />
      )}
      {emailState !== "Hidden" && (
        <Field label={t.email} required={emailState === "Required"} type="email" value={email} onChange={onEmailChange} autoComplete="email" />
      )}

      {showAddress && (
        <>
          <Section title={t.personalAddress} />
          {ownerAddressText && readyForAddressSuggestion && (
            // People travelling together usually share a home address, so the
            // owner's is offered as a one-tap fill - the same card MEWS shows.
            // Held back until Nationality is filled in - see
            // readyForAddressSuggestion above.
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
          {show("address_line1") && (
            <Field label={t.addressLine1} required={star("address_line1")} value={profile.address_line1} onChange={set("address_line1")} autoComplete="address-line1" />
          )}
          {show("address_line2") && (
            <Field label={t.addressLine2} required={star("address_line2")} value={profile.address_line2} onChange={set("address_line2")} autoComplete="address-line2" />
          )}
          {show("city") && (
            <Field label={t.city} required={star("city")} value={profile.city} onChange={set("city")} autoComplete="address-level2" />
          )}
          {show("postal_code") && (
            <Field label={t.postalCode} required={star("postal_code")} value={profile.postal_code} onChange={set("postal_code")} autoComplete="postal-code" />
          )}
          {show("country") && (
            <CountryField label={t.country} required={star("country")} value={profile.country} onChange={set("country")} options={countryOptions} />
          )}
        </>
      )}

      {/* The whole identity-document block is one Visibility setting - MEWS's
          own default is Hidden, i.e. a property collects no passport or ID at
          the terminal until it says it does. */}
      {documents.visibility !== "Hidden" && (
        <>
      <Section title={t.identityDocument} />
      <div>
        <p className="text-lg text-[var(--kiosk-text-muted)]">
          {t.documentType}
          {documents.visibility === "Required" && " *"}
        </p>
        <div className="mt-3 flex flex-wrap gap-3" role="radiogroup" aria-label={t.documentType}>
          {docTypes.map(({ value, label, icon: Icon }) => {
            const active = activeDocType === value;
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
      <Field
        label={t.documentNumber}
        required={documents.visibility === "Required"}
        value={profile.document_number}
        onChange={set("document_number")}
      />
      <Field label={t.issueDate} type="date" value={profile.issue_date} onChange={set("issue_date")} />
      <CountryField label={t.issuingCountry} value={profile.issuing_country} onChange={set("issuing_country")} options={countryOptions} />
      {activeDocType === "identity_card" && (
        <Field label={t.issuingCity} value={profile.issuing_city} onChange={set("issuing_city")} />
      )}
      <Field label={t.expirationDate} type="date" value={profile.expiration_date} onChange={set("expiration_date")} />
        </>
      )}
    </div>
  );
}
