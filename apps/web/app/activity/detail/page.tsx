"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";

import { RouteMap } from "@/components/activity/RouteMap";
import { useAuth, useProfile } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { ShareCardButton } from "@/components/ui/ShareCardButton";
import { StatCard } from "@/components/ui/StatCard";
import { ErrorState, SkeletonList } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { deleteActivity, getActivity } from "@/lib/data/activities";
import { formatDuration, shortDate } from "@/lib/logic/format";
import { caloriesEstimate, formatDistance, formatPace } from "@/lib/logic/geo";
import type { ShareCardData } from "@/lib/shareCard";

export default function ActivityDetailPage() {
  return (
    <Suspense fallback={<SkeletonList rows={3} height="h-32" />}>
      <ActivityDetail />
    </Suspense>
  );
}

function ActivityDetail() {
  const id = useSearchParams().get("id") ?? "";
  const { userId } = useAuth();
  const profile = useProfile();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const activity = useQuery({ queryKey: ["activity", id], queryFn: () => getActivity(id), enabled: Boolean(id) });
  const remove = useMutation({
    mutationFn: () => deleteActivity(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["activities"] });
      router.replace("/activity");
    },
    onError: (error) => toast(error.message, "error"),
  });

  const share = useMemo<ShareCardData | null>(() => {
    const a = activity.data;
    if (!a) return null;
    return {
      eyebrow: a.sport,
      title: a.title ?? "Activity",
      subtitle: shortDate(a.started_at),
      stats: [
        { label: "Distance", value: formatDistance(a.distance_m) },
        { label: "Time", value: formatDuration(a.duration_s) },
        { label: a.sport === "ride" ? "Speed" : "Pace", value: a.sport === "ride" && a.duration_s > 0 ? `${((a.distance_m / 1000) / (a.duration_s / 3600)).toFixed(1)} km/h` : formatPace(a.avg_pace_s_per_km) },
        { label: "Climb", value: `${Math.round(a.elevation_gain_m)} m` },
      ],
      lines: [`${caloriesEstimate(a.sport, a.distance_m)} kcal estimated`],
      footer: `@${profile.username ?? "fitos"}`,
    };
  }, [activity.data, profile.username]);

  if (!id) return <ErrorState message="No activity selected." />;
  if (activity.isPending) return <SkeletonList rows={3} height="h-32" />;
  if (activity.isError) return <ErrorState message={activity.error.message} onRetry={() => void activity.refetch()} />;
  if (!activity.data) return <ErrorState message="This activity is private or no longer exists." />;
  const a = activity.data;
  const mine = a.user_id === userId;

  return (
    <>
      <button onClick={() => router.back()} className="mb-5 inline-flex items-center gap-2 text-sm text-slate-400">
        <ArrowLeft size={16} /> Back
      </button>
      <header className="mb-5">
        <p className="text-xs uppercase tracking-[0.18em] text-accent">{a.sport}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{a.title ?? "Activity"}</h1>
        <p className="mt-1 text-sm text-muted">
          {shortDate(a.started_at)} · {a.source === "gpx" ? "Imported GPX" : "Recorded with GPS"}
        </p>
      </header>
      <div className="space-y-5">
        <div className="overflow-hidden rounded-3xl border border-white/10">
          <RouteMap points={a.polyline} label="No route recorded" height={220} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Distance" value={formatDistance(a.distance_m)} accent />
          <StatCard label="Time" value={formatDuration(a.duration_s)} />
          <StatCard label="Pace" value={formatPace(a.avg_pace_s_per_km)} />
          <StatCard label="Climb" value={`${Math.round(a.elevation_gain_m)} m`} hint={`${caloriesEstimate(a.sport, a.distance_m)} kcal est.`} />
        </div>
        {mine ? (
          <div className="grid grid-cols-2 gap-2">
            <ShareCardButton data={share} filename={`fitos-activity-${a.id.slice(0, 8)}.png`} label="Share card" className="w-full" />
            <Button variant="ghost" className="w-full gap-2 text-rose-300" disabled={remove.isPending} onClick={() => window.confirm("Delete this activity?") && remove.mutate()}>
              <Trash2 size={15} /> Delete
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
