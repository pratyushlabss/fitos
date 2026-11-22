"use client";

import { useEffect, useId, useRef, useState } from "react";

export function BarcodeScanner({ onDetected }: { onDetected: (code: string) => void }) {
  const elementId = `scanner-${useId().replace(/:/g, "")}`;
  const [error, setError] = useState<string | null>(null);
  const detected = useRef(onDetected);
  detected.current = onDetected;

  useEffect(() => {
    let stopped = false;
    let scanner: { stop: () => Promise<void>; clear: () => void; isScanning: boolean } | null = null;
    (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        if (stopped) return;
        const instance = new Html5Qrcode(elementId, {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
          ],
          useBarCodeDetectorIfSupported: true,
        });
        scanner = instance;
        await instance.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 140 }, aspectRatio: 1.6 },
          (text) => {
            if (stopped) return;
            stopped = true;
            void instance.stop().catch(() => undefined);
            detected.current(text);
          },
          () => undefined,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Camera unavailable. Allow camera access, or type the code below.");
      }
    })();
    return () => {
      stopped = true;
      if (scanner?.isScanning) void scanner.stop().catch(() => undefined);
    };
  }, [elementId]);

  return (
    <div>
      <div id={elementId} className="overflow-hidden rounded-2xl border border-white/10 bg-black" style={{ minHeight: 200 }} />
      {error ? <p className="mt-2 text-xs text-amber-200">{error}</p> : <p className="mt-2 text-xs text-slate-500">Point the camera at the barcode.</p>}
    </div>
  );
}
