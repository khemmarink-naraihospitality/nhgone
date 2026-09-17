"use client";

import { useCallback, useEffect, useState } from "react";
import { Info } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { useSelectedProperty } from "@/lib/propertyContext";
import { supabase } from "@/lib/supabase";

/**
 * Admin Console > Kiosks > Check In Form - which guest profile fields are
 * collected during self-service check-in, laid out to read the same way as
 * MEWS's own Check in form screen: a category of tabs, each a table of
 * fields x guest type (Reservation owner / Other adults / Children), each
 * cell one of Default / Required / Optional / Hidden.
 *
 * One config per PROPERTY, not per kiosk device (unlike Admin > Kiosks
 * itself) - guests fill out the same form regardless of which physical
 * terminal they use, so it follows the property switcher rather than a
 * kiosk picker.
 *
 * FIELD-LIST FIDELITY: "General" is copied field-for-field from the
 * reference MEWS screenshot this page was built against - which two cells
 * are locked (`locked`, rendered as fixed text) AND what MEWS's own default
 * state is for the rest (`default`, still an editable dropdown, just not
 * starting from the generic "Default" placeholder for a property that has
 * never saved its own choice). "Documents" is also verified against a real
 * screenshot, but is a different shape entirely - see the DocumentType note
 * below, not a fields x guest-type table. "Verification" is verified too -
 * three fields (Verification photo / ID photos / ID verification), each
 * defaulting to Hidden. Only "Address" below is NOT verified against a real
 * MEWS screen - nobody here has seen that tab - and is a reasonable
 * placeholder field list to be corrected once someone has. Kept in one place
 * (FIELD_CATEGORIES) so correcting it is an edit to a list, not a rewrite of
 * the page.
 *
 * Nothing reads this configuration yet: /kiosk/registration still uses its
 * own fixed field set. This is the configuration surface going in first,
 * the same order the Kiosks page itself shipped in.
 */

type FieldState = "Default" | "Required" | "Optional" | "Hidden";
type GuestType = "owner" | "other_adults" | "children";

const FIELD_STATES: FieldState[] = ["Default", "Required", "Optional", "Hidden"];

// The Documents tab isn't a fields x guest-type table like the others - MEWS's
// own screen for it is a single Type + Visibility choice, not per-field or
// per-guest-type. "Type" is which document(s) satisfy check-in: either the
// guest picks any one from a set ("Guest choose a document type") or a
// specific single document is required ("Guest fills one of these
// documents"). Copied field-for-field, including the grouping, from a real
// MEWS screenshot.
type DocumentType = "passport_id_license" | "passport_id" | "passport" | "id_card" | "driver_license";

const DOCUMENT_TYPE_GROUPS: { label: string; options: { value: DocumentType; label: string }[] }[] = [
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

const DEFAULT_DOCUMENT_TYPE: DocumentType = "passport_id_license";
const DEFAULT_DOCUMENT_VISIBILITY: FieldState = "Hidden";

interface FieldDef {
  key: string;
  label: string;
  /** A cell rendered as fixed text with an info tooltip instead of a
   * dropdown - MEWS locks a handful of fields this way (e.g. Last name is
   * always Required for everyone; "Relation to other guests" makes no sense
   * for the reservation owner and is always Hidden there). */
  locked?: Partial<Record<GuestType, FieldState>>;
  lockedHint?: string;
  /** The state shown (and used, until a property saves its own choice) for
   * every non-locked guest type before anyone has configured this property -
   * MEWS's own real default for that field, not the generic placeholder
   * "Default" every other field falls back to. Unset means MEWS itself has
   * no particular default for this field. */
  default?: FieldState;
}

interface Category {
  key: string;
  label: string;
  fields: FieldDef[];
}

// See the file-level note: only "general" is verified against a real MEWS
// screen. The rest are placeholders.
const FIELD_CATEGORIES: Category[] = [
  {
    key: "general",
    label: "General",
    fields: [
      { key: "first_name", label: "First name" },
      {
        key: "last_name",
        label: "Last name",
        locked: { owner: "Required", other_adults: "Required", children: "Required" },
        lockedHint: "A lodger register needs every guest's name - this can't be turned off.",
      },
      { key: "second_last_name", label: "Second last name" },
      { key: "email", label: "Email" },
      { key: "signature", label: "Signature" },
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
      { key: "address_line_2", label: "Address line 2" },
      { key: "city", label: "City" },
      { key: "state_province", label: "State / Province" },
      { key: "postal_code", label: "Postal code" },
      { key: "country", label: "Country" },
    ],
  },
  {
    // No `fields` here on purpose - see the DocumentType note above and
    // "Documents" rendering below, which is a Type + Visibility pair rather
    // than this shared fields-table layout.
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

const GUEST_TYPES: { key: GuestType; label: string; toggleable: boolean }[] = [
  { key: "owner", label: "Reservation owner", toggleable: false },
  { key: "other_adults", label: "Other adults", toggleable: true },
  { key: "children", label: "Children", toggleable: true },
];

// string, not FieldState: most categories only ever store a FieldState per
// cell, but Documents stores a DocumentType under its "type" key alongside a
// FieldState under "visibility" - see setDocumentField.
type FieldsValue = Record<string, Record<string, string>>;

interface CheckinFormSettings {
  id: string | null;
  property_name: string;
  fields: FieldsValue;
  other_adults_enabled: boolean;
  children_enabled: boolean;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

function defaultStateFor(field: FieldDef, guestType: GuestType): FieldState {
  return field.locked?.[guestType] ?? field.default ?? "Default";
}

function valueFor(settings: CheckinFormSettings, categoryKey: string, field: FieldDef, guestType: GuestType): FieldState {
  const locked = field.locked?.[guestType];
  if (locked) return locked;
  // Cast: this cell only ever holds a FieldState (fields x guest-type cells
  // never store a DocumentType) - the type is widened to string at the
  // FieldsValue level only because Documents' own two keys need to.
  return (settings.fields[categoryKey]?.[`${field.key}.${guestType}`] as FieldState | undefined)
    ?? defaultStateFor(field, guestType);
}

function stamp(at: string | null, by: string | null) {
  if (!at) return "Never saved";
  const when = new Date(at);
  const text = Number.isNaN(when.getTime()) ? at : when.toLocaleString();
  return by ? `${text}  (${by})` : text;
}

export default function CheckInFormPage() {
  const { selectedProperty } = useSelectedProperty();
  const [activeCategory, setActiveCategory] = useState(FIELD_CATEGORIES[0].key);
  const [settings, setSettings] = useState<CheckinFormSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [actor, setActor] = useState<string | null>(null);

  // Everything is reported in the page - no alert()/confirm() anywhere.
  const [pageError, setPageError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  const fail = (message: string) => {
    setPageError(message);
    setNeedsSetup(message.includes("checkin_form_settings.sql"));
  };

  const fetchSettings = useCallback(async (property: string) => {
    setLoading(true);
    try {
      // Hardcoded same-origin /api, deliberately NOT NEXT_PUBLIC_API_URL -
      // that points at a stale deployment without newer endpoints.
      const response = await fetch(`/api/checkin-form?property_name=${encodeURIComponent(property)}`);
      const res = await response.json();
      if (!response.ok || res.status !== "success") throw new Error(res.detail || "Failed to load the check-in form");
      setSettings(res.data);
      setPageError(null);
      setNeedsSetup(false);
    } catch (err) {
      setSettings(null);
      fail(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!selectedProperty) return;
    void fetchSettings(selectedProperty);
  }, [selectedProperty, fetchSettings]);

  useEffect(() => {
    const loadActor = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
      setActor(data?.full_name || user.email || null);
    };
    void loadActor();
  }, []);

  const setCell = (categoryKey: string, field: FieldDef, guestType: GuestType, value: FieldState) => {
    if (field.locked?.[guestType]) return; // Locked cells never change.
    setSettings((s) => {
      if (!s) return s;
      const category = { ...(s.fields[categoryKey] || {}) };
      category[`${field.key}.${guestType}`] = value;
      return { ...s, fields: { ...s.fields, [categoryKey]: category } };
    });
  };

  // Documents' Type/Visibility pair bypasses the field-x-guest-type storage
  // shape (`${key}.${guestType}`) other categories use - there is no guest
  // type here, so these two live under fields.documents as plain keys.
  const documentType = ((settings?.fields.documents?.type as DocumentType | undefined) || DEFAULT_DOCUMENT_TYPE);
  const documentVisibility = ((settings?.fields.documents?.visibility as FieldState | undefined) || DEFAULT_DOCUMENT_VISIBILITY);

  const setDocumentField = (key: "type" | "visibility", value: string) => {
    setSettings((s) => {
      if (!s) return s;
      const category = { ...(s.fields.documents || {}) };
      category[key] = value;
      return { ...s, fields: { ...s.fields, documents: category } };
    });
  };

  const toggleGuestType = (guestType: "other_adults" | "children") => {
    setSettings((s) =>
      s
        ? {
            ...s,
            other_adults_enabled: guestType === "other_adults" ? !s.other_adults_enabled : s.other_adults_enabled,
            children_enabled: guestType === "children" ? !s.children_enabled : s.children_enabled,
          }
        : s
    );
  };

  const handleSave = async () => {
    if (!settings || !selectedProperty) return;
    setSaving(true);
    setPageError(null);
    try {
      const response = await fetch(`/api/checkin-form?property_name=${encodeURIComponent(selectedProperty)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: settings.fields,
          other_adults_enabled: settings.other_adults_enabled,
          children_enabled: settings.children_enabled,
          actor,
        }),
      });
      const res = await response.json();
      if (!response.ok || res.status !== "success") throw new Error(res.detail || "Failed to save");
      setSettings(res.data);
      setSavedAt(Date.now());
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
    setSaving(false);
  };

  const category = FIELD_CATEGORIES.find((c) => c.key === activeCategory) || FIELD_CATEGORIES[0];

  return (
    <div className="p-8 bg-white min-h-screen text-slate-900">
      <PageHeader title="Check in form" description="Choose what information guests provide before check-in." />

      {pageError && (
        <div className="mt-8 rounded-2xl border border-red-100 bg-red-50 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm font-bold text-red-600">{pageError}</p>
            <button
              type="button"
              onClick={() => { setPageError(null); setNeedsSetup(false); }}
              className="shrink-0 text-xs font-bold text-red-400 transition-colors hover:text-red-600"
            >
              Dismiss
            </button>
          </div>
          {needsSetup && (
            <p className="mt-2 text-xs font-medium text-red-500">
              Run <code className="rounded bg-white px-1.5 py-0.5">api/sql/checkin_form_settings.sql</code> in the
              Supabase SQL Editor, then reload this page.
            </p>
          )}
        </div>
      )}

      {!selectedProperty ? (
        <p className="mt-10 text-sm font-medium text-slate-400">
          Pick a property from the switcher above to edit its check-in form.
        </p>
      ) : loading ? (
        <div className="mt-10 py-10 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-[#AAA024]" />
        </div>
      ) : settings ? (
        <div className="mt-8 space-y-6">
          <div className="flex items-start gap-3 rounded-2xl border border-sky-100 bg-sky-50 px-5 py-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" aria-hidden="true" />
            <p className="text-xs font-medium leading-relaxed text-sky-900">
              Enabling the collection of data categories is at your own discretion. Make sure you collect and
              process personal data in accordance with your local applicable data protection laws and regulations,
              and keep your privacy policy updated.
            </p>
          </div>

          {/* Tabs */}
          <div className="flex gap-6 border-b border-slate-200">
            {FIELD_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setActiveCategory(c.key)}
                className={`-mb-px border-b-2 px-1 pb-3 text-sm font-bold transition-all ${
                  c.key === activeCategory
                    ? "border-[#AAA024] text-slate-900"
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Documents: Type + Visibility, not the fields x guest-type table
              every other tab uses - see the DocumentType note up top. */}
          {category.key === "documents" ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[480px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="px-5 py-4 text-[11px] font-bold uppercase tracking-widest text-slate-400">Type</th>
                    <th className="px-5 py-4 text-[11px] font-bold uppercase tracking-widest text-slate-400">Visibility</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="px-5 py-3">
                      <select
                        value={documentType}
                        onChange={(e) => setDocumentField("type", e.target.value)}
                        className="w-full max-w-[320px] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                      >
                        {DOCUMENT_TYPE_GROUPS.map((group) => (
                          <optgroup key={group.label} label={group.label}>
                            {group.options.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </td>
                    <td className="px-5 py-3">
                      <select
                        value={documentVisibility}
                        onChange={(e) => setDocumentField("visibility", e.target.value)}
                        className="w-full max-w-[160px] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                      >
                        {FIELD_STATES.map((state) => (
                          <option key={state} value={state}>{state}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-5 py-4 text-[11px] font-bold uppercase tracking-widest text-slate-400">Field</th>
                  {GUEST_TYPES.map((gt) => {
                    const enabled = gt.key === "other_adults" ? settings.other_adults_enabled
                      : gt.key === "children" ? settings.children_enabled : true;
                    return (
                      <th key={gt.key} className="px-5 py-4 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                        <label className="inline-flex items-center gap-2">
                          {gt.toggleable && (
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={() => toggleGuestType(gt.key as "other_adults" | "children")}
                              className="h-4 w-4 rounded border-slate-300 text-[#AAA024] focus:ring-[#AAA024]/30"
                            />
                          )}
                          <span className={enabled ? "" : "text-slate-300"}>{gt.label}</span>
                        </label>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {category.fields.map((field) => (
                  <tr key={field.key}>
                    <td className="px-5 py-3 text-sm font-medium text-slate-700">{field.label}</td>
                    {GUEST_TYPES.map((gt) => {
                      const columnEnabled = gt.key === "other_adults" ? settings.other_adults_enabled
                        : gt.key === "children" ? settings.children_enabled : true;
                      const locked = field.locked?.[gt.key];

                      if (!columnEnabled) {
                        return (
                          <td key={gt.key} className="px-5 py-3 text-sm text-slate-300">—</td>
                        );
                      }
                      if (locked) {
                        return (
                          <td key={gt.key} className="px-5 py-3">
                            <span
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400"
                              title={field.lockedHint}
                            >
                              {locked}
                              <Info className="h-3.5 w-3.5" aria-hidden="true" />
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td key={gt.key} className="px-5 py-3">
                          <select
                            value={valueFor(settings, category.key, field, gt.key)}
                            onChange={(e) => setCell(category.key, field, gt.key, e.target.value as FieldState)}
                            className="w-full max-w-[160px] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                          >
                            {FIELD_STATES.map((state) => (
                              <option key={state} value={state}>{state}</option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-100 pt-6">
            <p className="text-xs font-medium text-slate-400">Last saved: {stamp(settings.updated_at, settings.updated_by)}</p>
            <div className="flex items-center gap-3">
              {savedAt && <span className="text-xs font-bold text-emerald-600">Saved</span>}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-xl bg-[#AAA024] px-8 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#AAA024]/20 transition-all hover:bg-[#8f871e] disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
