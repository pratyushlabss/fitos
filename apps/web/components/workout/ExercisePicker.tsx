"use client";

import type { Exercise } from "@fitos/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field, SelectInput, TextInput } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { EmptyState, QueryView, SkeletonList } from "@/components/ui/States";
import { createCustomExercise, listExercises } from "@/lib/data/exercises";

export const MUSCLE_GROUPS = ["chest", "back", "shoulders", "biceps", "triceps", "legs", "glutes", "core", "full body", "cardio"];
export const EQUIPMENT = ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "band", "other"];

export function useExercises() {
  return useQuery({ queryKey: ["exercises"], queryFn: listExercises, staleTime: 10 * 60 * 1000 });
}

export function ExercisePicker({
  open,
  title = "Add exercise",
  onClose,
  onPick,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  onPick: (exercise: Exercise) => void;
}) {
  const query = useExercises();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [custom, setCustom] = useState({ name: "", muscle_group: "chest", equipment: "barbell" });

  const create = useMutation({
    mutationFn: () => createCustomExercise({ name: custom.name, muscle_group: custom.muscle_group, equipment: custom.equipment }),
    onSuccess: (exercise) => {
      void queryClient.invalidateQueries({ queryKey: ["exercises"] });
      setCreating(false);
      setCustom({ name: "", muscle_group: "chest", equipment: "barbell" });
      onPick(exercise);
    },
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data ?? []).filter(
      (exercise) =>
        (group === "all" || exercise.muscle_group === group) &&
        (!term || exercise.name.toLowerCase().includes(term) || (exercise.equipment ?? "").includes(term)),
    );
  }, [query.data, search, group]);

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {creating ? (
        <form
          className="space-y-3 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (custom.name.trim()) create.mutate();
          }}
        >
          <Field label="Exercise name">
            <TextInput value={custom.name} onChange={(event) => setCustom({ ...custom, name: event.target.value })} autoFocus placeholder="Landmine press" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Muscle group">
              <SelectInput value={custom.muscle_group} onChange={(event) => setCustom({ ...custom, muscle_group: event.target.value })}>
                {MUSCLE_GROUPS.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Equipment">
              <SelectInput value={custom.equipment} onChange={(event) => setCustom({ ...custom, equipment: event.target.value })}>
                {EQUIPMENT.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </SelectInput>
            </Field>
          </div>
          {create.isError ? <p className="text-sm text-rose-300">{create.error.message}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Back
            </Button>
            <Button type="submit" disabled={create.isPending || !custom.name.trim()}>
              {create.isPending ? "Saving…" : "Create and add"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3 pb-2">
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5">
            <Search size={16} className="text-slate-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search exercises"
              className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-600"
            />
          </label>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {["all", ...MUSCLE_GROUPS].map((item) => (
              <button
                key={item}
                onClick={() => setGroup(item)}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs capitalize ${
                  group === item ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-200" : "border-white/10 text-slate-400"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
          <QueryView query={query} skeleton={<SkeletonList rows={6} height="h-12" />}>
            {() =>
              filtered.length === 0 ? (
                <EmptyState
                  title="No matching exercises"
                  body="Create it as a custom exercise."
                  action={
                    <Button className="w-full gap-2" onClick={() => { setCustom({ ...custom, name: search }); setCreating(true); }}>
                      <Plus size={15} /> Create “{search || "custom"}”
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-slate-950/50">
                  {filtered.map((exercise) => (
                    <li key={exercise.id}>
                      <button className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left" onClick={() => onPick(exercise)}>
                        <span>
                          <span className="block text-sm font-medium text-white">{exercise.name}</span>
                          <span className="text-xs capitalize text-slate-500">
                            {exercise.muscle_group ?? "other"} · {exercise.equipment ?? "any"}
                            {exercise.is_global ? "" : " · custom"}
                          </span>
                        </span>
                        <Plus size={16} className="text-emerald-300" />
                      </button>
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryView>
          <Button variant="ghost" className="w-full gap-2" onClick={() => { setCustom({ ...custom, name: search }); setCreating(true); }}>
            <Plus size={15} /> Custom exercise
          </Button>
        </div>
      )}
    </Sheet>
  );
}
