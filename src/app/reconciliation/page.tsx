"use client";

import { useRef, useState, type RefObject } from "react";
import PageHeader from "@/components/PageHeader";

type Tab = "gl-split" | "bank-gl";

function filenameFromResponse(res: Response, fallback: string): string {
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^";]+)"?/);
  return match ? match[1] : fallback;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function FilePicker({
  label, file, onChange, inputRef,
}: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex flex-col gap-2 w-full">
      <label className="text-[9px] font-bold text-[var(--text-primary)]/50 tracked-caps ml-1">{label}</label>
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => onChange(e.target.files?.[0] || null)}
        />
        <button
          onClick={() => inputRef.current?.click()}
          className="px-4 py-2 text-[10px] font-bold tracked-caps bg-[var(--paper)] border border-[var(--text-primary)]/14 text-[var(--text-primary)] hover:border-[var(--text-primary)] transition-colors whitespace-nowrap"
        >
          Choose File
        </button>
        <span className="text-[13px] text-[var(--text-primary)]/70 truncate">
          {file ? file.name : "No file selected"}
        </span>
      </div>
    </div>
  );
}

export default function ReconciliationPage() {
  const [tab, setTab] = useState<Tab>("gl-split");

  // Mode 1: GL Split & Reconciliation
  const [glFile, setGlFile] = useState<File | null>(null);
  const [glRunning, setGlRunning] = useState(false);
  const [glError, setGlError] = useState<string | null>(null);
  const [glDone, setGlDone] = useState<string | null>(null);
  const glInputRef = useRef<HTMLInputElement>(null);

  // Mode 2: Bank vs GL Matching
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [glMatchFile, setGlMatchFile] = useState<File | null>(null);
  const [matchRunning, setMatchRunning] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchDone, setMatchDone] = useState<string | null>(null);
  const bankInputRef = useRef<HTMLInputElement>(null);
  const glMatchInputRef = useRef<HTMLInputElement>(null);

  const runGlSplit = async () => {
    if (!glFile) return;
    setGlRunning(true);
    setGlError(null);
    setGlDone(null);
    try {
      const formData = new FormData();
      formData.append("file", glFile);
      const res = await fetch("/api/reconciliation/gl-split", { method: "POST", body: formData });
      if (!res.ok) {
        const result = await res.json().catch(() => null);
        throw new Error(result?.detail || "GL split failed");
      }
      const filename = filenameFromResponse(res, "GL_Reconciliation.zip");
      downloadBlob(await res.blob(), filename);
      setGlDone(`Done — downloaded ${filename}`);
    } catch (err) {
      setGlError(err instanceof Error ? err.message : String(err));
    } finally {
      setGlRunning(false);
    }
  };

  const runBankGlMatch = async () => {
    if (!bankFile || !glMatchFile) return;
    setMatchRunning(true);
    setMatchError(null);
    setMatchDone(null);
    try {
      const formData = new FormData();
      formData.append("bank_file", bankFile);
      formData.append("gl_file", glMatchFile);
      const res = await fetch("/api/reconciliation/bank-gl-match", { method: "POST", body: formData });
      if (!res.ok) {
        const result = await res.json().catch(() => null);
        throw new Error(result?.detail || "Bank vs GL matching failed");
      }
      const filename = filenameFromResponse(res, "Bank_GL_Reconciliation.xlsx");
      downloadBlob(await res.blob(), filename);
      setMatchDone(`Done — downloaded ${filename}`);
    } catch (err) {
      setMatchError(err instanceof Error ? err.message : String(err));
    } finally {
      setMatchRunning(false);
    }
  };

  return (
    <div className="flex-1 p-4 sm:p-6 md:p-8 bg-[var(--bg-primary)] font-sans h-full overflow-auto">
      <div className="max-w-[100rem] mx-auto">
        <PageHeader title="Reconciliation" />
        <p className="text-[var(--text-primary)] text-sm opacity-70 leading-relaxed max-w-4xl mt-2 mb-6">
          Accounting reconciliation tools — split a GL export into per-account workbooks with
          self-offsetting entries paired off, or match a bank statement against the GL to see
          what is still outstanding on each side.
        </p>

        <div className="flex border border-[var(--text-primary)]/14 bg-[var(--paper)] w-fit mb-6">
          <button
            onClick={() => setTab("gl-split")}
            className={`px-6 py-2.5 text-[11px] font-bold tracked-caps transition-all ${tab === "gl-split" ? "bg-[#152A00] text-[#FFEFD2]" : "text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"}`}
          >
            GL Split &amp; Reconciliation
          </button>
          <button
            onClick={() => setTab("bank-gl")}
            className={`px-6 py-2.5 text-[11px] font-bold tracked-caps transition-all ${tab === "bank-gl" ? "bg-[#152A00] text-[#FFEFD2]" : "text-[var(--text-primary)]/40 hover:text-[var(--text-primary)]"}`}
          >
            Bank vs GL Matching
          </button>
        </div>

        {tab === "gl-split" && (
          <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 p-6 max-w-2xl">
            <p className="text-[13px] text-[var(--text-primary)]/70 leading-relaxed mb-5">
              Upload the GL Account Detail export. Rows are split into one workbook per account
              code, with matching debit/credit pairs (amounts that cancel exactly) separated
              into their own Offset sheet — Outstanding is left holding only the unresolved
              balance.
            </p>
            <FilePicker label="Account Detail (Excel)" file={glFile} onChange={setGlFile} inputRef={glInputRef} />
            <button
              onClick={runGlSplit}
              disabled={!glFile || glRunning}
              className="btn-brand btn-primary mt-5 w-full disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {glRunning ? "Processing…" : "Run & Download ZIP"}
            </button>
            {glError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-[13px]">{glError}</div>
            )}
            {glDone && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 text-green-700 text-[13px]">{glDone}</div>
            )}
          </div>
        )}

        {tab === "bank-gl" && (
          <div className="bg-[var(--paper)] border border-[var(--text-primary)]/14 p-6 max-w-2xl">
            <p className="text-[13px] text-[var(--text-primary)]/70 leading-relaxed mb-5">
              Upload both the bank statement and the GL statement. Transactions are matched by
              amount and date (within 1 day); unmatched rows on each side are listed as
              Outstanding, with matching amounts appearing on both outstanding lists highlighted
              for review.
            </p>
            <div className="flex flex-col gap-4">
              <FilePicker label="Bank Statement (.xlsx)" file={bankFile} onChange={setBankFile} inputRef={bankInputRef} />
              <FilePicker label="GL Statement (.xlsx)" file={glMatchFile} onChange={setGlMatchFile} inputRef={glMatchInputRef} />
            </div>
            <button
              onClick={runBankGlMatch}
              disabled={!bankFile || !glMatchFile || matchRunning}
              className="btn-brand btn-primary mt-5 w-full disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {matchRunning ? "Processing…" : "Run & Download Result"}
            </button>
            {matchError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-[13px]">{matchError}</div>
            )}
            {matchDone && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 text-green-700 text-[13px]">{matchDone}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
