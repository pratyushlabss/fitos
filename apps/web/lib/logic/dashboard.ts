import type { Meal, MealType, Profile } from "@fitos/types";

import { computeTargets, type TargetInput, trainingBonus } from "@/lib/logic/targets";

export type MacroTotals = { calories: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number };

// No per-user fibre goal is stored; 30 g/day is the common adult guideline.
export const FIBRE_TARGET_G = 30;

export const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snacks"];

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snacks: "Snacks",
};

export function totalsFor(meals: Meal[]): MacroTotals {
  const totals: MacroTotals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 };
  for (const meal of meals) {
    for (const item of meal.meal_items) {
      totals.calories += item.calories;
      totals.protein_g += item.protein_g;
      totals.carbs_g += item.carbs_g;
      totals.fat_g += item.fat_g;
      totals.fibre_g += item.fibre_g ?? 0;
    }
  }
  return {
    calories: Math.round(totals.calories),
    protein_g: Math.round(totals.protein_g),
    carbs_g: Math.round(totals.carbs_g),
    fat_g: Math.round(totals.fat_g),
    fibre_g: Math.round(totals.fibre_g),
  };
}

export function targetsFor(profile: Profile | null, trainedMinutes = 0): MacroTotals {
  const bonus = trainingBonus(trainedMinutes);
  return {
    calories: (profile?.calorie_target ?? 2200) + bonus.kcal,
    protein_g: profile?.protein_target_g ?? 160,
    carbs_g: (profile?.carbs_target_g ?? 250) + bonus.carbs_g,
    fat_g: profile?.fat_target_g ?? 70,
    fibre_g: FIBRE_TARGET_G,
  };
}

export function defaultMealType(date = new Date()): MealType {
  const hour = date.getHours();
  if (hour < 11) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 21) return "dinner";
  return "snacks";
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function recoveryLabel(score: number | null): string {
  if (score === null) return "No score yet";
  if (score >= 80) return "Recovered";
  if (score >= 60) return "Balanced";
  return "Needs recovery";
}

export function suggestedTargets(input: TargetInput): Pick<Profile, "calorie_target" | "protein_target_g" | "carbs_target_g" | "fat_target_g"> {
  const t = computeTargets(input);
  return { calorie_target: t.calorie_target, protein_target_g: t.protein_target_g, carbs_target_g: t.carbs_target_g, fat_target_g: t.fat_target_g };
}

export const GOALS: Array<{ value: NonNullable<Profile["goal"]>; label: string }> = [
  { value: "build_muscle", label: "Build muscle" },
  { value: "lose_fat", label: "Lose fat" },
  { value: "strength", label: "Get stronger" },
  { value: "endurance", label: "Endurance" },
  { value: "general", label: "General fitness" },
];
