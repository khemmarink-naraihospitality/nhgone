/**
 * The Check-in form's field list and rules - shared by the page that edits
 * them (Admin Console > Kiosks > Check In Form) and the kiosk screen that
 * obeys them (/kiosk/registration), so the two read one list and can never
 * disagree about which fields exist or what their defaults are.
 *
 * The backend applies the same rules when it saves a guest
 * (api/app/routers/checkin_form.py, KIOSK_PROFILE_FIELDS) - its copy of the
 * defaults for the fields the kiosk collects has to be kept in step with
 * FIELD_CATEGORIES below.
 *
 * FIELD-LIST FIDELITY: "General", "Documents" and "Verification" are copied
 * field-for-field from reference MEWS screenshots - which cells are locked
 * AND what MEWS's own default state is for the rest. "Address" was a
 * placeholder guess until 23-Sep-2026, when a real screenshot showed it has
 * no "Address line 2" field and lists its last three fields as Postal code,
 * Country, State/Province (not the alphabetical-ish guess this shipped
 * with) - both corrected below. "State / Province" itself is still
 * unverified as a field NAME; only its position and its neighbours are
 * confirmed.
 */

export type FieldState = "Default" | "Required" | "Optional" | "Hidden";
export type GuestType = "owner" | "other_adults" | "children";
/** What a field actually does on the kiosk - "Default" resolved away. */
export type EffectiveState = "Required" | "Optional" | "Hidden";

export const FIELD_STATES: FieldState[] = ["Default", "Required", "Optional", "Hidden"];

// The Documents tab isn't a fields x guest-type table like the others - MEWS's
// own screen for it is a single Type + Visibility choice. "Type" is which
// document(s) satisfy check-in: either the guest picks any one from a set
// ("Guest choose a document type") or one specific document is required
// ("Guest fills one of these documents"). Copied from a real MEWS screenshot.
export type CheckinDocumentType = "passport_id_license" | "passport_id" | "passport" | "id_card" | "driver_license";

export const DOCUMENT_TYPE_GROUPS: { label: string; options: { value: CheckinDocumentType; label: string }[] }[] = [
  {
    label: "Guest choose a document type",
    options: [
      { value: "passport_id_license", label: "Passport / ID card / Driver's license" },
      { value: "passport_id", label: "Passport / ID card" },
    ],
  },
  {
    label: "Guest fills one of these documents",
    options: [
      { value: "passport", label: "Passport" },
      { value: "id_card", label: "ID card" },
      { value: "driver_license", label: "Driver's license" },
    ],
  },
];

export const DEFAULT_DOCUMENT_TYPE: CheckinDocumentType = "passport_id_license";
// MEWS's own default: a property collects no identity document at the kiosk
// until it chooses to - see the data-protection note on the admin page.
export const DEFAULT_DOCUMENT_VISIBILITY: FieldState = "Hidden";

export interface FieldDef {
  key: string;
  label: string;
  /** A cell rendered as fixed text instead of a dropdown - MEWS locks a
   * handful of fields (Last name is always Required for everyone; "Relation
   * to other guests" is always Hidden for the reservation owner). */
  locked?: Partial<Record<GuestType, FieldState>>;
  lockedHint?: string;
  /** MEWS's own default for this field, used until a property saves its own
   * choice. Unset means MEWS has no particular default. */
  default?: FieldState;
  /** What "Default" RESOLVES TO on the kiosk for a field MEWS shows no
   * default for. Deliberately separate from `default`: the admin table must
   * keep showing the literal "Default" the reference screenshot shows, while
   * the terminal still has to decide something. Only set where the answer
   * isn't a judgement call - a lodger register with no given name is not a
   * registration card, whatever the dropdown says. */
  kioskDefault?: FieldState;
}

export interface Category {
  key: string;
  label: string;
  fields: FieldDef[];
}

export const FIELD_CATEGORIES: Category[] = [
  {
    key: "general",
    label: "General",
    fields: [
      { key: "first_name", label: "First name", kioskDefault: "Required" },
      {
        key: "last_name",
        label: "Last name",
        locked: { owner: "Required", other_adults: "Required", children: "Required" },
        lockedHint: "A lodger register needs every guest's name - this can't be turned off.",
      },
      { key: "second_last_name", label: "Second last name" },
      { key: "email", label: "Email" },
      // A ร.ร.๓ card is a signed document, so the terminal asks for one
      // unless a property says otherwise - but it IS a dropdown, and Hidden
      // here really does take the pad off the screen.
      { key: "signature", label: "Signature", kioskDefault: "Required" },
      { key: "sex", label: "Sex", default: "Required" },
      { key: "nationality", label: "Nationality", default: "Required" },
      { key: "telephone", label: "Telephone", default: "Optional" },
      { key: "date_of_birth", label: "Date of birth", default: "Required" },
      { key: "place_of_birth", label: "Place of birth", default: "Hidden" },
      { key: "occupation", label: "Occupation", default: "Hidden" },
      { key: "purpose_of_stay", label: "Purpose of stay", default: "Optional" },
      { key: "dietary_requirements", label: "Dietary requirements", default: "Hidden" },
      { key: "car_registration_number", label: "Car registration number", default: "Hidden" },
      {
        key: "relation_to_other_guests",
        label: "Relation to other guests",
        locked: { owner: "Hidden" },
        lockedHint: "The reservation owner has no one to be \"related to\" on their own card.",
      },
      { key: "country_of_birth", label: "Country of birth", default: "Hidden" },
    ],
  },
  {
    key: "address",
    label: "Address",
    fields: [
      { key: "address_line_1", label: "Address line 1" },
      // No Address line 2 - MEWS's own Check In Form has no such field
      // (confirmed against a real screenshot, 23-Sep-2026; the earlier list
      // here was a placeholder guess, never verified). A property that saved
      // an address_line_2.<guestType> value before this correction keeps it
      // in checkin_form_settings.fields harmlessly - it is simply unread now,
      // not deleted, so nothing needs a migration.
      { key: "city", label: "City" },
      // Order matches MEWS's own form: Postal code, then Country, then
      // State/Province - not alphabetical and not the placeholder order this
      // list shipped with originally.
      { key: "postal_code", label: "Postal code" },
      { key: "country", label: "Country" },
      { key: "state_province", label: "State / Province" },
    ],
  },
  {
    // No `fields`: Documents is a Type + Visibility pair, not a fields table.
    key: "documents",
    label: "Documents",
    fields: [],
  },
  {
    key: "verification",
    label: "Verification",
    fields: [
      { key: "verification_photo", label: "Verification photo", default: "Hidden" },
      { key: "id_photos", label: "ID photos", default: "Hidden" },
      { key: "id_verification", label: "ID verification", default: "Hidden" },
    ],
  },
];

/** checkin_form_settings.fields: `{category: {"<field>.<guestType>": state}}`,
 * plus `documents: {type, visibility}`. string rather than FieldState because
 * documents.type holds a CheckinDocumentType. */
export type FieldsValue = Record<string, Record<string, string>>;

/** What the admin table shows for a cell nobody has set: the locked value,
 * else MEWS's default, else the literal "Default" placeholder. */
export function defaultStateFor(field: FieldDef, guestType: GuestType): FieldState {
  return field.locked?.[guestType] ?? field.default ?? "Default";
}

function findField(categoryKey: string, fieldKey: string): FieldDef | undefined {
  const inCategory = FIELD_CATEGORIES.find((c) => c.key === categoryKey)?.fields.find((f) => f.key === fieldKey);
  if (inCategory) return inCategory;
  // DOCUMENT_FIELD_CATEGORIES is declared further down this file - safe to
  // reference here because this function only runs once the whole module
  // has finished evaluating, not at the point this line is written.
  const inDocumentCategory = DOCUMENT_FIELD_CATEGORIES.find(
    (c) => documentCategoryKey(c.kind) === categoryKey,
  )?.fields.find((f) => f.key === fieldKey);
  return inDocumentCategory;
}

const CONCRETE: EffectiveState[] = ["Required", "Optional", "Hidden"];

/**
 * What a field actually does on the kiosk for one guest type. A locked cell
 * wins; then the property's saved choice; then MEWS's default for the field;
 * then the kiosk's own reading of "Default" where one is recorded; and
 * anything still undecided is simply shown and optional. "Default" - whether
 * never set or picked explicitly from the dropdown - means "MEWS's default",
 * so it resolves the same way as unset.
 *
 * A field NOT in FIELD_CATEGORIES resolves to Optional rather than throwing:
 * a caller asking about something the table doesn't list is asking about a
 * field nobody can have configured, and a check-in must not fail over it.
 */
export function effectiveState(
  fields: FieldsValue,
  categoryKey: string,
  fieldKey: string,
  guestType: GuestType,
): EffectiveState {
  const field = findField(categoryKey, fieldKey);
  const locked = field?.locked?.[guestType];
  if (locked && locked !== "Default") return locked as EffectiveState;
  const saved = fields[categoryKey]?.[`${fieldKey}.${guestType}`] as EffectiveState | undefined;
  if (saved && CONCRETE.includes(saved)) return saved;
  for (const fallback of [field?.default, field?.kioskDefault]) {
    if (fallback && fallback !== "Default") return fallback as EffectiveState;
  }
  return "Optional";
}

/**
 * The `<category>.<field>` cells /kiosk/registration actually renders a
 * control for. Everything else in FIELD_CATEGORIES is stored and unread -
 * MEWS's own kiosk form asks a subset of its own configuration table too,
 * and there is no control on our terminal to ask the rest. The admin table
 * marks these rows, so nobody sets a field Required and then waits for it to
 * appear on a screen that has no box for it.
 *
 * The Documents category isn't a fields table and isn't listed here - its
 * Type/Visibility pair IS obeyed, through documentSettings().
 */
export const KIOSK_COLLECTED_FIELDS: string[] = [
  "general.first_name",
  "general.last_name",
  "general.nationality",
  "general.telephone",
  "general.occupation",
  "general.email",
  "general.signature",
  "address.address_line_1",
  "address.city",
  "address.postal_code",
  "address.country",
];

export function collectedAtKiosk(categoryKey: string, fieldKey: string): boolean {
  return KIOSK_COLLECTED_FIELDS.includes(`${categoryKey}.${fieldKey}`);
}

/** The kiosk's own document types - see GuestProfileForm. */
export type KioskDocumentType = "passport" | "identity_card" | "drivers_license";

export const DOCUMENTS_ALLOWED: Record<CheckinDocumentType, KioskDocumentType[]> = {
  passport_id_license: ["passport", "identity_card", "drivers_license"],
  passport_id: ["passport", "identity_card"],
  passport: ["passport"],
  id_card: ["identity_card"],
  driver_license: ["drivers_license"],
};

/**
 * Per-document-type field tables, shown under the Documents tab's Type +
 * Visibility row for whichever kinds the chosen Type actually allows
 * (DOCUMENTS_ALLOWED[type]) - MEWS shows one table per possible document,
 * not one shared table, because a passport asks different questions than a
 * driver's license.
 *
 * FIELD-LIST FIDELITY: Passport and ID card are copied field-for-field from
 * a real MEWS screenshot (23-Sep-2026), including the one locked cell each -
 * the document number is always Required for the reservation owner, the same
 * "a lodger register needs it" reasoning as General > Last name. Driver's
 * license appears in the same reference screenshot but wasn't part of this
 * pass: its Type/Visibility choice still works, and no per-field table
 * renders for it until someone verifies one.
 *
 * Nothing on /kiosk/registration reads these yet - the kiosk still asks for
 * a single "document number" governed by documentSettings().visibility
 * alone, the same configuration-surface-first order Check In Form itself
 * shipped in. collectedAtKiosk() correctly marks every row here "Not on the
 * kiosk" with no special-casing needed, since none of these keys are in
 * KIOSK_COLLECTED_FIELDS.
 */
export interface DocumentFieldCategory {
  kind: KioskDocumentType;
  label: string;
  fields: FieldDef[];
}

export const DOCUMENT_FIELD_CATEGORIES: DocumentFieldCategory[] = [
  {
    kind: "passport",
    label: "Passport",
    fields: [
      {
        key: "number",
        label: "Passport number",
        locked: { owner: "Required" },
        lockedHint: "A lodger register needs the reservation owner's passport number - this can't be turned off.",
        default: "Required",
      },
      { key: "issuing_country", label: "Issuing country", default: "Optional" },
      { key: "issuing_city", label: "Issuing city", default: "Hidden" },
      { key: "issue_date", label: "Issue date", default: "Optional" },
      { key: "expiration_date", label: "Expiration date", default: "Optional" },
    ],
  },
  {
    kind: "identity_card",
    label: "ID card",
    fields: [
      {
        key: "number",
        label: "Identity number",
        locked: { owner: "Required" },
        lockedHint: "A lodger register needs the reservation owner's ID number - this can't be turned off.",
        default: "Required",
      },
      { key: "issuing_country", label: "Issuing country", default: "Optional" },
      { key: "issuing_city", label: "Issuing city", default: "Optional" },
      { key: "issue_date", label: "Issue date", default: "Optional" },
      { key: "expiration_date", label: "Expiration date", default: "Optional" },
    ],
  },
];

/** The `fields` key one document kind's table saves under -
 * `documents_passport`, `documents_identity_card` - kept separate from the
 * plain `documents` key that holds the Type/Visibility pair, so the two
 * shapes (a flat {type, visibility} object vs a `${field}.${guestType}`
 * table) never collide inside the same object. */
export function documentCategoryKey(kind: KioskDocumentType): string {
  return `documents_${kind}`;
}

/**
 * The Documents tab resolved: whether an identity document is collected at
 * all (and whether it has to be), and which document types the guest may
 * give. Not per guest type - MEWS's own screen has no guest-type split here.
 */
export function documentSettings(fields: FieldsValue): { visibility: EffectiveState; allowed: KioskDocumentType[] } {
  const savedVisibility = fields.documents?.visibility as FieldState | undefined;
  const visibility =
    savedVisibility && CONCRETE.includes(savedVisibility as EffectiveState)
      ? (savedVisibility as EffectiveState)
      : (DEFAULT_DOCUMENT_VISIBILITY as EffectiveState);
  const savedType = fields.documents?.type as CheckinDocumentType | undefined;
  const allowed = DOCUMENTS_ALLOWED[savedType && savedType in DOCUMENTS_ALLOWED ? savedType : DEFAULT_DOCUMENT_TYPE];
  return { visibility, allowed };
}
