"use client";

import type { FoodDraft, MealItemSource, MealType } from "@fitos/types";
import { motion, useReducedMotion } from "framer-motion";
import { Barcode, Camera, Flashlight, FlashlightOff, ImageIcon, Search, Type, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { DraftReview } from "@/components/nutrition/DraftReview";
import { analyzePhoto, lookupBarcode } from "@/lib/data/nutrition";
import { defaultMealType, MEAL_LABELS, MEAL_TYPES } from "@/lib/logic/dashboard";
import { haptic } from "@/lib/useReducedMotion";

const BarcodeScanner = dynamic(() => import("./BarcodeScanner").then((mod) => mod.BarcodeScanner), { ssr: false });

type DetectorLike = { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> };
type DetectorCtor = new (options: { formats: string[] }) => DetectorLike;
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

type Mode = "photo" | "barcode";
type Phase = { kind: "live" } | { kind: "analysing"; preview: string | null; label: string } | { kind: "review"; draft: FoodDraft; source: MealItemSource } | { kind: "error"; message: string };
type CamState = "starting" | "live" | "denied" | "unavailable";

function barcodeDetector(): DetectorCtor | null {
  const ctor = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

// Full-screen camera: shutter for meal photos, live barcode scanning, gallery, and ways out to typing or search.
export function CameraLogger({
  open,
  onClose,
  day,
  onLogged,
  onUseTab,
}: {
  open: boolean;
  onClose: () => void;
  day: string;
  onLogged: (message: string) => void;
  onUseTab: (tab: "describe" | "search", mealType: MealType) => void;
}) {
  const reduced = useReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const nativeCamera = useRef<HTMLInputElement>(null);
  const handled = useRef(false);
  const [mode, setMode] = useState<Mode>("photo");
  const [phase, setPhase] = useState<Phase>({ kind: "live" });
  const [cam, setCam] = useState<CamState>("starting");
  const [mealType, setMealType] = useState<MealType>(defaultMealType());
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });

  const liveDetector = mode === "barcode" ? barcodeDetector() : null;
  const ownStream = open && phase.kind === "live" && (mode === "photo" || Boolean(liveDetector));

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setTorch({ supported: false, on: false });
  }, []);

  const start = useCallback(async () => {
    if (stream.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCam("unavailable");
      return;
    }
    setCam("starting");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play().catch(() => undefined);
      }
      const track = media.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as TorchCapabilities;
      setTorch({ supported: Boolean(caps.torch), on: false });
      setCam("live");
    } catch (error) {
      stop();
      setCam(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "denied" : "unavailable");
    }
  }, [stop]);

  // Reset each time the view opens.
  useEffect(() => {
    if (!open) return;
    setMode("photo");
    setPhase({ kind: "live" });
    setMealType(defaultMealType());
    handled.current = false;
  }, [open]);

  // The camera runs only while it is visible, and stops when the app goes to the background.
  useEffect(() => {
    if (!ownStream) {
      stop();
      return;
    }
    void start();
    const onVisibility = () => (document.visibilityState === "hidden" ? stop() : void start());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [ownStream, start, stop]);

  // Live barcode scanning with the native BarcodeDetector.
  useEffect(() => {
    if (!liveDetector || !ownStream || cam !== "live") return;
    const detector = new liveDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
    let busy = false;
    const timer = window.setInterval(async () => {
      if (busy || handled.current || !video.current || video.current.readyState < 2) return;
      busy = true;
      try {
        const codes = await detector.detect(video.current);
        if (codes[0]?.rawValue) void handleBarcode(codes[0].rawValue);
      } catch {
        // frame not ready
      } finally {
        busy = false;
      }
    }, 250);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveDetector, ownStream, cam]);

  async function toggleTorch() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch({ supported: true, on: next });
    } catch {
      setTorch({ supported: false, on: false });
    }
  }

  async function handleImage(file: Blob) {
    haptic(12);
    stop();
    const preview = URL.createObjectURL(file);
    setPhase({ kind: "analysing", preview, label: "Finding every food on the plate…" });
    try {
      const { draft } = await analyzePhoto(file, mealType, day);
      if (draft.status === "no_match" || !draft.items.length) setPhase({ kind: "error", message: draft.message ?? "I don't know this one yet. Type it instead or add it manually." });
      else setPhase({ kind: "review", draft, source: "photo_ai" });
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : "Could not read that photo." });
    }
  }

  async function handleBarcode(code: string) {
    if (handled.current) return;
    handled.current = true;
    haptic(12);
    stop();
    setPhase({ kind: "analysing", preview: null, label: `Looking up ${code}…` });
    try {
      const result = await lookupBarcode(code);
      if (result.draft) setPhase({ kind: "review", draft: result.draft, source: "barcode" });
      else setPhase({ kind: "error", message: result.message ?? "That barcode isn't in Open Food Facts yet." });
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : "Barcode lookup failed." });
    }
  }

  function capture() {
    const v = video.current;
    if (!v || cam !== "live" || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    canvas.toBlob((blob) => blob && void handleImage(blob), "image/jpeg", 0.92);
  }

  function backToCamera() {
    if (phase.kind === "analysing" && phase.preview) URL.revokeObjectURL(phase.preview);
    handled.current = false;
    setPhase({ kind: "live" });
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    void handleImage(file);
  }

  if (!open) return null;

  const fileInputs = (
    <>
      <input ref={gallery} type="file" accept="image/*" hidden onChange={(event) => (pickFile(event.target.files?.[0]), (event.target.value = ""))} />
      <input ref={nativeCamera} type="file" accept="image/*" capture="environment" hidden onChange={(event) => (pickFile(event.target.files?.[0]), (event.target.value = ""))} />
    </>
  );

  if (phase.kind === "review") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label="Review food">
        <div className="flex items-center justify-between px-4 pb-2 pt-[calc(env(safe-area-inset-top)+12px)]">
          <h2 className="text-lg font-semibold tracking-tight text-fg">Review before saving</h2>
          <button className="press flex h-11 w-11 items-center justify-center rounded-full text-muted" aria-label="Close" onClick={onClose}>
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
          <DraftReview
            draft={phase.draft}
            mealType={mealType}
            date={day}
            source={phase.source}
            onDone={(message) => {
              onLogged(message);
              onClose();
            }}
            onCancel={backToCamera}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="Log food with the camera">
      {fileInputs}

      {/* Viewfinder, or the captured photo while it is analysed */}
      <div className="absolute inset-0">
        {phase.kind === "analysing" ? (
          <div className="relative h-full w-full">
            {phase.preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={phase.preview} alt="Captured meal" className="h-full w-full object-cover opacity-80" />
            ) : (
              <div className="h-full w-full bg-black" />
            )}
            {!reduced ? (
              <motion.div
                className="absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-white/25 to-transparent"
                initial={{ top: "-10%" }}
                animate={{ top: ["-10%", "100%"] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
                aria-hidden="true"
              />
            ) : null}
          </div>
        ) : ownStream ? (
          <video ref={video} className="h-full w-full object-cover" playsInline muted autoPlay />
        ) : mode === "barcode" && phase.kind === "live" ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="w-full max-w-phone">
              <BarcodeScanner onDetected={(code) => void handleBarcode(code)} />
            </div>
          </div>
        ) : null}
      </div>

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 pb-6 pt-[calc(env(safe-area-inset-top)+8px)]">
        <button className="press flex h-11 w-11 items-center justify-center rounded-full bg-black/40" aria-label="Close camera" onClick={onClose}>
          <X size={20} strokeWidth={1.5} />
        </button>
        <label className="relative">
          <span className="sr-only">Meal</span>
          <select
            className="min-h-[44px] appearance-none rounded-full border border-white/30 bg-black/50 px-4 text-sm font-medium text-white"
            value={mealType}
            onChange={(event) => setMealType(event.target.value as MealType)}
            aria-label="Meal"
          >
            {MEAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {MEAL_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        {torch.supported ? (
          <button className="press flex h-11 w-11 items-center justify-center rounded-full bg-black/40" aria-label={torch.on ? "Turn flash off" : "Turn flash on"} aria-pressed={torch.on} onClick={() => void toggleTorch()}>
            {torch.on ? <Flashlight size={20} strokeWidth={1.5} /> : <FlashlightOff size={20} strokeWidth={1.5} />}
          </button>
        ) : (
          <span className="h-11 w-11" />
        )}
      </div>

      {/* Middle: guidance, analysing state, errors, or the native-camera fallback */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-6 text-center">
        {phase.kind === "analysing" ? (
          <p className="rounded-full bg-black/60 px-4 py-2 text-sm" role="status">
            {phase.label}
          </p>
        ) : phase.kind === "error" ? (
          <div className="w-full max-w-sm rounded-card border border-white/40 bg-black/80 p-5" role="alert">
            <p className="text-sm font-semibold">{phase.message}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="press min-h-[44px] rounded-full bg-white text-sm font-semibold text-black" onClick={backToCamera}>
                Try again
              </button>
              <button className="press min-h-[44px] rounded-full border border-white/40 text-sm" onClick={() => onUseTab("describe", mealType)}>
                Type it instead
              </button>
            </div>
          </div>
        ) : ownStream && (cam === "denied" || cam === "unavailable") ? (
          <div className="w-full max-w-sm space-y-3">
            <p className="text-sm text-white/80">
              {cam === "denied" ? "Camera access is off for FitOS. You can still use your phone's camera:" : "The live camera isn't available here. Use your phone's camera instead:"}
            </p>
            <button className="press flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-semibold text-black" onClick={() => nativeCamera.current?.click()}>
              <Camera size={18} strokeWidth={1.5} /> Open camera
            </button>
          </div>
        ) : mode === "barcode" && ownStream ? (
          <div className="h-36 w-72 rounded-2xl border-2 border-white/80" aria-hidden="true" />
        ) : null}
      </div>

      {/* Bottom controls */}
      {phase.kind === "live" ? (
        <div className="relative z-10 space-y-4 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-8">
          <div className="flex justify-center gap-2">
            <button className="press inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-white/30 bg-black/40 px-4 text-xs" onClick={() => onUseTab("describe", mealType)}>
              <Type size={14} strokeWidth={1.5} /> Type it instead
            </button>
            <button className="press inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-white/30 bg-black/40 px-4 text-xs" onClick={() => onUseTab("search", mealType)}>
              <Search size={14} strokeWidth={1.5} /> Search
            </button>
          </div>
          <div className="grid grid-cols-3 items-center">
            <button className="press flex h-12 w-12 items-center justify-center justify-self-start rounded-full border border-white/30 bg-black/40" aria-label="Choose from gallery" onClick={() => gallery.current?.click()}>
              <ImageIcon size={20} strokeWidth={1.5} />
            </button>
            {mode === "photo" ? (
              <button
                className="press h-[76px] w-[76px] justify-self-center rounded-full border-4 border-white bg-white/90 shadow-[inset_0_0_0_4px_black] disabled:opacity-40"
                aria-label="Take photo"
                disabled={cam !== "live"}
                onClick={capture}
              />
            ) : (
              <p className="justify-self-center text-center text-xs text-white/80">Point at a barcode</p>
            )}
            <div className="flex justify-self-end rounded-full border border-white/30 bg-black/40 p-1" role="group" aria-label="Camera mode">
              <button className={`press flex h-10 w-10 items-center justify-center rounded-full ${mode === "photo" ? "bg-white text-black" : ""}`} aria-label="Photo mode" aria-pressed={mode === "photo"} onClick={() => setMode("photo")}>
                <Camera size={18} strokeWidth={1.5} />
              </button>
              <button className={`press flex h-10 w-10 items-center justify-center rounded-full ${mode === "barcode" ? "bg-white text-black" : ""}`} aria-label="Barcode mode" aria-pressed={mode === "barcode"} onClick={() => setMode("barcode")}>
                <Barcode size={18} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
