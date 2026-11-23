import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { AiError, aiInfo, createGuard, generateJSON, type Guard, type ImageInput, type JsonSchema } from "./ai.ts";
import { embed, toVector } from "./embed.ts";

// Retrieval thresholds on match_foods.score (0..1). Tuned with scripts/rag_eval.ts; see PROGRESS.md.
export const THRESHOLDS = {
  cacheSimilarity: 0.95, // semantic cache: reuse a confirmed draft
  strong: 0.8, // text: every segment this good -> no AI call
  photoStrong: 0.75, // photo: item this good -> DB values, no breakdown
  accept: 0.55, // below this a proposed match is rejected and treated as new
};
const MAX_CANDIDATES = 25;

export type Unit = "roti" | "katori" | "ladle" | "piece" | "plate" | "cup" | "tbsp" | "g" | "serving";
const UNITS: Unit[] = ["roti", "katori", "ladle", "piece", "plate", "cup", "tbsp", "g", "serving"];
export type MealType = "breakfast" | "lunch" | "dinner" | "snacks";
export type FoodSource = "ifct" | "ai" | "user" | "barcode" | "verified";
export type Per100 = { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number };
export type Serving = { unit: Unit; grams: number; label: string | null; specific: boolean };

export type DraftIngredient = { food_id: string | null; name: string; grams: number; per100: Per100; source: FoodSource; notes: string | null };
export type DraftItem = {
  key: string;
  food_id: string | null;
  name: string;
  is_dish: boolean;
  cuisine: string | null;
  quantity: number;
  unit: Unit;
  grams: number;
  per100: Per100;
  source: FoodSource;
  own: boolean;
  confidence: number;
  match_score: number | null;
  ingredients: DraftIngredient[];
  servings: Serving[];
};
export type Draft = {
  analysis_id: string | null;
  input_type: "text" | "photo" | "barcode";
  input_text: string | null;
  image_path: string | null;
  cuisine: string | null;
  confidence: number;
  question: string | null;
  items: DraftItem[];
  meal_type: MealType | null;
  date: string | null;
  cache_hit: boolean;
  ai_calls: number;
  candidates_count: number;
};

export type Candidate = {
  food_id: string;
  name: string;
  cuisine: string | null;
  source: FoodSource;
  verified: boolean;
  is_dish: boolean;
  is_own: boolean;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fibre_g: number | null;
  serving_grams: number | null;
  servings: Serving[];
  score: number;
  rrf: number;
};

export type Ctx = { userId: string | null; user: SupabaseClient; admin: SupabaseClient; aiCalls: number; guard: Guard; timezone: string };

export function createCtx(userId: string | null, user: SupabaseClient, admin: SupabaseClient, timezone = "UTC", action = "nutrition"): Ctx {
  const ctx = { userId, user, admin, timezone, aiCalls: 0 } as Ctx;
  ctx.guard = createGuard(admin, userId, action, () => {
    ctx.aiCalls += 1;
  });
  return ctx;
}

// Embeddings barely separate "2 roti" from "3 roti", so a cache hit also needs the same numbers.
const NUMBER_WORD_VALUES: Record<string, string> = { a: "1", an: "1", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", half: "0.5" };
export function quantitySignature(text: string): string {
  const tokens = text.toLowerCase().match(/\d+(?:\.\d+)?|\b(?:one|two|three|four|five|six|seven|eight|half)\b/g) ?? [];
  return tokens.map((t) => NUMBER_WORD_VALUES[t] ?? String(Number(t))).sort().join(",");
}

const n = (value: unknown) => {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
};
const round1 = (value: number) => Math.round(value * 10) / 10;

export function localDate(timezone: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export function macrosFor(item: Pick<DraftItem, "grams" | "per100" | "ingredients">): Per100 {
  const parts = item.ingredients.length ? item.ingredients : [{ grams: item.grams, per100: item.per100 }];
  const total = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 };
  for (const part of parts) {
    const f = Math.max(0, part.grams) / 100;
    total.kcal += n(part.per100.kcal) * f;
    total.protein_g += n(part.per100.protein_g) * f;
    total.carbs_g += n(part.per100.carbs_g) * f;
    total.fat_g += n(part.per100.fat_g) * f;
    total.fibre_g += n(part.per100.fibre_g) * f;
  }
  return { kcal: round1(total.kcal), protein_g: round1(total.protein_g), carbs_g: round1(total.carbs_g), fat_g: round1(total.fat_g), fibre_g: round1(total.fibre_g) };
}

function per100Of(c: { kcal: unknown; protein_g: unknown; carbs_g: unknown; fat_g: unknown; fibre_g?: unknown }): Per100 {
  return { kcal: n(c.kcal), protein_g: n(c.protein_g), carbs_g: n(c.carbs_g), fat_g: n(c.fat_g), fibre_g: n(c.fibre_g) };
}

function sourceOf(c: { source: string; is_own?: boolean; verified?: boolean }): FoodSource {
  if (c.is_own) return "user";
  return (["ifct", "ai", "user", "barcode", "verified"].includes(c.source) ? c.source : "ai") as FoodSource;
}

// ---------- parsing ----------

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, half: 0.5 };
const UNIT_WORDS: Record<string, Unit> = {
  roti: "roti", rotis: "roti", katori: "katori", katoris: "katori", bowl: "katori", bowls: "katori",
  ladle: "ladle", ladles: "ladle", plate: "plate", plates: "plate", cup: "cup", cups: "cup", glass: "cup", glasses: "cup",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", g: "g", gm: "g", gms: "g", gram: "g", grams: "g",
  piece: "piece", pieces: "piece", pc: "piece", pcs: "piece", slice: "piece", slices: "piece", serving: "serving", servings: "serving",
};

export function splitSegments(text: string): string[] {
  return text
    .split(/,|;|\+|&|\bplus\b|\band\b|\bwith\b/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 1)
    .slice(0, 8);
}

export function parseSegment(segment: string): { quantity: number; unit: Unit | null; name: string } {
  let rest = segment.toLowerCase().trim();
  let quantity = 1;
  const numeric = rest.match(/^(\d+(?:\.\d+)?|\d+\/\d+)\s*/);
  if (numeric) {
    const raw = numeric[1];
    quantity = raw.includes("/") ? n(raw.split("/")[0]) / Math.max(1, n(raw.split("/")[1])) : n(raw);
    rest = rest.slice(numeric[0].length);
  } else {
    const word = rest.match(/^([a-z]+)\s+/);
    if (word && NUMBER_WORDS[word[1]] !== undefined) {
      quantity = NUMBER_WORDS[word[1]];
      rest = rest.slice(word[0].length);
    }
  }
  let unit: Unit | null = null;
  const unitMatch = rest.match(/^([a-z]+)\b\s*(?:of\s+)?/);
  if (unitMatch && UNIT_WORDS[unitMatch[1]]) {
    unit = UNIT_WORDS[unitMatch[1]];
    const after = rest.slice(unitMatch[0].length).trim();
    rest = after || unitMatch[1];
  }
  return { quantity: quantity > 0 ? quantity : 1, unit, name: rest.replace(/\s+/g, " ").trim() || segment };
}

export function gramsFor(quantity: number, unit: Unit | null, servings: Serving[], servingGrams: number | null): { unit: Unit; grams: number } {
  if (unit === "g") return { unit: "g", grams: quantity };
  const pick =
    (unit && (servings.find((s) => s.unit === unit && s.specific) ?? servings.find((s) => s.unit === unit))) ||
    (!unit ? servings.find((s) => s.specific && s.unit !== "g") : undefined);
  if (pick) return { unit: pick.unit, grams: round1(quantity * n(pick.grams)) };
  return { unit: "serving", grams: round1(quantity * (n(servingGrams) || 100)) };
}

// ---------- retrieval ----------

export async function retrieve(ctx: Ctx, text: string, embedding: number[] | null, cuisine: string | null, k = 10): Promise<Candidate[]> {
  const client = ctx.userId ? ctx.user : ctx.admin;
  const { data, error } = await client.rpc("match_foods", {
    query_text: text,
    query_embedding: embedding ? toVector(embedding) : null,
    p_user_id: ctx.userId,
    k,
    p_cuisine: cuisine,
  });
  if (error) throw new Error(`match_foods: ${error.message}`);
  return ((data ?? []) as Candidate[]).map((c) => ({ ...c, score: n(c.score), servings: (c.servings ?? []) as Serving[] }));
}

function mergeCandidates(lists: Candidate[][]): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const list of lists) for (const c of list) if (!best.has(c.food_id) || best.get(c.food_id)!.score < c.score) best.set(c.food_id, c);
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
}

function candidateLines(candidates: Candidate[]): string {
  if (!candidates.length) return "(none yet)";
  return candidates
    .map((c) => `${c.food_id} | ${c.name} | ${c.cuisine ?? "-"} | ${c.is_dish ? "dish" : "ingredient"} | ${sourceOf(c)} | per100g ${n(c.kcal)} kcal P${n(c.protein_g)} C${n(c.carbs_g)} F${n(c.fat_g)}`)
    .join("\n");
}

type DishRow = { dish_food_id: string; grams_per_serving: number; notes: string | null; position: number; ingredient: Record<string, unknown> | null };

async function loadDishIngredients(ctx: Ctx, dishIds: string[]): Promise<Map<string, DraftIngredient[]>> {
  const map = new Map<string, DraftIngredient[]>();
  if (!dishIds.length) return map;
  const client = ctx.userId ? ctx.user : ctx.admin;
  const { data } = await client
    .from("dish_ingredients")
    .select("dish_food_id, grams_per_serving, notes, position, ingredient:foods!dish_ingredients_ingredient_food_id_fkey(id, name, source, verified, owner_id, food_nutrition(calories, protein_g, carbs_g, fat_g, fiber_g))")
    .in("dish_food_id", dishIds)
    .order("position");
  for (const row of (data ?? []) as unknown as DishRow[]) {
    const food = row.ingredient;
    if (!food) continue;
    const nutritionRaw = food.food_nutrition as Record<string, unknown> | Record<string, unknown>[] | null;
    const nutrition = Array.isArray(nutritionRaw) ? nutritionRaw[0] : nutritionRaw;
    const list = map.get(row.dish_food_id) ?? [];
    list.push({
      food_id: String(food.id),
      name: String(food.name),
      grams: n(row.grams_per_serving),
      per100: per100Of({ kcal: nutrition?.calories, protein_g: nutrition?.protein_g, carbs_g: nutrition?.carbs_g, fat_g: nutrition?.fat_g, fibre_g: nutrition?.fiber_g }),
      source: sourceOf({ source: String(food.source), is_own: Boolean(food.owner_id) }),
      notes: row.notes,
    });
    map.set(row.dish_food_id, list);
  }
  return map;
}

function itemFromCandidate(c: Candidate, quantity: number, unit: Unit | null, grams: number | null, recipe: DraftIngredient[] | undefined, key: string): DraftItem {
  const portion = grams && grams > 0 ? { unit: unit ?? "g", grams } : gramsFor(quantity, unit, c.servings, c.serving_grams);
  const per100 = per100Of(c);
  const servingGrams = n(c.serving_grams);
  const factor = servingGrams > 0 ? portion.grams / servingGrams : 0;
  const ingredients = recipe && factor > 0 ? recipe.map((ing) => ({ ...ing, grams: round1(ing.grams * factor) })) : [];
  return {
    key,
    food_id: c.food_id,
    name: c.name,
    is_dish: c.is_dish,
    cuisine: c.cuisine,
    quantity,
    unit: portion.unit as Unit,
    grams: portion.grams,
    per100,
    source: sourceOf(c),
    own: c.is_own,
    confidence: Math.min(0.95, c.score),
    match_score: c.score,
    ingredients,
    servings: c.servings,
  };
}

// ---------- food creation (global AI foods and dishes, written with the service role) ----------

async function embedFoods(ctx: Ctx, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { data } = await ctx.admin.rpc("foods_to_embed", { p_limit: ids.length, p_ids: ids });
  for (const row of (data ?? []) as Array<{ id: string; embedded_text: string }>) {
    try {
      const vector = await embed(row.embedded_text);
      await ctx.admin.from("foods").update({ embedding: toVector(vector), embedded_text: row.embedded_text }).eq("id", row.id);
    } catch (error) {
      console.warn("embed failed; embed-worker will retry", row.id, error instanceof Error ? error.message : error);
    }
  }
}

async function getOrCreateGlobalFood(
  ctx: Ctx,
  input: { name: string; per100: Per100; cuisine: string | null; isDish: boolean; source: FoodSource; aliases?: string[] },
  created: string[],
): Promise<string> {
  const name = input.name.trim().slice(0, 120);
  const existing = await ctx.admin.from("foods").select("id").is("owner_id", null).ilike("name", name.replace(/[%_]/g, "\\$&")).limit(1).maybeSingle();
  if (existing.data?.id) return String(existing.data.id);
  const inserted = await ctx.admin
    .from("foods")
    .insert({
      name,
      owner_id: null,
      source: input.source,
      verified: false,
      is_dish: input.isDish,
      cuisine: normalizeCuisine(input.cuisine),
      aliases: input.aliases ?? [],
      confidence: 0.5,
    })
    .select("id")
    .single();
  if (inserted.error) {
    const retry = await ctx.admin.from("foods").select("id").is("owner_id", null).ilike("name", name).limit(1).maybeSingle();
    if (retry.data?.id) return String(retry.data.id);
    throw new Error(`create food: ${inserted.error.message}`);
  }
  const id = String(inserted.data.id);
  if (!input.isDish) {
    await ctx.admin.from("food_nutrition").insert({
      food_id: id,
      calories: input.per100.kcal,
      protein_g: input.per100.protein_g,
      carbs_g: input.per100.carbs_g,
      fat_g: input.per100.fat_g,
      fiber_g: input.per100.fibre_g,
      source: input.source,
      confidence: 0.5,
    });
  }
  created.push(id);
  return id;
}

const CUISINES = ["indian", "south_indian", "north_indian", "australian", "western", "other"];
function normalizeCuisine(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.toLowerCase().replace(/[\s-]+/g, "_");
  return CUISINES.includes(v) ? v : "other";
}

async function saveDish(ctx: Ctx, item: DraftItem, ingredients: DraftIngredient[], created: string[], ownerId: string | null = null): Promise<string> {
  const perServing = Math.max(item.quantity, 0.25);
  let dishId: string;
  if (ownerId) {
    const mine = await ctx.admin.from("foods").select("id").eq("owner_id", ownerId).eq("is_dish", true).ilike("name", item.name).limit(1).maybeSingle();
    if (mine.data?.id) {
      dishId = String(mine.data.id);
      await ctx.admin.from("dish_ingredients").delete().eq("dish_food_id", dishId);
    } else {
      const ins = await ctx.admin
        .from("foods")
        .insert({ name: item.name, owner_id: ownerId, source: "user", verified: false, is_dish: true, cuisine: normalizeCuisine(item.cuisine) })
        .select("id")
        .single();
      if (ins.error) throw new Error(`create personal dish: ${ins.error.message}`);
      dishId = String(ins.data.id);
    }
  } else {
    dishId = await getOrCreateGlobalFood(ctx, { name: item.name, per100: item.per100, cuisine: item.cuisine, isDish: true, source: "ai" }, created);
    const has = await ctx.admin.from("dish_ingredients").select("id").eq("dish_food_id", dishId).limit(1);
    if ((has.data ?? []).length) return dishId;
  }
  const rows = ingredients
    .filter((ing) => ing.food_id && ing.grams > 0 && ing.food_id !== dishId)
    .map((ing, position) => ({ dish_food_id: dishId, ingredient_food_id: ing.food_id, grams_per_serving: round1(ing.grams / perServing), notes: ing.notes, position }));
  if (rows.length) await ctx.admin.from("dish_ingredients").insert(rows);
  const servingUnit: Unit = item.unit === "g" ? "serving" : item.unit;
  await ctx.admin.from("food_servings").insert({ food_id: dishId, unit: servingUnit, grams: round1(item.grams / perServing), label: `1 ${servingUnit}` });
  if (ownerId) created.push(dishId);
  return dishId;
}

// ---------- AI schemas ----------

const PER100: JsonSchema = {
  type: "object",
  properties: { kcal: { type: "number" }, protein_g: { type: "number" }, carbs_g: { type: "number" }, fat_g: { type: "number" }, fibre_g: { type: "number" } },
  required: ["kcal", "protein_g", "carbs_g", "fat_g", "fibre_g"],
};
const INGREDIENT: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    matched_food_id: { type: ["string", "null"], description: "id from the candidate list, or null" },
    grams: { type: "number", description: "raw grams for the whole amount eaten" },
    notes: { type: ["string", "null"] },
    per100: PER100,
  },
  required: ["name", "matched_food_id", "grams", "notes", "per100"],
};
const CUISINE_ENUM = { type: "string", enum: CUISINES } as JsonSchema;
const UNIT_ENUM = { type: "string", enum: UNITS } as JsonSchema;

const TEXT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    cuisine: CUISINE_ENUM,
    confidence: { type: "number" },
    question: { type: ["string", "null"] },
    dishes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          matched_food_id: { type: ["string", "null"] },
          is_dish: { type: "boolean" },
          quantity: { type: "number" },
          unit: UNIT_ENUM,
          grams: { type: "number", description: "total grams eaten" },
          confidence: { type: "number" },
          per100: PER100,
          ingredients: { type: "array", items: INGREDIENT },
        },
        required: ["name", "matched_food_id", "is_dish", "quantity", "unit", "grams", "confidence", "per100", "ingredients"],
      },
    },
  },
  required: ["cuisine", "confidence", "question", "dishes"],
};

const PHOTO_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    cuisine: CUISINE_ENUM,
    confidence: { type: "number" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          quantity: { type: "number" },
          unit: UNIT_ENUM,
          grams: { type: "number" },
          confidence: { type: "number" },
          visible_fat: { type: "string", enum: ["none", "oil", "ghee", "butter"] },
          visible_fat_grams: { type: "number" },
        },
        required: ["name", "quantity", "unit", "grams", "confidence", "visible_fat", "visible_fat_grams"],
      },
    },
  },
  required: ["cuisine", "confidence", "items"],
};

const BREAKDOWN_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    question: { type: ["string", "null"] },
    dishes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          matched_food_id: { type: ["string", "null"] },
          per100: PER100,
          ingredients: { type: "array", items: INGREDIENT },
        },
        required: ["index", "matched_food_id", "per100", "ingredients"],
      },
    },
  },
  required: ["question", "dishes"],
};

type AiIngredient = { name: string; matched_food_id: string | null; grams: number; notes: string | null; per100: Per100 };
type AiDish = { name: string; matched_food_id: string | null; is_dish: boolean; quantity: number; unit: Unit; grams: number; confidence: number; per100: Per100; ingredients: AiIngredient[] };

const GUIDE = `Portion guide: 1 roti ~40 g, 1 katori ~150 g, 1 ladle ~120 g, 1 idli ~40 g, 1 dosa ~100 g, 1 vada ~60 g, 1 cup cooked rice ~160 g, 1 plate ~300-350 g, 1 tbsp ~15 g.
Recipes are home-style: include the cooking fat (oil, ghee or butter), coconut, onion, tempering and so on. Ingredient grams are raw weights for the whole amount eaten.`;

// Turns AI dishes into draft items using candidates and the database; creates foods the DB lacks.
async function resolveDishes(ctx: Ctx, dishes: AiDish[], candidates: Candidate[], cuisine: string | null, created: string[]): Promise<DraftItem[]> {
  const byId = new Map(candidates.map((c) => [c.food_id, c]));
  const usable = (id: string | null) => (id && byId.has(id) && byId.get(id)!.score >= THRESHOLDS.accept && byId.get(id)!.kcal !== null ? byId.get(id)! : null);
  const matchedDishIds = dishes.map((d) => usable(d.matched_food_id)).filter((c): c is Candidate => Boolean(c?.is_dish)).map((c) => c.food_id);
  const recipes = await loadDishIngredients(ctx, matchedDishIds);
  const items: DraftItem[] = [];

  for (const [index, dish] of dishes.entries()) {
    const key = `d${index}`;
    const quantity = dish.quantity > 0 ? dish.quantity : 1;
    const match = usable(dish.matched_food_id);
    if (match) {
      items.push({ ...itemFromCandidate(match, quantity, dish.unit, dish.grams, recipes.get(match.food_id), key), confidence: Math.min(dish.confidence, match.score) });
      continue;
    }
    const ingredients: DraftIngredient[] = [];
    for (const ing of dish.ingredients ?? []) {
      if (!ing.name || !(ing.grams > 0)) continue;
      let cand = usable(ing.matched_food_id);
      if (!cand) {
        const found = (await retrieve(ctx, ing.name, await embed(ing.name), null, 3))[0];
        cand = found && found.score >= THRESHOLDS.accept && found.kcal !== null && !found.is_dish ? found : null;
      }
      if (cand) {
        ingredients.push({ food_id: cand.food_id, name: cand.name, grams: round1(ing.grams), per100: per100Of(cand), source: sourceOf(cand), notes: ing.notes });
      } else {
        const id = await getOrCreateGlobalFood(ctx, { name: ing.name, per100: ing.per100, cuisine: null, isDish: false, source: "ai" }, created);
        ingredients.push({ food_id: id, name: ing.name, grams: round1(ing.grams), per100: ing.per100, source: "ai", notes: ing.notes });
      }
    }
    const base: DraftItem = {
      key,
      food_id: null,
      name: dish.name,
      is_dish: ingredients.length > 1 || dish.is_dish,
      cuisine: normalizeCuisine(cuisine),
      quantity,
      unit: dish.unit,
      grams: round1(dish.grams),
      per100: dish.per100,
      source: "ai",
      own: false,
      confidence: Math.max(0, Math.min(1, dish.confidence)),
      match_score: null,
      ingredients,
      servings: [],
    };
    if (ingredients.length > 1) {
      const total = ingredients.reduce((sum, ing) => sum + ing.grams, 0);
      const sum = macrosFor({ grams: total, per100: base.per100, ingredients });
      base.per100 = total > 0 ? { kcal: round1((sum.kcal / total) * 100), protein_g: round1((sum.protein_g / total) * 100), carbs_g: round1((sum.carbs_g / total) * 100), fat_g: round1((sum.fat_g / total) * 100), fibre_g: round1((sum.fibre_g / total) * 100) } : base.per100;
      base.grams = round1(total);
      base.food_id = await saveDish(ctx, base, ingredients, created);
    } else if (ingredients.length === 1) {
      base.food_id = ingredients[0].food_id;
      base.per100 = ingredients[0].per100;
      base.source = ingredients[0].source;
      base.ingredients = [];
    } else {
      base.food_id = await getOrCreateGlobalFood(ctx, { name: dish.name, per100: dish.per100, cuisine, isDish: false, source: "ai" }, created);
    }
    items.push(base);
  }
  return items;
}

function summarize(items: DraftItem[], fallback: number): number {
  if (!items.length) return 0;
  return Math.round((items.reduce((sum, item) => sum + item.confidence, 0) / items.length || fallback) * 100) / 100;
}

async function saveAnalysis(
  ctx: Ctx,
  draft: Draft,
  extra: { embedding: number[] | null; raw: unknown; latency: number },
): Promise<Draft> {
  if (!ctx.userId) return draft;
  const { data, error } = await ctx.user
    .from("food_analyses")
    .insert({
      user_id: ctx.userId,
      input_type: draft.input_type === "photo" ? "photo" : "text",
      input_text: draft.input_text,
      image_path: draft.image_path,
      provider: draft.ai_calls ? aiInfo.provider : null,
      model: draft.ai_calls ? aiInfo.model : null,
      raw_json: extra.raw ?? null,
      detected_cuisine: draft.cuisine,
      confidence: draft.confidence,
      status: "pending",
      draft,
      input_embedding: extra.embedding ? toVector(extra.embedding) : null,
      cache_hit: draft.cache_hit,
      candidates_count: draft.candidates_count,
      ai_calls: draft.ai_calls,
      latency_ms: Math.round(extra.latency),
      source: "nutrition-ai",
      source_version: aiInfo.model,
    })
    .select("id")
    .single();
  if (error) throw new Error(`save analysis: ${error.message}`);
  return { ...draft, analysis_id: String(data.id) };
}

// ---------- analyze_text ----------

export async function analyzeText(ctx: Ctx, text: string, meta: { meal_type?: MealType | null; date?: string | null } = {}): Promise<Draft> {
  const started = performance.now();
  const input = text.trim().slice(0, 500);
  if (input.length < 2) throw new AiError("invalid_output", "Describe what you ate, like “2 roti and 1 katori dal”.");
  const segments = splitSegments(input);
  const fullEmbedding = await embed(input);
  const base = { analysis_id: null, input_type: "text" as const, input_text: input, image_path: null, meal_type: meta.meal_type ?? null, date: meta.date ?? null };

  // 1. Semantic cache: a confirmed analysis of (almost) the same words.
  if (ctx.userId) {
    const { data: cached } = await ctx.user.rpc("match_analysis_cache", { query_embedding: toVector(fullEmbedding), min_similarity: THRESHOLDS.cacheSimilarity });
    const hit = (cached ?? [])[0] as { draft: Draft; input_text: string | null } | undefined;
    if (hit?.draft?.items?.length && quantitySignature(hit.input_text ?? "") === quantitySignature(input)) {
      const draft: Draft = { ...hit.draft, ...base, cache_hit: true, ai_calls: 0, candidates_count: 0, question: null };
      return saveAnalysis(ctx, draft, { embedding: fullEmbedding, raw: { cache: true }, latency: performance.now() - started });
    }
  }

  // 2. Retrieval per segment; confident DB matches for every segment need no AI.
  const parsed = segments.map(parseSegment);
  const segmentEmbeddings = await Promise.all(parsed.map((p) => embed(p.name)));
  const perSegment = await Promise.all(parsed.map((p, i) => retrieve(ctx, p.name, segmentEmbeddings[i], null, 10)));
  const whole = await retrieve(ctx, input, fullEmbedding, null, 10);
  const candidates = mergeCandidates([...perSegment, whole]);
  const direct = perSegment.map((list) => list[0]).filter((c) => c && c.score >= THRESHOLDS.strong && c.kcal !== null);
  if (parsed.length > 0 && direct.length === parsed.length) {
    const recipes = await loadDishIngredients(ctx, direct.filter((c) => c.is_dish).map((c) => c.food_id));
    const items = parsed.map((p, i) => itemFromCandidate(direct[i], p.quantity, p.unit, null, recipes.get(direct[i].food_id), `d${i}`));
    const draft: Draft = { ...base, cuisine: direct[0].cuisine, confidence: summarize(items, 0.9), question: null, items, cache_hit: false, ai_calls: 0, candidates_count: candidates.length };
    return saveAnalysis(ctx, draft, { embedding: fullEmbedding, raw: { db_match: true }, latency: performance.now() - started });
  }

  // 3. AI with candidates as context; it must pick candidate ids or null.
  const prompt = `You are FitOS's nutrition analyst for home-style food, especially Indian (North and South) and Australian meals.
The user ate: "${input}"
Rough segments: ${JSON.stringify(segments)}

Candidate foods from our database. Use these ids only; never invent an id. Use null when nothing fits.
${candidateLines(candidates)}

1. Detect the cuisine.
2. List every dish or food eaten with quantity, unit and total grams. Understand roti, katori, ladle, plate, piece, and counts of idli, dosa, vada.
3. If a candidate is the same dish, set matched_food_id to its id and leave ingredients empty.
4. Otherwise break the dish into a typical home-style recipe of raw ingredients with grams, preferring candidate raw ingredients (set their matched_food_id). Give per-100 g macros for each ingredient and for the dish as eaten.
5. Give confidence 0-1 per dish and overall. Only if overall confidence is below 0.6, ask ONE short clarifying question (for example "Ghee or oil?"); otherwise question is null.
${GUIDE}`;
  const ai = await generateJSON<{ cuisine: string; confidence: number; question: string | null; dishes: AiDish[] }>(prompt, TEXT_SCHEMA, undefined, ctx.guard);
  const created: string[] = [];
  const cuisine = normalizeCuisine(ai.cuisine);
  const items = await resolveDishes(ctx, ai.dishes ?? [], candidates, cuisine, created);
  await embedFoods(ctx, created);
  const confidence = Math.max(0, Math.min(1, ai.confidence));
  const draft: Draft = {
    ...base,
    cuisine,
    confidence: Math.round(confidence * 100) / 100,
    question: confidence < 0.6 ? ai.question : null,
    items,
    cache_hit: false,
    ai_calls: ctx.aiCalls,
    candidates_count: candidates.length,
  };
  return saveAnalysis(ctx, draft, { embedding: fullEmbedding, raw: ai, latency: performance.now() - started });
}

// ---------- analyze_photo ----------

const FAT_PER100: Record<string, Per100> = {
  ghee: { kcal: 900, protein_g: 0, carbs_g: 0, fat_g: 99.8, fibre_g: 0 },
  oil: { kcal: 884, protein_g: 0, carbs_g: 0, fat_g: 100, fibre_g: 0 },
  butter: { kcal: 717, protein_g: 0.9, carbs_g: 0.1, fat_g: 81, fibre_g: 0 },
};

export async function analyzePhoto(ctx: Ctx, imagePath: string, image: ImageInput, meta: { meal_type?: MealType | null; date?: string | null } = {}): Promise<Draft> {
  const started = performance.now();
  const first = await generateJSON<{
    cuisine: string;
    confidence: number;
    items: Array<{ name: string; quantity: number; unit: Unit; grams: number; confidence: number; visible_fat: string; visible_fat_grams: number }>;
  }>(
    `Identify every item on this plate or table: main dishes, sides, chutneys, breads, rice, drinks (thali included).
Estimate each portion in grams from visual cues: plate size, katori, ladle, piece counts. Note visible oil, ghee or butter and estimate its grams.
${GUIDE}`,
    PHOTO_SCHEMA,
    image,
    ctx.guard,
  );
  const cuisine = normalizeCuisine(first.cuisine);
  const photoItems = (first.items ?? []).filter((item) => item.name && item.grams > 0).slice(0, 12);
  const retrieved = await Promise.all(photoItems.map(async (item) => retrieve(ctx, item.name, await embed(item.name), cuisine, 8)));
  const items: DraftItem[] = [];
  const unmatched: number[] = [];
  const recipes = await loadDishIngredients(ctx, retrieved.map((list) => list[0]).filter((c) => c && c.is_dish && c.score >= THRESHOLDS.photoStrong).map((c) => c.food_id));
  photoItems.forEach((item, i) => {
    const top = retrieved[i][0];
    if (top && top.score >= THRESHOLDS.photoStrong && top.kcal !== null) {
      items[i] = { ...itemFromCandidate(top, item.quantity || 1, item.unit, item.grams, recipes.get(top.food_id), `p${i}`), confidence: Math.min(item.confidence, top.score) };
    } else {
      unmatched.push(i);
    }
  });

  const created: string[] = [];
  const candidates = mergeCandidates(retrieved);
  let question: string | null = null;
  if (unmatched.length) {
    const second = await generateJSON<{ question: string | null; dishes: Array<{ index: number; matched_food_id: string | null; per100: Per100; ingredients: AiIngredient[] }> }>(
      `These dishes were seen in a ${cuisine ?? "home"} meal photo. For each, pick a candidate id if it is the same dish, otherwise break it into a typical home-style recipe of raw ingredients with grams for the amount shown, preferring candidate raw ingredients.
Dishes:
${unmatched.map((i) => `${i}. ${photoItems[i].name}, ${photoItems[i].quantity} ${photoItems[i].unit}, about ${photoItems[i].grams} g`).join("\n")}

Candidate foods (use these ids only, never invent one):
${candidateLines(candidates)}
Only if you are unsure about something that changes calories a lot, ask ONE short question; otherwise null.
${GUIDE}`,
      BREAKDOWN_SCHEMA,
      undefined,
      ctx.guard,
    );
    question = second.question;
    const aiDishes: AiDish[] = unmatched.map((i) => {
      const found = second.dishes.find((d) => d.index === i);
      const p = photoItems[i];
      return {
        name: p.name,
        matched_food_id: found?.matched_food_id ?? null,
        is_dish: true,
        quantity: p.quantity || 1,
        unit: p.unit,
        grams: p.grams,
        confidence: p.confidence,
        per100: found?.per100 ?? { kcal: 150, protein_g: 4, carbs_g: 20, fat_g: 5, fibre_g: 2 },
        ingredients: found?.ingredients ?? [],
      };
    });
    const resolved = await resolveDishes(ctx, aiDishes, candidates, cuisine, created);
    unmatched.forEach((i, j) => {
      items[i] = { ...resolved[j], key: `p${i}` };
    });
  }

  // Visible cooking fat becomes its own editable line.
  for (const [i, item] of photoItems.entries()) {
    if (item.visible_fat === "none" || !(item.visible_fat_grams > 0)) continue;
    const label = item.visible_fat === "ghee" ? "Ghee" : item.visible_fat === "butter" ? "Butter" : "Cooking oil";
    const found = (await retrieve(ctx, label, await embed(label), null, 3))[0];
    const match = found && found.score >= THRESHOLDS.accept && found.kcal !== null ? found : null;
    const per100 = match ? per100Of(match) : FAT_PER100[item.visible_fat] ?? FAT_PER100.oil;
    const foodId = match?.food_id ?? (await getOrCreateGlobalFood(ctx, { name: label, per100, cuisine: null, isDish: false, source: "ai" }, created));
    items.push({
      key: `f${i}`,
      food_id: foodId,
      name: `${label} (visible on ${item.name})`,
      is_dish: false,
      cuisine: null,
      quantity: round1(item.visible_fat_grams),
      unit: "g",
      grams: round1(item.visible_fat_grams),
      per100,
      source: match ? sourceOf(match) : "ai",
      own: false,
      confidence: 0.5,
      match_score: match?.score ?? null,
      ingredients: [],
      servings: [],
    });
  }
  await embedFoods(ctx, created);

  const finalItems = items.filter(Boolean);
  const confidence = Math.round(Math.max(0, Math.min(1, first.confidence)) * 100) / 100;
  const draft: Draft = {
    analysis_id: null,
    input_type: "photo",
    input_text: null,
    image_path: imagePath,
    cuisine,
    confidence,
    question: confidence < 0.6 ? question : null,
    items: finalItems,
    meal_type: meta.meal_type ?? null,
    date: meta.date ?? null,
    cache_hit: false,
    ai_calls: ctx.aiCalls,
    candidates_count: candidates.length,
  };
  return saveAnalysis(ctx, draft, { embedding: null, raw: { first, unmatched }, latency: performance.now() - started });
}

// ---------- confirm (writes meal_items with a macro snapshot; corrections loop) ----------

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snacks"];

function changed(a: DraftItem | undefined, b: DraftItem): boolean {
  if (!a) return true;
  if (Math.abs(a.grams - b.grams) > 1 || a.food_id !== b.food_id) return true;
  if (a.ingredients.length !== b.ingredients.length) return true;
  return a.ingredients.some((ing, i) => ing.food_id !== b.ingredients[i]?.food_id || Math.abs(ing.grams - (b.ingredients[i]?.grams ?? 0)) > 1);
}

export async function mealIdFor(user: SupabaseClient, userId: string, date: string, mealType: MealType): Promise<string> {
  const existing = await user.from("meals").select("id").eq("user_id", userId).eq("log_date", date).eq("meal_type", mealType).maybeSingle();
  if (existing.data?.id) return String(existing.data.id);
  const inserted = await user.from("meals").insert({ user_id: userId, log_date: date, meal_type: mealType, meal_date: new Date().toISOString() }).select("id").single();
  if (inserted.error) {
    const again = await user.from("meals").select("id").eq("user_id", userId).eq("log_date", date).eq("meal_type", mealType).maybeSingle();
    if (again.data?.id) return String(again.data.id);
    throw new Error(inserted.error.message);
  }
  return String(inserted.data.id);
}

export async function confirmDraft(
  ctx: Ctx,
  input: { analysis_id: string | null; meal_type: MealType; date: string; source: string; items: DraftItem[] },
): Promise<{ logged: number; meal_id: string; corrected: number; personalised: string[] }> {
  if (!ctx.userId) throw new Error("Sign in to log food.");
  if (!MEAL_TYPES.includes(input.meal_type)) throw new Error("Pick breakfast, lunch, dinner or snacks.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Invalid date.");
  const items = (input.items ?? []).filter((item) => item && item.name && item.grams > 0).slice(0, 30);
  if (!items.length) throw new Error("Nothing to log.");
  const source = ["search", "text_ai", "photo_ai", "barcode", "manual", "chat"].includes(input.source) ? input.source : "manual";

  const mealId = await mealIdFor(ctx.user, ctx.userId, input.date, input.meal_type);
  const rows = items.map((item) => {
    const m = macrosFor(item);
    return {
      meal_id: mealId,
      food_id: item.food_id,
      name: item.name.slice(0, 160),
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
      confidence: Math.max(0, Math.min(1, item.confidence ?? 1)),
      analysis_id: input.analysis_id,
    };
  });
  const { error } = await ctx.user.from("meal_items").insert(rows);
  if (error) throw new Error(`log: ${error.message}`);

  let corrected = 0;
  const personalised: string[] = [];
  if (input.analysis_id) {
    const { data: analysis } = await ctx.user.from("food_analyses").select("draft, status").eq("id", input.analysis_id).maybeSingle();
    const original = (analysis?.draft as Draft | undefined)?.items ?? [];
    const corrections = items
      .filter((item) => changed(original.find((o) => o.key === item.key), item))
      .map((item) => ({
        user_id: ctx.userId,
        analysis_id: input.analysis_id,
        food_id: item.food_id,
        original_payload: original.find((o) => o.key === item.key) ?? {},
        corrected_payload: item,
      }));
    const removed = original.filter((o) => !items.some((item) => item.key === o.key));
    for (const o of removed) corrections.push({ user_id: ctx.userId, analysis_id: input.analysis_id, food_id: o.food_id, original_payload: o, corrected_payload: { removed: true } as unknown as DraftItem });
    if (corrections.length) await ctx.user.from("user_corrections").insert(corrections);
    corrected = corrections.length;
    const finalDraft = { ...((analysis?.draft as Draft) ?? {}), items };
    await ctx.user
      .from("food_analyses")
      .update({ status: corrected ? "edited" : "confirmed", confirmed_at: new Date().toISOString(), draft: finalDraft })
      .eq("id", input.analysis_id);

    // Two or more corrections of the same dish -> personal copy that matches how this user cooks it.
    const created: string[] = [];
    for (const item of items.filter((i) => i.is_dish && i.food_id && i.ingredients.length && !i.own && changed(original.find((o) => o.key === i.key), i))) {
      const { count } = await ctx.user.from("user_corrections").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId).eq("food_id", item.food_id!);
      if ((count ?? 0) >= 2) {
        const id = await saveDish(ctx, item, item.ingredients, created, ctx.userId);
        personalised.push(id);
      }
    }
    await embedFoods(ctx, created);
  }
  return { logged: rows.length, meal_id: mealId, corrected, personalised };
}

// ---------- search (no AI quota) ----------

export async function searchFoods(ctx: Ctx, q: string, cuisine: string | null = null, k = 15): Promise<Candidate[]> {
  const query = q.trim().slice(0, 100);
  if (query.length < 2) return [];
  return retrieve(ctx, query, await embed(query), cuisine, k);
}
