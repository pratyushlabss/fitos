"use client";

import { RotateCw } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

const THRESHOLD = 70;

export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    const onStart = (event: TouchEvent) => {
      start.current = window.scrollY <= 0 ? event.touches[0].clientY : null;
    };
    const onMove = (event: TouchEvent) => {
      if (start.current === null) return;
      const distance = event.touches[0].clientY - start.current;
      if (distance <= 0 || window.scrollY > 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      pullRef.current = Math.min(distance * 0.5, 110);
      setPull(pullRef.current);
    };
    const onEnd = () => {
      const reached = pullRef.current >= THRESHOLD;
      start.current = null;
      pullRef.current = 0;
      setPull(0);
      if (!reached) return;
      setRefreshing(true);
      void refreshRef.current().finally(() => setRefreshing(false));
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const visible = refreshing || pull > 8;
  return (
    <>
      <div
        className="flex justify-center overflow-hidden text-emerald-300 transition-[height] duration-150"
        style={{ height: refreshing ? 40 : visible ? pull * 0.6 : 0 }}
        aria-live="polite"
      >
        {visible ? (
          <RotateCw
            size={18}
            className={`mt-2 ${refreshing ? "animate-spin" : ""}`}
            style={{ transform: refreshing ? undefined : `rotate(${pull * 3}deg)`, opacity: Math.min(1, pull / THRESHOLD + (refreshing ? 1 : 0)) }}
          />
        ) : null}
      </div>
      {children}
    </>
  );
}
