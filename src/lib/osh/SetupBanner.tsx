"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Shown on all three OSH pages when the backing tables aren't there yet (or
 * the settings couldn't be loaded at all). The pages keep working on the
 * built-in defaults either way - this only says why a save is about to fail,
 * before someone fills in 136 rows and finds out on Submit.
 */
export default function SetupBanner({ storageReady, loadError }: { storageReady: boolean; loadError: string | null }) {
  if (storageReady && !loadError) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
      <div>
        {!storageReady ? (
          <>
            <p className="font-bold">ยังไม่ได้ติดตั้งฐานข้อมูลของ OSH Checklist</p>
            <p className="mt-1">
              ใช้งานด้วยค่าเริ่มต้นไปก่อนได้ แต่จะยังบันทึกแบบร่าง ส่ง Report หรือบันทึกการตั้งค่าไม่ได้ จนกว่าจะรัน{" "}
              <code className="rounded bg-amber-100 px-1">api/sql/osh_checklist.sql</code> ใน Supabase SQL Editor
            </p>
          </>
        ) : (
          <>
            <p className="font-bold">โหลดการตั้งค่า OSH ไม่สำเร็จ - กำลังแสดงค่าเริ่มต้น</p>
            <p className="mt-1">{loadError}</p>
          </>
        )}
      </div>
    </div>
  );
}
