"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";

const TOKENS: { name: string; description: string }[] = [
  { name: "HotelName", description: "Hotel name in Thai (on the card title line)" },
  { name: "FirstName", description: "Guest first name" },
  { name: "LastName", description: "Guest surname" },
  { name: "IdBoxes", description: "Thai ID card number as 13 digit boxes (pre-built HTML)" },
  { name: "IdentityCardNumber", description: "Thai ID card number as plain text" },
  { name: "AlienBook", description: "Alien registration book no." },
  { name: "PassportNumber", description: "Passport no." },
  { name: "Occupation", description: "Occupation (default นักธุรกิจ)" },
  { name: "NationalityName", description: "Nationality (Thai name)" },
  { name: "NationalityCode", description: "Nationality country code, e.g. GB" },
  { name: "AddressDetails", description: "Current address" },
  { name: "Telephone", description: "Telephone no." },
  { name: "Email", description: "Guest email" },
  { name: "Departure", description: "Place of departure (1.2, blank by default)" },
  { name: "Destination", description: "Next destination (2.2, blank by default)" },
  { name: "CheckIn", description: "Arrival date (DD/MM/YYYY)" },
  { name: "CheckInTime", description: "Arrival time (HH:MM)" },
  { name: "CheckOut", description: "Expected departure date" },
  { name: "CheckOutTime", description: "Expected departure time" },
  { name: "RoomNumber", description: "Room no." },
  { name: "GuestSign", description: "Guest full name (under the signature line)" },
  { name: "ReservationsNumber", description: "MEWS reservation/confirmation number" },
];

export default function Rr3TemplatesPage() {
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [html, setHtml] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "/api";

  useEffect(() => {
    const fetchProperties = async () => {
      const { data } = await supabase.from("property_api_settings").select("property_name").order("property_name");
      if (data && data.length > 0) {
        const names = data.map((p) => p.property_name);
        setProperties(names);
        setSelectedProperty(names[0]);
      }
    };
    fetchProperties();
  }, []);

  useEffect(() => {
    if (!selectedProperty) return;
    const fetchTemplate = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${apiUrl}/rr3/template?property_name=${encodeURIComponent(selectedProperty)}`);
        const result = await res.json();
        if (result.status === "success") {
          setHtml(result.data.html_template);
          setIsDefault(!!result.data.is_default);
        } else {
          alert("Error loading template: " + (result.detail || result.message));
        }
      } catch (err: any) {
        alert("Error loading template: " + err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchTemplate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProperty]);

  const handleSave = async () => {
    if (!selectedProperty || !html.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/rr3/template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_name: selectedProperty, html_template: html }),
      });
      const result = await res.json();
      if (result.status === "success") {
        alert("RR3 template saved");
        setIsDefault(false);
      } else {
        alert("Error saving: " + (result.detail || result.message));
      }
    } catch (err: any) {
      alert("Error saving template: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 bg-white min-h-screen text-slate-900 font-sans">
      <PageHeader
        title="RR3 Templates"
        description="Edit the printable HTML for the ร.ร.๓ Lodger Registration Card per property. The default matches the official Hotel Act form."
      />

      <div className="mt-8 max-w-6xl grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="bg-slate-50 border border-slate-200 rounded-3xl p-8 shadow-sm">
          <div className="space-y-1.5 mb-6 max-w-sm">
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Property</label>
            <select
              value={selectedProperty}
              onChange={(e) => setSelectedProperty(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
            >
              {properties.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {isDefault && !loading && (
            <div className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              This property has no saved RR3 template yet - showing the official-form default. Save to customize it for this property.
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#AAA024]"></div>
            </div>
          ) : (
            <>
              <textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                spellCheck={false}
                className="w-full h-[520px] bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 transition-all text-slate-900"
              />
              <button
                onClick={handleSave}
                disabled={saving}
                className="mt-6 w-full py-4 bg-[#AAA024] hover:bg-[#8f871e] text-white rounded-2xl font-bold shadow-xl shadow-[#AAA024]/20 transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Template"}
              </button>
            </>
          )}
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6 shadow-sm h-fit">
          <h3 className="text-sm font-bold text-slate-700 mb-1">Available Tokens</h3>
          <p className="text-xs text-slate-500 mb-4">
            Use <code className="bg-slate-200 px-1 rounded">{"<<TokenName>>"}</code> anywhere in the HTML - it&apos;s replaced with the guest&apos;s real data when printed. Include the <code className="bg-slate-200 px-1 rounded">{"<style>"}</code> block: it controls fonts, the A4 card frame, and page breaks.
          </p>
          <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {TOKENS.map((t) => (
              <div key={t.name} className="text-xs">
                <code className="bg-slate-200 px-1.5 py-0.5 rounded font-mono text-slate-800">{`<<${t.name}>>`}</code>
                <span className="text-slate-500 ml-2">{t.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
