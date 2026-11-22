import type { Exercise, PersonalRecord, Routine, Visibility, Workout, WorkoutExercise, WorkoutSet } from "@fitos/types";

import { detectRecords, type ExerciseBests, type RecordCandidate, workoutVolume } from "@/lib/logic/workout";

import { currentUserId, num, numOrNull, supabase, unwrap, type Row } from "./base";

const TREE = "*, workout_exercises(*, workout_sets(*))";

function toSet(row: Record<string, unknown>): WorkoutSet {
  return {
    id: String(row.id),
    set_index: num(row.set_index),
    reps: num(row.reps),
    weight_kg: num(row.weight_kg),
    rpe: numOrNull(row.rpe),
    is_warmup: Boolean(row.is_warmup),
    completed: Boolean(row.completed),
  };
}

function toExercise(row: Record<string, unknown>): WorkoutExercise {
  return {
    id: String(row.id),
    exercise_id: (row.exercise_id as string | null) ?? null,
    exercise_name: String(row.exercise_name),
    muscle_group: (row.muscle_group as string | null) ?? null,
    equipment: (row.equipment as string | null) ?? null,
    order_index: num(row.order_index),
    notes: (row.notes as string | null) ?? null,
    sets: ((row.workout_sets as Record<string, unknown>[] | null) ?? []).map(toSet).sort((a, b) => a.set_index - b.set_index),
  };
}

export function toWorkout(row: Record<string, unknown>): Workout {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    title: String(row.title),
    started_at: String(row.started_at),
    completed_at: (row.completed_at as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    visibility: (row.visibility as Visibility) ?? "private",
    total_volume_kg: num(row.total_volume_kg),
    exercises: ((row.workout_exercises as Record<string, unknown>[] | null) ?? [])
      .map(toExercise)
      .sort((a, b) => a.order_index - b.order_index),
  };
}

export async function listWorkouts(options: { limit?: number; before?: string; since?: string } = {}): Promise<Workout[]> {
  const userId = await currentUserId();
  let query = supabase
    .from("workouts")
    .select(TREE)
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(options.limit ?? 20);
  if (options.before) query = query.lt("started_at", options.before);
  if (options.since) query = query.gte("started_at", options.since);
  return (unwrap(await query) ?? []).map(toWorkout);
}

export async function getWorkout(id: string): Promise<Workout | null> {
  const row = unwrap(await supabase.from("workouts").select(TREE).eq("id", id).maybeSingle());
  return row ? toWorkout(row) : null;
}

export async function getActiveWorkout(): Promise<Workout | null> {
  const userId = await currentUserId();
  const rows = unwrap(
    await supabase
      .from("workouts")
      .select(TREE)
      .eq("user_id", userId)
      .is("completed_at", null)
      .order("started_at", { ascending: false })
      .limit(1),
  );
  return rows?.[0] ? toWorkout(rows[0]) : null;
}

export type WorkoutPlan = {
  routineId: string | null;
  exercises: Array<Pick<Routine["routine_exercises"][number], "exercise_id" | "exercise_name" | "sets" | "reps" | "target_weight_kg">>;
};

export function planFromRoutine(routine: Routine): WorkoutPlan {
  return { routineId: routine.id, exercises: routine.routine_exercises };
}

export async function startWorkout(input: { title: string; visibility: Visibility; plan?: WorkoutPlan | null }): Promise<string> {
  const userId = await currentUserId();
  const row = unwrap(
    await supabase
      .from("workouts")
      .insert({
        user_id: userId,
        title: input.title.trim() || "Workout",
        visibility: input.visibility,
        routine_id: input.plan?.routineId ?? null,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single(),
  );
  const workoutId = String(row.id);
  const planned = input.plan?.exercises ?? [];
  for (let index = 0; index < planned.length; index += 1) {
    const item = planned[index];
    const exercise = unwrap(
      await supabase
        .from("workout_exercises")
        .insert({ workout_id: workoutId, exercise_id: item.exercise_id, exercise_name: item.exercise_name, order_index: index })
        .select("id")
        .single(),
    );
    const sets = Array.from({ length: Math.max(1, item.sets) }, (_, setIndex) => ({
      workout_exercise_id: exercise.id,
      set_index: setIndex,
      reps: item.reps,
      weight_kg: item.target_weight_kg ?? 0,
      completed: false,
    }));
    unwrap(await supabase.from("workout_sets").insert(sets));
  }
  return workoutId;
}

export async function addExercise(workoutId: string, exercise: Pick<Exercise, "id" | "name" | "muscle_group" | "equipment">, orderIndex: number): Promise<void> {
  const row = unwrap(
    await supabase
      .from("workout_exercises")
      .insert({
        workout_id: workoutId,
        exercise_id: exercise.id,
        exercise_name: exercise.name,
        muscle_group: exercise.muscle_group,
        equipment: exercise.equipment,
        order_index: orderIndex,
      })
      .select("id")
      .single(),
  );
  const last = await lastSetFor(exercise.name);
  unwrap(
    await supabase.from("workout_sets").insert({
      workout_exercise_id: row.id,
      set_index: 0,
      reps: last?.reps ?? 8,
      weight_kg: last?.weight_kg ?? 0,
      completed: false,
    }),
  );
}

export async function replaceExercise(workoutExerciseId: string, exercise: Pick<Exercise, "id" | "name" | "muscle_group" | "equipment">): Promise<void> {
  unwrap(
    await supabase
      .from("workout_exercises")
      .update({
        exercise_id: exercise.id,
        exercise_name: exercise.name,
        muscle_group: exercise.muscle_group,
        equipment: exercise.equipment,
      })
      .eq("id", workoutExerciseId),
  );
}

export async function removeExercise(workoutExerciseId: string): Promise<void> {
  unwrap(await supabase.from("workout_exercises").delete().eq("id", workoutExerciseId));
}

export async function addSet(workoutExerciseId: string, set: Omit<WorkoutSet, "id">): Promise<WorkoutSet> {
  const row = unwrap(
    await supabase
      .from("workout_sets")
      .insert({ workout_exercise_id: workoutExerciseId, ...set })
      .select("*")
      .single(),
  );
  return toSet(row);
}

export async function updateSet(setId: string, patch: Partial<Omit<WorkoutSet, "id">>): Promise<void> {
  unwrap(await supabase.from("workout_sets").update(patch).eq("id", setId));
}

export async function deleteSet(setId: string): Promise<void> {
  unwrap(await supabase.from("workout_sets").delete().eq("id", setId));
}

async function previousBests(userId: string, names: string[]): Promise<Map<string, Partial<ExerciseBests>>> {
  const map = new Map<string, Partial<ExerciseBests>>();
  if (names.length === 0) return map;
  const rows = unwrap(
    await supabase
      .from("personal_records")
      .select("exercise_name, record_type, value")
      .eq("user_id", userId)
      .in("exercise_name", names),
  );
  for (const row of (rows ?? []) as Row[]) {
    const key = String(row.exercise_name).toLowerCase();
    const current = map.get(key) ?? {};
    const type = row.record_type as keyof ExerciseBests;
    current[type] = Math.max(current[type] ?? 0, num(row.value));
    map.set(key, current);
  }
  return map;
}

export async function finishWorkout(
  workoutId: string,
  input: { title: string; visibility: Visibility; notes: string | null },
): Promise<{ workout: Workout; records: RecordCandidate[] }> {
  const userId = await currentUserId();
  const workout = await getWorkout(workoutId);
  if (!workout) throw new Error("Workout not found");
  const unfinished = workout.exercises.flatMap((exercise) => exercise.sets.filter((set) => !set.completed).map((set) => set.id));
  if (unfinished.length > 0) unwrap(await supabase.from("workout_sets").delete().in("id", unfinished));
  const exercises = workout.exercises
    .map((exercise) => ({ ...exercise, sets: exercise.sets.filter((set) => set.completed) }))
    .filter((exercise) => exercise.sets.length > 0);
  const emptyExercises = workout.exercises.filter((exercise) => !exercises.some((kept) => kept.id === exercise.id)).map((exercise) => exercise.id);
  if (emptyExercises.length > 0) unwrap(await supabase.from("workout_exercises").delete().in("id", emptyExercises));

  const completedAt = new Date().toISOString();
  const volume = workoutVolume(exercises);
  unwrap(
    await supabase
      .from("workouts")
      .update({
        title: input.title.trim() || workout.title,
        visibility: input.visibility,
        notes: input.notes,
        completed_at: completedAt,
        total_volume_kg: volume,
      })
      .eq("id", workoutId),
  );

  const prior = await previousBests(userId, Array.from(new Set(exercises.map((exercise) => exercise.exercise_name))));
  const records = detectRecords(exercises, prior);
  if (records.length > 0) {
    unwrap(
      await supabase.from("personal_records").insert(
        records.map((record) => ({
          user_id: userId,
          exercise_id: record.exercise_id,
          exercise_name: record.exercise_name,
          record_type: record.record_type,
          value: record.value,
          workout_id: workoutId,
          is_baseline: record.is_baseline,
          achieved_at: completedAt,
        })),
      ),
    );
  }
  return {
    workout: { ...workout, exercises, completed_at: completedAt, total_volume_kg: volume, visibility: input.visibility },
    records,
  };
}

export async function deleteWorkout(id: string): Promise<void> {
  unwrap(await supabase.from("workouts").delete().eq("id", id));
}

export async function listRecordsForWorkout(workoutId: string): Promise<PersonalRecord[]> {
  const rows = unwrap(
    await supabase
      .from("personal_records")
      .select("id, exercise_name, record_type, value, workout_id, achieved_at")
      .eq("workout_id", workoutId)
      .eq("is_baseline", false),
  );
  return (rows ?? []).map((row: Row) => ({ ...row, value: num(row.value) })) as PersonalRecord[];
}

export async function listPersonalRecords(exerciseName?: string): Promise<PersonalRecord[]> {
  const userId = await currentUserId();
  let query = supabase
    .from("personal_records")
    .select("id, exercise_name, record_type, value, workout_id, achieved_at")
    .eq("user_id", userId)
    .order("achieved_at", { ascending: false })
    .limit(200);
  if (exerciseName) query = query.eq("exercise_name", exerciseName);
  return (unwrap(await query) ?? []).map((row: Row) => ({ ...row, value: num(row.value) })) as PersonalRecord[];
}

export type ExerciseSession = {
  workout_id: string;
  date: string;
  sets: WorkoutSet[];
};

export async function exerciseHistory(exerciseName: string, limit = 30): Promise<ExerciseSession[]> {
  const userId = await currentUserId();
  const rows = unwrap(
    await supabase
      .from("workout_exercises")
      .select("id, exercise_name, workouts!inner(id, user_id, started_at, completed_at), workout_sets(*)")
      .eq("exercise_name", exerciseName)
      .eq("workouts.user_id", userId)
      .not("workouts.completed_at", "is", null)
      .limit(200),
  );
  return (rows ?? [])
    .map((row: Row) => {
      const parent = row.workouts as unknown as { id: string; started_at: string };
      return {
        workout_id: parent.id,
        date: parent.started_at,
        sets: ((row.workout_sets as Record<string, unknown>[] | null) ?? []).map(toSet).sort((a, b) => a.set_index - b.set_index),
      };
    })
    .sort((a: ExerciseSession, b: ExerciseSession) => a.date.localeCompare(b.date))
    .slice(-limit);
}

async function lastSetFor(exerciseName: string): Promise<WorkoutSet | null> {
  const history = await exerciseHistory(exerciseName, 1);
  const sets = history.at(-1)?.sets.filter((set) => set.completed && !set.is_warmup) ?? [];
  return sets.at(-1) ?? null;
}

export async function recentExerciseNames(limit = 12): Promise<string[]> {
  const workouts = await listWorkouts({ limit: 10 });
  const names: string[] = [];
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      if (!names.includes(exercise.exercise_name)) names.push(exercise.exercise_name);
    }
  }
  return names.slice(0, limit);
}
