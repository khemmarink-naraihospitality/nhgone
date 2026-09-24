"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Eye, FileText, LayoutDashboard, Loader2, Printer } from "lucide-react";
import type { OshReport } from "@/lib/osh/defaults";
import { renderReportHTML } from "@/lib/osh/report";
import { apiJson, useAllowedOshProperties, useOshSettings } from "../oshClient";
import SetupBanner from "../SetupBanner";

/**
 * OSH Checklist > Report - the prototype's ReportsView: filters, the four
 * totals, the per-category bars, the submitted-report history, and "View
 * Custom PDF" (the report rendered through Setting > Report Templates).
 * Reports come from osh_reports rather than this browser, so every
 * inspection any property has submitted is here. Differences:
 *
 * - A role restricted to some properties only sees those properties'
 *   reports, and only those in the Property filter.
 * - "View Custom PDF" gains a Print / Save as PDF button (the browser's own
 *   print dialog - the prototype had no way to actually produce the PDF its
 *   button was named after), and the controls around it are left off paper.
 * - ?id=<report> opens one report directly: the link in the submission
 *   email lands here.
 *
 * Like the prototype, a report renders through the CURRENT template, so a
 * template fix applies to reports already filed; the data itself (header,
 * items, photos, score) is the snapshot taken at submission.
 */

export default function OshReportPage() {
  return (
    <Suspense fallback={null}>
      <OshReportView />
    </Suspense>
  );
}

function OshReportView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkedId = searchParams.get("id");

  const { settings, storageReady, loadError } = useOshSettings();
  const allowed = useAllowedOshProperties(settings?.properties);

  const [reports, setReports] = useState<OshReport[] | null>(null);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [viewReport, setViewReport] = useState<OshReport | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [filterProp, setFilterProp] = useState("All");
  const [filterYear, setFilterYear] = useState("All");

  const currentYear = new Date().getFullYear();
  const availableYears = Array.from({ length: 10 }, (_, i) => (currentYear - 3 + i).toString());

  useEffect(() => {
    let cancelled = false;
    apiJson<OshReport[]>("/api/osh/reports")
      .then((data) => {
        if (!cancelled) setReports(data || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setReportsError(err instanceof Error ? err.message : String(err));
        setReports([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The emailed link: open that one report once it (and the user's
  // property access) is known.
  useEffect(() => {
    if (!linkedId || !allowed.ready) return;
    let cancelled = false;
    apiJson<OshReport>(`/api/osh/reports/${encodeURIComponent(linkedId)}`)
      .then((report) => {
        if (cancelled) return;
        if (allowed.restricted && !allowed.properties.includes(report.property_name)) {
          setLinkError("คุณไม่มีสิทธิ์ดูรายงานของโรงแรมนี้");
          return;
        }
        setLinkError(null);
        setViewReport(report);
      })
      .catch((err) => {
        if (!cancelled) setLinkError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [linkedId, allowed.ready, allowed.restricted, allowed.properties]);

  // What this user may see at all: everything, or only their properties.
  const visibleReports = useMemo(() => {
    const list = reports || [];
    if (!allowed.restricted) return list;
    return list.filter((r) => allowed.properties.includes(r.header?.propertyName || r.property_name));
  }, [reports, allowed.restricted, allowed.properties]);

  // The OSH property list, plus - for an unrestricted role - any property a
  // filed report names that has since been renamed or removed in Setting,
  // so its history can still be filtered to.
  const propertyOptions = useMemo(() => {
    const list = [...allowed.properties];
    if (!allowed.restricted) {
      for (const r of visibleReports) {
        const name = r.header?.propertyName || r.property_name;
        if (name && !list.includes(name)) list.push(name);
      }
    }
    return list;
  }, [allowed.properties, allowed.restricted, visibleReports]);

  const filteredReports = visibleReports.filter(
    (r) =>
      (filterProp === "All" || (r.header?.propertyName || r.property_name) === filterProp) &&
      (filterYear === "All" || String(r.header?.year) === filterYear),
  );

  // Dashboard metrics, counted exactly as the prototype counts them.
  let totalItems = 0;
  let totalCompliant = 0;
  let totalNonCompliant = 0;
  let totalObservation = 0;
  const catStats: Record<string, { name: string; total: number; compliant: number; nonCompliant: number }> = {};
  for (const cat of settings?.categories || []) {
    catStats[cat.id] = { name: cat.name, total: 0, compliant: 0, nonCompliant: 0 };
  }
  for (const report of filteredReports) {
    for (const item of report.items || []) {
      totalItems++;
      if (item.status === "Compliant") totalCompliant++;
      else if (item.status === "Non-compliant") totalNonCompliant++;
      else if (item.status === "Observation") totalObservation++;
      const stat = catStats[item.catId];
      if (stat) {
        stat.total++;
        if (item.status === "Compliant") stat.compliant++;
        if (item.status === "Non-compliant") stat.nonCompliant++;
      }
    }
  }

  const closeReport = () => {
    setViewReport(null);
    if (linkedId) router.replace("/osh-checklist/report");
  };

  if (!settings || reports === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (viewReport) {
    const photos = (viewReport.items || []).filter((i) => i.photo);
    return (
      <div className="min-h-screen bg-slate-50 p-4 font-sans text-slate-800 md:p-8 print:bg-white print:p-0">
        <div className="mx-auto mb-10 max-w-5xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:m-0 print:max-w-none print:border-0 print:p-0 print:shadow-none">
          <div className="no-print mb-8 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
            <h2 className="text-2xl font-bold text-slate-800">Generated Report (Template View)</h2>
            <div className="flex gap-2">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
              >
                <Printer size={18} /> Print / Save as PDF
              </button>
              <button
                onClick={closeReport}
                className="flex items-center gap-2 rounded-lg bg-slate-200 px-4 py-2 font-medium text-slate-700 hover:bg-slate-300"
              >
                <ChevronLeft size={18} /> กลับไปหน้า Reports
              </button>
            </div>
          </div>

          <div
            className="min-h-[800px] rounded-lg border border-slate-300 bg-white p-8 shadow-inner print:min-h-0 print:border-0 print:p-0 print:shadow-none"
            dangerouslySetInnerHTML={{
              __html: renderReportHTML(settings.template, {
                header: viewReport.header,
                items: viewReport.items || [],
                score: viewReport.score,
              }),
            }}
          />

          <div className="print:break-before-page">
            <h3 className="mb-4 mt-10 border-b pb-2 text-lg font-bold text-slate-800">Raw Photo Evidences</h3>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {photos.map((item) => (
                <div key={item.id} className="break-inside-avoid rounded border border-slate-200 p-2 text-center">
                  <span className="mb-1 block text-sm font-bold">{item.code}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.photo as string} alt="evidence" className="h-auto w-full rounded" />
                </div>
              ))}
              {photos.length === 0 && <p className="col-span-4 text-center text-slate-500">ไม่มีรูปภาพแนบในรายงานนี้</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans text-slate-800 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6 pb-20">
        <SetupBanner storageReady={storageReady} loadError={loadError} />
        {(reportsError || linkError) && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {linkError ? `เปิดรายงานจากลิงก์ไม่สำเร็จ: ${linkError}` : `โหลดรายงานไม่สำเร็จ: ${reportsError}`}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
            <LayoutDashboard className="text-blue-500" /> Dashboard &amp; Reports
          </h2>

          <div className="flex flex-wrap gap-4 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
            <select
              value={filterProp}
              onChange={(e) => setFilterProp(e.target.value)}
              className="rounded border-none bg-slate-50 px-4 py-2 text-sm font-medium outline-none"
            >
              <option value="All">{allowed.restricted ? "ทุกโรงแรมที่มีสิทธิ์ (All Properties)" : "ทุกโรงแรม (All Properties)"}</option>
              {propertyOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="rounded border-none bg-slate-50 px-4 py-2 text-sm font-medium outline-none"
            >
              <option value="All">ทุกปี (All Years)</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Dashboard Stats */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
          <div className="rounded-xl border border-l-4 border-slate-200 border-l-blue-500 bg-white p-6 shadow-sm">
            <h4 className="mb-1 text-sm font-bold text-slate-500">Total Items Evaluated</h4>
            <span className="text-3xl font-black text-slate-800">{totalItems}</span>
          </div>
          <div className="rounded-xl border border-l-4 border-slate-200 border-l-emerald-500 bg-white p-6 shadow-sm">
            <h4 className="mb-1 text-sm font-bold text-slate-500">Compliant (Done)</h4>
            <span className="text-3xl font-black text-emerald-600">{totalCompliant}</span>
            <span className="ml-2 text-xs text-slate-400">({totalItems ? Math.round((totalCompliant / totalItems) * 100) : 0}%)</span>
          </div>
          <div className="rounded-xl border border-l-4 border-slate-200 border-l-amber-500 bg-white p-6 shadow-sm">
            <h4 className="mb-1 text-sm font-bold text-slate-500">Observation</h4>
            <span className="text-3xl font-black text-amber-600">{totalObservation}</span>
            <span className="ml-2 text-xs text-slate-400">({totalItems ? Math.round((totalObservation / totalItems) * 100) : 0}%)</span>
          </div>
          <div className="rounded-xl border border-l-4 border-slate-200 border-l-red-500 bg-white p-6 shadow-sm">
            <h4 className="mb-1 text-sm font-bold text-slate-500">Non-compliant</h4>
            <span className="text-3xl font-black text-red-600">{totalNonCompliant}</span>
            <span className="ml-2 text-xs text-slate-400">({totalItems ? Math.round((totalNonCompliant / totalItems) * 100) : 0}%)</span>
          </div>
        </div>

        {/* Category Breakdown (Simple Bars) */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 font-bold text-slate-700">Compliance Breakdown by Category</h3>
          <div className="space-y-4">
            {Object.entries(catStats).map(([id, cat]) => {
              const pctCompliant = cat.total ? Math.round((cat.compliant / cat.total) * 100) : 0;
              const pctNon = cat.total ? Math.round((cat.nonCompliant / cat.total) * 100) : 0;
              return (
                <div key={id}>
                  <div className="mb-1 flex justify-between text-xs font-bold text-slate-600">
                    <span className="truncate pr-4">{cat.name}</span>
                    <span className="whitespace-nowrap">{cat.compliant} / {cat.total} Compliant</span>
                  </div>
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-2.5 bg-emerald-500" style={{ width: `${pctCompliant}%` }} />
                    <div className="h-2.5 bg-red-500" style={{ width: `${pctNon}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 p-4">
            <h3 className="font-bold text-slate-700">
              <FileText className="mr-2 inline text-blue-500" size={18} /> Submitted Reports History
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100 text-sm text-slate-600">
                  <th className="p-4 font-semibold">Date Submitted</th>
                  <th className="p-4 font-semibold">Property</th>
                  <th className="p-4 font-semibold">Year / Period</th>
                  <th className="p-4 font-semibold">Operator</th>
                  <th className="p-4 font-semibold">Submitted By</th>
                  <th className="p-4 text-center font-semibold">Score</th>
                  <th className="p-4 text-center font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredReports.map((rep) => (
                  <tr key={rep.id} className="hover:bg-slate-50">
                    <td className="p-4 text-sm">{new Date(rep.submitted_at).toLocaleString()}</td>
                    <td className="p-4 font-medium text-blue-700">{rep.header?.propertyName || rep.property_name}</td>
                    <td className="p-4 text-sm">{rep.header?.year} - {rep.header?.period}</td>
                    <td className="p-4 text-sm">{rep.header?.operatorName}</td>
                    <td className="p-4 text-sm">
                      {rep.submitted_by_email || rep.submitted_by ? (
                        <>
                          {rep.submitted_by && <div className="font-medium text-slate-700">{rep.submitted_by}</div>}
                          {rep.submitted_by_email && <div className="text-xs text-slate-500">{rep.submitted_by_email}</div>}
                        </>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      <span className="rounded bg-emerald-100 px-2 py-1 text-sm font-bold text-emerald-800">{rep.score}%</span>
                    </td>
                    <td className="p-4 text-center">
                      <button
                        onClick={() => {
                          setViewReport(rep);
                          window.scrollTo({ top: 0 });
                        }}
                        className="inline-flex items-center gap-1 rounded bg-blue-100 p-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-200"
                      >
                        <Eye size={16} /> View Custom PDF
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredReports.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-slate-500">ไม่พบประวัติรายงานตามเงื่อนไขที่เลือก</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
