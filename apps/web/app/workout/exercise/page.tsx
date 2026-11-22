"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useProfile } from "@/components/auth/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/States";
import { exerciseHistory, listPersonalRecords } from "@/lib/data/workouts";
import { shortDate } from "@/lib/logic/format";
import { formatWeight, toDisplayWeight, weightUnit } from "@/lib/logic/units";
import { estimatedOneRepMax } from "@/lib/logic/workout";

export default function ExerciseProgressPage() {
  return (
    <Suspense fallback={<SkeletonList rows={3} height="h-40" />}>
      <ExerciseProgress />
    </Suspense>
  );
}

function ExerciseProgress() {
  const name = useSearchParams().get("name") ?? "";
  const units = useProfile().unit_system;
  const router = useRouter();
  const history = useQuery({ queryKey: ["exercise-history", name], queryFn: () => exerciseHistory(name), enabled: Boolean(name) });
  const records = useQuery({ queryKey: ["records", name], queryFn: () => listPersonalRecords(name), enabled: Boolean(name) });

  const points = useMemo(
    () =>
      (history.data ?? [])
        .map((session) => {
          const working = session.sets.filter((set) => set.completed && !set.is_warmup && set.reps > 0);
          if (working.length === 0) return null;
          return {
            date: new Date(session.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
            e1rm: toDisplayWeight(Math.max(...working.map((set) => estimatedOneRepMax(set.weight_kg, set.reps))), units),
            top: toDisplayWeight(Math.max(...working.map((set) => set.weight_kg)), units),
            reps: Math.max(...working.map((set) => set.reps)),
          };
        })
        .filter((point): point is NonNullable<typeof point> => point !== null),
    [history.data, units],
  );

  const best = (type: string) => Math.max(0, ...(records.data ?? []).filter((record) => record.record_type === type).map((record) => record.value));
  const bodyweight = points.length > 0 && points.every((point) => point.top === 0);

  return (
    <>
      <button onClick={() => router.back()} className="mb-5 inline-flex items-center gap-2 text-sm text-slate-400">
        <ArrowLeft size={16} /> Back
      </button>
      <ScreenHeader eyebrow="Exercise" title={name || "Exercise"} subtitle="Progress across your sessions" />
      {history.isPending ? (
        <SkeletonList rows={3} height="h-40" />
      ) : history.isError ? (
        <ErrorState message={history.error.message} onRetry={() => void history.refetch()} />
      ) : points.length === 0 ? (
        <EmptyState title="No sessions yet" body="Log this exercise in a workout to see your progress." />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="Best e1RM" value={bodyweight ? "–" : formatWeight(best("estimated_1rm"), units)} accent />
            <StatCard label="Heaviest" value={bodyweight ? "–" : formatWeight(best("max_weight"), units)} />
            <StatCard label="Most reps" value={String(best("max_reps") || Math.max(...points.map((p) => p.reps)))} />
          </div>
          <SectionCard title={bodyweight ? "Reps per session" : `Estimated 1RM (${weightUnit(units)})`}>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,.12)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#8B98B3", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#8B98B3", fontSize: 11 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#121A2B", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, color: "#fff" }} />
                  {bodyweight ? (
                    <Line type="monotone" dataKey="reps" name="Reps" stroke="#3DDC97" strokeWidth={2.5} dot={{ r: 3 }} />
                  ) : (
                    <>
                      <Line type="monotone" dataKey="e1rm" name="e1RM" stroke="#3DDC97" strokeWidth={2.5} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="top" name="Top set" stroke="#8B98B3" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
          <SectionCard title="Sessions">
            <div className="space-y-2">
              {[...(history.data ?? [])].reverse().map((session) => (
                <div key={session.workout_id} className="rounded-xl border border-white/5 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-400">{shortDate(session.date)}</p>
                  <p className="mt-1 text-sm text-white">
                    {session.sets
                      .filter((set) => set.completed && !set.is_warmup)
                      .map((set) => (set.weight_kg > 0 ? `${toDisplayWeight(set.weight_kg, units)}×${set.reps}` : `${set.reps}`))
                      .join("  ·  ") || "No working sets"}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}
    </>
  );
}
