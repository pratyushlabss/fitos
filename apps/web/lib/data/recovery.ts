import type { Profile, RecoveryCheckIn, RecoveryDay } from "@fitos/types";

import { totalsFor } from "@/lib/logic/dashboard";
import type { RecoveryFeatures, RecoveryResult } from "@/lib/logic/recovery";
import { RECOVERY_ALGORITHM } from "@/lib/logic/recovery";

import { listActivities } from "./activities";
import { currentUserId, dayBounds, num, numOrNull, supabase, unwrap, type Row } from "./base";
import { getMealsForDay } from "./nutrition";
import { listWorkouts } from "./workouts";

export async function loadDayFeatures(day: string, profile: Profile | null, checkIn: RecoveryCheckIn | null): Promise<RecoveryFeatures> {
  const { start, end } = dayBounds(day);
  const [workouts, meals, activities] = await Promise.all([
    listWorkouts({ since: start, limit: 20 }),
    getMealsForDay(day),
    listActivities({ since: start, limit: 20 }),
  ]);
  const todaysWorkouts = workouts.filter((workout) => workout.started_at < end);
  const todaysActivities = activities.filter((activity) => activity.started_at < end);
  const volume = todaysWorkouts.reduce((sum, workout) => sum + workout.total_volume_kg, 0);
  const totals = totalsFor(meals);
  const activityMinutes = todaysActivities.reduce((sum, activity) => sum + activity.duration_s / 60, 0);
  return {
    sleep_hours: checkIn?.sleep_hours ?? null,
    sleep_score: checkIn?.sleep_quality ?? null,
    stress_score: checkIn?.stress ?? null,
    soreness_score: checkIn?.soreness ?? null,
    training_load: todaysWorkouts.length ? volume / 50 : null,
    workout_count: todaysWorkouts.length ? todaysWorkouts.length : null,
    activity_load: todaysActivities.length ? Math.min(100, activityMinutes) : null,
    calories: meals.some((meal) => meal.meal_items.length) ? totals.calories : null,
    protein_g: meals.some((meal) => meal.meal_items.length) ? totals.protein_g : null,
    hrv: null,
    resting_hr: checkIn?.resting_hr ?? null,
    protein_target_g: profile?.protein_target_g ?? 160,
    calorie_target: profile?.calorie_target ?? 2200,
  };
}

export async function getCheckIn(day: string): Promise<RecoveryCheckIn | null> {
  const userId = await currentUserId();
  const row = unwrap(
    await supabase
      .from("recovery_checkins")
      .select("day, sleep_hours, sleep_quality, stress, soreness, resting_hr, notes")
      .eq("user_id", userId)
      .eq("day", day)
      .maybeSingle(),
  );
  if (!row) return null;
  return {
    day: String(row.day),
    sleep_hours: numOrNull(row.sleep_hours),
    sleep_quality: numOrNull(row.sleep_quality),
    stress: numOrNull(row.stress),
    soreness: numOrNull(row.soreness),
    resting_hr: numOrNull(row.resting_hr),
    notes: (row.notes as string | null) ?? null,
  };
}

export async function saveCheckIn(checkIn: RecoveryCheckIn): Promise<void> {
  const userId = await currentUserId();
  unwrap(
    await supabase
      .from("recovery_checkins")
      .upsert({ ...checkIn, user_id: userId, updated_at: new Date().toISOString() }, { onConflict: "user_id,day" }),
  );
}

export async function saveRecoveryDay(day: string, result: RecoveryResult): Promise<void> {
  const userId = await currentUserId();
  unwrap(
    await supabase.from("recovery_daily").upsert(
      {
        user_id: userId,
        day,
        recovery_score: result.recovery_score,
        readiness_score: result.readiness_score,
        inputs: result.inputs,
        components: result.inputs,
        missing_inputs: result.missing_inputs,
        data_completeness: result.data_completeness,
        confidence: result.confidence,
        status: "open",
        algorithm: RECOVERY_ALGORITHM,
        calculated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,day,algorithm" },
    ),
  );
}

export async function listRecoveryDays(sinceDay: string): Promise<RecoveryDay[]> {
  const userId = await currentUserId();
  const rows = unwrap(
    await supabase
      .from("recovery_daily")
      .select("day, recovery_score, readiness_score, confidence, data_completeness, missing_inputs, components")
      .eq("user_id", userId)
      .eq("algorithm", RECOVERY_ALGORITHM)
      .gte("day", sinceDay)
      .order("day"),
  );
  return (rows ?? []).map((row: Row) => ({
    day: String(row.day),
    recovery_score: numOrNull(row.recovery_score),
    readiness_score: numOrNull(row.readiness_score),
    confidence: num(row.confidence),
    data_completeness: num(row.data_completeness),
    missing_inputs: (row.missing_inputs as string[] | null) ?? [],
    components: (row.components as Record<string, number | null> | null) ?? {},
  }));
}
