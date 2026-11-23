"use client";

import { useEffect, useState } from "react";

// Resolved monochrome tokens as CSS colour strings, for libraries that need literal colours (charts, canvas, QR).
export type Tokens = { bg: string; s1: string; s2: string; s3: string; line: string; muted: string; fg: string; max: string };

const DARK: Tokens = { bg: "#000000", s1: "#0A0A0A", s2: "#141414", s3: "#1F1F1F", line: "#2A2A2A", muted: "#8A8A8A", fg: "#EDEDED", max: "#FFFFFF" };

export function readTokens(): Tokens {
  if (typeof window === "undefined") return DARK;
  const style = getComputedStyle(document.documentElement);
  const get = (name: string) => `rgb(${style.getPropertyValue(`--${name}`).trim().split(/\s+/).join(",")})`;
  return { bg: get("bg"), s1: get("s1"), s2: get("s2"), s3: get("s3"), line: get("line"), muted: get("muted"), fg: get("fg"), max: get("max") };
}

export function useTokens(): Tokens {
  const [tokens, setTokens] = useState<Tokens>(DARK);
  useEffect(() => {
    const update = () => setTokens(readTokens());
    update();
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", update);
    window.addEventListener("fitos-ui", update);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("fitos-ui", update);
    };
  }, []);
  return tokens;
}

export function chartTheme(t: Tokens) {
  return {
    grid: t.line,
    tick: { fill: t.muted, fontSize: 11, fontFamily: "var(--font-geist-mono)" },
    tooltip: { background: t.s1, border: `1px solid ${t.line}`, borderRadius: 14, color: t.fg, fontFamily: "var(--font-geist-mono)", fontSize: 12 },
    cursor: { fill: t.max, fillOpacity: 0.04 },
  };
}
