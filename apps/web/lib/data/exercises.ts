import type { Exercise, Routine, RoutineExercise } from "@fitos/types";

import { currentUserId, num, numOrNull, supabase, unwrap } from "./base";

export async function listExercises(): Promise<Exercise[]> {
  const rows = unwrap(
    await supabase.from("exercises").select("id, user_id, name, muscle_group, equipment, is_global").order("name"),
  );
  return (rows ?? []) as Exercise[];
}

export async function createCustomExercise(input: {
  name: string;
  muscle_group: string | null;
  equipment: string | null;
}): Promise<Exercise> {
  const userId = await currentUserId();
  const row = unwrap(
    await supabase
      .from("exercises")
      .insert({ ...input, name: input.name.trim(), user_id: userId, is_global: false })
      .select("id, user_id, name, muscle_group, equipment, is_global")
      .single(),
  );
  return row as Exercise;
}

function toRoutine(row: Record<string, unknown>): Routine {
  const exercises = ((row.routine_exercises as Record<string, unknown>[] | null) ?? [])
    .map(
      (item): RoutineExercise => ({
        id: String(item.id),
        routine_id: String(item.routine_id),
        exercise_id: (item.exercise_id as string | null) ?? null,
        exercise_name: String(item.exercise_name),
        order_index: num(item.order_index),
        sets: num(item.sets),
        reps: num(item.reps),
        target_weight_kg: numOrNull(item.target_weight_kg),
      }),
    )
    .sort((a, b) => a.order_index - b.order_index);
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    created_at: String(row.created_at),
    routine_exercises: exercises,
  };
}

export async function listRoutines(): Promise<Routine[]> {
  const userId = await currentUserId();
  const rows = unwrap(
    await supabase
      .from("routines")
      .select("*, routine_exercises(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  );
  return (rows ?? []).map(toRoutine);
}

export async function getRoutine(id: string): Promise<Routine | null> {
  const row = unwrap(await supabase.from("routines").select("*, routine_exercises(*)").eq("id", id).maybeSingle());
  return row ? toRoutine(row) : null;
}

export type RoutineDraft = {
  id?: string;
  name: string;
  description: string | null;
  exercises: Array<Pick<RoutineExercise, "exercise_id" | "exercise_name" | "sets" | "reps" | "target_weight_kg">>;
};

export async function saveRoutine(draft: RoutineDraft): Promise<string> {
  const userId = await currentUserId();
  let routineId = draft.id;
  if (routineId) {
    unwrap(
      await supabase
        .from("routines")
        .update({ name: draft.name.trim(), description: draft.description, updated_at: new Date().toISOString() })
        .eq("id", routineId),
    );
    unwrap(await supabase.from("routine_exercises").delete().eq("routine_id", routineId));
  } else {
    const row = unwrap(
      await supabase
        .from("routines")
        .insert({ user_id: userId, name: draft.name.trim(), description: draft.description })
        .select("id")
        .single(),
    );
    routineId = String(row.id);
  }
  if (draft.exercises.length > 0) {
    unwrap(
      await supabase.from("routine_exercises").insert(
        draft.exercises.map((item, index) => ({ ...item, routine_id: routineId, order_index: index })),
      ),
    );
  }
  return routineId;
}

export async function deleteRoutine(id: string): Promise<void> {
  unwrap(await supabase.from("routines").delete().eq("id", id));
}
