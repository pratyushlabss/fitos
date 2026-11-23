"use client";

import { useEffect } from "react";

import { haptic } from "@/lib/useReducedMotion";

// Every button and link-button vibrates briefly on press; the 0.97 scale lives in globals.css.
export function PressFeedback() {
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = (event.target as HTMLElement | null)?.closest("button:not(:disabled), [role='button'], a[data-press]");
      if (target) haptic(8);
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  return null;
}
