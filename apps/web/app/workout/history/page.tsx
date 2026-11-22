"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Medal } from "lucide-react";
import Link from "next/link";

import { useProfile } from "@/components/auth/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState, ErrorState, QueryView, SkeletonList } from "@/components/ui/States";
import { listPersonalRecords, listWorkouts } from "@/lib/data/workouts";
import { formatDuration, shortDate } from "@/lib/logic/format";
import { formatVolume, formatWeight } from "@/lib/logic/units";
import { RECORD_LABELS, workoutDurationSeconds } from "@/lib/logic/workout";

const PAGE = 15;

export default function WorkoutHistoryPage() {
  const units = useProfile().unit_system;
  const workouts = useInfiniteQuery({
    queryKey: ["workouts", "history"],
    queryFn: ({ pageParam }) => listWorkouts({ limit: PAGE, before: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.length === PAGE ? last.at(-1)!.started_at : null),
  });
  const records = useQuery({ queryKey: ["records", "all"], queryFn: () => listPersonalRecords() });
  const items = workouts.data?.pages.flat() ?? [];
  const recentRecords = (records.data ?? []).slice(0, 8);

  return (
    <PullToRefresh onRefresh={() => Promise.all([workouts.refetch(), records.refetch()])}>
      <Link href="/workout" className="mb-5 inline-flex items-center gap-2 text-sm text-slate-400">
        <ArrowLeft size={16} /> Workout
      </Link>
      <ScreenHeader eyebrow="History" title="Every session" subtitle="Tap a workout for sets, or an exercise for its progress." />
      <div className="space-y-5">
        <SectionCard title="Recent records" action={<Medal size={16} className="text-amber-300" />}>
          <QueryView
            query={records}
            isEmpty={() => recentRecords.length === 0}
            empty={<EmptyState title="No records yet" body="Beat a previous best and it lands here." />}
          >
            {() => (
              <div className="space-y-2">
                {recentRecords.map((record) => (
                  <Link
                    key={record.id}
                    href={`/workout/exercise?name=${encodeURIComponent(record.exercise_name)}`}
                    className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2 text-sm"
                  >
                    <span className="text-white">
                      {record.exercise_name} <span className="text-slate-500">· {RECORD_LABELS[record.record_type]}</span>
                    </span>
                    <span className="text-amber-200">{record.record_type === "max_reps" ? `${record.value} reps` : formatWeight(record.value, units)}</span>
                  </Link>
                ))}
              </div>
            )}
          </QueryView>
        </SectionCard>

        <SectionCard title="Workouts">
          {workouts.isPending ? (
            <SkeletonList rows={5} />
          ) : workouts.isError ? (
            <ErrorState message={workouts.error.message} onRetry={() => void workouts.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              title="No workouts yet"
              body="Start a session from the Workout tab."
              action={
                <Link href="/workout" className="flex w-full items-center justify-center rounded-xl bg-accent py-2.5 text-sm font-semibold text-ink">
                  Go to Workout
                </Link>
              }
            />
          ) : (
            <div className="space-y-2">
              {items.map((workout) => (
                <Link key={workout.id} href={`/workout/detail?id=${workout.id}`} className="block rounded-xl border border-white/5 bg-slate-950/60 p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-white">{workout.title}</p>
                    <span className="text-sm text-slate-200">{formatVolume(workout.total_volume_kg, units)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {shortDate(workout.started_at)} · {formatDuration(workoutDurationSeconds(workout))} · {workout.exercises.map((e) => e.exercise_name).join(", ")}
                  </p>
                </Link>
              ))}
              {workouts.hasNextPage ? (
                <Button variant="secondary" className="w-full" disabled={workouts.isFetchingNextPage} onClick={() => void workouts.fetchNextPage()}>
                  {workouts.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              ) : null}
            </div>
          )}
        </SectionCard>
      </div>
    </PullToRefresh>
  );
}
