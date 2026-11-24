import type { Profile } from "@fitos/types";

export type Sex = "female" | "male" | "other";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";

export const ACTIVITY: Array<{ value: ActivityLevel; label: string; factor: number }> = [
  { value: "sedentary", label: "Desk job, little exercise", factor: 1.2 },
  { value: "light", label: "Light: 1–3 sessions a week", factor: 1.375 },
  { value: "moderate", label: "Moderate: 3–5 sessions a week", factor: 1.55 },
  { value: "active", label: "Active: 6–7 sessions a week", factor: 1.725 },
  { value: "very_active", label: "Very active: physical job plus training", factor: 1.9 },
];

// Mifflin-St Jeor. "other" or unknown sex uses the midpoint of the two formulas.
export function bmr(weightKg: number, heightCm: number | null, age: number | null, sex: Sex | null): number {
  const base = 10 * weightKg + 6.25 * (heightCm ?? 170) - 5 * (age ?? 30);
  return base + (sex === "male" ? 5 : sex === "female" ? -161 : -78);
}

export function calorieFloor(bmrKcal: number, sex: Sex | null): number {
  return Math.round(Math.max(bmrKcal, sex === "male" ? 1500 : 1200));
}

const PROTEIN_PER_KG: Record<NonNullable<Profile["goal"]>, number> = { lose_fat: 2.2, build_muscle: 2.0, strength: 2.0, endurance: 1.6, general: 1.6 };
const GOAL_FACTOR: Record<NonNullable<Profile["goal"]>, number> = { lose_fat: 0.82, build_muscle: 1.07, strength: 1.05, endurance: 1, general: 1 };

export type TargetInput = { weightKg: number | null; heightCm?: number | null; age?: number | null; sex?: Sex | null; activity?: ActivityLevel | null; goal: Profile["goal"] };

// TDEE x goal (cut -18%, lean bulk +7%), protein by goal, fat >= 0.6 g/kg, carbs the rest.
// Never below max(BMR, 1200 women / 1500 men) or a deficit faster than 1% bodyweight a week.
export function computeTargets(input: TargetInput) {
  const weight = input.weightKg ?? 75;
  const goal = input.goal ?? "general";
  const base = bmr(weight, input.heightCm ?? null, input.age ?? null, input.sex ?? null);
  const factor = ACTIVITY.find((a) => a.value === (input.activity ?? "moderate"))?.factor ?? 1.55;
  const tdee = base * factor;
  const maxDeficit = (weight * 0.01 * 7700) / 7;
  let calories = Math.max(tdee * GOAL_FACTOR[goal], tdee - maxDeficit);
  calories = Math.round(Math.max(calories, calorieFloor(base, input.sex ?? null)) / 10) * 10;
  const protein = Math.round(weight * PROTEIN_PER_KG[goal]);
  const fat = Math.round(Math.max(weight * 0.6, (calories * 0.25) / 9));
  const carbs = Math.max(50, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { bmr: Math.round(base), tdee: Math.round(tdee), calorie_target: calories, protein_target_g: protein, carbs_target_g: carbs, fat_target_g: fat };
}

// Training days: +1 g carbs per minute trained (max 60 g), so +4 kcal per gram.
export function trainingBonus(minutes: number): { carbs_g: number; kcal: number } {
  const carbs = Math.min(60, Math.max(0, Math.round(minutes)));
  return { carbs_g: carbs, kcal: carbs * 4 };
}
