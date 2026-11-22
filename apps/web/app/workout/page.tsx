"use client";

import type { Routine } from "@fitos/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Dumbbell, History, ListChecks, Play, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useProfile } from "@/components/auth/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SectionCard } from "@/components/ui/SectionCard";
import { Sheet } from "@/components/ui/Sheet";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, QueryView, SkeletonList } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ExercisePicker } from "@/components/workout/ExercisePicker";
import { listRoutines } from "@/lib/data/exercises";
import { getMyStreak } from "@/lib/data/profile";
import { listRecoveryDays } from "@/lib/data/recovery";
import { getActiveWorkout, listWorkouts, planFromRoutine, startWorkout, type WorkoutPlan } from "@/lib/data/workouts";
import { daysAgoKey, defaultWorkoutTitle, formatDuration, shortDate, startOfWeekIso } from "@/lib/logic/format";
import { type ProgressionRecommendation, recommendFromHistory } from "@/lib/logic/progression";
import { formatVolume, formatWeight, fromDisplayWeight, toDisplayWeight, weightUnit } from "@/lib/logic/units";
import { completedSetCount, workoutDurationSeconds } from "@/lib/logic/workout";

export default function WorkoutPage() {
  const profile = useProfile();
  const units = profile.unit_system;
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const active = useQuery({ queryKey: ["workout", "active"], queryFn: getActiveWorkout });
  const recent = useQuery({ queryKey: ["workouts", "recent"], queryFn: () => listWorkouts({ limit: 10 }) });
  const week = useQuery({ queryKey: ["workouts", "week"], queryFn: () => listWorkouts({ since: startOfWeekIso(), limit: 50 }) });
  const routines = useQuery({ queryKey: ["routines"], queryFn: listRoutines });
  const recovery = useQuery({ queryKey: ["recovery", "days", 2], queryFn: () => listRecoveryDays(daysAgoKey(1)) });
  const streak = useQuery({ queryKey: ["streak"], queryFn: getMyStreak });

  const latestScore = recovery.data?.at(-1)?.recovery_score ?? null;
  const baseSuggestions = useMemo(() => recommendFromHistory(recent.data ?? [], latestScore), [recent.data, latestScore]);
  const [overrides, setOverrides] = useState<ProgressionRecommendation[] | null>(null);
  const suggestions = overrides ?? baseSuggestions;
  const [editing, setEditing] = useState<number | null>(null);
  const [replacing, setReplacing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ weight: "", reps: "", sets: "" });

  const start = useMutation({
    mutationFn: (input: { title: string; plan: WorkoutPlan | null }) =>
      startWorkout({ title: input.title, visibility: profile.default_visibility, plan: input.plan }),
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: ["workout", "active"] });
      router.push(`/workout/session?id=${id}`);
    },
    onError: (error) => toast(error.message, "error"),
  });

  function startFromSuggestions() {
    start.mutate({
      title: defaultWorkoutTitle(),
      plan: {
        routineId: null,
        exercises: suggestions.map((item) => ({
          exercise_id: null,
          exercise_name: item.exercise,
          sets: item.recommended_sets,
          reps: item.recommended_reps,
          target_weight_kg: item.recommended_weight_kg,
        })),
      },
    });
  }

  function startRoutine(routine: Routine) {
    start.mutate({ title: routine.name, plan: planFromRoutine(routine) });
  }

  function updateSuggestion(index: number, patch: Partial<ProgressionRecommendation>) {
    setOverrides(suggestions.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  const weekVolume = (week.data ?? []).reduce((sum, workout) => sum + workout.total_volume_kg, 0);
  const hasActive = Boolean(active.data);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["workouts"] });
    await Promise.all([active.refetch(), routines.refetch(), streak.refetch()]);
  }

  return (
    <PullToRefresh onRefresh={refresh}>
      <ScreenHeader eyebrow="Workout" title="Strength plan" subtitle="Suggestions, session logging and volume tracking" />

      <div className="space-y-5">
        {active.data ? (
          <Link
            href={`/workout/session?id=${active.data.id}`}
            className="block rounded-3xl border border-emerald-300/30 bg-emerald-500/10 p-4"
          >
            <p className="text-xs uppercase tracking-[0.14em] text-emerald-300">Session in progress</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-white">{active.data.title}</p>
                <p className="text-sm text-slate-300">
                  {active.data.exercises.length} exercises · {completedSetCount(active.data)} sets done
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-ink">
                Resume <ChevronRight size={16} />
              </span>
            </div>
          </Link>
        ) : null}

        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Volume" value={week.data ? formatVolume(weekVolume, units) : "–"} hint="this week" />
          <StatCard label="Workouts" value={week.data ? String(week.data.length) : "–"} hint="this week" />
          <StatCard label="Streak" value={streak.data !== undefined ? `${streak.data}d` : "–"} hint="active days" accent />
        </div>

        <SectionCard
          title="Today’s suggestions"
          action={latestScore !== null ? <span className="text-xs text-emerald-300">Recovery {latestScore}</span> : undefined}
        >
          <QueryView
            query={recent}
            skeleton={<SkeletonList rows={2} height="h-24" />}
            isEmpty={() => suggestions.length === 0}
            empty={
              <EmptyState
                icon={<Dumbbell size={20} />}
                title="No suggestions yet"
                body="Log a workout and FitOS will suggest your next weights from it."
              />
            }
          >
            {() => (
              <div className="space-y-3">
                {suggestions.map((item, index) => (
                  <div key={`${item.exercise}-${index}`} className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link href={`/workout/exercise?name=${encodeURIComponent(item.exercise)}`} className="text-base font-semibold text-white">
                          {item.exercise}
                        </Link>
                        <p className="mt-1 text-sm text-slate-300">
                          {item.recommended_sets} × {item.recommended_reps} at {formatWeight(item.recommended_weight_kg, units)}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        className="px-3 py-2 text-xs"
                        onClick={() => {
                          setDraft({
                            weight: String(toDisplayWeight(item.recommended_weight_kg, units)),
                            reps: String(item.recommended_reps),
                            sets: String(item.recommended_sets),
                          });
                          setEditing(index);
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{item.reason}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button variant="secondary" className="w-full text-xs" onClick={() => setReplacing(index)}>
                        Replace
                      </Button>
                      <Button variant="ghost" className="w-full text-xs" onClick={() => setOverrides(suggestions.filter((_, i) => i !== index))}>
                        Skip
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </QueryView>
        </SectionCard>

        <SectionCard title="Workout session controls">
          <div className="grid grid-cols-2 gap-2">
            <Button className="w-full gap-2" disabled={hasActive || start.isPending || suggestions.length === 0} onClick={startFromSuggestions}>
              <Play size={15} /> Start session
            </Button>
            <Button
              variant="secondary"
              className="w-full gap-2"
              disabled={hasActive || start.isPending}
              onClick={() => start.mutate({ title: defaultWorkoutTitle(), plan: null })}
            >
              <Plus size={15} /> Empty workout
            </Button>
          </div>
          {hasActive ? <p className="mt-3 text-xs text-slate-500">Finish or discard the session in progress before starting another.</p> : null}
        </SectionCard>

        <SectionCard title="Routines" action={<Link href="/workout/routine" className="text-xs text-emerald-300">New routine</Link>}>
          <QueryView
            query={routines}
            isEmpty={(data) => data.length === 0}
            empty={
              <EmptyState
                icon={<ListChecks size={20} />}
                title="No routines yet"
                body="Save a set of exercises once, then start it in one tap."
                action={
                  <Link href="/workout/routine" className="flex w-full items-center justify-center rounded-xl bg-accent py-2.5 text-sm font-semibold text-ink">
                    Create a routine
                  </Link>
                }
              />
            }
          >
            {(data) => (
              <div className="space-y-2">
                {data.map((routine) => (
                  <div key={routine.id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-950/60 p-3">
                    <Link href={`/workout/routine?id=${routine.id}`} className="min-w-0 flex-1">
                      <p className="truncate font-medium text-white">{routine.name}</p>
                      <p className="truncate text-xs text-slate-400">
                        {routine.routine_exercises.map((item) => item.exercise_name).join(" · ") || "No exercises"}
                      </p>
                    </Link>
                    <Button className="px-3 py-2 text-xs" disabled={hasActive || start.isPending} onClick={() => startRoutine(routine)}>
                      Start
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </QueryView>
        </SectionCard>

        <SectionCard title="History" action={<Link href="/workout/history" className="inline-flex items-center gap-1 text-xs text-emerald-300"><History size={13} /> All</Link>}>
          <QueryView
            query={recent}
            isEmpty={(data) => data.length === 0}
            empty={<EmptyState title="No finished workouts" body="Your completed sessions will show up here." />}
          >
            {(data) => (
              <div className="space-y-2">
                {data.slice(0, 5).map((workout) => (
                  <Link
                    key={workout.id}
                    href={`/workout/detail?id=${workout.id}`}
                    className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 p-3"
                  >
                    <div>
                      <p className="font-medium text-white">{workout.title}</p>
                      <p className="text-xs text-slate-400">
                        {shortDate(workout.started_at)} · {formatDuration(workoutDurationSeconds(workout))}
                      </p>
                    </div>
                    <span className="text-sm text-slate-200">{formatVolume(workout.total_volume_kg, units)}</span>
                  </Link>
                ))}
              </div>
            )}
          </QueryView>
        </SectionCard>
      </div>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing !== null ? `Edit ${suggestions[editing]?.exercise}` : "Edit"}>
        <form
          className="space-y-3 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (editing === null) return;
            updateSuggestion(editing, {
              recommended_weight_kg: fromDisplayWeight(Number(draft.weight) || 0, units),
              recommended_reps: Math.max(1, Number(draft.reps) || 1),
              recommended_sets: Math.max(1, Number(draft.sets) || 1),
              reason: "Adjusted by you for today.",
            });
            setEditing(null);
          }}
        >
          <div className="grid grid-cols-3 gap-2">
            <Field label="Sets">
              <TextInput inputMode="numeric" value={draft.sets} onChange={(event) => setDraft({ ...draft, sets: event.target.value })} />
            </Field>
            <Field label="Reps">
              <TextInput inputMode="numeric" value={draft.reps} onChange={(event) => setDraft({ ...draft, reps: event.target.value })} />
            </Field>
            <Field label={weightUnit(units)}>
              <TextInput inputMode="decimal" value={draft.weight} onChange={(event) => setDraft({ ...draft, weight: event.target.value })} />
            </Field>
          </div>
          <Button type="submit" className="w-full">
            Save
          </Button>
        </form>
      </Sheet>

      <ExercisePicker
        open={replacing !== null}
        title="Replace with"
        onClose={() => setReplacing(null)}
        onPick={(exercise) => {
          if (replacing !== null) {
            updateSuggestion(replacing, {
              exercise: exercise.name,
              recommended_weight_kg: 0,
              reason: "Swapped in by you. Set the weight once you start.",
            });
          }
          setReplacing(null);
        }}
      />
    </PullToRefresh>
  );
}
