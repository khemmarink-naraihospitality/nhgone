"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";

interface RevenueSettings {
  pin_set: boolean;
}

export default function RevenueSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pinSet, setPinSet] = useState(false);
  const [pin, setPin] = useState("");

  // Hardcoded same-origin path, deliberately NOT NEXT_PUBLIC_API_URL: that env
  // var points at a stale API deployment lacking newer endpoints/behavior
  // (see admin/users' identical fix).
  const apiUrl = "/api";

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/admin/revenue-settings`);
      const result = await res.json();
      if (result.status === "success" && result.data) {
        const d: RevenueSettings = result.data;
        setPinSet(!!d.pin_set);
        setPin("");
      }
    } catch (err) {
      alert("Error loading Revenue settings: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async () => {
    if (pin && (!/^\d{4}$/.test(pin))) {
      alert("PIN must be exactly 4 digits");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/admin/revenue-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stop_sale_pin: pin }),
      });
      const result = await res.json();
      if (result.status === "success") {
        alert(pin ? "Stop-Sale PIN saved" : "No PIN entered - left unchanged");
        setPin("");
        fetchSettings();
      } else {
        alert("Error saving: " + (result.detail || result.message));
      }
    } catch (err) {
      alert("Error saving Revenue settings: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 bg-white min-h-screen text-slate-900 font-sans">
      <PageHeader
        title="Revenue Settings"
        description={'A 4-digit PIN required before anyone can edit the Stop-Sale threshold on the Revenue page’s Occupancy By Type Calendar - the % occupancy that flags a night as "stopped for travel agents". Defaults to 2026 until a real one is saved here.'}
      />

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#AAA024]"></div>
        </div>
      ) : (
        <div className="mt-8 max-w-2xl bg-slate-50 border border-slate-200 rounded-3xl p-8 shadow-sm">
          <div className="space-y-1.5 mb-8">
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Stop-Sale Threshold PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder={pinSet ? "Leave blank to keep current PIN" : "Leave blank to keep the default (2026)"}
              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
            <p className="text-[11px] text-slate-400 ml-1 pt-1">
              {pinSet
                ? "A custom PIN is currently set - it is never shown here, same as an SMTP or FTP password."
                : "No custom PIN has been saved yet - the Revenue page currently accepts the default, 2026."}
            </p>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-4 bg-[#AAA024] hover:bg-[#8f871e] text-white rounded-2xl font-bold shadow-xl shadow-[#AAA024]/20 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
