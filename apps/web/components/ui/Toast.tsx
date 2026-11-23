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
      ? "border-fg font-semibold text-fg"
      : toast?.tone === "success"
        ? "border-line bg-max text-bg font-medium"
        : "border-line text-fg";
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+12px)] z-50 flex justify-center px-4" role="status">
          <div className={`max-w-phone rounded-full border bg-surface-1/95 px-5 py-3 text-sm backdrop-blur-xl ${toneClass}`}>{toast.message}</div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
