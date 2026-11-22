"use client";

import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";

type ToastTone = "info" | "success" | "error";
type ToastState = { message: string; tone: ToastTone } | null;

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((message: string, tone: ToastTone = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone });
    timer.current = setTimeout(() => setToast(null), 2800);
  }, []);
  const toneClass =
    toast?.tone === "error"
      ? "border-rose-400/30 text-rose-100"
      : toast?.tone === "success"
        ? "border-emerald-400/30 text-emerald-100"
        : "border-white/10 text-white";
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+12px)] z-50 flex justify-center px-4" role="status">
          <div className={`max-w-phone rounded-2xl border bg-slate-900/95 px-4 py-3 text-sm shadow-xl backdrop-blur ${toneClass}`}>{toast.message}</div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
