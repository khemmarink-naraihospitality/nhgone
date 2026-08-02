"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import PageHeader from "@/components/PageHeader";

interface SmtpSettings {
  host: string;
  port: number;
  username: string;
  from_email: string;
  from_name: string;
  use_tls: boolean;
  password_set: boolean;
}

const emptyForm = {
  host: "",
  port: 587,
  username: "",
  password: "",
  from_email: "",
  from_name: "",
  use_tls: true,
};

export default function SMTPPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [testEmail, setTestEmail] = useState("");
  const [testing, setTesting] = useState(false);

  // Hardcoded same-origin path, deliberately NOT NEXT_PUBLIC_API_URL: that env
  // var points at a stale API deployment lacking newer endpoints/behavior
  // (see admin/users' identical fix).
  const apiUrl = "/api";

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${apiUrl}/admin/smtp`);
      const result = await res.json();
      if (result.status === "success" && result.data) {
        const d: SmtpSettings = result.data;
        setForm({
          host: d.host || "",
          port: d.port || 587,
          username: d.username || "",
          password: "",
          from_email: d.from_email || "",
          from_name: d.from_name || "",
          use_tls: d.use_tls ?? true,
        });
        setPasswordSet(!!d.password_set);
      }
    } catch (err: any) {
      alert("Error loading SMTP settings: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!form.host || !form.from_email) {
      alert("Host and From Email are required");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`${apiUrl}/admin/smtp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await res.json();
      if (result.status === "success") {
        alert("SMTP settings saved");
        setForm((f) => ({ ...f, password: "" }));
        fetchSettings();
      } else {
        alert("Error saving: " + (result.detail || result.message));
      }
    } catch (err: any) {
      alert("Error saving SMTP settings: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testEmail) {
      alert("Enter an email address to send the test to");
      return;
    }
    setTesting(true);
    try {
      const res = await apiFetch(`${apiUrl}/admin/smtp/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_email: testEmail }),
      });
      const result = await res.json();
      if (result.status === "success") {
        alert(result.message);
      } else {
        alert("Test failed: " + (result.detail || result.message));
      }
    } catch (err: any) {
      alert("Test failed: " + err.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="p-8 bg-white min-h-screen text-slate-900 font-sans">
      <PageHeader
        title="Email SMTP"
        description="Configure the email server used to send system notifications (e.g. welcome emails for new users)."
      />

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#AAA024]"></div>
        </div>
      ) : (
        <div className="mt-8 max-w-2xl bg-slate-50 border border-slate-200 rounded-3xl p-8 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="space-y-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Host</label>
              <input
                placeholder="smtp.example.com"
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Port</label>
              <input
                type="number"
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Username</label>
              <input
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Password</label>
              <input
                type="password"
                placeholder={passwordSet ? "Leave blank to keep current password" : ""}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">From Email</label>
              <input
                placeholder="noreply@naraihospitality.com"
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
                value={form.from_email}
                onChange={(e) => setForm({ ...form, from_email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">From Name</label>
              <input
                placeholder="NHGOne"
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
                value={form.from_name}
                onChange={(e) => setForm({ ...form, from_name: e.target.value })}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 mb-8 ml-1">
            <input
              type="checkbox"
              checked={form.use_tls}
              onChange={(e) => setForm({ ...form, use_tls: e.target.checked })}
              className="w-4 h-4 rounded border-slate-300 text-[#AAA024] focus:ring-[#AAA024]"
            />
            <label className="text-sm font-bold text-slate-600">Use STARTTLS</label>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-4 bg-[#AAA024] hover:bg-[#8f871e] text-white rounded-2xl font-bold shadow-xl shadow-[#AAA024]/20 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save SMTP Settings"}
          </button>

          <div className="mt-10 pt-8 border-t border-slate-200">
            <h3 className="text-sm font-bold text-slate-700 mb-3">Send Test Email</h3>
            <div className="flex gap-3">
              <input
                type="email"
                placeholder="you@example.com"
                className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />
              <button
                onClick={handleTest}
                disabled={testing}
                className="px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all disabled:opacity-50 whitespace-nowrap"
              >
                {testing ? "Sending..." : "Send Test Email"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
