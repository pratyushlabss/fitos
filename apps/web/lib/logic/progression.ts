import type { Workout } from "@fitos/types";

export type ProgressionInput = {
  exercise: string;
  previous_weight_kg: number;
  previous_reps: number;
  previous_rpe: number | null;
  target_reps: number;
  recovery_score: number | null;
};

export type ProgressionRecommendation = {
  exercise: string;
  recommended_weight_kg: number;
  recommended_reps: number;
  recommended_sets: number;
  reason: string;
  confidence: number;
};

const fmt = (value: number) => `${Number(value.toFixed(2))}`;

export function recommend(input: ProgressionInput): ProgressionRecommendation {
  const { previous_weight_kg: weight, previous_reps: reps, previous_rpe: rpe, recovery_score: recovery } = input;
  let increment = 0;
  let sets = 3;
  let reason: string;
  let confidence: number;
  if (recovery !== null && recovery < 50) {
    sets = 2;
    reason = `Recovery is ${recovery}/100, so load stays at last session's level with less volume.`;
    confidence = 0.78;
  } else if (rpe !== null && rpe >= 9) {
    reason = `Last session was ${fmt(weight)} kg × ${reps} at RPE ${fmt(rpe)}. Repeat it until it feels easier.`;
    confidence = 0.8;
  } else if (reps >= input.target_reps && (rpe === null || rpe <= 8)) {
    increment = weight >= 40 ? 2.5 : 1.25;
    reason = `Last session was ${fmt(weight)} kg × ${reps}. You hit the target reps without grinding, so add a little load.`;
    confidence = 0.82;
  } else {
    reason = `Last session was ${fmt(weight)} kg × ${reps}. Build reps before adding load.`;
    confidence = 0.74;
  }
  return {
    exercise: input.exercise,
    recommended_weight_kg: Math.round((weight + increment) * 100) / 100,
    recommended_reps: input.target_reps,
    recommended_sets: sets,
    reason,
    confidence,
  };
}

export function recommendFromHistory(workouts: Workout[], recoveryScore: number | null, max = 3): ProgressionRecommendation[] {
  const seen = new Set<string>();
  const results: ProgressionRecommendation[] = [];
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      const key = exercise.exercise_name.toLowerCase();
      if (seen.has(key)) continue;
      const working = exercise.sets.filter((set) => set.completed && !set.is_warmup && set.reps > 0);
      if (working.length === 0) continue;
      seen.add(key);
      const top = working.reduce((best, set) => (set.weight_kg > best.weight_kg || (set.weight_kg === best.weight_kg && set.reps > best.reps) ? set : best));
      results.push(
        recommend({
          exercise: exercise.exercise_name,
          previous_weight_kg: top.weight_kg,
          previous_reps: top.reps,
          previous_rpe: top.rpe,
          target_reps: top.reps <= 6 ? 5 : top.reps <= 10 ? 8 : 12,
          recovery_score: recoveryScore,
        }),
      );
      if (results.length >= max) return results;
    }
  }
  return results;
}
