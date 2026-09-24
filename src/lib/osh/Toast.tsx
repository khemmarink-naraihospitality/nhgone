"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";

/**
 * The prototype's bottom-right toast, as it was - every page message in OSH
 * Checklist goes through this rather than alert() (which this app doesn't
 * use anywhere new). Errors stay up a little longer than confirmations: they
 * usually need reading, not just noticing.
 */

export type ToastType = "info" | "success" | "error";

export interface ToastState {
  msg: string;
  type: ToastType;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, type: ToastType = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, type });
    timer.current = setTimeout(() => setToast(null), type === "error" ? 5000 : 3000);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { toast, showToast };
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div
      role="status"
      className={`no-print fixed bottom-6 right-6 z-[60] flex max-w-md items-center gap-2 rounded-lg px-6 py-3 font-medium text-white shadow-lg animate-bounce ${
        toast.type === "error" ? "bg-red-500" : toast.type === "success" ? "bg-emerald-500" : "bg-blue-500"
      }`}
    >
      {toast.type === "error" && <AlertTriangle size={18} className="shrink-0" />}
      {toast.type === "success" && <Check size={18} className="shrink-0" />}
      {toast.msg}
    </div>
  );
}
