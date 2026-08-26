"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";

// Opened in its own tab by RR4/TM30's Files table (RR4 v > Edit), same as
// Preview - the register is 26 columns wide and wants the whole window,
// and the launching tab keeps its loaded report.
//
// Visual language is deliberately Admin > RR4-Nationality's (white/slate,
// rounded cards, edit-in-place cells saving on blur) rather than the main
// app's paper/green: this is the same kind of screen - a reference grid
// someone corrects a cell at a time - and it should feel like one.

interface EditColumn {
  key: string;
  label_th: string;
  // RR4 carries the export's own second header row of plain English field
  // keys (rowNo, dateCheckIn, ...); TM30 has no such row and repeats its key.
  field: string;
}

interface EditRow {
  // Stable identity (reservation id + guest id) - see get_rr4_report's own
  // note. Every write is addressed by this, never by the line number.
  _key?: string;
  // Which columns are no longer MEWS's own answer, stamped on by
  // sync_service.apply_rr4_tm30_overrides.
  _edited?: string[];
  row_no?: number;
  [k: string]: unknown;
}

const PAGE_SIZE = 20;

const KIND_LABEL: Record<string, { title: string; blurb: string }> = {
  rr4: {
    title: "Edit RR4",
    blurb:
      "ทะเบียนผู้เข้าพักในโรงแรม (ร.ร.๔) - correct a guest row before the file is filed. Edits apply immediately to Preview, Download and the daily email.",
  },
  tm30: {
    title: "Edit TM30",
    blurb:
      "แจ้งที่พักคนต่างด้าว (TM30) - correct a guest row before the file is filed. Edits apply immediately to Preview, Download and the daily email.",
  },
};

function Rr4Tm30EditContent() {
  const searchParams = useSearchParams();
  const kind = (searchParams.get("kind") || "rr4").toLowerCase();
  const propertyName = searchParams.get("property_name") || "";
  const date = searchParams.get("date") || "";

  const [columns, setColumns] = useState<EditColumn[]>([]);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [readmeOpen, setReadmeOpen] = useState(false);

  const [regenerating, setRegenerating] = useState(false);
  const [resettingRow, setResettingRow] = useState<EditRow | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const [userEmail, setUserEmail] = useState("");

  const meta = KIND_LABEL[kind] || KIND_LABEL.rr4;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || ""));
  }, []);

  const fetchAll = useCallback(async () => {
    if (!propertyName || !date) {
      setError("Missing property or date.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ property_name: propertyName, date });
      // Columns come from the backend on purpose - they're the very same
      // constants the .xlsx export is rendered from, so the editor can't
      // drift out of step with the filed form.
      const [colRes, rowRes] = await Promise.all([
        fetch(`/api/rr4/edit-columns?kind=${kind}`),
        fetch(`/api/${kind}/managed?${params.toString()}`),
      ]);
      const colResult = await colRes.json();
      const rowResult = await rowRes.json();
      if (colResult.status !== "success") throw new Error(colResult.detail || "Could not load columns.");
      if (rowResult.status !== "success") throw new Error(rowResult.detail || "Could not load the register.");
      if (!rowResult.data) {
        throw new Error(
          `No imported report for ${propertyName} on ${date}. Import it to Data Mart first - the editor corrects an already-generated register, it doesn't create one.`
        );
      }
      setColumns(colResult.data || []);
      setRows(rowResult.data.rows || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [kind, propertyName, date]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Saves one cell on blur (not per keystroke) and only when the value
  // actually changed, so tabbing across a row without editing it doesn't
  // write. The register is rebuilt from MEWS on every read with these laid
  // over it, so a save here is live immediately - no publish step, and no
  // need to re-run "Re-Generate Files".
  const handleCellSave = async (row: EditRow, columnKey: string, value: string) => {
    const current = row[columnKey] === undefined || row[columnKey] === null ? "" : String(row[columnKey]);
    if (current === value) return;
    if (!row._key) {
      alert(
        "This row was imported before per-row editing existed, so it has no stable identity to attach an edit to. Use “Re-Generate Files” on this date first."
      );
      return;
    }
    setSavingKey(row._key);
    try {
      const res = await fetch("/api/rr4/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_name: propertyName,
          date,
          kind,
          row_key: row._key,
          fields: { [columnKey]: value },
          user_email: userEmail,
        }),
      });
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.detail || "Save failed");
      setRows((prev) =>
        prev.map((r) =>
          r._key === row._key ? { ...r, [columnKey]: value, _edited: Object.keys(result.fields || {}).sort() } : r
        )
      );
    } catch (err) {
      alert("Save failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingKey(null);
    }
  };

  // Rows imported before per-row editing existed carry no _key, and a key is
  // what an edit is addressed by - so there is nothing to attach a
  // correction to until the day is rebuilt. Rebuilding is the same
  // sync-manual call the Files table's "Re-Generate Files" runs, offered
  // here so the fix is one click from where the problem is visible rather
  // than a trip back to the previous page.
  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch("/api/rr4/sync-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_name: propertyName, start_date: date, end_date: date }),
      });
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.detail || result.message || "Re-generate failed");
      if (result.errors?.length) throw new Error(`Re-generate finished with errors: ${result.errors.join("; ")}`);
      await fetchAll();
    } catch (err) {
      alert("Re-generate failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRegenerating(false);
    }
  };

  // Reverting needs no re-fetch from MEWS: rr4_tm30_sync still holds the
  // raw answer (the import stores it un-overridden on purpose), so dropping
  // the override row is enough - reload to pick the original values back up.
  const handleReset = async (rowKey?: string) => {
    setResetBusy(true);
    try {
      const params = new URLSearchParams({ property_name: propertyName, date, kind });
      if (rowKey) params.set("row_key", rowKey);
      const res = await fetch(`/api/rr4/overrides?${params.toString()}`, { method: "DELETE" });
      const result = await res.json();
      if (result.status !== "success") throw new Error(result.detail || "Reset failed");
      setResettingRow(null);
      setResetAllOpen(false);
      await fetchAll();
    } catch (err) {
      alert("Reset failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setResetBusy(false);
    }
  };

  const filtered = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const editedCount = rows.filter((r) => (r._edited || []).length > 0).length;
  // Every row missing a key means the whole day predates the feature, not
  // that one guest is odd - so this is surfaced once, up front, instead of
  // as a failed save on the first cell someone happens to try.
  const needsRegenerate = !loading && rows.length > 0 && rows.every((r) => !r._key);

  const cellInputCls =
    "w-full min-w-[130px] bg-transparent px-2 py-1.5 text-sm text-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 focus:bg-slate-50 transition-all";
  const editedInputCls =
    "w-full min-w-[130px] bg-[#AAA024]/10 px-2 py-1.5 text-sm text-slate-900 font-bold rounded-lg focus:outline-none focus:ring-2 focus:ring-[#AAA024]/30 transition-all";

  return (
    <div className="p-6 bg-white min-h-screen text-slate-900 font-sans relative">
      <PageHeader title={meta.title} description={meta.blurb} />

      <div className="mt-4 mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="font-bold text-slate-800">{propertyName}</span>
        <span className="text-slate-500">{date}</span>
        {editedCount > 0 && (
          <span className="px-2 py-0.5 rounded-lg bg-[#AAA024]/10 text-[#8f871e] text-[11px] font-bold">
            {editedCount} row{editedCount === 1 ? "" : "s"} edited
          </span>
        )}
      </div>

      <div className="mb-6">
        <button
          onClick={() => setReadmeOpen((o) => !o)}
          className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-colors"
        >
          <svg className={`w-3.5 h-3.5 transition-transform ${readmeOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          Read Me - what an edit here does, and what it does not
        </button>
        {readmeOpen && (
          <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-600 space-y-2">
            <p>
              <span className="font-bold text-slate-800">Edits survive &ldquo;Re-Generate Files&rdquo;.</span> They are stored
              separately from the imported report, and laid back over it on every read - so Preview, Download, the
              on-screen table and the daily email all show the corrected register, and re-importing the day does not
              wipe them.
            </p>
            <p>
              <span className="font-bold text-slate-800">Edits do not go back to MEWS.</span> The guest&rsquo;s MEWS profile
              is unchanged, so the same wrong value will reappear on every other day this guest stays. Fix it in MEWS
              too when the correction is about the profile itself rather than this one filing.
            </p>
            <p>
              <span className="font-bold text-slate-800">Reset</span> reverts a row to exactly what MEWS returned. Nothing
              is re-fetched to do it - the original values were never overwritten.
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700 leading-relaxed">{error}</div>
      )}

      {needsRegenerate && (
        <div className="mb-6 p-4 bg-[#AAA024]/10 border border-[#AAA024]/30 rounded-2xl flex flex-col md:flex-row md:items-center gap-3 justify-between">
          <p className="text-sm text-slate-700 leading-relaxed">
            This day was imported before per-row editing existed, so its rows carry no stable identity to attach an
            edit to. Re-generate it once from MEWS and the register becomes editable. No existing edits can be lost -
            there are none yet.
          </p>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="px-4 py-2 bg-[#AAA024] text-white rounded-xl text-xs font-bold hover:bg-[#8f871e] transition-all disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {regenerating ? "Re-Generating..." : "Re-Generate This Day"}
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <div className="p-4 flex flex-col md:flex-row gap-4 items-center justify-between border-b border-slate-100">
          <div className="relative w-full md:w-96">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              type="text"
              placeholder="Search name, room, passport, nationality..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/10 transition-all font-medium text-slate-900"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={fetchAll}
              className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              Refresh
            </button>
            <button
              onClick={() => setResetAllOpen(true)}
              disabled={editedCount === 0}
              className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all whitespace-nowrap"
            >
              Reset All Edits
            </button>
          </div>
        </div>

        <div className="max-h-[65vh] overflow-y-auto overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {/* Sticky on BOTH axes - the register is 26 columns wide, and
                    without an anchored line number you lose track of which
                    guest a cell belongs to as soon as you scroll sideways. */}
                <th className="sticky top-0 left-0 z-20 bg-slate-50 px-3 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest w-14">No.</th>
                {columns.map((c) => (
                  <th key={c.key} className="sticky top-0 z-10 bg-slate-50 px-2 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest align-bottom">
                    <div className="whitespace-pre-line normal-case tracking-normal text-[11px] text-slate-500 font-bold leading-tight">{c.label_th}</div>
                    {c.field !== c.key && <div className="mt-1 text-[9px] text-slate-300 font-mono normal-case tracking-normal">{c.field}</div>}
                  </th>
                ))}
                <th className="sticky top-0 z-10 bg-slate-50 px-3 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={columns.length + 2} className="py-20 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#AAA024] mx-auto"></div></td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={columns.length + 2} className="py-20 text-center text-slate-400 text-sm">
                  {search ? `No guest row matches "${search}".` : "No guest rows on this register."}
                </td></tr>
              ) : pageRows.map((row, i) => {
                const edited = row._edited || [];
                const lineNo = row.row_no ?? (currentPage - 1) * PAGE_SIZE + i + 1;
                return (
                  <tr key={row._key || lineNo} className="hover:bg-slate-50/50 transition-colors">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-bold text-slate-400">{String(lineNo)}</td>
                    {columns.map((c) => {
                      const value = row[c.key] === undefined || row[c.key] === null ? "" : String(row[c.key]);
                      const isEdited = edited.includes(c.key);
                      return (
                        <td key={c.key} className="px-2 py-2">
                          <input
                            key={`${row._key}-${c.key}-${value}`}
                            type="text"
                            defaultValue={value}
                            onBlur={(e) => handleCellSave(row, c.key, e.target.value)}
                            disabled={needsRegenerate}
                            title={isEdited ? "Edited - no longer MEWS's own value" : undefined}
                            className={`${isEdited ? editedInputCls : cellInputCls} disabled:cursor-not-allowed disabled:text-slate-400`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center">
                      {savingKey === row._key ? (
                        <span className="text-[10px] font-bold text-slate-400">Saving...</span>
                      ) : edited.length > 0 ? (
                        <button
                          onClick={() => setResettingRow(row)}
                          className="px-2 py-1 rounded-lg text-[10px] font-bold text-slate-400 hover:text-[#8f871e] hover:bg-[#AAA024]/10 transition-all whitespace-nowrap"
                          title="Revert this row to MEWS's own values"
                        >
                          Reset
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-200">&mdash;</span>
                      )}
                    </td>
                  </tr>
                );
              })}
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

      {(resettingRow || resetAllOpen) && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-slate-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-[#AAA024]/10 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-[#AAA024]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">
                {resetAllOpen ? "Reset all edits" : "Reset this row"}
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                {resetAllOpen ? (
                  <>
                    Discard every manual correction on <span className="font-bold text-slate-700">{kind.toUpperCase()} {date}</span> and go back to
                    exactly what MEWS returned? {editedCount} row{editedCount === 1 ? "" : "s"} will change back.
                  </>
                ) : (
                  <>
                    Revert{" "}
                    <span className="font-bold text-slate-700">
                      {String(resettingRow?.name_en || resettingRow?.first_name || "this row")}{" "}
                      {String(resettingRow?.surname_en || resettingRow?.last_name || "")}
                    </span>{" "}
                    to MEWS&rsquo;s own values? The {(resettingRow?._edited || []).length} edited field
                    {(resettingRow?._edited || []).length === 1 ? "" : "s"} will be discarded.
                  </>
                )}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleReset(resetAllOpen ? undefined : resettingRow?._key)}
                  disabled={resetBusy}
                  className="flex-1 bg-[#AAA024] text-white rounded-xl py-2.5 text-sm font-bold shadow-lg shadow-[#AAA024]/20 hover:bg-[#8f871e] transition-all disabled:opacity-50"
                >
                  {resetBusy ? "Resetting..." : "Reset"}
                </button>
                <button
                  onClick={() => { setResettingRow(null); setResetAllOpen(false); }}
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

export default function Rr4Tm30EditPage() {
  return (
    <Suspense fallback={null}>
      <Rr4Tm30EditContent />
    </Suspense>
  );
}
