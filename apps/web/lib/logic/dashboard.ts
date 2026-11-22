import type { Meal, MealType, Profile } from "@fitos/types";

export type MacroTotals = { calories: number; protein_g: number; carbs_g: number; fat_g: number };

export const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
  other: "Other",
};

export function totalsFor(meals: Meal[]): MacroTotals {
  const totals: MacroTotals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const meal of meals) {
    for (const item of meal.meal_items) {
      totals.calories += item.calories;
      totals.protein_g += item.protein_g;
      totals.carbs_g += item.carbs_g;
      totals.fat_g += item.fat_g;
    }
  }
  return {
    calories: Math.round(totals.calories),
    protein_g: Math.round(totals.protein_g),
    carbs_g: Math.round(totals.carbs_g),
    fat_g: Math.round(totals.fat_g),
  };
}

export function targetsFor(profile: Profile | null): MacroTotals {
  return {
    calories: profile?.calorie_target ?? 2200,
    protein_g: profile?.protein_target_g ?? 160,
    carbs_g: profile?.carbs_target_g ?? 250,
    fat_g: profile?.fat_target_g ?? 70,
  };
}

export function defaultMealType(date = new Date()): MealType {
  const hour = date.getHours();
  if (hour < 11) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
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

export function suggestedTargets(input: { weightKg: number | null; goal: Profile["goal"] }): Pick<
  Profile,
  "calorie_target" | "protein_target_g" | "carbs_target_g" | "fat_target_g"
> {
  const weight = input.weightKg ?? 75;
  const maintenance = Math.round(weight * 31);
  const calories =
    input.goal === "lose_fat" ? maintenance - 450 : input.goal === "build_muscle" ? maintenance + 250 : maintenance;
  const protein = Math.round(weight * (input.goal === "endurance" ? 1.6 : 2.0));
  const fat = Math.round((calories * 0.27) / 9);
  const carbs = Math.max(50, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calorie_target: calories, protein_target_g: protein, carbs_target_g: carbs, fat_target_g: fat };
}

export const GOALS: Array<{ value: NonNullable<Profile["goal"]>; label: string }> = [
  { value: "build_muscle", label: "Build muscle" },
  { value: "lose_fat", label: "Lose fat" },
  { value: "strength", label: "Get stronger" },
  { value: "endurance", label: "Endurance" },
  { value: "general", label: "General fitness" },
];
