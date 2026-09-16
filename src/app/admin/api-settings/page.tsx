"use client";

import { useEffect, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import ImageCropDialog from "@/components/ImageCropDialog";
import PageHeader from "@/components/PageHeader";
import { PropertyAvatar } from "@/components/PropertySwitcher";
import { useSelectedProperty } from "@/lib/propertyContext";

interface PropertySetting {
  id: string;
  property_name: string;
  client_name: string;
  client_token: string;
  access_token: string;
  st_property_code: string | null;
  // Comma-separated MEWS category types the ST report counts for this
  // property; null/blank falls back to Room,Bed.
  st_space_types?: string | null;
  // The property's real registered Thai name for RR4/TM30 filings; null/
  // blank falls back to the hardcoded name table server-side.
  rr4_property_thai_name?: string | null;
  // Branding shown in the property switcher (api/sql/property_images.sql).
  // Uploaded and removed through their own endpoint, never through Save.
  profile_image_url?: string | null;
  background_image_url?: string | null;
}

type ImageKind = "profile" | "background";

const IMAGE_FIELD: Record<ImageKind, "profile_image_url" | "background_image_url"> = {
  profile: "profile_image_url",
  background: "background_image_url",
};

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// The one part of this feature the app genuinely cannot do for itself: adding
// a column is DDL, PostgREST has no DDL, and the backend has no direct
// Postgres connection. (The bucket it *can* create - see
// _ensure_property_image_bucket.) So rather than naming a file in the repo
// that whoever is standing here would have to go and find, the error hands
// over the exact statement to paste.
const IMAGE_COLUMNS_SQL = `alter table public.property_api_settings
  add column if not exists profile_image_url text,
  add column if not exists background_image_url text;`;

function MissingColumnsHelp() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <pre className="overflow-x-auto rounded-lg border border-red-200 bg-white px-3 py-2 text-[11px] leading-relaxed text-slate-700">
        {IMAGE_COLUMNS_SQL}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(IMAGE_COLUMNS_SQL);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard blocked (insecure context, or denied) - the SQL is
              // on screen above and can still be selected by hand.
              setCopied(false);
            }
          }}
          className="rounded-lg border border-red-200 bg-white px-3 py-1 text-[11px] font-bold text-red-600 transition-all hover:bg-red-50"
        >
          {copied ? "Copied" : "Copy SQL"}
        </button>
        <span className="text-[11px] font-medium text-red-500">
          Run it once in Supabase &gt; SQL Editor, then upload again.
        </span>
      </div>
    </div>
  );
}

export default function ApiSettingsPage() {
  const [settings, setSettings] = useState<PropertySetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PropertySetting | null>(null);
  const [imageBusy, setImageBusy] = useState<ImageKind | null>(null);
  // Image problems and the delete confirmation are shown in the page, never
  // through alert()/confirm() - a native browser dialog here reads like the
  // app broke. Both are scoped to the property + kind they belong to so the
  // message appears next to the control that produced it.
  const [imageError, setImageError] = useState<{ id: string; kind: ImageKind; message: string } | null>(null);
  const [pendingImage, setPendingImage] = useState<{ id: string; kind: ImageKind; file: File } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; kind: ImageKind } | null>(null);
  // Whole-page problems (load/add/save/delete) - same rule as the image
  // errors above: shown in the page, never as a native browser dialog.
  const [pageError, setPageError] = useState<string | null>(null);
  // The property whose Delete is awaiting confirmation, in the row itself.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const { refreshProperties } = useSelectedProperty();

  const [isAdding, setIsAdding] = useState(false);
  const [newForm, setNewForm] = useState({
    property_name: "",
    client_name: "XPossible Hotel Connec",
    client_token: "",
    access_token: "",
    st_property_code: ""
  });

  const fetchSettings = async () => {
    setLoading(true);
    try {
      // Must go through the backend, not a direct Supabase query - client_name/
      // client_token/access_token are stored encrypted, and only the backend's
      // GET /admin/sync/properties decrypts them (encryption_service.decrypt_data).
      // Reading the raw ciphertext here and saving it back through the backend's
      // PUT (which encrypts unconditionally) double-encrypts it, corrupting the
      // real MEWS credentials - this broke 3 properties' live API access before
      // it was caught.
      const apiUrl = "/api";
      const response = await fetch(`${apiUrl}/admin/sync/properties`);
      const res = await response.json();
      if (res.status !== "success") throw new Error(res.detail || "Failed to load settings");
      setSettings(res.data || []);
    } catch (err: any) {
      console.error("Fetch error:", err);
      setPageError("Could not load settings: " + err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleEdit = (prop: PropertySetting) => {
    setEditingId(prop.id);
    setEditForm({ ...prop });
  };

  const handleAdd = async () => {
    setPageError(null);
    if (!newForm.property_name || !newForm.client_token || !newForm.access_token) {
      setPageError("Please fill in the property name, client token and access token.");
      return;
    }

    try {
      // Hardcoded same-origin path, deliberately NOT NEXT_PUBLIC_API_URL: that
      // env var points at a stale API deployment lacking newer endpoints/
      // behavior (see admin/users' identical fix).
      const apiUrl = "/api";
      const response = await fetch(`${apiUrl}/admin/sync/properties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newForm)
      });
      const res = await response.json();

      if (res.status === "success") {
        setSettings([...settings, res.data].sort((a, b) => a.property_name.localeCompare(b.property_name)));
        setIsAdding(false);
        setNewForm({ property_name: "", client_name: "XPossible Hotel Connec", client_token: "", access_token: "", st_property_code: "" });
        await refreshProperties();
      } else {
        setPageError("Could not add the property: " + res.detail);
      }
    } catch (err) {
      setPageError("Could not add the property: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleSave = async () => {
    if (!editForm) return;

    try {
      // Hardcoded same-origin path, deliberately NOT NEXT_PUBLIC_API_URL: that
      // env var points at a stale API deployment lacking newer endpoints/
      // behavior (see admin/users' identical fix).
      const apiUrl = "/api";
      const response = await fetch(`${apiUrl}/admin/sync/properties/${editForm.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_name: editForm.property_name,
          client_name: editForm.client_name,
          client_token: editForm.client_token,
          access_token: editForm.access_token,
          st_property_code: editForm.st_property_code,
          st_space_types: editForm.st_space_types || null,
          rr4_property_thai_name: editForm.rr4_property_thai_name || null
        })
      });
      const res = await response.json();

      if (res.status === "success") {
        setSettings(settings.map(s => s.id === editForm.id ? editForm : s));
        setEditingId(null);
        await refreshProperties();
      } else {
        setPageError("Could not save: " + res.detail);
      }
    } catch (err) {
      setPageError("Could not save: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Confirmed in the row before this is ever called - see confirmDeleteId.
  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    setPageError(null);
    try {
      // Hardcoded same-origin path, deliberately NOT NEXT_PUBLIC_API_URL: that
      // env var points at a stale API deployment lacking newer endpoints/
      // behavior (see admin/users' identical fix).
      const apiUrl = "/api";
      const response = await fetch(`${apiUrl}/admin/sync/properties/${id}`, {
        method: "DELETE"
      });
      const res = await response.json();
      if (res.status === "success") {
        setSettings(settings.filter(s => s.id !== id));
        await refreshProperties();
      }
    } catch (err) {
      setPageError("Could not delete the property: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Images take effect immediately - they go straight to the backend (which
  // writes to Storage with the service role) rather than waiting for Save, the
  // same way the profile page's photo does. Both copies of the row are updated
  // so a later Save of the other fields can't write a stale URL back.
  const applyImage = (id: string, kind: ImageKind, url: string | null) => {
    const field = IMAGE_FIELD[kind];
    setEditForm((f) => (f && f.id === id ? { ...f, [field]: url } : f));
    setSettings((list) => list.map((s) => (s.id === id ? { ...s, [field]: url } : s)));
  };

  // Picking a file only opens the cropper - nothing is uploaded until the
  // user has framed it and pressed Save, the way Google's account photo works.
  const chooseImage = (id: string, kind: ImageKind, file: File) => {
    setImageError(null);
    if (!IMAGE_ACCEPT.split(",").includes(file.type)) {
      setImageError({ id, kind, message: "Please choose a PNG, JPG, WebP or GIF image." });
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setImageError({ id, kind, message: "Image must be 5 MB or smaller." });
      return;
    }
    setPendingImage({ id, kind, file });
  };

  // Takes the cropped Blob the dialog produced, not the file that was picked,
  // so what is stored is exactly what was framed. FormData needs a filename
  // for FastAPI to read it as an upload at all.
  const uploadImage = async (id: string, kind: ImageKind, blob: Blob) => {
    setImageBusy(kind);
    setImageError(null);
    try {
      const body = new FormData();
      body.append("kind", kind);
      body.append("file", blob, `${kind}.${blob.type === "image/png" ? "png" : "jpg"}`);
      const response = await fetch(`/api/admin/sync/properties/${id}/image`, { method: "POST", body });
      const res = await response.json();
      if (!response.ok || res.status !== "success") throw new Error(res.detail || "Upload failed");
      applyImage(id, kind, res.data.url);
      setPendingImage(null);
      await refreshProperties();
    } catch (err) {
      // Close the cropper and report underneath it: an error stranded behind
      // a modal is an error nobody reads.
      setPendingImage(null);
      setImageError({ id, kind, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setImageBusy(null);
    }
  };

  const removeImage = async (id: string, kind: ImageKind) => {
    setConfirmRemove(null);
    setImageBusy(kind);
    setImageError(null);
    try {
      const response = await fetch(`/api/admin/sync/properties/${id}/image?kind=${kind}`, { method: "DELETE" });
      const res = await response.json();
      if (!response.ok || res.status !== "success") throw new Error(res.detail || "Remove failed");
      applyImage(id, kind, null);
      await refreshProperties();
    } catch (err) {
      setImageError({ id, kind, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setImageBusy(null);
    }
  };

  const imageButtons = (prop: PropertySetting, kind: ImageKind) => {
    const hasImage = !!prop[IMAGE_FIELD[kind]];
    const busy = imageBusy === kind;
    const error = imageError && imageError.id === prop.id && imageError.kind === kind ? imageError.message : null;
    const confirming = confirmRemove?.id === prop.id && confirmRemove.kind === kind;
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <label
            className={`inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition-all ${
              busy ? "cursor-wait opacity-60" : "cursor-pointer hover:bg-slate-50"
            }`}
          >
            <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
            {busy ? "Working…" : hasImage ? "Replace" : "Upload"}
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file) chooseImage(prop.id, kind, file);
              }}
            />
          </label>
          {hasImage && !confirming && (
            <button
              type="button"
              disabled={busy}
              onClick={() => { setImageError(null); setConfirmRemove({ id: prop.id, kind }); }}
              className="inline-flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 transition-all hover:bg-red-100 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Remove
            </button>
          )}
        </div>

        {confirming && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
            <span className="text-xs font-bold text-red-700">
              Remove the {kind === "profile" ? "profile image" : "background image"}?
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => removeImage(prop.id, kind)}
              className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white transition-all hover:bg-red-700 disabled:opacity-60"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(null)}
              className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-bold text-red-600 transition-all hover:bg-red-50"
            >
              Keep
            </button>
          </div>
        )}

        {error && (
          <div className="space-y-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
            <p className="text-xs font-bold text-red-600">{error}</p>
            {error.includes("property_images.sql") && <MissingColumnsHelp />}
          </div>
        )}
      </div>
    );
  };

  const asPropertyInfo = (prop: PropertySetting) => ({
    name: prop.property_name,
    profileImageUrl: prop.profile_image_url || null,
    backgroundImageUrl: prop.background_image_url || null,
  });

  return (
    <div className="p-8 bg-white min-h-screen text-slate-900">
      {/* A logo is square and masked round, the way it renders in the property
          switcher; a background is the wide banner behind the name there. */}
      {pendingImage && (
        <ImageCropDialog
          file={pendingImage.file}
          aspect={pendingImage.kind === "background" ? 3 : 1}
          shape={pendingImage.kind === "background" ? "rect" : "round"}
          title={pendingImage.kind === "background" ? "Adjust the background" : "Adjust the property logo"}
          outputWidth={pendingImage.kind === "background" ? 1600 : 512}
          busy={imageBusy !== null}
          onCancel={() => setPendingImage(null)}
          onConfirm={(blob) => uploadImage(pendingImage.id, pendingImage.kind, blob)}
        />
      )}
      <PageHeader
        title="API Settings"
        description="Configure MEWS API Credentials for each property"
      >
        <button
          onClick={() => setIsAdding(!isAdding)}
          className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${isAdding ? "bg-red-50 text-red-600 border border-red-200" : "bg-[#AAA024] text-white shadow-lg shadow-[#AAA024]/20"}`}
        >
          {isAdding ? "Cancel" : "Add New Property"}
        </button>
      </PageHeader>

      {pageError && (
        <div className="mb-8 flex items-start justify-between gap-4 rounded-2xl border border-red-100 bg-red-50 px-5 py-4">
          <p className="text-sm font-bold text-red-600">{pageError}</p>
          <button
            type="button"
            onClick={() => setPageError(null)}
            className="shrink-0 text-xs font-bold text-red-400 transition-colors hover:text-red-600"
          >
            Dismiss
          </button>
        </div>
      )}

      {isAdding && (
        <div className="mb-10 bg-slate-50 border border-slate-200 rounded-3xl p-8 animate-in slide-in-from-top-4 duration-300 shadow-sm">
           <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-800">
             <div className="w-2 h-6 bg-[#AAA024] rounded-full"></div>
             New Property Credentials
           </h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Property Name</label>
                <input
                  placeholder="e.g. Lub d Koh Samui"
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
                  value={newForm.property_name}
                  onChange={(e) => setNewForm({...newForm, property_name: e.target.value})}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Property Code</label>
                <input
                  placeholder="e.g. SM"
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
                  value={newForm.st_property_code}
                  onChange={(e) => setNewForm({...newForm, st_property_code: e.target.value})}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Client Name</label>
                <input
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
                  value={newForm.client_name}
                  onChange={(e) => setNewForm({...newForm, client_name: e.target.value})}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Client Token</label>
                <input
                  placeholder="Paste Client Token here..."
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
                  value={newForm.client_token}
                  onChange={(e) => setNewForm({...newForm, client_token: e.target.value})}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Access Token</label>
                <input
                  placeholder="Paste Access Token here..."
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
                  value={newForm.access_token}
                  onChange={(e) => setNewForm({...newForm, access_token: e.target.value})}
                />
              </div>
           </div>
           <button
             onClick={handleAdd}
             className="w-full py-4 bg-[#AAA024] hover:bg-[#8f871e] text-white rounded-2xl font-bold shadow-xl shadow-[#AAA024]/20 transition-all active:scale-[0.98]"
           >
             Save New Property
           </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#AAA024]"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {settings.map((prop) => (
            <div key={prop.id} className="bg-slate-50 border border-slate-200 rounded-3xl p-6 transition-all hover:bg-slate-100/50 shadow-sm">
              {editingId === prop.id && editForm ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-3">
                      <PropertyAvatar property={asPropertyInfo(editForm)} size={40} />
                      <h3 className="text-xl font-bold text-[#AAA024]">{prop.property_name}</h3>
                    </div>
                    <div className="flex gap-2">
                       <button onClick={handleSave} className="px-4 py-1.5 bg-[#AAA024] text-white rounded-lg text-sm font-bold shadow-md shadow-[#AAA024]/20">Save</button>
                       <button onClick={() => setEditingId(null)} className="px-4 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-bold">Cancel</button>
                    </div>
                  </div>

                  {/* Branding - what the property switcher at the top-right of
                      every page shows for this property. */}
                  <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6 rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="flex flex-col gap-3">
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Property Profile</label>
                      <div className="flex items-center gap-4">
                        <PropertyAvatar property={asPropertyInfo(editForm)} size={88} className="ring-4 ring-slate-100" />
                        {imageButtons(editForm, "profile")}
                      </div>
                      <span className="text-[10px] text-slate-400 px-1">Square logo, at least 200 × 200. PNG, JPG, WebP or GIF, up to 5 MB.</span>
                    </div>
                    <div className="flex flex-col gap-3 min-w-0">
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Property Background</label>
                      <div className="relative h-28 overflow-hidden rounded-xl bg-gradient-to-br from-[#152A00] via-[#2f4a0f] to-[#AAA024]">
                        {editForm.background_image_url && (
                          // eslint-disable-next-line @next/next/no-img-element -- arbitrary Supabase Storage URLs, not configured for next/image
                          <img src={editForm.background_image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
                        <div className="absolute inset-x-4 bottom-3 flex items-center gap-3">
                          <PropertyAvatar property={asPropertyInfo(editForm)} size={36} className="ring-2 ring-white/80" />
                          <span className="truncate text-[15px] font-bold text-white drop-shadow">{editForm.property_name}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {imageButtons(editForm, "background")}
                        <span className="text-[10px] text-slate-400 px-1">Wide photo, e.g. 1200 × 400 - shown behind the name when the switcher opens.</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Property Name</label>
                      <input
                        className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                        value={editForm?.property_name}
                        onChange={(e) => setEditForm({...editForm!, property_name: e.target.value})}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Property Code</label>
                      <input
                        placeholder="e.g. SM"
                        className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                        value={editForm?.st_property_code || ""}
                        onChange={(e) => setEditForm({...editForm!, st_property_code: e.target.value})}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Property Thai Name</label>
                      <input
                        placeholder="e.g. โรงแรมหลับดี สยาม"
                        className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                        value={editForm?.rr4_property_thai_name || ""}
                        onChange={(e) => setEditForm({...editForm!, rr4_property_thai_name: e.target.value})}
                      />
                      <span className="text-[10px] text-slate-400 px-1">The property&apos;s real registered Thai name, used on RR4/TM30 filings.</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Client Name</label>
                      <input
                        className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                        value={editForm?.client_name}
                        onChange={(e) => setEditForm({...editForm!, client_name: e.target.value})}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Client Token</label>
                      <input
                        className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                        value={editForm?.client_token}
                        onChange={(e) => setEditForm({...editForm!, client_token: e.target.value})}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">Access Token</label>
                      <input
                        className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                        value={editForm?.access_token}
                        onChange={(e) => setEditForm({...editForm!, access_token: e.target.value})}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-1">ST Space Types</label>
                      <input
                        placeholder="Room,Bed"
                        className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                        value={editForm?.st_space_types || ""}
                        onChange={(e) => setEditForm({...editForm!, st_space_types: e.target.value})}
                      />
                      <span className="text-[10px] text-slate-400 px-1">Must match this property&apos;s MEWS export &quot;Space types&quot; filter. Blank = Room,Bed.</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-4 min-w-0">
                    <PropertyAvatar property={asPropertyInfo(prop)} size={44} />
                    <div className="min-w-0">
                      <h3 className="text-xl font-bold mb-1 text-slate-800">{prop.property_name}</h3>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                         <span className="text-slate-500">Property Code: <span className={`font-mono ${prop.st_property_code ? "text-slate-700" : "text-red-500 italic"}`}>{prop.st_property_code || "not set"}</span></span>
                         <span className="text-slate-500">Client: <span className="text-slate-700">{prop.client_name}</span></span>
                         <span className="text-slate-500">Access Token: <span className="text-slate-700 font-mono italic">***{prop.access_token.slice(-6)}</span></span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(prop)}
                      className="px-6 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-bold border border-slate-200 transition-all shadow-sm"
                    >
                      Edit
                    </button>
                    {confirmDeleteId === prop.id ? (
                      /* Inline instead of a browser confirm() - and unlike the
                         native dialog, it names the property being deleted. */
                      <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2">
                        <span className="text-xs font-bold text-red-700">Delete {prop.property_name}?</span>
                        <button
                          onClick={() => handleDelete(prop.id)}
                          className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white transition-all hover:bg-red-700"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-bold text-red-600 transition-all hover:bg-red-50"
                        >
                          Keep
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setPageError(null); setConfirmDeleteId(prop.id); }}
                        className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl text-sm font-bold border border-red-100 transition-all shadow-sm"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
