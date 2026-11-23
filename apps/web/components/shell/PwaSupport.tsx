"use client";

import { Share, SquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";

const DISMISS_KEY = "fitos-install-hint-dismissed";

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
  return ios && !otherBrowser;
}

function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export function PwaSupport() {
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      dismissed = false;
    }
    if (!dismissed && isIosSafari() && !isStandalone()) setShowHint(true);
  }, []);

  if (!showHint) return null;

  function dismiss() {
    setShowHint(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // private mode: the hint simply comes back next visit
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 mx-auto w-[calc(100%-32px)] max-w-[398px] rounded-2xl border border-emerald-300/25 bg-slate-900/95 p-4 shadow-xl backdrop-blur" role="dialog" aria-label="Install FitOS">
      <button className="absolute right-2 top-2 rounded-full p-1.5 text-slate-400" onClick={dismiss} aria-label="Dismiss">
        <X size={16} />
      </button>
      <p className="pr-6 text-sm font-semibold text-white">Install FitOS on your iPhone</p>
      <p className="mt-1 text-sm leading-6 text-slate-300">
        Tap <Share size={15} className="inline align-[-2px] text-sky-300" /> Share, then <SquarePlus size={15} className="inline align-[-2px]" /> Add to Home Screen. It opens full screen and stays signed in.
      </p>
    </div>
  );
}
