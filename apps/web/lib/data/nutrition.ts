import type {
  CoachMessage,
  DraftItem,
  FavouriteMeal,
  FoodDraft,
  FoodHit,
  Meal,
  MealItem,
  MealItemSource,
  MealType,
  NutritionDay,
  Serving,
  ServingUnit,
} from "@fitos/types";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

import { macrosFor, round1 } from "@/lib/logic/nutrition";

import { currentUserId, num, numOrNull, type Row, supabase, unwrap } from "./base";
import { uploadImage } from "./storage";
import { functionsUrl, supabaseAnonKey } from "@/lib/supabase";

// ---------- meals and items ----------

function toItem(row: Row): MealItem {
  return {
    id: String(row.id),
    meal_id: String(row.meal_id),
    food_id: (row.food_id as string | null) ?? null,
    name: String(row.name),
    quantity: num(row.quantity) || 1,
    unit: (row.unit as ServingUnit) ?? "g",
    amount_grams: num(row.amount_grams),
    calories: num(row.calories),
    protein_g: num(row.protein_g),
    carbs_g: num(row.carbs_g),
    fat_g: num(row.fat_g),
    fibre_g: num(row.fibre_g),
    source: (row.source as MealItemSource) ?? "manual",
    source_version: (row.source_version as string | null) ?? null,
    confidence: numOrNull(row.confidence) ?? 1,
    micros: (row.micros as Record<string, number> | null) ?? {},
    oil_level: (row.oil_level as MealItem["oil_level"]) ?? null,
    analysis_id: (row.analysis_id as string | null) ?? null,
  };
}

export async function getMealsForDay(day: string): Promise<Meal[]> {
  const userId = await currentUserId();
  const rows = unwrap(
    await supabase
      .from("meals")
      .select("id, meal_type, log_date, meal_items(*)")
      .eq("user_id", userId)
      .eq("log_date", day)
      .order("created_at", { referencedTable: "meal_items" }),
  );
  return (rows ?? []).map((row: Row) => ({
    id: String(row.id),
    meal_type: row.meal_type as MealType,
    log_date: String(row.log_date),
    meal_items: ((row.meal_items as Row[] | null) ?? []).map(toItem),
  }));
}

async function mealIdFor(day: string, mealType: MealType): Promise<string> {
  const userId = await currentUserId();
  const existing = unwrap(await supabase.from("meals").select("id").eq("user_id", userId).eq("log_date", day).eq("meal_type", mealType).maybeSingle());
  if (existing?.id) return String(existing.id);
  const inserted = await supabase.from("meals").insert({ user_id: userId, log_date: day, meal_type: mealType, meal_date: new Date().toISOString() }).select("id").single();
  if (inserted.error) {
    const again = unwrap(await supabase.from("meals").select("id").eq("user_id", userId).eq("log_date", day).eq("meal_type", mealType).maybeSingle());
    if (again?.id) return String(again.id);
    throw new Error(inserted.error.message);
  }
  return String(inserted.data.id);
}

// Direct logging for search, recents, favourites and my foods. Stores a macro snapshot.
export async function logItems(day: string, mealType: MealType, items: DraftItem[], source: MealItemSource): Promise<void> {
  if (!items.length) return;
  const mealId = await mealIdFor(day, mealType);
  unwrap(
    await supabase.from("meal_items").insert(
      items.map((item) => {
        const m = macrosFor(item);
        return {
          meal_id: mealId,
          food_id: item.food_id,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          amount_grams: item.grams,
          calories: m.kcal,
          protein_g: m.protein_g,
          carbs_g: m.carbs_g,
          fat_g: m.fat_g,
          fibre_g: m.fibre_g,
          source,
          source_version: item.source,
          confidence: item.confidence,
        };
      }),
    ),
  );
}

// Editing an amount rescales the stored snapshot; it never re-reads the food.
export async function updateMealItemAmount(item: MealItem, quantity: number, unit: ServingUnit, grams: number): Promise<void> {
  const factor = item.amount_grams > 0 ? grams / item.amount_grams : 1;
  unwrap(
    await supabase
      .from("meal_items")
      .update({
        quantity,
        unit,
        amount_grams: grams,
        calories: round1(item.calories * factor),
        protein_g: round1(item.protein_g * factor),
        carbs_g: round1(item.carbs_g * factor),
        fat_g: round1(item.fat_g * factor),
        fibre_g: round1(item.fibre_g * factor),
      })
      .eq("id", item.id),
  );
}

export async function moveMealItem(itemId: string, day: string, mealType: MealType): Promise<void> {
  const mealId = await mealIdFor(day, mealType);
  unwrap(await supabase.from("meal_items").update({ meal_id: mealId }).eq("id", itemId));
}

export async function deleteMealItem(id: string): Promise<void> {
  unwrap(await supabase.from("meal_items").delete().eq("id", id));
}

export async function copyMeal(meal: Meal, toDay: string, mealType: MealType): Promise<void> {
  if (!meal.meal_items.length) return;
  const mealId = await mealIdFor(toDay, mealType);
  unwrap(
    await supabase.from("meal_items").insert(
      meal.meal_items.map(({ id: _id, meal_id: _meal, analysis_id: _analysis, ...rest }) => ({ ...rest, meal_id: mealId })),
    ),
  );
}

// ---------- foods ----------

let genericServings: Serving[] | null = null;
async function loadGenericServings(): Promise<Array<Serving & { applies_to: string | null }>> {
  const rows = unwrap(await supabase.from("food_servings").select("unit, grams, label, applies_to").is("food_id", null));
  const list = (rows ?? []).map((row: Row) => ({ unit: row.unit as ServingUnit, grams: num(row.grams), label: row.label ?? null, applies_to: row.applies_to ?? null }));
  genericServings = list;
  return list;
}

async function hitsFromFoodRows(rows: Row[], own: boolean): Promise<FoodHit[]> {
  const generic = (genericServings as Array<Serving & { applies_to: string | null }> | null) ?? (await loadGenericServings());
  return rows.map((row) => {
    const nutrition = (Array.isArray(row.food_nutrition) ? row.food_nutrition[0] : row.food_nutrition) as Row | null;
    const name = String(row.name);
    const lower = name.toLowerCase();
    const specific = ((row.food_servings as Row[] | null) ?? []).map((s) => ({ unit: s.unit as ServingUnit, grams: num(s.grams), label: s.label ?? null, specific: true }));
    const shared = generic
      .filter((s) => !s.applies_to || lower.includes(s.applies_to))
      .map((s) => ({ unit: s.unit, grams: s.grams, label: s.label, specific: Boolean(s.applies_to) }));
    return {
      food_id: String(row.id),
      name,
      cuisine: row.cuisine ?? null,
      source: row.source,
      verified: Boolean(row.verified),
      is_dish: Boolean(row.is_dish),
      is_own: own || Boolean(row.owner_id),
      kcal: numOrNull(nutrition?.calories),
      protein_g: numOrNull(nutrition?.protein_g),
      carbs_g: numOrNull(nutrition?.carbs_g),
      fat_g: numOrNull(nutrition?.fat_g),
      fibre_g: numOrNull(nutrition?.fiber_g),
      serving_grams: numOrNull(row.serving_grams),
      servings: [...specific, ...shared],
    };
  });
}

const FOOD_SELECT = "id, name, cuisine, source, verified, is_dish, owner_id, serving_grams, food_nutrition(calories, protein_g, carbs_g, fat_g, fiber_g), food_servings(unit, grams, label)";

export async function myFoods(): Promise<FoodHit[]> {
  const userId = await currentUserId();
  const rows = unwrap(await supabase.from("foods").select(FOOD_SELECT).eq("owner_id", userId).order("created_at", { ascending: false }).limit(100));
  return hitsFromFoodRows(rows ?? [], true);
}

export async function recentFoods(limit = 25): Promise<FoodHit[]> {
  const userId = await currentUserId();
  const rows = unwrap(
    await supabase
      .from("meal_items")
      .select("food_id, created_at, meals!inner(user_id)")
      .eq("meals.user_id", userId)
      .not("food_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
  );
  const ids: string[] = [];
  for (const row of (rows ?? []) as Row[]) if (!ids.includes(row.food_id)) ids.push(row.food_id);
  if (!ids.length) return [];
  const foods = unwrap(await supabase.from("foods").select(FOOD_SELECT).in("id", ids.slice(0, limit)));
  const hits = await hitsFromFoodRows(foods ?? [], false);
  return ids.map((id) => hits.find((hit) => hit.food_id === id)).filter((hit): hit is FoodHit => Boolean(hit));
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
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) return new Error("Can't reach FitOS AI right now. Check your connection, or log it manually.");
  return error instanceof Error ? error : new Error("Request failed");
}

async function nutritionAi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("nutrition-ai", { body });
  if (error) throw await functionError(error);
  return data as T;
}

// Hybrid search (vectors + trigram) through the edge function; falls back to text-only RPC.
export async function searchFoods(q: string): Promise<FoodHit[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  try {
    const data = await nutritionAi<{ results: FoodHit[] }>({ action: "search", q: query, k: 20 });
    return data.results ?? [];
  } catch {
    const rows = unwrap(await supabase.rpc("match_foods", { query_text: query, query_embedding: null, k: 20 }));
    return (rows ?? []) as FoodHit[];
  }
}

export async function createMyFood(input: {
  name: string;
  servingUnit: ServingUnit;
  servingGrams: number;
  perServing: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number };
}): Promise<FoodHit> {
  const userId = await currentUserId();
  const food = unwrap(
    await supabase
      .from("foods")
      .insert({ owner_id: userId, name: input.name.trim(), source: "user", verified: false, serving_grams: input.servingGrams, cuisine: null })
      .select("id")
      .single(),
  );
  const f = 100 / Math.max(input.servingGrams, 1);
  unwrap(
    await supabase.from("food_nutrition").insert({
      food_id: food.id,
      calories: round1(input.perServing.kcal * f),
      protein_g: round1(input.perServing.protein_g * f),
      carbs_g: round1(input.perServing.carbs_g * f),
      fat_g: round1(input.perServing.fat_g * f),
      fiber_g: round1(input.perServing.fibre_g * f),
      source: "user",
      confidence: 1,
    }),
  );
  if (input.servingUnit !== "g") {
    unwrap(await supabase.from("food_servings").insert({ food_id: food.id, unit: input.servingUnit, grams: input.servingGrams, label: `1 ${input.servingUnit}` }));
  }
  const rows = unwrap(await supabase.from("foods").select(FOOD_SELECT).eq("id", food.id));
  return (await hitsFromFoodRows(rows ?? [], true))[0];
}

// ---------- AI drafts ----------

export function analyzeText(text: string, mealType: MealType, date: string): Promise<{ draft: FoodDraft }> {
  return nutritionAi({ action: "analyze_text", text, meal_type: mealType, date });
}

export async function analyzePhoto(file: Blob, mealType: MealType, date: string): Promise<{ draft: FoodDraft }> {
  const path = await uploadImage("food-photos", file, 1024);
  return nutritionAi({ action: "analyze_photo", image_path: path, meal_type: mealType, date });
}

export async function lookupBarcode(barcode: string): Promise<{ draft: FoodDraft | null; message?: string }> {
  const { data, error } = await supabase.functions.invoke("barcode", { body: { barcode } });
  if (error) throw await functionError(error);
  return data as { draft: FoodDraft | null; message?: string };
}

export function confirmDraft(input: { analysis_id: string | null; meal_type: MealType; date: string; source: MealItemSource; items: DraftItem[] }) {
  return nutritionAi<{ logged: number; corrected: number; personalised: string[] }>({ action: "confirm", ...input });
}

export function discardDraft(analysisId: string): Promise<unknown> {
  return nutritionAi({ action: "discard", analysis_id: analysisId });
}

// ---------- favourites ----------

export async function listFavourites(): Promise<FavouriteMeal[]> {
  const userId = await currentUserId();
  const rows = unwrap(
    await supabase
      .from("favourite_meals")
      .select("id, name, meal_type, favourite_meal_items(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  );
  return (rows ?? []).map((row: Row) => ({
    id: String(row.id),
    name: String(row.name),
    meal_type: (row.meal_type as MealType | null) ?? null,
    favourite_meal_items: ((row.favourite_meal_items as Row[] | null) ?? []).map((item) => ({
      id: String(item.id),
      food_id: item.food_id ?? null,
      name: String(item.name),
      quantity: num(item.quantity),
      unit: item.unit as ServingUnit,
      grams: num(item.grams),
      calories: num(item.calories),
      protein_g: num(item.protein_g),
      carbs_g: num(item.carbs_g),
      fat_g: num(item.fat_g),
      fibre_g: num(item.fibre_g),
    })),
  }));
}

export async function saveFavourite(name: string, mealType: MealType | null, items: MealItem[]): Promise<void> {
  const userId = await currentUserId();
  const fav = unwrap(await supabase.from("favourite_meals").insert({ user_id: userId, name: name.trim(), meal_type: mealType }).select("id").single());
  unwrap(
    await supabase.from("favourite_meal_items").insert(
      items.map((item, position) => ({
        favourite_meal_id: fav.id,
        food_id: item.food_id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        grams: item.amount_grams,
        calories: item.calories,
        protein_g: item.protein_g,
        carbs_g: item.carbs_g,
        fat_g: item.fat_g,
        fibre_g: item.fibre_g,
        position,
      })),
    ),
  );
}

export async function deleteFavourite(id: string): Promise<void> {
  unwrap(await supabase.from("favourite_meals").delete().eq("id", id));
}

export async function logFavourite(fav: FavouriteMeal, day: string, mealType: MealType): Promise<void> {
  const mealId = await mealIdFor(day, mealType);
  unwrap(
    await supabase.from("meal_items").insert(
      fav.favourite_meal_items.map((item) => ({
        meal_id: mealId,
        food_id: item.food_id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        amount_grams: item.grams,
        calories: item.calories,
        protein_g: item.protein_g,
        carbs_g: item.carbs_g,
        fat_g: item.fat_g,
        fibre_g: item.fibre_g,
        source: "search",
        source_version: "favourite",
        confidence: 1,
      })),
    ),
  );
}

// ---------- history ----------

export async function nutritionHistory(limit = 90): Promise<NutritionDay[]> {
  const userId = await currentUserId();
  const rows = unwrap(
    await supabase.from("nutrition_daily").select("log_date, kcal, protein_g, carbs_g, fat_g, fibre_g, items").eq("user_id", userId).order("log_date", { ascending: false }).limit(limit),
  );
  return (rows ?? []).map((row: Row) => ({
    log_date: String(row.log_date),
    kcal: num(row.kcal),
    protein_g: num(row.protein_g),
    carbs_g: num(row.carbs_g),
    fat_g: num(row.fat_g),
    fibre_g: num(row.fibre_g),
    items: num(row.items),
  }));
}

// ---------- coach ----------

export async function coachHistory(limit = 40): Promise<CoachMessage[]> {
  const userId = await currentUserId();
  const rows = unwrap(
    await supabase
      .from("coach_messages")
      .select("id, role, content, created_at")
      .eq("user_id", userId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  return ((rows ?? []) as CoachMessage[]).reverse();
}

export type CoachOption = { title: string; why: string; items: DraftItem[]; totals: { kcal: number; protein_g: number; carbs_g: number; fat_g: number } };
export type CoachCard = {
  kind: "options" | "plan" | "review";
  title: string;
  options?: CoachOption[];
  plan?: { meals: Array<{ meal: MealType; items: DraftItem[]; totals: CoachOption["totals"] }>; totals: CoachOption["totals"] };
  body?: string;
};
export type CoachResult = { reply: string; drafts: FoodDraft[]; cards?: CoachCard[]; tools_used?: string[]; logged?: number };
export type CoachEvent = { type: "tool"; name: string; label: string } | { type: "delta"; text: string };

// Streams a coach turn (server-sent events): tool chips and text deltas while it works, then the full result.
export async function coachStream(message: string, onEvent: (event: CoachEvent) => void): Promise<CoachResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again.");
  let response: Response;
  try {
    response = await fetch(functionsUrl("nutrition-ai"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "chat_stream", message }),
    });
  } catch {
    throw new Error("Can't reach FitOS AI right now. Check your connection, or log it manually.");
  }
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? "Coach failed.");
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.startsWith("data: ")) continue;
      const event = JSON.parse(part.slice(6)) as CoachEvent | ({ type: "done" } & CoachResult) | { type: "error"; message: string };
      if (event.type === "done") return event;
      if (event.type === "error") throw new Error(event.message);
      onEvent(event);
    }
  }
  throw new Error("The coach stopped early. Try again.");
}

export function coachSend(message: string): Promise<CoachResult> {
  return nutritionAi({ action: "chat", message });
}

// ---------- admin ----------

export type AiUsageSummary = {
  month_calls: number;
  today_calls: number;
  today_users: number;
  today_tokens_in: number;
  today_tokens_out: number;
  daily_call_cap: number;
  user_daily_limit: number;
  provider: string;
  model: string;
};

// Returns null for everyone except the ADMIN_USER_ID set on the server.
export async function aiAdminUsage(): Promise<AiUsageSummary | null> {
  const { data, error } = await supabase.functions.invoke("nutrition-ai", { body: { action: "admin_usage" } });
  if (error) return null;
  return data as AiUsageSummary;
}
