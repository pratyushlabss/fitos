"use client";

import dynamic from "next/dynamic";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { type Drag } from "@/components/three/HomeScene";
import { isLightTheme, use3D, useActive } from "@/components/three/support";

const HomeScene = dynamic(() => import("@/components/three/HomeScene"), { ssr: false, loading: () => null });

// Fixed aspect so the HTML overlays line up with the 3D ring (left) and orb (right) and with the SVG fallback.
export function HomeHero({ ratio, streak, center, orbLabel }: { ratio: number; streak: number; center: ReactNode; orbLabel: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const three = use3D();
  const active = useActive(ref);
  const drag = useRef<Drag>({ x: 0, y: 0 });
  const start = useRef<{ x: number; y: number } | null>(null);
  const [light, setLight] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const update = () => setLight(isLightTheme());
    update();
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", update);
    window.addEventListener("fitos-ui", update);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("fitos-ui", update);
    };
  }, []);

  useEffect(() => {
    if (!three) return;
    const timer = window.setTimeout(() => setReady(true), 50);
    return () => window.clearTimeout(timer);
  }, [three]);

  const showScene = three && ready;

  return (
    <div
      ref={ref}
      className="relative aspect-[11/8] w-full touch-pan-y select-none"
      onPointerDown={(event) => (start.current = { x: event.clientX, y: event.clientY })}
      onPointerMove={(event) => {
        if (!start.current) return;
        drag.current = {
          x: Math.max(-0.6, Math.min(0.6, (event.clientX - start.current.x) / 160)),
          y: Math.max(-0.5, Math.min(0.5, (event.clientY - start.current.y) / 160)),
        };
      }}
      onPointerUp={() => {
        start.current = null;
        drag.current = { x: 0, y: 0 };
      }}
      onPointerCancel={() => {
        start.current = null;
        drag.current = { x: 0, y: 0 };
      }}
    >
      {showScene ? <HomeScene ratio={ratio} streak={streak} light={light} active={active} drag={drag} /> : <StaticHero ratio={ratio} streak={streak} />}
      <div className="pointer-events-none absolute inset-y-0 left-0 flex w-[75%] items-center justify-center">{center}</div>
      <div className="pointer-events-none absolute bottom-[14%] right-0 flex w-[34%] justify-center">{orbLabel}</div>
    </div>
  );
}

// Same layout in flat SVG: reduced motion, 3D off, or no WebGL.
export function StaticHero({ ratio, streak }: { ratio: number; streak: number }) {
  const r = 118;
  const cx = 165;
  const cy = 160;
  const circumference = 2 * Math.PI * r;
  const filled = Math.min(Math.max(ratio, 0), 1);
  const orbR = 22 + (Math.min(streak, 60) / 60) * 14;
  const sides = streak >= 30 ? 12 : streak >= 7 ? 8 : streak >= 3 ? 6 : 5;
  const pts = Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    return [370 + Math.cos(a) * orbR, 110 + Math.sin(a) * orbR];
  });
  return (
    <svg viewBox="0 0 440 320" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgb(var(--s3))" strokeWidth="22" />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="rgb(var(--max))"
        strokeWidth="26"
        strokeLinecap="round"
        strokeDasharray={`${circumference * filled} ${circumference}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <polygon points={pts.map((p) => p.join(",")).join(" ")} fill={streak > 0 ? "rgb(var(--max))" : "rgb(var(--s3))"} />
      {pts.map((p, i) => (
        <line key={i} x1="370" y1="110" x2={p[0]} y2={p[1]} stroke="rgb(var(--bg))" strokeOpacity="0.35" strokeWidth="1" />
      ))}
    </svg>
  );
}
