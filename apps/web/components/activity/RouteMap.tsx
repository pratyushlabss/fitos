import type { GeoPoint } from "@fitos/types";
import { MapPin } from "lucide-react";

import { projectRoute } from "@/lib/logic/geo";

export function RouteMap({ points, label, height = 144 }: { points: GeoPoint[]; label?: string; height?: number }) {
  const width = 400;
  const path = projectRoute(points, width, height, 14);
  return (
    <div
      className="relative flex items-center justify-center bg-[radial-gradient(circle_at_48%_45%,rgba(16,185,129,.24),transparent_34%),linear-gradient(135deg,#101827,#071019)]"
      style={{ height }}
    >
      {path ? (
        <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" aria-label="Route">
          <path d={path} fill="none" stroke="#3DDC97" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
      {label && !path ? (
        <div className="relative flex items-center gap-2 rounded-full border border-emerald-300/20 bg-slate-950/70 px-4 py-2 text-sm text-emerald-200">
          <MapPin size={16} /> {label}
        </div>
      ) : null}
    </div>
  );
}
