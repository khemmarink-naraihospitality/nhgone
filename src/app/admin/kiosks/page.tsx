"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, ImagePlus, Info, MonitorCog, Pipette, Plus, RotateCcw, Trash2 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useSelectedProperty } from "@/lib/propertyContext";
import { supabase } from "@/lib/supabase";
import {
  FALLBACK_ACCENT,
  dominantLogoColor,
  normalizeHex,
  readableTextOn,
} from "@/lib/kioskAccent";

/**
 * Admin Console > Kiosks - the back-office settings behind the /kiosk
 * check-in screens, laid out to read the same way as MEWS's own Kiosk
 * configuration form so the two can be compared side by side.
 *
 * Two deliberate departures from that form, both because pretending would be
 * worse than the gap:
 *
 * - **No "Add translation".** In MEWS that switches which language's copy you
 *   are editing. We store one set of texts, so the control would do nothing.
 *   The language the texts belong to is shown above each one instead.
 * - **Key cutter / Key issuing / Payment terminal are free text**, not
 *   dropdowns. There is no device registry here to populate a list from, and
 *   a dropdown would imply these are wired to hardware. Nothing reads them
 *   yet - they are recorded for when a terminal is actually installed.
 */

interface KioskImage {
  url: string;
  path: string;
}

interface Kiosk {
  id: string;
  property_name: string;
  name: string;
  theme: string;
  /** `#rrggbb`, or null meaning "use this property's logo colour". */
  accent_color: string | null;
  connector_integration: string;
  default_language: string;
  key_cutter: string | null;
  key_issuing: string | null;
  payment_method: string | null;
  payment_terminal: string | null;
  options_enabled: string[];
  checkin_grace_hours: number;
  checkin_grace_minutes: number;
  early_checkin_fee: string | null;
  checkout_grace_hours: number;
  checkout_grace_minutes: number;
  reservation_lookup: string;
  take_key_instructions: string | null;
  cut_key_instructions: string | null;
  thank_you_message: string | null;
  contact_instructions: string | null;
  checkout_instructions: string | null;
  cut_key_video_url: string | null;
  screen_saver_video_url: string | null;
  pin_code: string | null;
  images: KioskImage[];
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

const THEMES = ["Light", "Dark"];
// Matches the five languages the kiosk's own front-end selector offers
// (src/app/kiosk/i18n.ts) - keep the two lists in step, since this is what
// resolveDefaultLanguage() maps a kiosk's starting language from.
const LANGUAGES = [
  "English (United States)",
  "Thai (Thailand)",
  "Filipino (Philippines)",
  "Khmer (Cambodia)",
  "Japanese (Japan)",
];
const PAYMENT_METHODS = ["-", "Guest device", "Payment terminal", "No payment at check-in"];
const EARLY_CHECKIN_FEES = ["-", "Charge the property's early check-in rate", "Free"];
const RESERVATION_LOOKUPS = [
  "Last name and confirmation number",
  "Last name and arrival date",
  "Confirmation number only",
];
const KIOSK_OPTIONS = [
  { key: "Guests can remove other guests", hint: "A guest checking in for several people can drop one from the booking." },
  { key: "Staff mode", hint: "Front desk can run the same flow on the guest's behalf." },
  { key: "Skip upsell", hint: "Go straight from registration to payment." },
  { key: "Require signature", hint: "The registration card must be signed on screen." },
];

// The one thing this page cannot do for itself: creating a table is DDL, and
// this backend reaches Supabase only through PostgREST, which has none. So the
// error hands over the statement instead of naming a file to go and find.
const SETUP_SQL = `-- see api/sql/kiosk_settings.sql for the full file (RLS + bucket)
create table if not exists public.kiosk_settings (
  id uuid primary key default gen_random_uuid(),
  property_name text not null,
  name text not null,
  theme text not null default 'Light',
  connector_integration text not null default 'NHG Kiosk',
  default_language text not null default 'English (United States)',
  key_cutter text, key_issuing text,
  payment_method text, payment_terminal text,
  options_enabled text[] not null default '{}',
  checkin_grace_hours integer not null default 0,
  checkin_grace_minutes integer not null default 0,
  early_checkin_fee text,
  checkout_grace_hours integer not null default 0,
  checkout_grace_minutes integer not null default 0,
  reservation_lookup text not null default 'Last name and confirmation number',
  take_key_instructions text, cut_key_instructions text,
  thank_you_message text, contact_instructions text, checkout_instructions text,
  cut_key_video_url text, screen_saver_video_url text,
  pin_code text,
  images jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text
);
alter table public.kiosk_settings enable row level security;`;

const INPUT =
  "w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all";
const READONLY = "w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-400 font-mono";
const LABEL = "text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1";

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className={LABEL}>
        {label}
        {required && <span className="text-[#AAA024]"> *</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 font-medium ml-1 leading-relaxed">{hint}</p>}
    </div>
  );
}

function SetupHelp() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 space-y-2">
      <pre className="max-h-48 overflow-auto rounded-lg border border-red-200 bg-white px-3 py-2 text-[11px] leading-relaxed text-slate-700">
        {SETUP_SQL}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(SETUP_SQL);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard blocked - the SQL is on screen and can be selected.
              setCopied(false);
            }
          }}
          className="rounded-lg border border-red-200 bg-white px-3 py-1 text-[11px] font-bold text-red-600 transition-all hover:bg-red-50"
        >
          {copied ? "Copied" : "Copy SQL"}
        </button>
        <span className="text-[11px] font-medium text-red-500">
          Run it once in Supabase &gt; SQL Editor, then reload this page.
        </span>
      </div>
    </div>
  );
}

function stamp(at: string | null, by: string | null) {
  if (!at) return "-";
  const when = new Date(at);
  const text = Number.isNaN(when.getTime()) ? at : when.toLocaleString();
  return by ? `${text}  (${by})` : text;
}

export default function AdminKiosksPage() {
  const { selectedProperty } = useSelectedProperty();
  const [kiosks, setKiosks] = useState<Kiosk[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Kiosk | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [actor, setActor] = useState<string | null>(null);

  // Everything is reported in the page - no alert()/confirm() anywhere.
  const [pageError, setPageError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  // The colour read out of THIS property's logo - what a kiosk with no
  // colour of its own actually shows, so the field can present it as the
  // default rather than leaving the admin to guess what "empty" means.
  const [logoColor, setLogoColor] = useState<string | null>(null);

  const fail = (message: string) => {
    setPageError(message);
    setNeedsSetup(message.includes("kiosk_settings.sql"));
  };

  const fetchKiosks = useCallback(async (property: string) => {
    setLoading(true);
    try {
      // Hardcoded same-origin /api, deliberately NOT NEXT_PUBLIC_API_URL -
      // that points at a stale deployment without newer endpoints.
      const response = await fetch(`/api/kiosks?property_name=${encodeURIComponent(property)}`);
      const res = await response.json();
      if (!response.ok || res.status !== "success") throw new Error(res.detail || "Failed to load kiosks");
      setKiosks(res.data || []);
      setPageError(null);
      setNeedsSetup(false);
    } catch (err) {
      setKiosks([]);
      setPageError(err instanceof Error ? err.message : String(err));
      setNeedsSetup(String(err).includes("kiosk_settings.sql"));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!selectedProperty) return;
    setEditingId(null);
    setForm(null);
    void fetchKiosks(selectedProperty);
  }, [selectedProperty, fetchKiosks]);

  // Read the property's logo and pull its dominant colour out, so "Button
  // colour" can show what an unset kiosk will actually use. Only the two
  // image columns are selected: property_api_settings also holds the
  // encrypted MEWS tokens, and the switcher takes the same care.
  useEffect(() => {
    if (!selectedProperty) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("property_api_settings")
        .select("profile_image_url")
        .eq("property_name", selectedProperty)
        .limit(1);
      const url = data?.[0]?.profile_image_url;
      const color = url ? await dominantLogoColor(url) : null;
      if (!cancelled) setLogoColor(color);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProperty]);

  // Who to record in Created/Updated. The API layer has no session of its own,
  // so the name travels with the request rather than being inferred there.
  useEffect(() => {
    const loadActor = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
      setActor(data?.full_name || user.email || null);
    };
    void loadActor();
  }, []);

  const openEditor = (kiosk: Kiosk) => {
    setEditingId(kiosk.id);
    setForm({ ...kiosk, options_enabled: kiosk.options_enabled || [], images: kiosk.images || [] });
    setPageError(null);
    setSavedAt(null);
  };

  // Deliberately NOT gated behind a disabled button. A greyed-out primary
  // action with no explanation reads as "this page is broken" - it says
  // what's missing and puts the cursor where the fix goes.
  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setPageError("Give the kiosk a name first, then press Add Kiosk.");
      nameInputRef.current?.focus();
      return;
    }
    if (!selectedProperty) {
      setPageError("Pick a property from the switcher above first.");
      return;
    }
    setCreating(true);
    setPageError(null);
    try {
      const response = await fetch("/api/kiosks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_name: selectedProperty, name, actor }),
      });
      const res = await response.json();
      if (!response.ok || res.status !== "success") throw new Error(res.detail || "Failed to create kiosk");
      setNewName("");
      await fetchKiosks(selectedProperty);
      openEditor(res.data);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
    setCreating(false);
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setPageError(null);
    try {
      const { id, property_name, pin_code, images, created_at, created_by, updated_at, updated_by, connector_integration, ...editable } = form;
      // Intentionally not sent: the API owns them (pin/images/stamps) or they
      // are not editable here (property, connector).
      void property_name; void pin_code; void images; void created_at;
      void created_by; void updated_at; void updated_by; void connector_integration;

      const response = await fetch(`/api/kiosks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editable, actor }),
      });
      const res = await response.json();
      if (!response.ok || res.status !== "success") throw new Error(res.detail || "Failed to save");
      setForm({ ...res.data, options_enabled: res.data.options_enabled || [], images: res.data.images || [] });
      setKiosks((list) => list.map((k) => (k.id === id ? res.data : k)));
      setSavedAt(Date.now());
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    setPageError(null);
    try {
      const response = await fetch(`/api/kiosks/${id}`, { method: "DELETE" });
      const res = await response.json();
      if (!response.ok || res.status !== "success") throw new Error(res.detail || "Failed to delete");
      setEditingId(null);
      setForm(null);
      if (selectedProperty) await fetchKiosks(selectedProperty);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  };

  const uploadImage = async (blob: Blob) => {
    if (!form) return;
    setImageBusy(true);
    setPageError(null);
    try {
      const body = new FormData();
      body.append("file", blob, `kiosk.${blob.type === "image/png" ? "png" : "jpg"}`);
      if (actor) body.append("actor", actor);
      const response = await fetch(`/api/kiosks/${form.id}/image`, { method: "POST", body });
      const res = await response.json();
      if (!response.ok || res.status !== "success") throw new Error(res.detail || "Upload failed");
      setForm((f) => (f ? { ...f, images: res.data.images } : f));
      setPendingImage(null);
    } catch (err) {
      setPendingImage(null);
      fail(err instanceof Error ? err.message : String(err));
    }
    setImageBusy(false);
  };

  const removeImage = async (path: string) => {
    if (!form) return;
    setImageBusy(true);
    setPageError(null);
    try {
      const query = new URLSearchParams({ path, ...(actor ? { actor } : {}) });
      const response = await fetch(`/api/kiosks/${form.id}/image?${query}`, { method: "DELETE" });
      const res = await response.json();
      if (!response.ok || res.status !== "success") throw new Error(res.detail || "Remove failed");
      setForm((f) => (f ? { ...f, images: res.data.images } : f));
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
    setImageBusy(false);
  };

  const set = <K extends keyof Kiosk>(key: K, value: Kiosk[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  // The colour actually in force: this kiosk's own, else the property's logo
  // colour, else the built-in. Resolved exactly the way the kiosk resolves
  // it, so the swatch and the real button can't disagree.
  const effectiveAccent = normalizeHex(form?.accent_color) || logoColor || FALLBACK_ACCENT;

  // EyeDropper is Chromium-only. Read once on mount rather than during
  // render: it is a browser capability, and touching `window` while
  // rendering is a hydration mismatch waiting to happen.
  const [eyeDropperSupported, setEyeDropperSupported] = useState(false);
  useEffect(() => {
    setEyeDropperSupported(typeof window !== "undefined" && "EyeDropper" in window);
  }, []);

  const pickColorFromScreen = async () => {
    try {
      const Picker = (window as unknown as {
        EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
      }).EyeDropper;
      if (!Picker) return;
      const { sRGBHex } = await new Picker().open();
      const hex = normalizeHex(sRGBHex);
      if (hex) set("accent_color", hex);
    } catch {
      // The guest closed the picker with Escape - not a failure worth saying
      // anything about.
    }
  };

  const toggleOption = (option: string) =>
    setForm((f) =>
      f
        ? {
            ...f,
            options_enabled: f.options_enabled.includes(option)
              ? f.options_enabled.filter((o) => o !== option)
              : [...f.options_enabled, option],
          }
        : f
    );

  return (
    <div className="p-8 bg-white min-h-screen text-slate-900">
      {pendingImage && (
        <ImageCropDialog
          file={pendingImage}
          aspect={16 / 9}
          shape="rect"
          title="Adjust the kiosk image"
          outputWidth={1600}
          busy={imageBusy}
          onCancel={() => setPendingImage(null)}
          onConfirm={uploadImage}
        />
      )}

      <PageHeader title="Kiosks" description="Configure the self-service check-in terminals for each property" />

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
          {needsSetup && <SetupHelp />}
        </div>
      )}

      {!selectedProperty ? (
        <p className="mt-10 text-sm font-medium text-slate-400">
          Pick a property from the switcher above to see its kiosks.
        </p>
      ) : (
        <div className="mt-10 space-y-8">
          {/* Kiosk list + create */}
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                <MonitorCog className="h-5 w-5 text-[#AAA024]" aria-hidden="true" />
                {selectedProperty}
              </h2>
              <div className="flex items-center gap-2">
                <input
                  ref={nameInputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
                  placeholder="New kiosk name, e.g. Lobby Kiosk (Open at 6AM)"
                  className="w-72 max-w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                />
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#AAA024] px-5 py-2 text-sm font-bold text-white shadow-lg shadow-[#AAA024]/20 transition-all hover:bg-[#8f871e] disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {creating ? "Adding…" : "Add Kiosk"}
                </button>
              </div>
            </div>

            {loading ? (
              <div className="py-10 text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-[#AAA024]" />
              </div>
            ) : kiosks.length === 0 ? (
              <p className="py-6 text-center text-sm font-medium text-slate-400">
                No kiosks configured for this property yet — type a name above and press Add Kiosk.
              </p>
            ) : (
              <div className="space-y-2">
                {kiosks.map((kiosk) => (
                  <button
                    key={kiosk.id}
                    type="button"
                    onClick={() => openEditor(kiosk)}
                    className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-5 py-4 text-left transition-all ${
                      editingId === kiosk.id
                        ? "border-[#AAA024] bg-white shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-800">{kiosk.name}</p>
                      <p className="mt-0.5 text-xs font-medium text-slate-400">
                        {kiosk.theme} · {kiosk.default_language}
                        {kiosk.pin_code ? ` · PIN ${kiosk.pin_code}` : ""}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Editor */}
          {form && (
            <div className="rounded-3xl border border-slate-200 p-8 shadow-sm">
              <div className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-6">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {form.property_name} / Kiosks
                  </p>
                  <h2 className="mt-1 text-2xl font-bold text-slate-900">{form.name}</h2>
                </div>
                {confirmDeleteId === form.id ? (
                  <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2">
                    <span className="text-xs font-bold text-red-700">Delete {form.name}?</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(form.id)}
                      className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white transition-all hover:bg-red-700"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-bold text-red-600 transition-all hover:bg-red-50"
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(form.id)}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-xs font-bold text-red-600 transition-all hover:bg-red-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Delete Kiosk
                  </button>
                )}
              </div>

              <div className="flex items-start gap-3 rounded-2xl border border-sky-100 bg-sky-50 px-5 py-4">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" aria-hidden="true" />
                <p className="text-xs font-medium leading-relaxed text-sky-900">
                  The check-in screens read the name, images, theme, default language, search fields, the three
                  guest-facing texts and the screen saver video from here. Theme and default language apply to
                  Welcome/Search/Confirm/Registration only — a guest can still switch languages themselves from
                  those screens&apos; own selector; eKYC onward stay dark and English until they get a reference
                  screenshot too. Grace periods, hardware and payment are stored but not yet applied — nothing
                  behind these screens talks to MEWS yet.
                </p>
              </div>

              <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
                {/* Left: the form */}
                <div className="space-y-6">
                  <Field label="Name" required>
                    <input className={INPUT} value={form.name} onChange={(e) => set("name", e.target.value)} />
                  </Field>

                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <Field label="Theme" required hint="Applies to Welcome/Search/Confirm/Registration; eKYC onward is still dark-only.">
                      <select className={INPUT} value={form.theme} onChange={(e) => set("theme", e.target.value)}>
                        {THEMES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </Field>
                    <Field label="Connector integration" required hint="Fixed - these screens are NHG's own, not MEWS Kiosk.">
                      <input className={READONLY} value={form.connector_integration} readOnly />
                    </Field>
                  </div>

                  <Field
                    label="Default language"
                    required
                    hint="The language the instruction texts below are written in, and what the terminal starts on - a guest can still switch it themselves."
                  >
                    <select
                      className={INPUT}
                      value={form.default_language}
                      onChange={(e) => set("default_language", e.target.value)}
                    >
                      {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
                    </select>
                  </Field>

                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                    <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Hardware — recorded only, nothing reads these yet
                    </p>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <Field label="Key cutter">
                        <input className={INPUT} placeholder="-" value={form.key_cutter || ""} onChange={(e) => set("key_cutter", e.target.value)} />
                      </Field>
                      <Field label="Key issuing">
                        <input className={INPUT} placeholder="-" value={form.key_issuing || ""} onChange={(e) => set("key_issuing", e.target.value)} />
                      </Field>
                      <Field label="Payment method">
                        <select className={INPUT} value={form.payment_method || "-"} onChange={(e) => set("payment_method", e.target.value)}>
                          {PAYMENT_METHODS.map((p) => <option key={p}>{p}</option>)}
                        </select>
                      </Field>
                      <Field label="Payment terminal">
                        <input className={INPUT} placeholder="-" value={form.payment_terminal || ""} onChange={(e) => set("payment_terminal", e.target.value)} />
                      </Field>
                    </div>
                  </div>

                  <Field label="Options enabled">
                    <div className="flex flex-wrap gap-2">
                      {KIOSK_OPTIONS.map((option) => {
                        const on = form.options_enabled.includes(option.key);
                        return (
                          <button
                            key={option.key}
                            type="button"
                            title={option.hint}
                            onClick={() => toggleOption(option.key)}
                            className={`rounded-full border px-4 py-1.5 text-xs font-bold transition-all ${
                              on
                                ? "border-[#AAA024] bg-[#AAA024]/10 text-[#7d7419]"
                                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                            }`}
                          >
                            {option.key}
                          </button>
                        );
                      })}
                    </div>
                  </Field>

                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <Field label="Check-in grace period" hint="How long after the scheduled time the kiosk still offers check-in.">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type="number" min={0} max={240}
                            className={INPUT}
                            value={form.checkin_grace_hours}
                            onChange={(e) => set("checkin_grace_hours", Number(e.target.value))}
                          />
                          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-widest text-slate-300">Hours</span>
                        </div>
                        <div className="relative flex-1">
                          <input
                            type="number" min={0} max={59}
                            className={INPUT}
                            value={form.checkin_grace_minutes}
                            onChange={(e) => set("checkin_grace_minutes", Number(e.target.value))}
                          />
                          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-widest text-slate-300">Min</span>
                        </div>
                      </div>
                    </Field>

                    <Field label="Check-out grace period">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type="number" min={0} max={240}
                            className={INPUT}
                            value={form.checkout_grace_hours}
                            onChange={(e) => set("checkout_grace_hours", Number(e.target.value))}
                          />
                          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-widest text-slate-300">Hours</span>
                        </div>
                        <div className="relative flex-1">
                          <input
                            type="number" min={0} max={59}
                            className={INPUT}
                            value={form.checkout_grace_minutes}
                            onChange={(e) => set("checkout_grace_minutes", Number(e.target.value))}
                          />
                          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-widest text-slate-300">Min</span>
                        </div>
                      </div>
                    </Field>
                  </div>

                  <Field label="Early check-in fee">
                    <select className={INPUT} value={form.early_checkin_fee || "-"} onChange={(e) => set("early_checkin_fee", e.target.value)}>
                      {EARLY_CHECKIN_FEES.map((f) => <option key={f}>{f}</option>)}
                    </select>
                  </Field>

                  <Field label="Choose what guests need to find their reservation" required>
                    <select className={INPUT} value={form.reservation_lookup} onChange={(e) => set("reservation_lookup", e.target.value)}>
                      {RESERVATION_LOOKUPS.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </Field>

                  {([
                    ["take_key_instructions", "Take key instructions"],
                    ["cut_key_instructions", "Cut key instructions"],
                    ["thank_you_message", "Thank you message"],
                    ["contact_instructions", "Contact instructions"],
                    ["checkout_instructions", "Instructions to check out"],
                  ] as const).map(([key, label]) => (
                    <Field key={key} label={label}>
                      <p className="mb-1.5 ml-1 text-[11px] font-bold text-slate-400">{form.default_language}</p>
                      <textarea
                        rows={3}
                        className={`${INPUT} resize-y`}
                        value={form[key] || ""}
                        onChange={(e) => set(key, e.target.value)}
                      />
                    </Field>
                  ))}

                  <Field label="Cut key video URL" hint="Played while the key is being cut.">
                    <input className={INPUT} value={form.cut_key_video_url || ""} onChange={(e) => set("cut_key_video_url", e.target.value)} placeholder="https://" />
                  </Field>

                  <Field label="Screen saver video URL" hint="Looped while the terminal is idle.">
                    <input className={INPUT} value={form.screen_saver_video_url || ""} onChange={(e) => set("screen_saver_video_url", e.target.value)} placeholder="https://" />
                  </Field>

                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                    <Field label="PIN code" hint="Unlocks the settings screen on the terminal.">
                      <input className={READONLY} value={form.pin_code || "-"} readOnly />
                    </Field>
                    <Field label="Created">
                      <input className={READONLY} value={stamp(form.created_at, form.created_by)} readOnly />
                    </Field>
                    <Field label="Updated">
                      <input className={READONLY} value={stamp(form.updated_at, form.updated_by)} readOnly />
                    </Field>
                  </div>

                  <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-6">
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

                {/* Right: images, then the button colour */}
                <div className="space-y-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Images</p>

                  {form.images.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-xs font-medium text-slate-400">
                      No images yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {form.images.map((image) => (
                        <div key={image.path} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={image.url} alt="" className="h-16 w-24 shrink-0 rounded-lg object-cover" />
                          <button
                            type="button"
                            disabled={imageBusy}
                            onClick={() => removeImage(image.path)}
                            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-[11px] font-bold text-red-600 transition-all hover:bg-red-100 disabled:opacity-60"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <label
                    className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 px-4 py-8 text-center transition-all ${
                      imageBusy ? "cursor-wait opacity-60" : "cursor-pointer hover:border-[#AAA024]/40 hover:bg-slate-50"
                    }`}
                  >
                    <ImagePlus className="h-6 w-6 text-slate-300" aria-hidden="true" />
                    <span className="text-xs font-bold text-slate-600">
                      {imageBusy ? "Working…" : "Click or drag an image here"}
                    </span>
                    <span className="text-[11px] font-medium text-slate-400">PNG, JPG, WebP or GIF, up to 5 MB</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="sr-only"
                      disabled={imageBusy}
                      onChange={(e) => {
                        const file = e.currentTarget.files?.[0];
                        e.currentTarget.value = "";
                        if (!file) return;
                        if (file.size > 5 * 1024 * 1024) {
                          fail("Image must be 5 MB or smaller.");
                          return;
                        }
                        setPendingImage(file);
                      }}
                    />
                  </label>

                  {/* Button colour. Sits under Images on purpose: its default
                      comes from the property's logo, so the two belong to the
                      same "how this terminal looks" corner of the form. */}
                  <div className="space-y-3 border-t border-slate-100 pt-5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Button colour</p>

                    <div className="flex items-center gap-2">
                      {/* The OS colour picker. type="color" only accepts
                          #rrggbb, so it is fed the resolved colour rather
                          than a possibly-empty stored one. */}
                      <label
                        className="relative h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-slate-200 shadow-sm"
                        style={{ background: effectiveAccent }}
                        title="Pick a colour"
                      >
                        <input
                          type="color"
                          value={effectiveAccent}
                          onChange={(e) => set("accent_color", e.target.value)}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        />
                      </label>

                      <input
                        className={`${INPUT} font-mono uppercase`}
                        placeholder={logoColor ? `${logoColor} (from logo)` : FALLBACK_ACCENT}
                        value={form.accent_color || ""}
                        onChange={(e) => set("accent_color", e.target.value)}
                        onBlur={(e) => set("accent_color", normalizeHex(e.target.value))}
                      />

                      {/* Eyedropper - Chromium only (no Safari, no iPad), so
                          it is rendered only where it actually works rather
                          than sitting there doing nothing. */}
                      {eyeDropperSupported && (
                        <button
                          type="button"
                          onClick={pickColorFromScreen}
                          title="Pick a colour from anywhere on screen"
                          aria-label="Pick a colour from anywhere on screen"
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-all hover:border-[#AAA024]/40 hover:text-slate-900"
                        >
                          <Pipette className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}

                      {form.accent_color && (
                        <button
                          type="button"
                          onClick={() => set("accent_color", null)}
                          title="Back to the logo colour"
                          aria-label="Back to the logo colour"
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-all hover:border-[#AAA024]/40 hover:text-slate-900"
                        >
                          <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    {/* What a guest will see, in the colour chosen - text
                        colour included, since that flips automatically on a
                        light background rather than staying white. */}
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div
                        className="w-full rounded-xl py-3 text-center text-sm font-semibold"
                        style={{ background: effectiveAccent, color: readableTextOn(effectiveAccent) }}
                      >
                        Check In
                      </div>
                    </div>

                    <p className="text-[11px] font-medium leading-relaxed text-slate-400">
                      {form.accent_color
                        ? "This kiosk uses the colour above."
                        : logoColor
                          ? "Empty, so this kiosk follows the property's logo colour - it changes by itself if the logo does."
                          : "Empty, and this property has no logo to read a colour from, so the kiosk's built-in colour is used."}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
