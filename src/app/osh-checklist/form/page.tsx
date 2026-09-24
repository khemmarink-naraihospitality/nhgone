"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Eye, FileSignature, Filter, Image as ImageIcon, Loader2, Save, Search, Send, X } from "lucide-react";
import {
  STATUS_OPTS,
  SUB_STATUS_OPTS,
  emptyHeader,
  type OshChecklistItem,
  type OshFormItem,
  type OshHeader,
  type OshReport,
} from "@/lib/osh/defaults";
import { renderReportHTML } from "@/lib/osh/report";
import ImageCropperModal, { compressImage, readAspectRatioOk } from "../ImageCropperModal";
import { Toast, useToast } from "../Toast";
import { apiJson, useAllowedOshProperties, useOshSettings, useOshUser } from "../oshClient";
import SetupBanner from "../SetupBanner";

/**
 * OSH Checklist > OSH Form - the inspection itself. A port of the
 * prototype's OSHForm/ChecklistRow, same fields, same rules, same messages.
 * What changed underneath:
 *
 * - The draft is saved per signed-in user in Supabase (osh_drafts), not in
 *   this browser - the header on every change, the items on Save Draft,
 *   exactly when the prototype wrote each to localStorage.
 * - Photos are uploaded to the osh-photos bucket the moment they are
 *   attached; the item keeps the URL.
 * - Confirm & Submit files the report (osh_reports) and REALLY emails it to
 *   the property's recipients from Setting > Email - the prototype only
 *   showed a toast saying it had.
 * - The Property list is the OSH list narrowed to what this user's role may
 *   see (role_permissions.restricted_properties).
 * - The footer bar is sticky to this page, not fixed at "left-64" - the
 *   prototype's own sidebar width, which NHGOne's collapsible sidebar isn't.
 */

const freshItems = (master: OshChecklistItem[]): OshFormItem[] =>
  master.map((item) => ({ ...item, status: "", subStatus: "", actionPlan: "", photo: null }));

export default function OshFormPage() {
  const { settings, storageReady, loadError } = useOshSettings();
  const user = useOshUser();
  const allowed = useAllowedOshProperties(settings?.properties);
  const { toast, showToast } = useToast();

  const [headerInfo, setHeaderInfo] = useState<OshHeader>(emptyHeader());
  const [formItems, setFormItems] = useState<OshFormItem[]>([]);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [filterIncomplete, setFilterIncomplete] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [confirmModal, setConfirmModal] = useState(false);
  const [cropRequest, setCropRequest] = useState<{ id: number; file: File } | null>(null);
  const [uploadingIds, setUploadingIds] = useState<Set<number>>(new Set());
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load this user's draft once both it and the checklist are known. No
  // draft (or one with no items) starts from the current master checklist -
  // the prototype's "initialise from master if the draft is empty".
  useEffect(() => {
    if (!settings || !user || draftLoaded) return;
    let cancelled = false;
    (async () => {
      let draft: { header?: OshHeader | null; items?: OshFormItem[] | null } | null = null;
      try {
        draft = await apiJson(`/api/osh/draft?user_id=${encodeURIComponent(user.id)}`);
      } catch {
        draft = null;
      }
      if (cancelled) return;
      setHeaderInfo({ ...emptyHeader(), ...(draft?.header || {}) });
      setFormItems(draft?.items && draft.items.length > 0 ? draft.items : freshItems(settings.checklist));
      setDraftLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [settings, user, draftLoaded]);

  // The header is saved on every change, as the prototype did - debounced,
  // since a keystroke per request would be a request per keystroke.
  const headerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistHeader = useCallback(
    (header: OshHeader) => {
      if (!user) return;
      if (headerTimer.current) clearTimeout(headerTimer.current);
      headerTimer.current = setTimeout(() => {
        apiJson("/api/osh/draft", { method: "PUT", body: JSON.stringify({ user_id: user.id, header }) }).catch(() => {
          // Silent here - Save Draft reports failures; losing a header
          // autosave mid-typing is not worth a toast per keystroke.
        });
      }, 600);
    },
    [user],
  );
  useEffect(() => () => {
    if (headerTimer.current) clearTimeout(headerTimer.current);
  }, []);

  const categories = useMemo(() => settings?.categories ?? [], [settings]);

  const filteredItems = formItems.filter((item) => {
    const q = search.toLowerCase();
    const matchSearch = item.desc.toLowerCase().includes(q) || item.code.toLowerCase().includes(q);
    const matchCat = filterCat === "All" || item.catId === filterCat;
    const matchIncomplete = filterIncomplete ? !item.status || !item.subStatus : true;
    return matchSearch && matchCat && matchIncomplete;
  });

  const completeCount = formItems.filter((i) => i.status && i.subStatus).length;
  const totalCount = formItems.length;
  const percentComplete = totalCount === 0 ? 0 : Math.round((completeCount / totalCount) * 100);

  const handlePreviewClick = () => {
    if (!headerInfo.propertyName) return showToast("กรุณาเลือก ชื่อโรงแรม (Property Name) ก่อนทำรายการ", "error");
    if (!headerInfo.date) return showToast("กรุณาระบุ วันที่ (Date) ก่อนทำรายการ", "error");
    if (!headerInfo.operatorName) return showToast("กรุณากรอก ชื่อผู้ดำเนินการ (Operator) ก่อนทำรายการ", "error");
    setPreviewMode(true);
    window.scrollTo({ top: 0 });
  };

  const handleHeaderChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const newHeader = { ...headerInfo, [name]: value };
    setHeaderInfo(newHeader);
    persistHeader(newHeader);
  };

  const handleItemChange = useCallback((id: number, field: keyof OshFormItem, value: string | null) => {
    setFormItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value } as OshFormItem;
        // Status logic, as the prototype: Compliant settles the sub-status to
        // Done, N/A to N/A; Observation / Non-compliant reset it for the
        // inspector to choose.
        if (field === "status") {
          if (value === "Compliant") updated.subStatus = "Done";
          else if (value === "N/A") updated.subStatus = "N/A";
          else updated.subStatus = "";
        }
        return updated;
      }),
    );
  }, []);

  const uploadPhoto = useCallback(
    async (id: number, dataUrl: string) => {
      setUploadingIds((prev) => new Set(prev).add(id));
      try {
        const res = await apiJson<{ url: string }>("/api/osh/photos", {
          method: "POST",
          body: JSON.stringify({ data_url: dataUrl }),
        });
        handleItemChange(id, "photo", res.url);
      } catch (err) {
        showToast(`อัปโหลดรูปไม่สำเร็จ: ${err instanceof Error ? err.message : err}`, "error");
      } finally {
        setUploadingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [handleItemChange, showToast],
  );

  const saveDraft = async () => {
    if (!user) return;
    setSavingDraft(true);
    try {
      await apiJson("/api/osh/draft", {
        method: "PUT",
        body: JSON.stringify({ user_id: user.id, header: headerInfo, items: formItems }),
      });
      showToast("บันทึกแบบร่างสำเร็จ", "success");
    } catch (err) {
      showToast(`บันทึกแบบร่างไม่สำเร็จ: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setSavingDraft(false);
    }
  };

  const handleResetForm = async () => {
    if (!settings) return;
    setFormItems(freshItems(settings.checklist));
    setHeaderInfo(emptyHeader());
    if (user) {
      await apiJson(`/api/osh/draft?user_id=${encodeURIComponent(user.id)}`, { method: "DELETE" }).catch(() => {});
    }
  };

  const handleSubmit = async () => {
    if (!settings || submitting) return;
    setSubmitting(true);
    try {
      const reportHtml = renderReportHTML(settings.template, { header: headerInfo, items: formItems, score: percentComplete });
      const report = await apiJson<OshReport>("/api/osh/reports", {
        method: "POST",
        body: JSON.stringify({
          header: headerInfo,
          items: formItems,
          score: percentComplete,
          report_html: reportHtml,
          actor: user?.name ?? null,
        }),
      });
      if (report.email_status === "sent") {
        showToast(`ส่ง Report ไปที่ ${report.email_detail} สำเร็จ!`, "success");
      } else if (report.email_status === "failed") {
        showToast(`บันทึก Report สำเร็จ แต่ส่งอีเมลไม่สำเร็จ: ${report.email_detail || "ไม่ทราบสาเหตุ"}`, "error");
      } else {
        showToast("บันทึก Report สำเร็จ (ไม่มีการตั้งค่า Email สำหรับสาขานี้)", "success");
      }
      await handleResetForm();
      setConfirmModal(false);
      setPreviewMode(false);
    } catch (err) {
      showToast(`ส่ง Report ไม่สำเร็จ: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!settings || !draftLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (previewMode) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 font-sans text-slate-800 md:p-8">
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-8 flex items-center justify-between border-b pb-4">
            <h2 className="text-2xl font-bold text-slate-800">Preview: OSH Checklist Report</h2>
            <button
              onClick={() => setPreviewMode(false)}
              className="flex items-center gap-2 rounded-lg bg-slate-200 px-4 py-2 font-medium text-slate-700 hover:bg-slate-300"
            >
              <ChevronLeft size={18} /> Back to Edit
            </button>
          </div>

          <div className="mb-8 grid grid-cols-2 gap-6 rounded-lg bg-slate-50 p-6">
            <div><span className="block text-sm text-slate-500">Property Name</span><span className="text-lg font-semibold">{headerInfo.propertyName}</span></div>
            <div><span className="block text-sm text-slate-500">Date</span><span className="text-lg font-semibold">{headerInfo.date}</span></div>
            <div><span className="block text-sm text-slate-500">Year / Period</span><span className="text-lg font-semibold">{headerInfo.year} - {headerInfo.period}</span></div>
            <div><span className="block text-sm text-slate-500">Operator</span><span className="text-lg font-semibold">{headerInfo.operatorName}</span></div>
          </div>

          <div className="space-y-6">
            {formItems.map((item) => (
              <div key={item.id} className="flex gap-4 rounded-lg border border-slate-200 p-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-blue-100 font-bold text-blue-700">
                  {item.code}
                </div>
                <div className="flex-1">
                  <p className="mb-2 font-medium">{item.desc}</p>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="mr-2 text-slate-500">Status:</span>
                      <span
                        className={`rounded px-2 py-1 text-xs font-semibold ${
                          item.status === "Compliant" ? "bg-emerald-100 text-emerald-700"
                            : item.status === "Non-compliant" ? "bg-red-100 text-red-700"
                            : item.status === "Observation" ? "bg-amber-100 text-amber-700"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <div><span className="mr-2 text-slate-500">Sub Status:</span> <span className="font-medium">{item.subStatus}</span></div>
                    {item.actionPlan && (
                      <div className="col-span-2 mt-2">
                        <span className="block text-slate-500">Corrective Action Plan:</span>
                        <p className="mt-1 whitespace-pre-wrap rounded border border-slate-100 bg-slate-50 p-2">{item.actionPlan}</p>
                      </div>
                    )}
                  </div>
                </div>
                {item.photo && (
                  <div className="w-32 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.photo} alt="evidence" className="h-auto w-full rounded border border-slate-200" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-8 flex justify-end border-t pt-6">
            <button
              onClick={() => setConfirmModal(true)}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-8 py-3 font-bold text-white shadow-lg shadow-blue-200 hover:bg-blue-700"
            >
              <Send size={20} /> Confirm &amp; Submit
            </button>
          </div>

          {confirmModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
              <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
                <h3 className="mb-2 text-xl font-bold">ยืนยันการส่งข้อมูล</h3>
                <p className="mb-6 text-slate-600">
                  คุณตรวจสอบข้อมูลครบถ้วนแล้วใช่หรือไม่? เมื่อกดยืนยัน ระบบจะบันทึกรายงาน และส่ง Report ไปยังอีเมลที่ตั้งค่าไว้ทันที
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setConfirmModal(false)}
                    disabled={submitting}
                    className="rounded-lg bg-slate-100 px-4 py-2 font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {submitting && <Loader2 size={16} className="animate-spin" />}
                    {submitting ? "กำลังส่ง..." : "ยืนยันการส่ง"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <Toast toast={toast} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans text-slate-800 md:p-8">
      <div className="space-y-6">
        <SetupBanner storageReady={storageReady} loadError={loadError} />

        {/* Header Info */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
            <FileSignature className="text-blue-500" /> ข้อมูลทั่วไป (General Info)
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อโรงแรม (Property Name)</label>
              <select
                name="propertyName"
                value={headerInfo.propertyName}
                onChange={handleHeaderChange}
                className="w-full rounded-lg border border-slate-300 bg-white p-2.5 outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">เลือกโรงแรม...</option>
                {allowed.properties.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">วันที่ (Date)</label>
              <input
                type="date"
                name="date"
                value={headerInfo.date}
                onChange={handleHeaderChange}
                className="w-full rounded-lg border border-slate-300 p-2.5 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">รอบปี (Year)</label>
              <select
                name="year"
                value={headerInfo.year}
                onChange={handleHeaderChange}
                className="w-full rounded-lg border border-slate-300 bg-white p-2.5 outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 3 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">รอบการบันทึก (Period)</label>
              <div className="mt-2 flex gap-4">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="period" value="Mid Year" checked={headerInfo.period === "Mid Year"} onChange={handleHeaderChange} className="h-4 w-4 text-blue-600" />
                  <span>Mid Year</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="period" value="End Year" checked={headerInfo.period === "End Year"} onChange={handleHeaderChange} className="h-4 w-4 text-blue-600" />
                  <span>End Year</span>
                </label>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ผู้ดำเนินการ (Operator)</label>
              <input
                type="text"
                name="operatorName"
                value={headerInfo.operatorName}
                onChange={handleHeaderChange}
                placeholder="ชื่อ-นามสกุล ผู้ดำเนินการ"
                className="w-full rounded-lg border border-slate-300 p-2.5 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-1 flex-wrap items-center gap-4">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="ค้นหาด้วย Keyword หรือรหัส..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter size={18} className="text-slate-400" />
              <select
                value={filterCat}
                onChange={(e) => setFilterCat(e.target.value)}
                className="max-w-[250px] truncate rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="All">ทุกหมวดหมู่ (All Categories)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <input
                type="checkbox"
                checked={filterIncomplete}
                onChange={(e) => setFilterIncomplete(e.target.checked)}
                className="h-4 w-4 rounded text-blue-600"
              />
              <span className="text-sm font-medium text-slate-700">แสดงเฉพาะรายการที่ยังไม่เสร็จ</span>
            </label>
          </div>
          <div className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-bold text-slate-500">
            รายการทั้งหมด {filteredItems.length} รายการ
          </div>
        </div>

        {/* Checklist Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="max-h-[65vh] overflow-auto">
            <table className="relative w-full min-w-[1200px] border-collapse text-left">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 shadow-sm">
                <tr className="text-sm text-slate-600">
                  <th className="w-24 bg-slate-100 p-4 font-semibold">Item No.</th>
                  <th className="w-40 bg-slate-100 p-4 font-semibold">Category</th>
                  <th className="min-w-[250px] bg-slate-100 p-4 font-semibold">Checklist Description</th>
                  <th className="w-48 bg-slate-100 p-4 font-semibold">Status</th>
                  <th className="w-48 bg-slate-100 p-4 font-semibold">Sub Status</th>
                  <th className="w-64 bg-slate-100 p-4 font-semibold">Action Plan</th>
                  <th className="w-40 bg-slate-100 p-4 text-center font-semibold">Photo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredItems.map((item) => (
                  <ChecklistRow
                    key={item.id}
                    item={item}
                    uploading={uploadingIds.has(item.id)}
                    onChange={handleItemChange}
                    showToast={showToast}
                    onPhotoReady={uploadPhoto}
                    onRequestCrop={(id, file) => setCropRequest({ id, file })}
                  />
                ))}
                {filteredItems.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-slate-500">ไม่พบรายการที่ค้นหา</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Action Bar - sticky to this page (see file comment) */}
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 bg-white p-4 px-8 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] md:-mx-8">
          <div className="flex max-w-xl flex-1 items-center gap-4">
            <div className="h-4 flex-1 overflow-hidden rounded-full bg-slate-100 shadow-inner">
              <div
                className="flex h-full items-center justify-end bg-blue-600 pr-2 text-[10px] font-bold text-white transition-all duration-500"
                style={{ width: `${percentComplete}%` }}
              >
                {percentComplete > 5 ? `${percentComplete}%` : ""}
              </div>
            </div>
            <span className="whitespace-nowrap font-bold text-slate-700">{completeCount} / {totalCount} Completed</span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={saveDraft}
              disabled={savingDraft || !user}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-6 py-2.5 font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-60"
            >
              {savingDraft ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Save Draft
            </button>
            <button
              onClick={handlePreviewClick}
              disabled={uploadingIds.size > 0}
              title={uploadingIds.size > 0 ? "รอให้อัปโหลดรูปเสร็จก่อน" : undefined}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 font-bold text-white shadow-md shadow-blue-200 transition-all hover:bg-blue-700 disabled:opacity-60"
            >
              <Eye size={18} /> Preview &amp; Submit
            </button>
          </div>
        </div>
      </div>

      {cropRequest && (
        <ImageCropperModal
          file={cropRequest.file}
          onCancel={() => setCropRequest(null)}
          onCrop={(croppedDataUrl) => {
            const id = cropRequest.id;
            setCropRequest(null);
            void uploadPhoto(id, croppedDataUrl);
          }}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}

function ChecklistRow({
  item,
  uploading,
  onChange,
  showToast,
  onPhotoReady,
  onRequestCrop,
}: {
  item: OshFormItem;
  uploading: boolean;
  onChange: (id: number, field: keyof OshFormItem, value: string | null) => void;
  showToast: (msg: string, type?: "info" | "success" | "error") => void;
  onPhotoReady: (id: number, dataUrl: string) => void;
  onRequestCrop: (id: number, file: File) => void;
}) {
  const isSubStatusLocked = item.status === "Compliant" || item.status === "N/A";

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ""; // reset so the same file can be chosen again
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showToast("ขนาดไฟล์เกิน 5MB กรุณาเลือกไฟล์ที่เล็กกว่านี้", "error");
      return;
    }
    try {
      // Near 4:3 or 3:4 is kept (shrunk to 800px); anything else is cropped
      // first - the prototype's own rule.
      if (await readAspectRatioOk(file)) {
        onPhotoReady(item.id, await compressImage(file));
      } else {
        onRequestCrop(item.id, file);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "อ่านไฟล์รูปไม่สำเร็จ", "error");
    }
  };

  return (
    <tr className="group transition-colors hover:bg-slate-50">
      <td className="p-4 align-top font-bold text-slate-600">{item.code}</td>
      <td className="p-4 align-top text-sm">
        <span className="inline-block whitespace-nowrap rounded bg-slate-200 px-2 py-1 font-medium text-slate-700">{item.catId}</span>
      </td>
      <td className="p-4 align-top text-sm text-slate-800">{item.desc}</td>
      <td className="p-4 align-top">
        <select
          value={item.status}
          onChange={(e) => onChange(item.id, "status", e.target.value)}
          className={`w-full rounded-lg border p-2 text-sm outline-none transition-colors ${
            item.status === "Compliant" ? "border-emerald-500 bg-emerald-50 text-emerald-800"
              : item.status === "Non-compliant" ? "border-red-500 bg-red-50 text-red-800"
              : item.status === "Observation" ? "border-amber-500 bg-amber-50 text-amber-800"
              : item.status === "N/A" ? "border-slate-400 bg-slate-100 text-slate-600"
              : "border-slate-300"
          }`}
        >
          <option value="">- เลือกสถานะ -</option>
          {STATUS_OPTS.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </td>
      <td className="p-4 align-top">
        <select
          value={item.subStatus}
          onChange={(e) => onChange(item.id, "subStatus", e.target.value)}
          disabled={isSubStatusLocked}
          className={`w-full rounded-lg border p-2 text-sm outline-none ${
            isSubStatusLocked ? "cursor-not-allowed border-transparent bg-slate-100 text-slate-500" : "border-slate-300 bg-white"
          }`}
        >
          <option value="">- สถานะย่อย -</option>
          {SUB_STATUS_OPTS.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </td>
      <td className="p-4 align-top">
        <textarea
          value={item.actionPlan}
          onChange={(e) => onChange(item.id, "actionPlan", e.target.value)}
          placeholder="แผนแก้ไข..."
          className="min-h-[60px] w-full resize-y rounded-lg border border-slate-300 p-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </td>
      <td className="p-4 text-center align-top">
        {uploading ? (
          <div className="mx-auto flex h-18 w-24 flex-col items-center justify-center rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 text-blue-500">
            <Loader2 size={20} className="animate-spin" />
            <span className="mt-1 text-[10px] font-medium">กำลังอัปโหลด</span>
          </div>
        ) : item.photo ? (
          <div className="group/img relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.photo} alt="Upload" className="h-18 w-24 rounded border border-slate-300 object-cover shadow-sm" />
            <button
              onClick={() => onChange(item.id, "photo", null)}
              aria-label="ลบรูป"
              className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white opacity-0 shadow-md transition-opacity group-hover/img:opacity-100 focus:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <label className="mx-auto flex h-18 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-500">
            <ImageIcon size={20} className="mb-1" />
            <span className="px-1 text-center text-[10px] font-medium leading-tight">แนบรูป<br />(แนวนอน 3:4)</span>
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} />
          </label>
        )}
      </td>
    </tr>
  );
}
