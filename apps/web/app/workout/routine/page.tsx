"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useProfile } from "@/components/auth/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ExercisePicker } from "@/components/workout/ExercisePicker";
import { deleteRoutine, getRoutine, type RoutineDraft, saveRoutine } from "@/lib/data/exercises";
import { getActiveWorkout, startWorkout } from "@/lib/data/workouts";
import { fromDisplayWeight, toDisplayWeight, weightUnit } from "@/lib/logic/units";

type DraftExercise = RoutineDraft["exercises"][number] & { key: string };

export default function RoutinePage() {
  return (
    <Suspense fallback={<SkeletonList rows={4} />}>
      <RoutineEditor />
    </Suspense>
  );
}

function RoutineEditor() {
  const id = useSearchParams().get("id");
  const profile = useProfile();
  const units = profile.unit_system;
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const routine = useQuery({ queryKey: ["routine", id], queryFn: () => getRoutine(id!), enabled: Boolean(id) });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [exercises, setExercises] = useState<DraftExercise[]>([]);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!routine.data) return;
    setName(routine.data.name);
    setDescription(routine.data.description ?? "");
    setExercises(routine.data.routine_exercises.map((item) => ({ ...item, key: item.id })));
  }, [routine.data]);

  const draft = (): RoutineDraft => ({
    id: id ?? undefined,
    name: name.trim() || "Routine",
    description: description.trim() || null,
    exercises: exercises.map(({ key: _key, ...rest }) => rest),
  });

  const save = useMutation({
    mutationFn: () => saveRoutine(draft()),
    onSuccess: (savedId) => {
      toast("Routine saved", "success");
      void queryClient.invalidateQueries({ queryKey: ["routines"] });
      void queryClient.invalidateQueries({ queryKey: ["routine", savedId] });
      if (!id) router.replace(`/workout/routine?id=${savedId}`);
    },
    onError: (error) => toast(error.message, "error"),
  });

  const remove = useMutation({
    mutationFn: () => deleteRoutine(id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["routines"] });
      router.replace("/workout");
    },
    onError: (error) => toast(error.message, "error"),
  });

  const start = useMutation({
    mutationFn: async () => {
      if (await getActiveWorkout()) throw new Error("Finish your current session first.");
      const savedId = await saveRoutine(draft());
      return startWorkout({
        title: name.trim() || "Routine",
        visibility: profile.default_visibility,
        plan: { routineId: savedId, exercises: draft().exercises },
      });
    },
    onSuccess: (workoutId) => {
      void queryClient.invalidateQueries({ queryKey: ["workout", "active"] });
      router.push(`/workout/session?id=${workoutId}`);
    },
    onError: (error) => toast(error.message, "error"),
  });

  function move(index: number, delta: number) {
    const next = [...exercises];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setExercises(next);
  }

  function patch(index: number, value: Partial<DraftExercise>) {
    setExercises(exercises.map((item, i) => (i === index ? { ...item, ...value } : item)));
  }

  if (id && routine.isPending) return <SkeletonList rows={4} />;
  if (id && routine.isError) return <ErrorState message={routine.error.message} onRetry={() => void routine.refetch()} />;

  return (
    <>
      <Link href="/workout" className="mb-5 inline-flex items-center gap-2 text-sm text-slate-400">
        <ArrowLeft size={16} /> Workout
      </Link>
      <ScreenHeader eyebrow="Routine" title={id ? "Edit routine" : "New routine"} subtitle="Plan exercises, sets, reps and target weights." />
      <div className="space-y-4">
        <Field label="Name">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Push day" />
        </Field>
        <Field label="Description">
          <TextInput value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" />
        </Field>

        {exercises.length === 0 ? (
          <EmptyState title="No exercises" body="Add exercises in the order you train them." />
        ) : (
          <div className="space-y-2">
            {exercises.map((item, index) => (
              <div key={item.key} className="rounded-2xl border border-white/10 bg-slate-900/80 p-3">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-medium text-white">
                    {index + 1}. {item.exercise_name}
                  </p>
                  <button className="rounded-lg p-1.5 text-slate-400 disabled:opacity-30" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">
                    <ArrowUp size={16} />
                  </button>
                  <button className="rounded-lg p-1.5 text-slate-400 disabled:opacity-30" disabled={index === exercises.length - 1} onClick={() => move(index, 1)} aria-label="Move down">
                    <ArrowDown size={16} />
                  </button>
                  <button className="rounded-lg p-1.5 text-rose-300" onClick={() => setExercises(exercises.filter((_, i) => i !== index))} aria-label="Remove">
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Field label="Sets">
                    <TextInput inputMode="numeric" value={String(item.sets)} onChange={(event) => patch(index, { sets: Math.max(1, Number(event.target.value.replace(/\D/g, "")) || 1) })} />
                  </Field>
                  <Field label="Reps">
                    <TextInput inputMode="numeric" value={String(item.reps)} onChange={(event) => patch(index, { reps: Math.max(1, Number(event.target.value.replace(/\D/g, "")) || 1) })} />
                  </Field>
                  <Field label={weightUnit(units)}>
                    <TextInput
                      inputMode="decimal"
                      value={item.target_weight_kg === null ? "" : String(toDisplayWeight(item.target_weight_kg, units))}
                      placeholder="–"
                      onChange={(event) => {
                        const value = event.target.value.replace(/[^\d.]/g, "");
                        patch(index, { target_weight_kg: value === "" ? null : fromDisplayWeight(Number(value), units) });
                      }}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        )}

        <Button variant="secondary" className="w-full gap-2" onClick={() => setPicking(true)}>
          <Plus size={16} /> Add exercise
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button className="w-full" disabled={save.isPending || exercises.length === 0} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save routine"}
          </Button>
          <Button variant="secondary" className="w-full gap-2" disabled={start.isPending || exercises.length === 0} onClick={() => start.mutate()}>
            <Play size={15} /> Start now
          </Button>
        </div>
        {id ? (
          <Button variant="ghost" className="w-full gap-2 text-rose-300" disabled={remove.isPending} onClick={() => window.confirm("Delete this routine?") && remove.mutate()}>
            <Trash2 size={15} /> Delete routine
          </Button>
        ) : null}
      </div>

      <ExercisePicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(exercise) => {
          setExercises([
            ...exercises,
            { key: crypto.randomUUID(), exercise_id: exercise.id, exercise_name: exercise.name, sets: 3, reps: 8, target_weight_kg: null },
          ]);
          setPicking(false);
        }}
      />
    </>
  );
}
