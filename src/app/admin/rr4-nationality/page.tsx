"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";

// Same 4 columns as the "RR4-TM30-Chinatown-Gen" reference sheet's own
// RR4-Nationality tab, in the same order - MEWS Nationality is the country
// NAME (e.g. "Germany"), not an ISO code, matching how the original manual
// spreadsheet's VLOOKUP worked; see _resolve_rr4_nationality_codes in
// sync_service.py for how the backend joins a guest's alpha-2
// NationalityCode to this table via _RR3_COUNTRY_MAP.
interface NationalityRow {
  id: string;
  mews_nationality: string;
  thai_name: string;
  english_name: string;
  rr4_code: string;
}

const PAGE_SIZE = 20;

export default function Rr4NationalityPage() {
  const [rows, setRows] = useState<NationalityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [isAdding, setIsAdding] = useState(false);
  const [addingBusy, setAddingBusy] = useState(false);
  const [newForm, setNewForm] = useState({ mews_nationality: "", thai_name: "", english_name: "", rr4_code: "" });

  const [deletingRow, setDeletingRow] = useState<NationalityRow | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const fetchRows = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("rr4_nationality_codes")
      .select("id, mews_nationality, thai_name, english_name, rr4_code")
      .order("mews_nationality");
    if (error) {
      console.error("Failed to fetch rr4_nationality_codes:", error.message);
      alert("Error loading nationality codes: " + error.message);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    const run = async () => {
      await fetchRows();
    };
    run();
  }, []);

  const filtered = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      r.mews_nationality.toLowerCase().includes(q) ||
      r.english_name.toLowerCase().includes(q) ||
      r.thai_name.toLowerCase().includes(q) ||
      r.rr4_code.toLowerCase().includes(q)
    );
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Saves one field on blur (not per keystroke) - only if the value
  // actually changed, so tabbing through a row without editing it doesn't
  // fire a write. get_rr4_report reads this table fresh on every export, so
  // a save here is live immediately - no separate "publish" step.
  const handleFieldSave = async (row: NationalityRow, field: keyof Omit<NationalityRow, "id">, value: string) => {
    const trimmed = value.trim();
    if (row[field] === trimmed) return;
    setSavingId(row.id);
    const { error } = await supabase
      .from("rr4_nationality_codes")
      .update({ [field]: trimmed, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      alert("Save failed: " + error.message);
    } else {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [field]: trimmed } : r)));
    }
    setSavingId(null);
  };

  const handleAdd = async () => {
    const mewsNationality = newForm.mews_nationality.trim();
    if (!mewsNationality) {
      alert("MEWS Nationality is required (the country name exactly as it should match a guest's nationality, e.g. Germany).");
      return;
    }
    if (rows.some((r) => r.mews_nationality.toLowerCase() === mewsNationality.toLowerCase())) {
      alert(`"${mewsNationality}" already exists - edit that row instead of adding a duplicate.`);
      return;
    }
    setAddingBusy(true);
    const { data, error } = await supabase
      .from("rr4_nationality_codes")
      .insert({
        mews_nationality: mewsNationality,
        thai_name: newForm.thai_name.trim(),
        english_name: newForm.english_name.trim(),
        rr4_code: newForm.rr4_code.trim(),
      })
      .select("id, mews_nationality, thai_name, english_name, rr4_code")
      .single();
    if (error) {
      alert("Add failed: " + error.message);
    } else if (data) {
      setRows((prev) => [...prev, data].sort((a, b) => a.mews_nationality.localeCompare(b.mews_nationality)));
      setNewForm({ mews_nationality: "", thai_name: "", english_name: "", rr4_code: "" });
      setIsAdding(false);
    }
    setAddingBusy(false);
  };

  const handleDelete = async () => {
    if (!deletingRow) return;
    setDeletingBusy(true);
    const { error } = await supabase.from("rr4_nationality_codes").delete().eq("id", deletingRow.id);
    if (error) {
      alert("Delete failed: " + error.message);
    } else {
      setRows((prev) => prev.filter((r) => r.id !== deletingRow.id));
      setDeletingRow(null);
    }
    setDeletingBusy(false);
  };

  const cellInputCls =
    "w-full bg-transparent px-2 py-1.5 text-sm text-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 focus:bg-slate-50 transition-all";

  return (
    <div className="p-6 bg-white min-h-screen text-slate-900 font-sans relative">
      <PageHeader
        title="RR4-Nationality"
        description="MEWS Nationality -> Thai Hotel Act (ร.ร.๔) numeric code, used by every RR4 export. Edits apply immediately - no deploy needed."
      />

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <div className="p-4 flex flex-col md:flex-row gap-4 items-center justify-between border-b border-slate-100">
          <div className="relative w-full md:w-96">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              type="text"
              placeholder="Search MEWS Nationality, English or Thai name..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/10 transition-all font-medium text-slate-900"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={fetchRows}
              className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              Refresh
            </button>
            <button
              onClick={() => setIsAdding((o) => !o)}
              className="px-4 py-2 bg-[#AAA024] text-white rounded-xl text-xs font-bold hover:bg-[#8f871e] transition-all whitespace-nowrap"
            >
              + Add Nationality
            </button>
          </div>
        </div>

        {isAdding && (
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row gap-3 items-stretch md:items-end">
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">MEWS Nationality</label>
              <input
                type="text"
                placeholder="e.g. Germany"
                value={newForm.mews_nationality}
                onChange={(e) => setNewForm({ ...newForm, mews_nationality: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
              />
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">ชื่อสัญชาติ (ไทย)</label>
              <input
                type="text"
                placeholder="e.g. เยอรมัน"
                value={newForm.thai_name}
                onChange={(e) => setNewForm({ ...newForm, thai_name: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
              />
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">ชื่อสัญชาติ (อังกฤษ)</label>
              <input
                type="text"
                placeholder="e.g. GERMAN"
                value={newForm.english_name}
                onChange={(e) => setNewForm({ ...newForm, english_name: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
              />
            </div>
            <div className="w-full md:w-32 shrink-0">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">RR4-Nationality</label>
              <input
                type="text"
                placeholder="e.g. 4"
                value={newForm.rr4_code}
                onChange={(e) => setNewForm({ ...newForm, rr4_code: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20"
              />
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={handleAdd}
                disabled={addingBusy}
                className="px-4 py-2 bg-[#AAA024] text-white rounded-xl text-xs font-bold hover:bg-[#8f871e] transition-all disabled:opacity-50 whitespace-nowrap"
              >
                {addingBusy ? "Adding..." : "Save"}
              </button>
              <button
                onClick={() => setIsAdding(false)}
                className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all whitespace-nowrap"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="max-h-[65vh] overflow-y-auto overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="sticky top-0 z-10 bg-slate-50 px-4 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">MEWS Nationality</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">ชื่อสัญชาติ (ไทย)</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">ชื่อสัญชาติ (อังกฤษ)</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest w-32">RR4-Nationality</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-3 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={5} className="py-20 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#AAA024] mx-auto"></div></td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={5} className="py-20 text-center text-slate-400 text-sm">
                  {search ? `No nationality matches "${search}".` : "No nationality codes yet."}
                </td></tr>
              ) : pageRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-2">
                    <input
                      key={`${row.id}-mews-${row.mews_nationality}`}
                      type="text"
                      defaultValue={row.mews_nationality}
                      onBlur={(e) => handleFieldSave(row, "mews_nationality", e.target.value)}
                      className={`${cellInputCls} font-bold`}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      key={`${row.id}-th-${row.thai_name}`}
                      type="text"
                      defaultValue={row.thai_name}
                      onBlur={(e) => handleFieldSave(row, "thai_name", e.target.value)}
                      className={cellInputCls}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      key={`${row.id}-en-${row.english_name}`}
                      type="text"
                      defaultValue={row.english_name}
                      onBlur={(e) => handleFieldSave(row, "english_name", e.target.value)}
                      className={cellInputCls}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      key={`${row.id}-rr4-${row.rr4_code}`}
                      type="text"
                      defaultValue={row.rr4_code}
                      onBlur={(e) => handleFieldSave(row, "rr4_code", e.target.value)}
                      className={`${cellInputCls} font-bold`}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    {savingId === row.id ? (
                      <span className="text-[10px] font-bold text-slate-400">Saving...</span>
                    ) : (
                      <button
                        onClick={() => setDeletingRow(row)}
                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && filtered.length > PAGE_SIZE && (
          <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} - Page {currentPage} of {totalPages}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition-all"
              >
                PREVIOUS
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-4 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition-all"
              >
                NEXT
              </button>
            </div>
          </div>
        )}
      </div>

      {deletingRow && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-slate-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-[#AAA024]/10 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-[#AAA024]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">Delete Nationality</h2>
              <p className="text-sm text-slate-500 mb-6">
                Are you sure you want to delete <span className="font-bold text-slate-700">{deletingRow.mews_nationality}</span>? RR4 exports will fall back to the hardcoded default code for this nationality, if one exists.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleDelete}
                  disabled={deletingBusy}
                  className="flex-1 bg-red-500 text-white rounded-xl py-2.5 text-sm font-bold shadow-lg shadow-red-500/20 hover:bg-red-600 transition-all disabled:opacity-50"
                >
                  {deletingBusy ? "Deleting..." : "Delete"}
                </button>
                <button
                  onClick={() => setDeletingRow(null)}
                  className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5 text-sm font-bold hover:bg-slate-200 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
