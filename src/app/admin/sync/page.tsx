"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";
import { format } from "date-fns";

interface PropertySyncSettings {
  id: string;
  property_name: string;
  sync_hour: number;
  sync_minute: number;
  sync_enabled: boolean;
  sync_reservations: boolean;
  sync_members: boolean;
  sync_payments: boolean;
  sync_bills: boolean;
  sync_resources: boolean;
  // ST Files' own independent schedule - always imports TODAY's Bangkok
  // date (not yesterday, unlike the 5 tables above), matching what the
  // manual Import To Data Mart button on /st-files fetches by default.
  st_files_sync_enabled: boolean;
  st_files_sync_hour: number | null;
  st_files_sync_minute: number | null;
  // This property's own To/Cc/Bcc for the ST Files daily email's "Split by
  // property" mode (Admin > Templates > ST Files Email) - unused while that
  // mode is off. Recipients (To) null/blank means this property is skipped
  // from the split send, same as a missing ST Property Code; Cc/Bcc are
  // optional either way.
  st_files_email_recipients: string | null;
  st_files_email_cc: string | null;
  st_files_email_bcc: string | null;
  // RR4/TM30's own independent schedule, separate again from ST Files above
  // - the two government filings can be captured on a different clock than
  // the occupancy report (or not at all). Imports YESTERDAY's date in the
  // property's own timezone, matching /rr4-tm30's manual default.
  rr4_tm30_sync_enabled: boolean;
  rr4_tm30_sync_hour: number | null;
  rr4_tm30_sync_minute: number | null;
  // RV Files' own independent schedule - the revenue journal can run on a
  // different clock than any of the other three (or not at all). Always
  // imports YESTERDAY's Bangkok date, same reasoning as RR4/TM30.
  rv_sync_enabled: boolean;
  rv_sync_hour: number | null;
  rv_sync_minute: number | null;
}

const SYNC_TABLE_OPTIONS: { key: keyof PropertySyncSettings; label: string }[] = [
  { key: "sync_reservations", label: "Reservations" },
  { key: "sync_members", label: "Members" },
  { key: "sync_payments", label: "Payments" },
  { key: "sync_bills", label: "Bills (+ Order Items)" },
  { key: "sync_resources", label: "Resources" },
];

interface RetrySettings {
  retry_count: number;
  retry_interval_minutes: number;
}

interface FtpSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  remote_path: string;
  enabled: boolean;
  upload_hour: number;
  upload_minute: number;
}

const emptyFtpSettings: FtpSettings = {
  host: "", port: 21, username: "", password: "", remote_path: "",
  enabled: false, upload_hour: 4, upload_minute: 0,
};

interface SyncLogRow {
  id: string;
  created_at: string;
  property: string | null;
  target_table: string;
  status: string;
  message: string;
  sync_type: string;
}

// Same tag palette as Admin > Activity Log, plus ST Files FTP - the action
// this History widget was built to surface in the first place (it used to
// be print()-only; see sync_service.py's _log_sync_row).
const HISTORY_TAG: Record<string, { label: string; cls: string }> = {
  "Reservations": { label: "RESERVATIONS", cls: "bg-indigo-50 text-indigo-600 border-indigo-100" },
  "Customers":    { label: "CUSTOMERS",    cls: "bg-violet-50 text-violet-600 border-violet-100" },
  "Payments":     { label: "PAYMENTS",     cls: "bg-amber-50 text-amber-600 border-amber-100" },
  "Bills":        { label: "BILLS",        cls: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  "Resources":    { label: "RESOURCES",    cls: "bg-sky-50 text-sky-600 border-sky-100" },
  "ST Files":     { label: "ST FILES",     cls: "bg-rose-50 text-rose-600 border-rose-100" },
  "ST Files FTP": { label: "ST FILES FTP", cls: "bg-cyan-50 text-cyan-600 border-cyan-100" },
  "RR4/TM30":     { label: "RR4/TM30",     cls: "bg-sky-50 text-sky-600 border-sky-100" },
  "RV Files":     { label: "RV FILES",     cls: "bg-orange-50 text-orange-600 border-orange-100" },
};

export default function AdminSyncPage() {
  const [properties, setProperties] = useState<PropertySyncSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProperty, setEditingProperty] = useState<PropertySyncSettings | null>(null);
  const [saving, setSaving] = useState(false);

  const [retrySettings, setRetrySettings] = useState<RetrySettings>({ retry_count: 2, retry_interval_minutes: 60 });
  const [retrySaving, setRetrySaving] = useState(false);

  const [ftpSettings, setFtpSettings] = useState<FtpSettings>(emptyFtpSettings);
  const [ftpPasswordSet, setFtpPasswordSet] = useState(false);
  const [ftpSaving, setFtpSaving] = useState(false);
  const [ftpTesting, setFtpTesting] = useState(false);

  const [historyLogs, setHistoryLogs] = useState<SyncLogRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Hardcoded same-origin path, deliberately NOT NEXT_PUBLIC_API_URL: that env
  // var points at a stale API deployment lacking newer endpoints/behavior
  // (see admin/users' identical fix).
  const apiUrl = "/api";

  const fetchProperties = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("property_api_settings")
        .select("id, property_name, sync_hour, sync_minute, sync_enabled, sync_reservations, sync_members, sync_payments, sync_bills, sync_resources, st_files_sync_enabled, st_files_sync_hour, st_files_sync_minute, st_files_email_recipients, st_files_email_cc, st_files_email_bcc, rr4_tm30_sync_enabled, rr4_tm30_sync_hour, rr4_tm30_sync_minute, rv_sync_enabled, rv_sync_hour, rv_sync_minute")
        .order("property_name");

      if (error) throw error;
      setProperties(data || []);
    } catch (err: unknown) {
      console.error("Failed to fetch sync settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRetrySettings = async () => {
    try {
      const res = await fetch(`${apiUrl}/admin/sync/retry-settings`);
      const result = await res.json();
      if (result.status === "success" && result.data) {
        setRetrySettings({
          retry_count: result.data.retry_count ?? 2,
          retry_interval_minutes: result.data.retry_interval_minutes ?? 60,
        });
      }
    } catch (err) {
      console.error("Failed to fetch retry settings:", err);
    }
  };

  const handleSaveRetrySettings = async () => {
    setRetrySaving(true);
    try {
      const res = await fetch(`${apiUrl}/admin/sync/retry-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retrySettings),
      });
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.detail || result.message);
    } catch (err: any) {
      alert("Error saving retry settings: " + err.message);
    } finally {
      setRetrySaving(false);
    }
  };

  const fetchFtpSettings = async () => {
    try {
      const res = await fetch(`${apiUrl}/admin/ftp-settings`);
      const result = await res.json();
      if (result.status === "success" && result.data) {
        const d = result.data;
        setFtpSettings({
          host: d.host || "",
          port: d.port ?? 21,
          username: d.username || "",
          password: "",
          remote_path: d.remote_path || "",
          enabled: !!d.enabled,
          upload_hour: d.upload_hour ?? 4,
          upload_minute: d.upload_minute ?? 0,
        });
        setFtpPasswordSet(!!d.password_set);
      }
    } catch (err) {
      console.error("Failed to fetch FTP settings:", err);
    }
  };

  const handleSaveFtpSettings = async () => {
    setFtpSaving(true);
    try {
      const res = await fetch(`${apiUrl}/admin/ftp-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ftpSettings),
      });
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.detail || result.message);
      setFtpSettings((s) => ({ ...s, password: "" }));
      await fetchFtpSettings();
    } catch (err: any) {
      alert("Error saving FTP settings: " + err.message);
    } finally {
      setFtpSaving(false);
    }
  };

  const handleFtpUploadTestNow = async () => {
    setFtpTesting(true);
    try {
      const res = await fetch(`${apiUrl}/admin/ftp-settings/upload-now`, { method: "POST" });
      const result = await res.json();
      if (result.status === "success") {
        const skippedNote = result.skipped?.length ? `\nSkipped: ${result.skipped.join("; ")}` : "";
        alert(`${result.message}\nIncluded: ${result.included.join(", ") || "none"}${skippedNote}`);
      } else {
        alert("Error uploading: " + (result.detail || result.message));
      }
    } catch (err: any) {
      alert("Error uploading: " + err.message);
    } finally {
      setFtpTesting(false);
    }
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from("sync_logs")
        .select("id, created_at, property, target_table, status, message, sync_type")
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      setHistoryLogs(data || []);
    } catch (err) {
      console.error("Failed to fetch sync history:", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchProperties();
    fetchRetrySettings();
    fetchFtpSettings();
    fetchHistory();

    // Live-updates as jobs run, matching Admin > Activity Log's own pattern -
    // useful here specifically because "Upload Test Now"/manual retries fire
    // from this same page, so the row they just created should appear
    // without a manual refresh.
    const subscription = supabase
      .channel("sync_page_history")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sync_logs" }, (payload) => {
        setHistoryLogs((current) => [payload.new as SyncLogRow, ...current].slice(0, 40));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  const handleToggleSync = async (prop: PropertySyncSettings) => {
    const newEnabled = !prop.sync_enabled;
    // Optimistic update
    setProperties(prev => prev.map(p => p.id === prop.id ? { ...p, sync_enabled: newEnabled } : p));
    
    const { error } = await supabase
      .from("property_api_settings")
      .update({ sync_enabled: newEnabled })
      .eq("id", prop.id);

    if (error) {
      console.error("Failed to toggle sync:", error);
      // Revert on error
      setProperties(prev => prev.map(p => p.id === prop.id ? { ...p, sync_enabled: prop.sync_enabled } : p));
      alert("Failed to update sync status");
    }
  };

  const handleSaveSettings = async () => {
    if (!editingProperty) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("property_api_settings")
        .update({
          sync_hour: editingProperty.sync_hour,
          sync_minute: editingProperty.sync_minute,
          sync_enabled: editingProperty.sync_enabled,
          sync_reservations: editingProperty.sync_reservations,
          sync_members: editingProperty.sync_members,
          sync_payments: editingProperty.sync_payments,
          sync_bills: editingProperty.sync_bills,
          sync_resources: editingProperty.sync_resources,
          st_files_sync_enabled: editingProperty.st_files_sync_enabled,
          st_files_sync_hour: editingProperty.st_files_sync_hour,
          st_files_sync_minute: editingProperty.st_files_sync_minute,
          st_files_email_recipients: editingProperty.st_files_email_recipients,
          st_files_email_cc: editingProperty.st_files_email_cc,
          st_files_email_bcc: editingProperty.st_files_email_bcc,
          rr4_tm30_sync_enabled: editingProperty.rr4_tm30_sync_enabled,
          rr4_tm30_sync_hour: editingProperty.rr4_tm30_sync_hour,
          rr4_tm30_sync_minute: editingProperty.rr4_tm30_sync_minute,
          rv_sync_enabled: editingProperty.rv_sync_enabled,
          rv_sync_hour: editingProperty.rv_sync_hour,
          rv_sync_minute: editingProperty.rv_sync_minute,
        })
        .eq("id", editingProperty.id);
      
      if (error) throw error;
      setProperties(prev => prev.map(p => p.id === editingProperty.id ? editingProperty : p));
      setEditingProperty(null);
    } catch (err) {
      console.error("Failed to save settings:", err);
      alert("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 bg-white min-h-screen text-slate-900 font-sans relative">
      <PageHeader 
        title="Auto Import Schedule" 
        description="Manage automated daily synchronization schedules for each property."
      >
        <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
           <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
           <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Scheduler Active (Asia/Bangkok)</span>
        </div>
      </PageHeader>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
           <h3 className="text-sm font-bold text-slate-700">Failed-Sync Retry Policy</h3>
           <p className="text-[11px] text-slate-400 mt-0.5">Applies to every property&apos;s Data Mart sync (Reservations/Customers/Payments/Bills/Resources) and ST Files sync, each checked against its own schedule. If still missing or errored after its scheduled run, it&apos;s retried this many times, this many minutes apart.</p>
        </div>
        <div className="p-5 flex items-center gap-6">
           <div className="flex flex-col items-center">
              <input
                type="number"
                min="0"
                max="6"
                className="w-16 bg-slate-50 border border-slate-200 rounded-xl text-center text-xl font-mono font-bold text-slate-800 py-2 outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                value={retrySettings.retry_count}
                onChange={(e) => setRetrySettings({ ...retrySettings, retry_count: parseInt(e.target.value) || 0 })}
              />
              <span className="text-[9px] font-bold text-slate-400 tracking-widest mt-1">RETRY COUNT</span>
           </div>
           <div className="flex flex-col items-center">
              <input
                type="number"
                min="5"
                max="720"
                step="5"
                className="w-20 bg-slate-50 border border-slate-200 rounded-xl text-center text-xl font-mono font-bold text-slate-800 py-2 outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                value={retrySettings.retry_interval_minutes}
                onChange={(e) => setRetrySettings({ ...retrySettings, retry_interval_minutes: parseInt(e.target.value) || 5 })}
              />
              <span className="text-[9px] font-bold text-slate-400 tracking-widest mt-1">MINUTES APART</span>
           </div>
           <div className="text-xs text-slate-400 flex-1">
              {retrySettings.retry_count === 0 ? (
                "Retries disabled - a failed table stays failed until the 09:00 daily catch-up."
              ) : (
                <>Fires at {Array.from({ length: retrySettings.retry_count }, (_, i) => `+${retrySettings.retry_interval_minutes * (i + 1)}m`).join(", ")} after each property&apos;s own scheduled sync time (checked every 5 min in production, so it lands on the nearest 5-minute mark).</>
              )}
           </div>
           <button
             onClick={handleSaveRetrySettings}
             disabled={retrySaving}
             className="px-5 py-2.5 bg-[#AAA024] text-white rounded-xl text-xs font-bold hover:bg-[#8f871e] transition-all disabled:opacity-50 shrink-0"
           >
             {retrySaving ? "Saving..." : "Save"}
           </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <div className="p-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
           <div>
              <h3 className="text-sm font-bold text-slate-700">ST Files FTP Upload</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">One shared FTP destination for every property&apos;s ST export CSV, on its own daily schedule (separate from the ST Files Email digest above).</p>
           </div>
           <button
             type="button"
             onClick={() => setFtpSettings({ ...ftpSettings, enabled: !ftpSettings.enabled })}
             className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0 ${ftpSettings.enabled ? 'bg-emerald-500' : 'bg-slate-200'}`}
           >
             <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ftpSettings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
           </button>
        </div>
        <div className="p-5">
           <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div className="md:col-span-2 space-y-1">
                 <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Host</label>
                 <input
                   type="text"
                   placeholder="ftp.example.com"
                   className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                   value={ftpSettings.host}
                   onChange={(e) => setFtpSettings({ ...ftpSettings, host: e.target.value })}
                 />
              </div>
              <div className="space-y-1">
                 <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Port</label>
                 <input
                   type="number"
                   className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                   value={ftpSettings.port}
                   onChange={(e) => setFtpSettings({ ...ftpSettings, port: parseInt(e.target.value) || 21 })}
                 />
              </div>
              <div className="space-y-1">
                 <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Upload Time (Bangkok)</label>
                 <input
                   type="time"
                   className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                   value={`${String(ftpSettings.upload_hour).padStart(2, "0")}:${String(ftpSettings.upload_minute).padStart(2, "0")}`}
                   onChange={(e) => {
                     const [h, m] = e.target.value.split(":").map(Number);
                     setFtpSettings({ ...ftpSettings, upload_hour: h || 0, upload_minute: m || 0 });
                   }}
                 />
              </div>
              <div className="space-y-1">
                 <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Username</label>
                 <input
                   type="text"
                   className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                   value={ftpSettings.username}
                   onChange={(e) => setFtpSettings({ ...ftpSettings, username: e.target.value })}
                 />
              </div>
              <div className="space-y-1">
                 <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">
                   Password {ftpPasswordSet && <span className="text-emerald-600 normal-case font-normal">(set - leave blank to keep)</span>}
                 </label>
                 <input
                   type="password"
                   placeholder={ftpPasswordSet ? "••••••••" : ""}
                   className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                   value={ftpSettings.password}
                   onChange={(e) => setFtpSettings({ ...ftpSettings, password: e.target.value })}
                 />
              </div>
              <div className="md:col-span-2 space-y-1">
                 <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Remote Path</label>
                 <input
                   type="text"
                   placeholder="/incoming/st-files (blank = root)"
                   className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#AAA024]/20"
                   value={ftpSettings.remote_path}
                   onChange={(e) => setFtpSettings({ ...ftpSettings, remote_path: e.target.value })}
                 />
              </div>
           </div>
           <div className="flex gap-3">
              <button
                onClick={handleSaveFtpSettings}
                disabled={ftpSaving}
                className="px-5 py-2.5 bg-[#AAA024] text-white rounded-xl text-xs font-bold hover:bg-[#8f871e] transition-all disabled:opacity-50"
              >
                {ftpSaving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={handleFtpUploadTestNow}
                disabled={ftpTesting}
                className="px-5 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
              >
                {ftpTesting ? "Uploading..." : "Upload Test Now"}
              </button>
           </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <div className="p-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
           <h3 className="text-sm font-bold text-slate-700">Property Settings</h3>
           <button
             onClick={fetchProperties}
             className="p-2 text-slate-400 hover:text-[#AAA024] transition-colors"
             title="Refresh"
           >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
           </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/30 border-b border-slate-100">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Property Name</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Data Mart Sync</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">ST Files Sync</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">RR4/TM30 Sync</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">RV Files Sync</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Auto-Sync</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="py-20 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#AAA024] mx-auto"></div></td></tr>
              ) : properties.length === 0 ? (
                <tr><td colSpan={6} className="py-20 text-center text-slate-400 text-sm">No properties configured. Add properties via API Setting first.</td></tr>
              ) : properties.map((prop) => (
                <tr key={prop.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-5">
                    <div className="text-sm font-bold text-slate-700">{prop.property_name}</div>
                    <div className="text-[10px] text-slate-400 font-medium">Daily incremental sync</div>
                  </td>
                  <td className="px-6 py-5 text-center">
                    <span className="bg-[#AAA024]/5 text-[#AAA024] px-3 py-1.5 rounded-lg text-sm font-mono font-bold border border-[#AAA024]/10">
                      {String(prop.sync_hour).padStart(2, '0')}:{String(prop.sync_minute).padStart(2, '0')}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-center">
                    {prop.st_files_sync_enabled ? (
                      <span className="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg text-sm font-mono font-bold border border-emerald-100">
                        {String(prop.st_files_sync_hour ?? 0).padStart(2, '0')}:{String(prop.st_files_sync_minute ?? 0).padStart(2, '0')}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-sm">Off</span>
                    )}
                  </td>
                  <td className="px-6 py-5 text-center">
                    {prop.rr4_tm30_sync_enabled ? (
                      <span className="bg-sky-50 text-sky-700 px-3 py-1.5 rounded-lg text-sm font-mono font-bold border border-sky-100">
                        {String(prop.rr4_tm30_sync_hour ?? 0).padStart(2, '0')}:{String(prop.rr4_tm30_sync_minute ?? 0).padStart(2, '0')}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-sm">Off</span>
                    )}
                  </td>
                  <td className="px-6 py-5 text-center">
                    {prop.rv_sync_enabled ? (
                      <span className="bg-orange-50 text-orange-700 px-3 py-1.5 rounded-lg text-sm font-mono font-bold border border-orange-100">
                        {String(prop.rv_sync_hour ?? 0).padStart(2, '0')}:{String(prop.rv_sync_minute ?? 0).padStart(2, '0')}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-sm">Off</span>
                    )}
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex justify-center">
                      <button 
                        onClick={() => handleToggleSync(prop)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${prop.sync_enabled ? 'bg-emerald-500' : 'bg-slate-200'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${prop.sync_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-5 text-center">
                    <button 
                      onClick={() => setEditingProperty(prop)}
                      className="px-4 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-200 transition-all border border-slate-200"
                    >
                      Edit Schedule
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <div className="p-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
           <div>
              <h3 className="text-sm font-bold text-slate-700">Recent Activity</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Latest 40 actions from every job on this page - Data Mart sync, ST Files sync, and ST Files FTP upload.</p>
           </div>
           <div className="flex items-center gap-2">
              <Link
                href="/admin/logs"
                className="px-3 py-1.5 text-[11px] font-bold text-slate-500 hover:text-[#AAA024] transition-colors"
              >
                View Full Activity Log →
              </Link>
              <button
                onClick={fetchHistory}
                className="p-2 text-slate-400 hover:text-[#AAA024] transition-colors"
                title="Refresh"
              >
                <svg className={`w-4 h-4 ${historyLoading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              </button>
           </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/30 border-b border-slate-100">
                <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Timestamp</th>
                <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Property</th>
                <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Action</th>
                <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Trigger</th>
                <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {historyLoading && historyLogs.length === 0 ? (
                <tr><td colSpan={6} className="py-16 text-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#AAA024] mx-auto"></div></td></tr>
              ) : historyLogs.length === 0 ? (
                <tr><td colSpan={6} className="py-16 text-center text-slate-400 text-sm">No activity recorded yet.</td></tr>
              ) : historyLogs.map((log) => {
                const tag = HISTORY_TAG[log.target_table] ?? { label: log.target_table.toUpperCase(), cls: "bg-slate-100 text-slate-500 border-slate-200" };
                return (
                  <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-3.5 whitespace-nowrap text-xs font-medium text-slate-700">
                      {format(new Date(log.created_at), "dd MMM, HH:mm:ss")}
                    </td>
                    <td className="px-6 py-3.5 whitespace-nowrap text-xs text-slate-600">{log.property || "-"}</td>
                    <td className="px-6 py-3.5 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${tag.cls}`}>{tag.label}</span>
                    </td>
                    <td className="px-6 py-3.5 whitespace-nowrap text-xs text-slate-400 capitalize">{log.sync_type}</td>
                    <td className="px-6 py-3.5 whitespace-nowrap">
                      {log.status === "success" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100">Success</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-600 border border-red-100">Error</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-xs text-slate-500 max-w-md truncate" title={log.message}>{log.message}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editingProperty && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
           <div className="bg-[#161616] rounded-[28px] w-full max-w-[480px] shadow-2xl overflow-hidden border border-white/10 animate-in fade-in zoom-in-95 duration-200">

              <div className="px-8 pt-7 pb-5 border-b border-white/5">
                 <div className="flex justify-between items-start">
                    <div>
                       <h2 className="text-xl font-bold text-white">Auto Import Schedule</h2>
                       <div className="inline-flex items-center gap-1.5 mt-2 bg-white/5 px-3 py-1 rounded-full border border-white/10">
                          <svg className="w-3 h-3 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          <span className="text-[12px] font-bold text-white/70">{editingProperty.property_name}</span>
                       </div>
                    </div>
                    <button onClick={() => setEditingProperty(null)} className="text-white/30 hover:text-white transition-colors -mt-1">
                       <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                 </div>
              </div>

              <div className="px-8 py-6 space-y-4 max-h-[70vh] overflow-y-auto">

                 {/* Data Mart card */}
                 <div className="rounded-2xl border border-[#AAA024]/20 bg-gradient-to-b from-[#AAA024]/[0.07] to-transparent overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4">
                       <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-[#AAA024]/15 flex items-center justify-center shrink-0">
                             <svg className="w-[18px] h-[18px] text-[#AAA024]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" /></svg>
                          </div>
                          <div className="min-w-0">
                             <div className="text-[13px] font-bold text-white">Data Mart Sync</div>
                             <div className="text-[10px] text-white/40 truncate">Reservations, Members, Payments, Bills, Resources</div>
                          </div>
                       </div>
                       <button
                         onClick={() => setEditingProperty({...editingProperty, sync_enabled: !editingProperty.sync_enabled})}
                         className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0 ${editingProperty.sync_enabled ? 'bg-emerald-500' : 'bg-white/10'}`}
                       >
                         <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editingProperty.sync_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                       </button>
                    </div>

                    <div className="px-5 pb-5">
                       <div className="flex items-center justify-center gap-3 bg-black/20 border border-white/5 rounded-xl py-3 mb-4">
                          <div className="flex flex-col items-center">
                             <input
                               type="number"
                               min="0"
                               max="23"
                               className="w-14 bg-transparent text-center text-2xl font-mono font-bold text-white outline-none"
                               value={editingProperty.sync_hour}
                               onChange={(e) => setEditingProperty({...editingProperty, sync_hour: parseInt(e.target.value) || 0})}
                             />
                             <span className="text-[9px] font-bold text-white/25 tracking-widest">HOUR</span>
                          </div>
                          <span className="text-2xl font-bold text-white/15 -mt-3">:</span>
                          <div className="flex flex-col items-center">
                             <input
                               type="number"
                               min="0"
                               max="59"
                               className="w-14 bg-transparent text-center text-2xl font-mono font-bold text-white outline-none"
                               value={editingProperty.sync_minute}
                               onChange={(e) => setEditingProperty({...editingProperty, sync_minute: parseInt(e.target.value) || 0})}
                             />
                             <span className="text-[9px] font-bold text-white/25 tracking-widest">MINUTE</span>
                          </div>
                          <span className="text-[10px] font-bold text-white/25 uppercase tracking-widest ml-1">Bangkok</span>
                       </div>

                       <div className="grid grid-cols-2 gap-2">
                          {SYNC_TABLE_OPTIONS.map((opt) => (
                            <label key={opt.key} className={`flex items-center gap-2 bg-white/[0.03] hover:bg-white/[0.06] px-3 py-2.5 rounded-lg border border-white/5 cursor-pointer transition-colors ${opt.key === "sync_resources" ? "col-span-2" : ""}`}>
                               <input
                                 type="checkbox"
                                 checked={editingProperty[opt.key] as boolean}
                                 onChange={(e) => setEditingProperty({ ...editingProperty, [opt.key]: e.target.checked })}
                                 className="accent-[#AAA024] w-3.5 h-3.5"
                               />
                               <span className="text-[12px] text-white/80">{opt.label}</span>
                            </label>
                          ))}
                       </div>
                    </div>
                 </div>

                 {/* ST Files card */}
                 <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.07] to-transparent overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4">
                       <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
                             <svg className="w-[18px] h-[18px] text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                          </div>
                          <div className="min-w-0">
                             <div className="text-[13px] font-bold text-white">ST Files Sync</div>
                             <div className="text-[10px] text-white/40 truncate">Today&apos;s occupancy report, same as manual &quot;Import To Data Mart&quot;</div>
                          </div>
                       </div>
                       <button
                         onClick={() => setEditingProperty({
                           ...editingProperty,
                           st_files_sync_enabled: !editingProperty.st_files_sync_enabled,
                           // Sensible default (05:00) the first time this is turned
                           // on for a property that's never had it configured.
                           st_files_sync_hour: editingProperty.st_files_sync_hour ?? 5,
                           st_files_sync_minute: editingProperty.st_files_sync_minute ?? 0,
                         })}
                         className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0 ${editingProperty.st_files_sync_enabled ? 'bg-emerald-500' : 'bg-white/10'}`}
                       >
                         <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editingProperty.st_files_sync_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                       </button>
                    </div>

                    <div className="px-5 pb-5">
                       <div className="flex items-center justify-center gap-3 bg-black/20 border border-white/5 rounded-xl py-3">
                          <div className="flex flex-col items-center">
                             <input
                               type="number"
                               min="0"
                               max="23"
                               className="w-14 bg-transparent text-center text-2xl font-mono font-bold text-white outline-none"
                               value={editingProperty.st_files_sync_hour ?? 5}
                               onChange={(e) => setEditingProperty({...editingProperty, st_files_sync_hour: parseInt(e.target.value) || 0})}
                             />
                             <span className="text-[9px] font-bold text-white/25 tracking-widest">HOUR</span>
                          </div>
                          <span className="text-2xl font-bold text-white/15 -mt-3">:</span>
                          <div className="flex flex-col items-center">
                             <input
                               type="number"
                               min="0"
                               max="59"
                               className="w-14 bg-transparent text-center text-2xl font-mono font-bold text-white outline-none"
                               value={editingProperty.st_files_sync_minute ?? 0}
                               onChange={(e) => setEditingProperty({...editingProperty, st_files_sync_minute: parseInt(e.target.value) || 0})}
                             />
                             <span className="text-[9px] font-bold text-white/25 tracking-widest">MINUTE</span>
                          </div>
                          <span className="text-[10px] font-bold text-white/25 uppercase tracking-widest ml-1">Bangkok</span>
                       </div>
                       <div className="mt-3 space-y-2.5">
                          <div className="space-y-1.5">
                             <label className="text-[9px] font-bold text-white/25 uppercase tracking-widest ml-1">To (comma-separated)</label>
                             <input
                               type="text"
                               placeholder="e.g. manager@lubd.com"
                               className="w-full bg-black/20 border border-white/5 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/20 outline-none focus:border-emerald-500/40"
                               value={editingProperty.st_files_email_recipients ?? ""}
                               onChange={(e) => setEditingProperty({...editingProperty, st_files_email_recipients: e.target.value})}
                             />
                          </div>
                          <div className="space-y-1.5">
                             <label className="text-[9px] font-bold text-white/25 uppercase tracking-widest ml-1">Cc (comma-separated)</label>
                             <input
                               type="text"
                               placeholder="optional"
                               className="w-full bg-black/20 border border-white/5 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/20 outline-none focus:border-emerald-500/40"
                               value={editingProperty.st_files_email_cc ?? ""}
                               onChange={(e) => setEditingProperty({...editingProperty, st_files_email_cc: e.target.value})}
                             />
                          </div>
                          <div className="space-y-1.5">
                             <label className="text-[9px] font-bold text-white/25 uppercase tracking-widest ml-1">Bcc (comma-separated)</label>
                             <input
                               type="text"
                               placeholder="optional"
                               className="w-full bg-black/20 border border-white/5 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/20 outline-none focus:border-emerald-500/40"
                               value={editingProperty.st_files_email_bcc ?? ""}
                               onChange={(e) => setEditingProperty({...editingProperty, st_files_email_bcc: e.target.value})}
                             />
                          </div>
                          <p className="text-[10px] text-white/25 ml-1">Only used when Admin &gt; Templates &gt; ST Files Email has &quot;Split by property&quot; turned on.</p>
                       </div>
                    </div>
                 </div>

                 {/* RR4/TM30 card */}
                 <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-b from-sky-500/[0.07] to-transparent overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4">
                       <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-sky-500/15 flex items-center justify-center shrink-0">
                             <svg className="w-[18px] h-[18px] text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                          </div>
                          <div className="min-w-0">
                             <div className="text-[13px] font-bold text-white">RR4 / TM30 Sync</div>
                             <div className="text-[10px] text-white/40 truncate">Yesterday&apos;s guest register + foreign-arrival filing</div>
                          </div>
                       </div>
                       <button
                         onClick={() => setEditingProperty({
                           ...editingProperty,
                           rr4_tm30_sync_enabled: !editingProperty.rr4_tm30_sync_enabled,
                           // Defaults to 02:00 the first time this is turned on -
                           // late enough that the previous day is fully closed out.
                           rr4_tm30_sync_hour: editingProperty.rr4_tm30_sync_hour ?? 2,
                           rr4_tm30_sync_minute: editingProperty.rr4_tm30_sync_minute ?? 0,
                         })}
                         className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0 ${editingProperty.rr4_tm30_sync_enabled ? 'bg-sky-500' : 'bg-white/10'}`}
                       >
                         <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editingProperty.rr4_tm30_sync_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                       </button>
                    </div>

                    <div className="px-5 pb-5">
                       <div className="flex items-center justify-center gap-3 bg-black/20 border border-white/5 rounded-xl py-3">
                          <div className="flex flex-col items-center">
                             <input
                               type="number"
                               min="0"
                               max="23"
                               className="w-14 bg-transparent text-center text-2xl font-mono font-bold text-white outline-none"
                               value={editingProperty.rr4_tm30_sync_hour ?? 2}
                               onChange={(e) => setEditingProperty({...editingProperty, rr4_tm30_sync_hour: parseInt(e.target.value) || 0})}
                             />
                             <span className="text-[9px] font-bold text-white/25 tracking-widest">HOUR</span>
                          </div>
                          <span className="text-2xl font-bold text-white/15 -mt-3">:</span>
                          <div className="flex flex-col items-center">
                             <input
                               type="number"
                               min="0"
                               max="59"
                               className="w-14 bg-transparent text-center text-2xl font-mono font-bold text-white outline-none"
                               value={editingProperty.rr4_tm30_sync_minute ?? 0}
                               onChange={(e) => setEditingProperty({...editingProperty, rr4_tm30_sync_minute: parseInt(e.target.value) || 0})}
                             />
                             <span className="text-[9px] font-bold text-white/25 tracking-widest">MINUTE</span>
                          </div>
                          <span className="text-[10px] font-bold text-white/25 uppercase tracking-widest ml-1">Bangkok</span>
                       </div>
                    </div>
                 </div>

                 {/* RV Files card */}
                 <div className="rounded-2xl border border-orange-500/20 bg-gradient-to-b from-orange-500/[0.07] to-transparent overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4">
                       <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-orange-500/15 flex items-center justify-center shrink-0">
                             <svg className="w-[18px] h-[18px] text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3v-6m-3 6v-9m12 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2z" /></svg>
                          </div>
                          <div className="min-w-0">
                             <div className="text-[13px] font-bold text-white">RV Files Sync</div>
                             <div className="text-[10px] text-white/40 truncate">Yesterday&apos;s revenue journal, same as manual &quot;Import To Data Mart&quot;</div>
                          </div>
                       </div>
                       <button
                         onClick={() => setEditingProperty({
                           ...editingProperty,
                           rv_sync_enabled: !editingProperty.rv_sync_enabled,
                           // Defaults to 02:00 the first time this is turned on -
                           // late enough that the previous day is fully closed out.
                           rv_sync_hour: editingProperty.rv_sync_hour ?? 2,
                           rv_sync_minute: editingProperty.rv_sync_minute ?? 0,
                         })}
                         className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0 ${editingProperty.rv_sync_enabled ? 'bg-orange-500' : 'bg-white/10'}`}
                       >
                         <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editingProperty.rv_sync_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                       </button>
                    </div>

                    <div className="px-5 pb-5">
                       <div className="flex items-center justify-center gap-3 bg-black/20 border border-white/5 rounded-xl py-3">
                          <div className="flex flex-col items-center">
                             <input
                               type="number"
                               min="0"
                               max="23"
                               className="w-14 bg-transparent text-center text-2xl font-mono font-bold text-white outline-none"
                               value={editingProperty.rv_sync_hour ?? 2}
                               onChange={(e) => setEditingProperty({...editingProperty, rv_sync_hour: parseInt(e.target.value) || 0})}
                             />
                             <span className="text-[9px] font-bold text-white/25 tracking-widest">HOUR</span>
                          </div>
                          <span className="text-2xl font-bold text-white/15 -mt-3">:</span>
                          <div className="flex flex-col items-center">
                             <input
                               type="number"
                               min="0"
                               max="59"
                               className="w-14 bg-transparent text-center text-2xl font-mono font-bold text-white outline-none"
                               value={editingProperty.rv_sync_minute ?? 0}
                               onChange={(e) => setEditingProperty({...editingProperty, rv_sync_minute: parseInt(e.target.value) || 0})}
                             />
                             <span className="text-[9px] font-bold text-white/25 tracking-widest">MINUTE</span>
                          </div>
                          <span className="text-[10px] font-bold text-white/25 uppercase tracking-widest ml-1">Bangkok</span>
                       </div>
                    </div>
                 </div>

              </div>

              <div className="px-8 py-6 border-t border-white/5 flex gap-3">
                 <button
                   onClick={handleSaveSettings}
                   disabled={saving}
                   className="flex-1 bg-[#AAA024] text-white rounded-xl py-3.5 text-sm font-extrabold shadow-xl shadow-[#AAA024]/20 hover:bg-[#8f871e] transition-all disabled:opacity-50"
                 >
                   {saving ? "Saving..." : "Save Schedule"}
                 </button>
                 <button
                   onClick={() => setEditingProperty(null)}
                   className="flex-1 bg-white/5 text-white/60 rounded-xl py-3.5 text-sm font-bold hover:bg-white/10 transition-all border border-white/5"
                 >
                   Cancel
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
