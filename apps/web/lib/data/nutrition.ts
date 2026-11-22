import type { FoodScanResult, Meal, MealItem, MealType, NewMealItem, NutritionLookup } from "@fitos/types";
import { FunctionsHttpError } from "@supabase/supabase-js";

import { compressImage } from "@/lib/image";

import { currentUserId, dayBounds, num, numOrNull, supabase, unwrap, type Row } from "./base";

function toItem(row: Record<string, unknown>): MealItem {
  return {
    id: String(row.id),
    meal_id: String(row.meal_id),
    name: String(row.name),
    amount_grams: num(row.amount_grams),
    calories: num(row.calories),
    protein_g: num(row.protein_g),
    carbs_g: num(row.carbs_g),
    fat_g: num(row.fat_g),
    source: String(row.source ?? "manual"),
    source_version: (row.source_version as string | null) ?? null,
    confidence: numOrNull(row.confidence) ?? 1,
    prediction_id: (row.prediction_id as string | null) ?? null,
  };
}

export async function getMealsForDay(day: string): Promise<Meal[]> {
  const userId = await currentUserId();
  const { start, end } = dayBounds(day);
  const rows = unwrap(
    await supabase
      .from("meals")
      .select("id, meal_type, meal_date, meal_items(*)")
      .eq("user_id", userId)
      .gte("meal_date", start)
      .lt("meal_date", end)
      .order("meal_date"),
  );
  return (rows ?? []).map((row: Row) => ({
    id: String(row.id),
    meal_type: row.meal_type as MealType,
    meal_date: String(row.meal_date),
    meal_items: ((row.meal_items as Record<string, unknown>[] | null) ?? []).map(toItem),
  }));
}

async function mealFor(day: string, mealType: MealType): Promise<string> {
  const userId = await currentUserId();
  const { start, end } = dayBounds(day);
  const existing = unwrap(
    await supabase
      .from("meals")
      .select("id")
      .eq("user_id", userId)
      .eq("meal_type", mealType)
      .gte("meal_date", start)
      .lt("meal_date", end)
      .limit(1),
  );
  if (existing?.[0]) return String(existing[0].id);
  const [y, m, d] = day.split("-").map(Number);
  const now = new Date();
  const when = new Date(y, m - 1, d, now.getHours(), now.getMinutes());
  const row = unwrap(
    await supabase
      .from("meals")
      .insert({ user_id: userId, meal_type: mealType, meal_date: when.toISOString() })
      .select("id")
      .single(),
  );
  return String(row.id);
}

export async function addMealItems(day: string, mealType: MealType, items: NewMealItem[]): Promise<void> {
  if (items.length === 0) return;
  const mealId = await mealFor(day, mealType);
  unwrap(await supabase.from("meal_items").insert(items.map((item) => ({ ...item, meal_id: mealId }))));
}

export async function updateMealItem(id: string, patch: Partial<NewMealItem>): Promise<void> {
  unwrap(await supabase.from("meal_items").update(patch).eq("id", id));
}

export async function deleteMealItem(id: string): Promise<void> {
  unwrap(await supabase.from("meal_items").delete().eq("id", id));
}

export async function recentFoods(limit = 30): Promise<MealItem[]> {
  const userId = await currentUserId();
  const rows = unwrap(
    await supabase
      .from("meal_items")
      .select("*, meals!inner(user_id)")
      .eq("meals.user_id", userId)
      .order("created_at", { ascending: false })
      .limit(150),
  );
  const seen = new Set<string>();
  const result: MealItem[] = [];
  for (const row of (rows ?? []) as Row[]) {
    const item = toItem(row);
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

export async function copyMeal(fromMealId: string, toDay: string, mealType: MealType): Promise<void> {
  const rows = unwrap(await supabase.from("meal_items").select("*").eq("meal_id", fromMealId));
  const items = (rows ?? []).map(toItem).map(({ id: _id, meal_id: _meal, ...rest }: MealItem) => rest);
  await addMealItems(toDay, mealType, items);
}

async function functionError(error: unknown): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      return new Error(body?.message ?? body?.error ?? "Request failed");
    } catch {
      return new Error("Request failed");
    }
  }
  return error instanceof Error ? error : new Error("Request failed");
}

export async function searchFoods(query: string): Promise<NutritionLookup[]> {
  const { data, error } = await supabase.functions.invoke("food-search", { body: { query, limit: 20 } });
  if (error) throw await functionError(error);
  return (data?.results ?? []) as NutritionLookup[];
}

export async function lookupBarcode(barcode: string): Promise<NutritionLookup | null> {
  const { data, error } = await supabase.functions.invoke("barcode", { body: { barcode } });
  if (error) throw await functionError(error);
  return (data?.result ?? null) as NutritionLookup | null;
}

export async function scanFoodPhoto(file: Blob): Promise<FoodScanResult> {
  const compressed = await compressImage(file);
  const form = new FormData();
  form.append("image", compressed, compressed.type === "image/webp" ? "meal.webp" : "meal.jpg");
  form.append("locale", typeof navigator !== "undefined" ? navigator.language : "en");
  const { data, error } = await supabase.functions.invoke("food-scan", { body: form });
  if (error) throw await functionError(error);
  return data as FoodScanResult;
}

export async function saveCorrection(predictionId: string, corrected: unknown): Promise<void> {
  const userId = await currentUserId();
  unwrap(
    await supabase
      .from("user_corrections")
      .insert({ user_id: userId, prediction_id: predictionId, corrected_payload: corrected }),
  );
}
