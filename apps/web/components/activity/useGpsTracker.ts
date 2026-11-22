"use client";

import type { ActivitySport, GeoPoint } from "@fitos/types";
import { useCallback, useEffect, useRef, useState } from "react";

import { distanceBetween } from "@/lib/logic/geo";

const STORAGE_KEY = "fitos-live-activity";
const MAX_ACCURACY_M = 35;

export type TrackerState = {
  sport: ActivitySport;
  startedAt: string;
  points: GeoPoint[];
  segments: number[];
  movingMs: number;
  resumedAt: number | null;
  distanceM: number;
};

type WakeLockSentinelLike = { release: () => Promise<void> };

function load(): TrackerState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TrackerState) : null;
  } catch {
    return null;
  }
}

function persist(state: TrackerState | null) {
  try {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable; tracking continues in memory
  }
}

export function useGpsTracker() {
  const [state, setState] = useState<TrackerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const watchId = useRef<number | null>(null);
  const wakeLock = useRef<WakeLockSentinelLike | null>(null);
  const stateRef = useRef<TrackerState | null>(null);

  const update = useCallback((next: TrackerState | null) => {
    stateRef.current = next;
    setState(next);
    persist(next);
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };
      wakeLock.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      wakeLock.current = null;
    }
  }, []);

  const stopWatch = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    void wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
  }, []);

  const startWatch = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("This device does not provide GPS to the browser.");
      return;
    }
    stopWatch();
    void requestWakeLock();
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        setError(null);
        setAccuracy(position.coords.accuracy);
        const current = stateRef.current;
        if (!current || current.resumedAt === null) return;
        if (position.coords.accuracy > MAX_ACCURACY_M) return;
        const point: GeoPoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          elevation_m: position.coords.altitude ?? null,
          recorded_at: new Date(position.timestamp).toISOString(),
        };
        const last = current.points.at(-1);
        const segmentStart = current.segments.at(-1) ?? 0;
        const sameSegment = last && current.points.length > segmentStart;
        const step = sameSegment && last ? distanceBetween(last, point) : 0;
        if (sameSegment && step < 3) return;
        update({ ...current, points: [...current.points, point], distanceM: current.distanceM + step });
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission is off. Enable it for this app in Settings › Privacy › Location Services."
            : "Waiting for a GPS signal. Move to open sky.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
  }, [requestWakeLock, stopWatch, update]);

  useEffect(() => {
    const restored = load();
    if (restored) {
      stateRef.current = restored;
      setState(restored);
      if (restored.resumedAt !== null) startWatch();
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && stateRef.current?.resumedAt !== null && stateRef.current) void requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      stopWatch();
    };
  }, [startWatch, stopWatch, requestWakeLock]);

  const start = useCallback(
    (sport: ActivitySport) => {
      update({ sport, startedAt: new Date().toISOString(), points: [], segments: [0], movingMs: 0, resumedAt: Date.now(), distanceM: 0 });
      startWatch();
    },
    [startWatch, update],
  );

  const pause = useCallback(() => {
    const current = stateRef.current;
    if (!current || current.resumedAt === null) return;
    update({ ...current, movingMs: current.movingMs + (Date.now() - current.resumedAt), resumedAt: null });
    stopWatch();
  }, [stopWatch, update]);

  const resume = useCallback(() => {
    const current = stateRef.current;
    if (!current || current.resumedAt !== null) return;
    update({ ...current, resumedAt: Date.now(), segments: [...current.segments, current.points.length] });
    startWatch();
  }, [startWatch, update]);

  const reset = useCallback(() => {
    stopWatch();
    update(null);
  }, [stopWatch, update]);

  const movingSeconds = (now: number) => {
    if (!state) return 0;
    return (state.movingMs + (state.resumedAt !== null ? now - state.resumedAt : 0)) / 1000;
  };

  return { state, error, accuracy, start, pause, resume, reset, movingSeconds };
}
