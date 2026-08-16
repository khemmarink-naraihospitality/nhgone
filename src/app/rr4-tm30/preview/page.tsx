"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ExcelSheetPreview, { parseSheetForPreview, type SheetGrid } from "@/components/ExcelSheetPreview";

// Opened in its own tab by RR4/TM30's History table (RR4 v > Preview), so
// the spreadsheet gets the whole window instead of an overlay on top of the
// page it was launched from - and the original tab stays where it was.
function Rr4Tm30PreviewContent() {
  const searchParams = useSearchParams();
  const kind = (searchParams.get("kind") || "rr4").toLowerCase();
  const propertyName = searchParams.get("property_name") || "";
  const date = searchParams.get("date") || "";

  const [grid, setGrid] = useState<SheetGrid | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>("");

  useEffect(() => {
    const load = async () => {
      if (!propertyName || !date) {
        setError("Missing property or date.");
        setLoading(false);
        return;
      }
      try {
        const params = new URLSearchParams({ property_name: propertyName, date });
        const res = await fetch(`/api/${kind}/export?${params.toString()}`);
        if (!res.ok) {
          const result = await res.json().catch(() => null);
          throw new Error(result?.detail || "Could not load the file.");
        }
        // Filename (<<Property Code>>_RR4_<<yyyymmdd>>.xlsx) is decided
        // server-side, where the real Property Code is known.
        const disposition = res.headers.get("Content-Disposition") || "";
        const match = disposition.match(/filename="?([^";]+)"?/);
        setFilename(match ? match[1] : `${kind.toUpperCase()}_${propertyName}_${date}.xlsx`);
        setGrid(parseSheetForPreview(await res.arrayBuffer()));
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [kind, propertyName, date]);

  const handleDownload = async () => {
    try {
      const params = new URLSearchParams({ property_name: propertyName, date });
      const res = await fetch(`/api/${kind}/export?${params.toString()}`);
      if (!res.ok) throw new Error("Download failed");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || `${kind.toUpperCase()}_${propertyName}_${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-primary)] font-sans overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-[var(--text-primary)]/14 bg-[var(--paper)] shrink-0">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="text-xl font-serif text-[var(--text-primary)] whitespace-nowrap">{kind.toUpperCase()} Preview</h1>
          <span className="text-sm text-[var(--text-primary)]/60 truncate">
            {propertyName}{date ? ` · ${date}` : ""}
          </span>
        </div>
        {grid && (
          <button
            onClick={handleDownload}
            className="px-3 py-1.5 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 transition-colors whitespace-nowrap shrink-0"
          >
            Download .xlsx
          </button>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {loading && (
          <div className="p-16 text-center text-[var(--text-primary)]/30 font-display text-2xl italic">Loading...</div>
        )}
        {error && <div className="p-6 text-red-700 text-sm">{error}</div>}
        {!loading && !error && grid && <ExcelSheetPreview grid={grid} />}
      </div>
    </div>
  );
}

export default function Rr4Tm30PreviewPage() {
  return (
    <Suspense fallback={null}>
      <Rr4Tm30PreviewContent />
    </Suspense>
  );
}
