"use client";

import { useMemo } from "react";
import { BookUser, CarFront, IdCard, type LucideIcon } from "lucide-react";
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
  options: CountryOption[];
}) {
  return (
    <label className={BOX}>
      <span className={LABEL}>
        {label}
        {required && " *"}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${CONTROL} cursor-pointer appearance-none`}
      >
        <option value="" />
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
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
        return { code: c.code, name };
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
      <CountryField label={t.nationality} required value={profile.nationality} onChange={set("nationality")} options={countryOptions} />
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
