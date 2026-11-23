import { currentUserId, supabase, unwrap } from "./base";

const OWNED_TABLES: Array<{ table: string; column: string; select?: string }> = [
  { table: "profiles", column: "id" },
  { table: "workouts", column: "user_id", select: "*, workout_exercises(*, workout_sets(*))" },
  { table: "routines", column: "user_id", select: "*, routine_exercises(*)" },
  { table: "personal_records", column: "user_id" },
  { table: "activities", column: "user_id" },
  { table: "meals", column: "user_id", select: "*, meal_items(*)" },
  { table: "food_predictions", column: "user_id" },
  { table: "user_corrections", column: "user_id" },
  { table: "body_measurements", column: "user_id" },
  { table: "progress_photos", column: "user_id" },
  { table: "recovery_checkins", column: "user_id" },
  { table: "recovery_daily", column: "user_id" },
  { table: "posts", column: "user_id" },
  { table: "comments", column: "user_id" },
  { table: "follows", column: "follower_id" },
  { table: "exercises", column: "user_id" },
];

export async function exportMyData(): Promise<Blob> {
  const userId = await currentUserId();
  const data: Record<string, unknown> = { exported_at: new Date().toISOString(), user_id: userId };
  for (const { table, column, select } of OWNED_TABLES) {
    data[table] = unwrap(await supabase.from(table).select(select ?? "*").eq(column, userId).limit(10000));
  }
  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
}
