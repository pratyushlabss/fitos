"use client";

import type { Visibility, Workout, WorkoutSet } from "@fitos/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LineChart, MoreHorizontal, Plus, Repeat, Timer, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { useProfile } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Field, Segmented, TextArea, TextInput } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ExercisePicker } from "@/components/workout/ExercisePicker";
import { createPost } from "@/lib/data/social";
import {
  addExercise,
  addSet,
  deleteSet,
  deleteWorkout,
  finishWorkout,
  getWorkout,
  removeExercise,
  replaceExercise,
  updateSet,
} from "@/lib/data/workouts";
import { formatClock } from "@/lib/logic/format";
import { fromDisplayWeight, toDisplayWeight, weightUnit } from "@/lib/logic/units";
import { completedSetCount, workoutVolume } from "@/lib/logic/workout";
import { formatVolume } from "@/lib/logic/units";

const REST_DEFAULT = 90;

export default function SessionPage() {
  return (
    <Suspense fallback={<SkeletonList rows={4} height="h-28" />}>
      <Session />
    </Suspense>
  );
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function Session() {
  const id = useSearchParams().get("id") ?? "";
  const profile = useProfile();
  const units = profile.unit_system;
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = useMemo(() => ["workout", id], [id]);
  const query = useQuery({ queryKey: key, queryFn: () => getWorkout(id), enabled: Boolean(id) });
  const now = useNow();
  const [picker, setPicker] = useState<{ mode: "add" } | { mode: "replace"; exerciseId: string } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [setOptions, setSetOptions] = useState<WorkoutSet | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [rest, setRest] = useState<{ endsAt: number; duration: number } | null>(null);
  const [restDuration, setRestDuration] = useState(REST_DEFAULT);

  const workout = query.data;

  useEffect(() => {
    if (workout?.completed_at) router.replace(`/workout/detail?id=${workout.id}`);
  }, [workout, router]);

  useEffect(() => {
    if (rest && now >= rest.endsAt) {
      setRest(null);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(200);
      toast("Rest done. Next set.", "success");
    }
  }, [now, rest, toast]);

  function patchCache(update: (current: Workout) => Workout) {
    queryClient.setQueryData<Workout | null>(key, (current) => (current ? update(current) : current));
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const saveSet = useMutation({
    mutationFn: ({ setId, patch }: { setId: string; patch: Partial<Omit<WorkoutSet, "id">> }) => updateSet(setId, patch),
    onMutate: ({ setId, patch }) =>
      patchCache((current) => ({
        ...current,
        exercises: current.exercises.map((exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set) => (set.id === setId ? { ...set, ...patch } : set)),
        })),
      })),
    onError: (error) => {
      toast(error.message, "error");
      void refresh();
    },
  });

  const mutate = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSettled: () => void refresh(),
    onError: (error) => toast(error.message, "error"),
  });

  if (!id) return <ErrorState message="No workout selected." />;
  if (query.isPending) return <SkeletonList rows={4} height="h-28" />;
  if (query.isError) return <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />;
  if (!workout) return <ErrorState message="This workout does not exist." />;

  const elapsed = (now - Date.parse(workout.started_at)) / 1000;
  const restLeft = rest ? Math.max(0, Math.ceil((rest.endsAt - now) / 1000)) : 0;

  return (
    <>
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-accent">Live session</p>
          <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight">{workout.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {formatClock(elapsed)} · {completedSetCount(workout)} sets · {formatVolume(workoutVolume(workout.exercises), units)}
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setFinishing(true)}>
          Finish
        </Button>
      </header>

      <div className="space-y-4">
        {workout.exercises.length === 0 ? (
          <EmptyState title="No exercises yet" body="Add your first exercise to start logging sets." />
        ) : null}

        {workout.exercises.map((exercise) => (
          <section key={exercise.id} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-white">{exercise.exercise_name}</h2>
                <p className="text-xs capitalize text-slate-500">
                  {[exercise.muscle_group, exercise.equipment].filter(Boolean).join(" · ") || "custom"}
                </p>
              </div>
              <button className="rounded-full p-2 text-slate-400 hover:bg-white/5" aria-label="Exercise options" onClick={() => setMenu(exercise.id)}>
                <MoreHorizontal size={18} />
              </button>
            </div>

            <div className="grid grid-cols-[28px_1fr_1fr_64px_44px] items-center gap-2 px-1 text-[11px] uppercase tracking-[0.12em] text-slate-500">
              <span>Set</span>
              <span>{weightUnit(units)}</span>
              <span>Reps</span>
              <span>RPE</span>
              <span className="text-center">Done</span>
            </div>
            <div className="mt-1 space-y-1.5">
              {exercise.sets.map((set, index) => (
                <SetRow
                  key={set.id}
                  set={set}
                  index={index}
                  units={units}
                  onSave={(patch) => {
                    saveSet.mutate({ setId: set.id, patch });
                    if (patch.completed) setRest({ endsAt: Date.now() + restDuration * 1000, duration: restDuration });
                  }}
                  onMenu={() => setSetOptions(set)}
                />
              ))}
            </div>
            <Button
              variant="ghost"
              className="mt-2 w-full gap-2 text-xs"
              onClick={() => {
                const last = exercise.sets.at(-1);
                mutate.mutate(() =>
                  addSet(exercise.id, {
                    set_index: (last?.set_index ?? -1) + 1,
                    reps: last?.reps ?? 8,
                    weight_kg: last?.weight_kg ?? 0,
                    rpe: null,
                    is_warmup: false,
                    completed: false,
                  }),
                );
              }}
            >
              <Plus size={14} /> Add set
            </Button>
          </section>
        ))}

        <Button variant="secondary" className="w-full gap-2" onClick={() => setPicker({ mode: "add" })}>
          <Plus size={16} /> Add exercise
        </Button>
        <Button
          variant="ghost"
          className="w-full gap-2 text-rose-300"
          onClick={() => {
            if (!window.confirm("Discard this workout? Logged sets will be deleted.")) return;
            mutate.mutate(async () => {
              await deleteWorkout(workout.id);
              await queryClient.invalidateQueries({ queryKey: ["workout", "active"] });
              router.replace("/workout");
            });
          }}
        >
          <Trash2 size={15} /> Discard workout
        </Button>
      </div>

      {rest ? (
        <div className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 mx-auto flex w-[calc(100%-32px)] max-w-[398px] items-center gap-3 rounded-2xl border border-emerald-300/30 bg-slate-900/95 px-4 py-3 shadow-xl backdrop-blur">
          <Timer size={18} className="text-emerald-300" />
          <div className="flex-1">
            <p className="text-xs text-slate-400">Rest</p>
            <p className="text-lg font-semibold tabular-nums text-white">{formatClock(restLeft)}</p>
          </div>
          <button className="rounded-lg px-2 py-1 text-sm text-slate-300" onClick={() => setRest({ ...rest, endsAt: rest.endsAt - 15000 })}>
            −15
          </button>
          <button className="rounded-lg px-2 py-1 text-sm text-slate-300" onClick={() => setRest({ ...rest, endsAt: rest.endsAt + 15000 })}>
            +15
          </button>
          <button className="rounded-lg p-1 text-slate-400" aria-label="Skip rest" onClick={() => setRest(null)}>
            <X size={16} />
          </button>
        </div>
      ) : null}

      <Sheet open={menu !== null} onClose={() => setMenu(null)} title="Exercise">
        {(() => {
          const exercise = workout.exercises.find((item) => item.id === menu);
          if (!exercise) return null;
          return (
            <div className="space-y-2 pb-2">
              <Link
                href={`/workout/exercise?name=${encodeURIComponent(exercise.exercise_name)}`}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm text-white"
              >
                <LineChart size={16} className="text-emerald-300" /> Progress and history
              </Link>
              <button
                className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3 text-left text-sm text-white"
                onClick={() => {
                  setPicker({ mode: "replace", exerciseId: exercise.id });
                  setMenu(null);
                }}
              >
                <Repeat size={16} className="text-emerald-300" /> Replace exercise
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-xl border border-rose-400/20 bg-rose-500/5 p-3 text-left text-sm text-rose-200"
                onClick={() => {
                  setMenu(null);
                  mutate.mutate(() => removeExercise(exercise.id));
                }}
              >
                <Trash2 size={16} /> Remove from workout
              </button>
              <div className="pt-2">
                <Field label="Rest timer (seconds)">
                  <TextInput inputMode="numeric" value={String(restDuration)} onChange={(event) => setRestDuration(Math.max(15, Number(event.target.value.replace(/\D/g, "")) || REST_DEFAULT))} />
                </Field>
              </div>
            </div>
          );
        })()}
      </Sheet>

      <Sheet open={setOptions !== null} onClose={() => setSetOptions(null)} title="Set options">
        {setOptions ? (
          <div className="space-y-2 pb-2">
            <button
              className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3 text-left text-sm text-white"
              onClick={() => {
                saveSet.mutate({ setId: setOptions.id, patch: { is_warmup: !setOptions.is_warmup } });
                setSetOptions(null);
              }}
            >
              <Timer size={16} className="text-amber-300" /> {setOptions.is_warmup ? "Make it a working set" : "Mark as warm-up"}
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-xl border border-rose-400/20 bg-rose-500/5 p-3 text-left text-sm text-rose-200"
              onClick={() => {
                const target = setOptions;
                setSetOptions(null);
                mutate.mutate(() => deleteSet(target.id));
              }}
            >
              <Trash2 size={16} /> Delete set
            </button>
            <p className="pt-1 text-xs text-slate-500">Warm-up sets do not count toward volume or records.</p>
          </div>
        ) : null}
      </Sheet>

      <ExercisePicker
        open={picker !== null}
        title={picker?.mode === "replace" ? "Replace with" : "Add exercise"}
        onClose={() => setPicker(null)}
        onPick={(exercise) => {
          const current = picker;
          setPicker(null);
          if (!current) return;
          if (current.mode === "replace") mutate.mutate(() => replaceExercise(current.exerciseId, exercise));
          else mutate.mutate(() => addExercise(workout.id, exercise, workout.exercises.length));
        }}
      />

      <FinishSheet
        open={finishing}
        workout={workout}
        defaultVisibility={profile.default_visibility}
        onClose={() => setFinishing(false)}
        onFinished={async (share, visibility, notes) => {
          if (share && visibility !== "private") {
            await createPost({ post_type: "workout", workout_id: workout.id, body: notes, visibility });
          }
          await queryClient.invalidateQueries({ queryKey: ["workouts"] });
          await queryClient.invalidateQueries({ queryKey: ["workout", "active"] });
          await queryClient.invalidateQueries({ queryKey: ["streak"] });
          await queryClient.invalidateQueries({ queryKey: ["feed"] });
          router.replace(`/workout/detail?id=${workout.id}&done=1`);
        }}
      />
    </>
  );
}

function SetRow({
  set,
  index,
  units,
  onSave,
  onMenu,
}: {
  set: WorkoutSet;
  index: number;
  units: "metric" | "imperial";
  onSave: (patch: Partial<Omit<WorkoutSet, "id">>) => void;
  onMenu: () => void;
}) {
  const [weight, setWeight] = useState(() => String(toDisplayWeight(set.weight_kg, units)));
  const [reps, setReps] = useState(() => String(set.reps));
  const [rpe, setRpe] = useState(() => (set.rpe === null ? "" : String(set.rpe)));

  useEffect(() => {
    setWeight(String(toDisplayWeight(set.weight_kg, units)));
    setReps(String(set.reps));
    setRpe(set.rpe === null ? "" : String(set.rpe));
  }, [set.weight_kg, set.reps, set.rpe, units]);

  function values() {
    return {
      weight_kg: fromDisplayWeight(Math.max(0, Number(weight) || 0), units),
      reps: Math.max(0, Math.round(Number(reps) || 0)),
      rpe: rpe === "" ? null : Math.min(10, Math.max(1, Number(rpe))),
    };
  }

  function saveIfChanged() {
    const next = values();
    if (next.weight_kg !== set.weight_kg || next.reps !== set.reps || next.rpe !== set.rpe) onSave(next);
  }

  const inputClass =
    "w-full rounded-lg border border-white/10 bg-slate-950/70 px-2 py-2 text-center text-base text-white outline-none focus:border-emerald-300/40";

  return (
    <div className={`grid grid-cols-[28px_1fr_1fr_64px_44px] items-center gap-2 rounded-xl px-1 py-1 ${set.completed ? "bg-emerald-400/10" : ""}`}>
      <button
        className={`text-sm font-semibold ${set.is_warmup ? "text-amber-300" : "text-slate-300"}`}
        aria-label={`Set ${index + 1} options`}
        onClick={onMenu}
      >
        {set.is_warmup ? "W" : index + 1}
      </button>
      <input className={inputClass} inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value.replace(/[^\d.]/g, ""))} onBlur={saveIfChanged} aria-label="Weight" />
      <input className={inputClass} inputMode="numeric" value={reps} onChange={(event) => setReps(event.target.value.replace(/\D/g, ""))} onBlur={saveIfChanged} aria-label="Reps" />
      <select className={`${inputClass} px-1`} value={rpe} onChange={(event) => { setRpe(event.target.value); onSave({ ...values(), rpe: event.target.value === "" ? null : Number(event.target.value) }); }} aria-label="RPE">
        <option value="">–</option>
        {[6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <button
        className={`mx-auto flex h-9 w-9 items-center justify-center rounded-lg border ${
          set.completed ? "border-emerald-300/50 bg-emerald-400 text-slate-950" : "border-white/15 text-slate-500"
        }`}
        aria-label={set.completed ? "Mark set not done" : "Mark set done"}
        onClick={() => onSave({ ...values(), completed: !set.completed })}
      >
        <Check size={16} />
      </button>
    </div>
  );
}

function FinishSheet({
  open,
  workout,
  defaultVisibility,
  onClose,
  onFinished,
}: {
  open: boolean;
  workout: Workout;
  defaultVisibility: Visibility;
  onClose: () => void;
  onFinished: (share: boolean, visibility: Visibility, notes: string | null) => Promise<void>;
}) {
  const [title, setTitle] = useState(workout.title);
  const [visibility, setVisibility] = useState<Visibility>(defaultVisibility);
  const [notes, setNotes] = useState("");
  const [share, setShare] = useState(defaultVisibility !== "private");
  const toast = useToast();
  const done = completedSetCount(workout);
  const finish = useMutation({
    mutationFn: async () => {
      const result = await finishWorkout(workout.id, { title, visibility, notes: notes.trim() || null });
      await onFinished(share, visibility, notes.trim() || null);
      return result;
    },
    onError: (error) => toast(error.message, "error"),
  });

  return (
    <Sheet open={open} onClose={onClose} title="Finish workout">
      <div className="space-y-4 pb-2">
        {done === 0 ? (
          <p className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">
            No sets are marked done. Tick the sets you completed first, or discard the workout.
          </p>
        ) : (
          <p className="text-sm text-slate-400">Unticked sets are removed when you finish.</p>
        )}
        <Field label="Title">
          <TextInput value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Who can see it">
          <Segmented
            value={visibility}
            onChange={(value) => {
              setVisibility(value);
              if (value === "private") setShare(false);
            }}
            options={[
              { value: "private", label: "Only me" },
              { value: "friends", label: "Followers" },
              { value: "public", label: "Everyone" },
            ]}
          />
        </Field>
        <Field label="Notes">
          <TextArea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="How did it feel?" />
        </Field>
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <input type="checkbox" className="h-5 w-5 accent-emerald-400" checked={share} disabled={visibility === "private"} onChange={(event) => setShare(event.target.checked)} />
          Post to my feed
        </label>
        <Button className="w-full" disabled={done === 0 || finish.isPending} onClick={() => finish.mutate()}>
          {finish.isPending ? "Saving…" : "Save workout"}
        </Button>
      </div>
    </Sheet>
  );
}
