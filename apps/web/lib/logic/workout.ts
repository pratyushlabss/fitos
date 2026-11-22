import type { PersonalRecordType, Workout, WorkoutExercise, WorkoutSet } from "@fitos/types";

export function countsTowardVolume(set: WorkoutSet): boolean {
  return set.completed && !set.is_warmup;
}

export function exerciseVolume(exercise: WorkoutExercise): number {
  return exercise.sets.filter(countsTowardVolume).reduce((sum, set) => sum + set.reps * set.weight_kg, 0);
}

export function workoutVolume(exercises: WorkoutExercise[]): number {
  return Math.round(exercises.reduce((sum, exercise) => sum + exerciseVolume(exercise), 0) * 100) / 100;
}

export function estimatedOneRepMax(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0;
  if (reps === 1) return weightKg;
  return Math.round(weightKg * (1 + Math.min(reps, 12) / 30) * 10) / 10;
}

export type ExerciseBests = Record<PersonalRecordType, number>;

export function bestsFor(exercise: WorkoutExercise): ExerciseBests {
  const sets = exercise.sets.filter((set) => countsTowardVolume(set) && set.reps > 0);
  return {
    max_weight: Math.max(0, ...sets.map((set) => set.weight_kg)),
    max_reps: Math.max(0, ...sets.map((set) => set.reps)),
    estimated_1rm: Math.max(0, ...sets.map((set) => estimatedOneRepMax(set.weight_kg, set.reps))),
    volume: exerciseVolume(exercise),
  };
}

export type RecordCandidate = {
  exercise_name: string;
  exercise_id: string | null;
  record_type: PersonalRecordType;
  value: number;
  previous: number | null;
  is_baseline: boolean;
};

const RECORD_TYPES: PersonalRecordType[] = ["max_weight", "max_reps", "estimated_1rm", "volume"];

export function detectRecords(
  exercises: WorkoutExercise[],
  previous: Map<string, Partial<ExerciseBests>>,
): RecordCandidate[] {
  const results: RecordCandidate[] = [];
  for (const exercise of exercises) {
    const bests = bestsFor(exercise);
    const prior = previous.get(exercise.exercise_name.toLowerCase());
    for (const type of RECORD_TYPES) {
      const value = bests[type];
      if (value <= 0) continue;
      const before = prior?.[type];
      if (before === undefined) {
        results.push({ exercise_name: exercise.exercise_name, exercise_id: exercise.exercise_id, record_type: type, value, previous: null, is_baseline: true });
      } else if (value > before) {
        results.push({ exercise_name: exercise.exercise_name, exercise_id: exercise.exercise_id, record_type: type, value, previous: before, is_baseline: false });
      }
    }
  }
  return results;
}

export function workoutDurationSeconds(workout: Pick<Workout, "started_at" | "completed_at">): number | null {
  if (!workout.completed_at) return null;
  return Math.max(0, Math.round((Date.parse(workout.completed_at) - Date.parse(workout.started_at)) / 1000));
}

export function completedSetCount(workout: Workout): number {
  return workout.exercises.reduce((sum, exercise) => sum + exercise.sets.filter(countsTowardVolume).length, 0);
}

export const RECORD_LABELS: Record<PersonalRecordType, string> = {
  max_weight: "Heaviest weight",
  max_reps: "Most reps",
  estimated_1rm: "Estimated 1RM",
  volume: "Best volume",
};
