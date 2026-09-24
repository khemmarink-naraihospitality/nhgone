"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowUpDown, Edit, FileCode2, FileSpreadsheet, Loader2, Plus, Save, Search, Settings, Trash } from "lucide-react";
import {
  generateDefaultTemplate,
  type OshCategory,
  type OshChecklistItem,
  type OshEmailConfig,
  type OshFormItem,
} from "@/lib/osh/defaults";
import { renderReportHTML } from "@/lib/osh/report";
import { Toast, useToast, type ToastType } from "../Toast";
import { useOshSettings, useOshUser, type OshSettingKey, type OshSettings } from "../oshClient";
import SetupBanner from "../SetupBanner";

/**
 * OSH Checklist > Setting - the prototype's SettingsView, five tabs, same
 * controls and messages. Every change is saved to osh_settings (shared by
 * every property) instead of this browser, and only reflected on screen once
 * it has saved - a toast says so either way.
 *
 * Fixed from the prototype, each of which left a control not doing its job:
 * - A new checklist item got the code "{001}": its template string had lost
 *   the `${category}` prefix and the `$`. It is now e.g. "A023".
 * - Insert Variables listed "{A001}_SubStatus" and "A001_Plan" only; the
 *   template actually understands _Status, _SubStatus, _Plan and _Photo per
 *   item, and now lists all four.
 * - "click to insert into the HTML" did nothing (insertVariable was never
 *   wired up). Clicking a variable now inserts it at the editor's cursor.
 * - The Preview panel only ever showed an "upload an Excel file" placeholder
 *   (there was no upload control, and no Excel support behind one). It now
 *   renders the HTML being edited, live, with sample data.
 * - A category that still has checklist items can't be deleted - the
 *   prototype deleted it and left those items pointing at nothing, gone from
 *   every Category filter and bar.
 */

type SetTab = "property" | "category" | "checklist" | "email" | "template";

type SaveFn = <K extends OshSettingKey>(key: K, value: OshSettings[K]) => Promise<boolean>;

export default function OshSettingsPage() {
  const { settings, storageReady, loadError, save } = useOshSettings();
  const user = useOshUser();
  const { toast, showToast } = useToast();

  // Save one setting and report failure in the page; resolves to whether it
  // saved so each caller only clears its input on success.
  const persist: SaveFn = async (key, value) => {
    try {
      await save(key, value, user?.name ?? null);
      return true;
    } catch (err) {
      showToast(`บันทึกไม่สำเร็จ: ${err instanceof Error ? err.message : err}`, "error");
      return false;
    }
  };

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans text-slate-800 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <SetupBanner storageReady={storageReady} loadError={loadError} />
        {/* Mounted only once settings exist, so its drafts can start from them. */}
        <SettingsContent settings={settings} persist={persist} showToast={showToast} />
      </div>
      <Toast toast={toast} />
    </div>
  );
}

function SettingsContent({
  settings,
  persist,
  showToast,
}: {
  settings: OshSettings;
  persist: SaveFn;
  showToast: (msg: string, type?: ToastType) => void;
}) {
  const { properties, categories, checklist: checklistMaster, emails: emailSettings } = settings;
  const [activeSetTab, setActiveSetTab] = useState<SetTab>("property");
  const [busy, setBusy] = useState(false);

  // Property State
  const [newProperty, setNewProperty] = useState("");
  const [editingProp, setEditingProp] = useState<string | null>(null);
  const [editPropInput, setEditPropInput] = useState("");

  // Category State
  const [newCatId, setNewCatId] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editCatIdInput, setEditCatIdInput] = useState("");
  const [editCatNameInput, setEditCatNameInput] = useState("");

  // Checklist Sort State
  const [sortConfig, setSortConfig] = useState<{ key: "code" | "catId"; direction: "asc" | "desc" }>({ key: "code", direction: "asc" });

  // Edit Item State
  const [newItemCat, setNewItemCat] = useState(categories.length > 0 ? categories[0].id : "A");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [editingItem, setEditingItem] = useState<OshChecklistItem | null>(null);

  // Email Config State
  const [selectedProp, setSelectedProp] = useState(properties[0] || "");

  // Template State
  const [templateDraft, setTemplateDraft] = useState(settings.template);
  const [varSearch, setVarSearch] = useState("");
  const templateRef = useRef<HTMLTextAreaElement>(null);

  /** Runs one save at a time - a second click while the first is in flight
   * would otherwise save a list built from the stale one. */
  const guarded = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const handleAddProperty = () =>
    guarded(async () => {
      const name = newProperty.trim();
      if (!name) return;
      if (properties.includes(name)) return showToast("ชื่อโรงแรมนี้มีอยู่แล้ว", "error");
      if (await persist("properties", [...properties, name])) {
        setNewProperty("");
        showToast("เพิ่มโรงแรมสำเร็จ", "success");
      }
    });

  const handleDeleteProperty = (prop: string) =>
    guarded(async () => {
      if (await persist("properties", properties.filter((p) => p !== prop))) {
        if (selectedProp === prop) setSelectedProp("");
        showToast("ลบโรงแรมสำเร็จ", "success");
      }
    });

  const handleSaveEditProperty = (oldName: string) =>
    guarded(async () => {
      const newName = editPropInput.trim();
      if (!newName) return;
      if (newName !== oldName && properties.includes(newName)) return showToast("ชื่อโรงแรมนี้มีอยู่แล้ว", "error");

      if (!(await persist("properties", properties.map((p) => (p === oldName ? newName : p))))) return;

      // Update Email Settings Keys to match new property name
      if (newName !== oldName && emailSettings[oldName]) {
        const newEmailSettings = { ...emailSettings };
        newEmailSettings[newName] = newEmailSettings[oldName];
        delete newEmailSettings[oldName];
        if (!(await persist("emails", newEmailSettings))) return;
      }
      if (selectedProp === oldName) setSelectedProp(newName);

      setEditingProp(null);
      showToast("แก้ไขชื่อโรงแรมสำเร็จ", "success");
    });

  const handleAddCategory = () =>
    guarded(async () => {
      const id = newCatId.trim().toUpperCase();
      if (!id || !newCatName.trim()) return showToast("กรุณากรอกรหัสและชื่อหมวดหมู่", "error");
      if (categories.find((c) => c.id === id)) return showToast("รหัสหมวดหมู่นี้มีอยู่แล้ว", "error");
      if (await persist("categories", [...categories, { id, name: newCatName.trim() }])) {
        setNewCatId("");
        setNewCatName("");
        showToast("เพิ่มหมวดหมู่สำเร็จ", "success");
      }
    });

  const handleDeleteCategory = (id: string) =>
    guarded(async () => {
      const inUse = checklistMaster.filter((i) => i.catId === id).length;
      if (inUse > 0) {
        return showToast(`ลบไม่ได้: หมวดหมู่ ${id} ยังมี ${inUse} รายการตรวจสอบอยู่ กรุณาย้ายหรือลบรายการเหล่านั้นก่อน`, "error");
      }
      if (await persist("categories", categories.filter((c) => c.id !== id))) {
        if (newItemCat === id) setNewItemCat(categories.find((c) => c.id !== id)?.id || "A");
        showToast("ลบหมวดหมู่สำเร็จ", "success");
      }
    });

  const handleSaveEditCategory = (oldId: string) =>
    guarded(async () => {
      const newId = editCatIdInput.trim().toUpperCase();
      if (!newId || !editCatNameInput.trim()) return showToast("กรุณากรอกรหัสและชื่อหมวดหมู่", "error");
      if (newId !== oldId && categories.find((c) => c.id === newId)) return showToast("รหัสหมวดหมู่นี้มีอยู่แล้ว", "error");

      const updated: OshCategory[] = categories.map((c) => (c.id === oldId ? { id: newId, name: editCatNameInput.trim() } : c));
      if (!(await persist("categories", updated))) return;

      // Update Checklist Master to reflect new Category ID
      if (newId !== oldId) {
        const updatedMaster = checklistMaster.map((item) => (item.catId === oldId ? { ...item, catId: newId } : item));
        if (!(await persist("checklist", updatedMaster))) return;
        if (newItemCat === oldId) setNewItemCat(newId);
      }

      setEditingCat(null);
      showToast("แก้ไขหมวดหมู่สำเร็จ", "success");
    });

  const sortChecklist = (key: "code" | "catId") => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") direction = "desc";
    setSortConfig({ key, direction });
  };

  const sortedChecklist = [...checklistMaster].sort((a, b) => {
    if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === "asc" ? -1 : 1;
    if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === "asc" ? 1 : -1;
    return 0;
  });

  const handleSaveItem = () =>
    guarded(async () => {
      const desc = newItemDesc.trim();
      if (!desc) return showToast("กรุณากรอกรายละเอียด", "error");

      if (editingItem) {
        // Update existing item
        const updated = checklistMaster.map((item) =>
          item.id === editingItem.id ? { ...item, catId: newItemCat, desc } : item,
        );
        if (!(await persist("checklist", updated))) return;
        showToast("อัปเดตรายการสำเร็จ", "success");
        setEditingItem(null);
      } else {
        // Add new item: the next free number in its category, e.g. A023.
        const newId = Math.max(Date.now(), ...checklistMaster.map((i) => i.id + 1));
        let maxNum = 0;
        for (const i of checklistMaster.filter((i) => i.catId === newItemCat)) {
          const num = parseInt(i.code.replace(newItemCat, ""), 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
        const newCode = `${newItemCat}${String(maxNum + 1).padStart(3, "0")}`;
        if (!(await persist("checklist", [...checklistMaster, { id: newId, code: newCode, catId: newItemCat, desc }]))) return;
        showToast(`เพิ่มรายการ ${newCode} สำเร็จ`, "success");
      }
      setNewItemDesc("");
    });

  const handleDeleteItem = (id: number) =>
    guarded(async () => {
      if (await persist("checklist", checklistMaster.filter((i) => i.id !== id))) {
        if (editingItem?.id === id) {
          setEditingItem(null);
          setNewItemDesc("");
        }
        showToast("ลบรายการสำเร็จ", "success");
      }
    });

  const handleSaveEmail = (prop: string, form: OshEmailConfig) =>
    guarded(async () => {
      if (!prop) return;
      if (await persist("emails", { ...emailSettings, [prop]: form })) {
        showToast(`บันทึกการตั้งค่าอีเมลสำหรับ ${prop} สำเร็จ`, "success");
      }
    });

  const handleSaveTemplate = () =>
    guarded(async () => {
      if (await persist("template", templateDraft)) showToast("บันทึก Template สำเร็จ", "success");
    });

  /** Inserts {{variable}} at the editor's cursor (or the end, if it has never
   * been focused) and puts the cursor after it. */
  const insertVariable = (variable: string) => {
    const token = `{{${variable}}}`;
    const el = templateRef.current;
    const start = el ? el.selectionStart : templateDraft.length;
    const end = el ? el.selectionEnd : templateDraft.length;
    setTemplateDraft((prev) => prev.slice(0, start) + token + prev.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
    showToast(`แทรก ${token} แล้ว`, "success");
  };

  const copyVariable = async (variable: string) => {
    const token = `{{${variable}}}`;
    try {
      await navigator.clipboard.writeText(token);
      showToast(`คัดลอก ${token} แล้ว`, "success");
    } catch {
      showToast("คัดลอกไม่สำเร็จ - เบราว์เซอร์ไม่อนุญาตให้เข้าถึงคลิปบอร์ด", "error");
    }
  };

  const generalVariables = ["PropertyName", "Date", "Year", "Period", "Operator", "Score"];
  const itemVariables = checklistMaster.flatMap((item) => [
    `${item.code}_Status`,
    `${item.code}_SubStatus`,
    `${item.code}_Plan`,
    `${item.code}_Photo`,
  ]);
  const allVariables = [...generalVariables, ...itemVariables];
  const filteredVars = allVariables.filter((v) => v.toLowerCase().includes(varSearch.toLowerCase()));

  // Sample data for the live preview - the prototype's own mockup values
  // (Sample Hotel, John Doe, 95%, and its three example rows), every other
  // item Compliant.
  const previewItems = useMemo<OshFormItem[]>(() => {
    const samples: Record<number, Pick<OshFormItem, "status" | "subStatus" | "actionPlan">> = {
      0: { status: "Compliant", subStatus: "Done", actionPlan: "" },
      1: { status: "Non-compliant", subStatus: "Working on it", actionPlan: "Waiting for battery replacement" },
      2: { status: "Observation", subStatus: "Not Started", actionPlan: "Door hinge is squeaky" },
    };
    return checklistMaster.map((item, i) => ({
      ...item,
      ...(samples[i] || { status: "Compliant", subStatus: "Done", actionPlan: "" }),
      photo: null,
    }));
  }, [checklistMaster]);
  const previewHtml = useMemo(
    () =>
      renderReportHTML(templateDraft, {
        header: {
          propertyName: "Sample Hotel (Lub d)",
          date: new Date().toISOString().slice(0, 10),
          year: String(new Date().getFullYear()),
          period: "Mid Year",
          operatorName: "John Doe",
        },
        items: previewItems,
        score: 95,
      }),
    [templateDraft, previewItems],
  );

  const tabClass = (tab: SetTab) =>
    `whitespace-nowrap border-b-2 px-6 py-3 font-semibold transition-colors ${
      activeSetTab === tab ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-800"
    }`;

  return (
    <>
      <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
        <Settings className="text-blue-500" /> Settings
        {busy && <Loader2 size={18} className="animate-spin text-slate-400" />}
      </h2>

      <div className="flex overflow-x-auto border-b border-slate-200">
        <button onClick={() => setActiveSetTab("property")} className={tabClass("property")}>โรงแรม (Property Name)</button>
        <button onClick={() => setActiveSetTab("category")} className={tabClass("category")}>หมวดหมู่ (Category)</button>
        <button onClick={() => setActiveSetTab("checklist")} className={tabClass("checklist")}>จัดการรายการตรวจสอบ</button>
        <button onClick={() => setActiveSetTab("email")} className={tabClass("email")}>เทมเพลตอีเมล (Email)</button>
        <button onClick={() => setActiveSetTab("template")} className={tabClass("template")}>Report Templates (PDF)</button>
      </div>

      {activeSetTab === "property" && (
        <div className="max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex gap-4">
            <input
              type="text"
              value={newProperty}
              onChange={(e) => setNewProperty(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddProperty()}
              placeholder="ชื่อโรงแรมใหม่..."
              className="flex-1 rounded-lg border p-2 outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button onClick={handleAddProperty} disabled={busy} className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
              <Plus size={18} /> เพิ่ม
            </button>
          </div>
          <div className="space-y-2">
            {properties.map((p) => (
              <div key={p} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                {editingProp === p ? (
                  <div className="mr-4 flex flex-1 items-center gap-2">
                    <input
                      type="text"
                      value={editPropInput}
                      onChange={(e) => setEditPropInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveEditProperty(p)}
                      autoFocus
                      className="flex-1 rounded border border-blue-400 bg-white p-1.5 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button onClick={() => handleSaveEditProperty(p)} disabled={busy} className="rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-600 disabled:opacity-60">บันทึก</button>
                    <button onClick={() => setEditingProp(null)} className="rounded bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-300">ยกเลิก</button>
                  </div>
                ) : (
                  <>
                    <span className="font-medium text-slate-700">{p}</span>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditingProp(p); setEditPropInput(p); }} aria-label={`แก้ไข ${p}`} className="rounded p-2 text-blue-500 transition-colors hover:bg-blue-50"><Edit size={18} /></button>
                      <button onClick={() => handleDeleteProperty(p)} disabled={busy} aria-label={`ลบ ${p}`} className="rounded p-2 text-red-500 transition-colors hover:bg-red-50 disabled:opacity-60"><Trash size={18} /></button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {properties.length === 0 && <div className="p-3 text-sm text-slate-500">ยังไม่มีโรงแรม</div>}
          </div>
        </div>
      )}

      {activeSetTab === "category" && (
        <div className="max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-end gap-4">
            <div className="w-24">
              <label className="mb-1 block text-sm font-medium text-slate-700">รหัส (เช่น G)</label>
              <input
                type="text"
                value={newCatId}
                onChange={(e) => setNewCatId(e.target.value.toUpperCase())}
                maxLength={2}
                className="w-full rounded-lg border p-2 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อหมวดหมู่</label>
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
                placeholder="รายละเอียดหมวดหมู่..."
                className="w-full rounded-lg border p-2 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button onClick={handleAddCategory} disabled={busy} className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
              <Plus size={18} /> เพิ่ม
            </button>
          </div>
          <div className="space-y-2">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-4 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                {editingCat === c.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="text"
                      value={editCatIdInput}
                      onChange={(e) => setEditCatIdInput(e.target.value.toUpperCase())}
                      maxLength={2}
                      className="w-16 rounded border border-blue-400 p-1.5 text-center font-bold outline-none"
                    />
                    <input
                      type="text"
                      value={editCatNameInput}
                      onChange={(e) => setEditCatNameInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveEditCategory(c.id)}
                      className="flex-1 rounded border border-blue-400 p-1.5 outline-none"
                    />
                    <button onClick={() => handleSaveEditCategory(c.id)} disabled={busy} className="rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60">บันทึก</button>
                    <button onClick={() => setEditingCat(null)} className="rounded bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-300">ยกเลิก</button>
                  </div>
                ) : (
                  <>
                    <span className="rounded bg-slate-200 px-3 py-1 font-bold text-slate-700">{c.id}</span>
                    <span className="flex-1 font-medium text-slate-700">{c.name}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEditingCat(c.id); setEditCatIdInput(c.id); setEditCatNameInput(c.name); }}
                        aria-label={`แก้ไขหมวดหมู่ ${c.id}`}
                        className="rounded p-2 text-blue-500 hover:bg-blue-50"
                      >
                        <Edit size={18} />
                      </button>
                      <button onClick={() => handleDeleteCategory(c.id)} disabled={busy} aria-label={`ลบหมวดหมู่ ${c.id}`} className="rounded p-2 text-red-500 hover:bg-red-50 disabled:opacity-60">
                        <Trash size={18} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeSetTab === "checklist" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="w-full md:w-1/4">
              <label className="mb-1 block text-sm font-medium text-slate-700">หมวดหมู่</label>
              <select
                value={newItemCat}
                onChange={(e) => setNewItemCat(e.target.value)}
                className="w-full rounded-lg border bg-white p-2 outline-none focus:ring-2 focus:ring-blue-500"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                รายละเอียดรายการ{editingItem && <span className="ml-2 text-blue-600">(กำลังแก้ไข {editingItem.code})</span>}
              </label>
              <input
                type="text"
                value={newItemDesc}
                onChange={(e) => setNewItemDesc(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveItem()}
                placeholder="พิมพ์รายละเอียด..."
                className="w-full rounded-lg border p-2 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button onClick={handleSaveItem} disabled={busy} className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
              {editingItem ? <Save size={18} /> : <Plus size={18} />}
              {editingItem ? "อัปเดต" : "เพิ่มรายการ"}
            </button>
            {editingItem && (
              <button onClick={() => { setEditingItem(null); setNewItemDesc(""); }} className="rounded-lg bg-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-300">
                ยกเลิก
              </button>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <div className="max-h-[65vh] overflow-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-slate-100 text-sm text-slate-600">
                  <tr>
                    <th onClick={() => sortChecklist("code")} className="w-24 cursor-pointer select-none p-3 font-semibold hover:bg-slate-200">
                      Code <ArrowUpDown size={14} className="ml-1 inline" />
                    </th>
                    <th onClick={() => sortChecklist("catId")} className="w-24 cursor-pointer select-none p-3 font-semibold hover:bg-slate-200">
                      Cat <ArrowUpDown size={14} className="ml-1 inline" />
                    </th>
                    <th className="p-3 font-semibold">Description</th>
                    <th className="w-24 p-3 text-center font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedChecklist.map((item) => (
                    <tr key={item.id} className={editingItem?.id === item.id ? "bg-blue-50" : "hover:bg-slate-50"}>
                      <td className="p-3 text-sm font-bold text-slate-600">{item.code}</td>
                      <td className="p-3"><span className="rounded bg-slate-200 px-2 py-1 text-xs font-bold">{item.catId}</span></td>
                      <td className="p-3 text-sm text-slate-700">{item.desc}</td>
                      <td className="p-3">
                        <div className="flex justify-center gap-2">
                          <button
                            onClick={() => { setEditingItem(item); setNewItemDesc(item.desc); setNewItemCat(item.catId); }}
                            aria-label={`แก้ไข ${item.code}`}
                            className="rounded p-1.5 text-blue-600 hover:bg-blue-50"
                          >
                            <Edit size={16} />
                          </button>
                          <button onClick={() => handleDeleteItem(item.id)} disabled={busy} aria-label={`ลบ ${item.code}`} className="rounded p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-60">
                            <Trash size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeSetTab === "email" && (
        <div className="flex flex-col gap-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row">
          <div className="border-slate-200 md:w-1/3 md:border-r md:pr-6">
            <h3 className="mb-4 font-bold text-slate-700">เลือกโรงแรม</h3>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-2">
              {properties.map((p) => (
                <button
                  key={p}
                  onClick={() => setSelectedProp(p)}
                  className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
                    selectedProp === p ? "border-blue-500 bg-blue-50 font-bold text-blue-700" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {p}
                  {!emailSettings[p]?.recipients?.trim() && (
                    <span className="ml-2 text-[10px] font-medium text-amber-600">ยังไม่มีผู้รับ</span>
                  )}
                </button>
              ))}
              {properties.length === 0 && <div className="text-sm text-slate-500">กรุณาเพิ่มโรงแรมก่อน</div>}
            </div>
          </div>
          {selectedProp ? (
            // Keyed by property: switching property starts its form from what
            // is saved for it (or the prototype's default subject/body).
            <EmailForm
              key={selectedProp}
              property={selectedProp}
              saved={emailSettings[selectedProp]}
              busy={busy}
              onSave={(form) => handleSaveEmail(selectedProp, form)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-500">เลือกโรงแรมทางซ้ายเพื่อตั้งค่าอีเมล</div>
          )}
        </div>
      )}

      {activeSetTab === "template" && (
        <div className="flex flex-col gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:h-[800px] lg:flex-row">
          {/* Variables Sidebar */}
          <div className="flex max-h-[500px] w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50 lg:max-h-none lg:w-1/3">
            <div className="border-b border-slate-200 bg-white p-4">
              <h3 className="mb-2 flex items-center gap-2 font-bold text-slate-700">
                <FileCode2 size={18} /> Insert Variables
              </h3>
              <p className="mb-3 text-xs text-slate-500">
                คลิกที่ตัวแปรเพื่อแทรกลงใน HTML ตรงตำแหน่งเคอร์เซอร์ หรือกด Copy เพื่อคัดลอกไปวางเอง
              </p>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="ค้นหาตัวแปร (เช่น A001)..."
                  value={varSearch}
                  onChange={(e) => setVarSearch(e.target.value)}
                  className="w-full rounded-lg border py-2 pl-8 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {filteredVars.map((v) => (
                <div key={v} className="flex items-center justify-between rounded border border-slate-200 bg-white p-2 shadow-sm transition-colors hover:border-blue-300">
                  <button
                    onClick={() => insertVariable(v)}
                    title="คลิกเพื่อแทรกใน HTML"
                    className="break-all text-left font-mono text-xs text-slate-700 hover:text-blue-600"
                  >
                    {`{{${v}}}`}
                  </button>
                  <button
                    onClick={() => copyVariable(v)}
                    className="ml-2 whitespace-nowrap rounded bg-blue-50 px-2 py-1 text-[10px] text-blue-600 hover:bg-blue-100"
                  >
                    Copy
                  </button>
                </div>
              ))}
              {filteredVars.length === 0 && <p className="text-center text-xs text-slate-400">ไม่พบตัวแปร</p>}
            </div>
          </div>

          {/* Main Area: Editor & Preview */}
          <div className="flex min-h-[700px] flex-1 flex-col space-y-4 lg:min-h-0">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-blue-200 bg-blue-50 p-6">
              <div>
                <h3 className="mb-1 flex items-center gap-2 font-bold text-blue-900">
                  <FileSpreadsheet size={20} /> ตัวแก้ไขโครงสร้าง HTML (HTML Template Editor)
                </h3>
                <p className="text-sm text-blue-700">แก้ไข Code HTML ของ Report หรือกดปุ่มโหลดเทมเพลต NARAI เริ่มต้น</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setTemplateDraft(generateDefaultTemplate(categories, checklistMaster));
                    showToast("โหลดโครงสร้าง NARAI Format ทับสำเร็จ กรุณากดบันทึก!", "success");
                  }}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-amber-600"
                >
                  โหลด NARAI Format อัปเดตล่าสุด
                </button>
                <button
                  onClick={handleSaveTemplate}
                  disabled={busy}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white shadow-sm transition-all hover:bg-blue-700 disabled:opacity-60"
                >
                  <Save size={18} /> บันทึก Template
                </button>
              </div>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 p-3">
                <span className="text-sm font-bold text-slate-700">HTML Editor</span>
                {templateDraft !== settings.template && <span className="text-xs font-medium text-amber-600">ยังไม่ได้บันทึก</span>}
              </div>
              <div className="flex flex-1 overflow-hidden">
                <textarea
                  ref={templateRef}
                  value={templateDraft}
                  onChange={(e) => setTemplateDraft(e.target.value)}
                  className="h-full min-h-[250px] w-full resize-none bg-slate-900 p-4 font-mono text-sm text-slate-200 outline-none"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 p-3">
                <span className="text-sm font-bold text-slate-700">Preview ตัวอย่าง (Mockup Data)</span>
              </div>
              <div className="min-h-[250px] flex-1 overflow-y-auto bg-slate-200 p-6">
                <div className="min-h-full w-full border border-slate-300 bg-white p-8 shadow-md" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function EmailForm({
  property,
  saved,
  busy,
  onSave,
}: {
  property: string;
  saved: OshEmailConfig | undefined;
  busy: boolean;
  onSave: (form: OshEmailConfig) => void;
}) {
  const [emailForm, setEmailForm] = useState<OshEmailConfig>(
    saved || { subject: `[OSH Report] ${property}`, body: "โปรดตรวจสอบรายงาน OSH ตามเอกสารแนบ", recipients: "" },
  );

  return (
    <div className="flex-1 space-y-4">
      <h3 className="mb-4 font-bold text-slate-700">ตั้งค่าอีเมลสำหรับ: {property}</h3>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">ผู้รับ (To, CC - คั่นด้วยลูกน้ำ)</label>
        <input
          type="text"
          value={emailForm.recipients}
          onChange={(e) => setEmailForm({ ...emailForm, recipients: e.target.value })}
          placeholder="gm@hotel.com, safety@hotel.com"
          className="w-full rounded-lg border p-2.5 outline-none focus:border-blue-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">หัวข้ออีเมล (Subject)</label>
        <input
          type="text"
          value={emailForm.subject}
          onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })}
          className="w-full rounded-lg border p-2.5 outline-none focus:border-blue-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">เนื้อหาอีเมล (Body)</label>
        <textarea
          value={emailForm.body}
          onChange={(e) => setEmailForm({ ...emailForm, body: e.target.value })}
          className="min-h-[150px] w-full rounded-lg border p-2.5 outline-none focus:border-blue-500"
        />
      </div>
      <p className="text-xs text-slate-500">
        เมื่อกด Confirm &amp; Submit ในหน้า OSH Form ระบบจะส่งอีเมลนี้ไปยังผู้รับด้านบน พร้อมไฟล์ Report (HTML) แนบ และลิงก์เปิดดู Report ในระบบ
      </p>
      <button
        onClick={() => onSave(emailForm)}
        disabled={busy}
        className="flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        <Save size={18} /> บันทึกการตั้งค่า
      </button>
    </div>
  );
}
