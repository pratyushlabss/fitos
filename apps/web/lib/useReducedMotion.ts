"use client";

import { useEffect, useState } from "react";

// True when the system asks for reduced motion or the user turned 3D off in Settings.
export function useCalmMode(): { reduced: boolean; no3d: boolean } {
  const [state, setState] = useState({ reduced: false, no3d: false });
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setState({ reduced: media.matches, no3d: media.matches || document.documentElement.hasAttribute("data-no-3d") });
    update();
    media.addEventListener("change", update);
    window.addEventListener("fitos-ui", update);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("fitos-ui", update);
    };
  }, []);
  return state;
}

export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {}
}
