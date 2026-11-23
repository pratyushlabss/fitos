"use client";

import { AnimatePresence, motion, type PanInfo, useDragControls, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

// Spring bottom sheet; drag the handle or header down to dismiss.
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  const controls = useDragControls();
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
          <motion.button
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.div
            className="relative flex max-h-[88dvh] w-full max-w-phone flex-col rounded-t-[28px] border border-b-0 border-line bg-surface-1 pb-[max(env(safe-area-inset-bottom),16px)]"
            initial={{ y: reduced ? 0 : "100%", opacity: reduced ? 0 : 1 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: reduced ? 0 : "100%", opacity: reduced ? 0 : 1 }}
            transition={{ type: "spring", damping: 32, stiffness: 340 }}
            drag={reduced ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragListener={false}
            dragControls={controls}
            onDragEnd={onDragEnd}
          >
            <div className="touch-none" onPointerDown={(event) => controls.start(event)}>
              <div className="flex h-6 cursor-grab items-center justify-center" aria-hidden="true">
                <span className="h-1 w-10 rounded-full bg-fg/25" />
              </div>
            <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-1">
              <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="press -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-muted">
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>
            </div>
            <div className="overflow-y-auto overscroll-contain px-5 pb-2">{children}</div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
