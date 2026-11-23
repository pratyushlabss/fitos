"use client";

import { type RefObject, useEffect, useState } from "react";

import { useCalmMode } from "@/lib/useReducedMotion";

let webgl: boolean | null = null;
export function hasWebGL(): boolean {
  if (webgl !== null) return webgl;
  try {
    const canvas = document.createElement("canvas");
    webgl = Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    webgl = false;
  }
  return webgl;
}

// 3D runs only with WebGL, no reduced-motion request and the 3D preference on.
export function use3D(): boolean {
  const { no3d } = useCalmMode();
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(!no3d && hasWebGL()), [no3d]);
  return ok;
}

// True while the element is on screen and the tab is visible; drives frameloop "always" vs "never".
export function useActive(ref: RefObject<HTMLElement>): boolean {
  const [onScreen, setOnScreen] = useState(true);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.05 });
    observer.observe(node);
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ref]);
  return onScreen && visible;
}

export function isLightTheme(): boolean {
  const root = document.documentElement;
  const forced = root.getAttribute("data-theme");
  if (forced) return forced === "light";
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}
