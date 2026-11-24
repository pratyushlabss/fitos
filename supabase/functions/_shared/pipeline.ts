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
  notes?: string[];
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

export type Ctx = { userId: string | null; user: SupabaseClient; admin: SupabaseClient; aiCalls: number; guard: Guard; timezone: string; embeddings: Map<string, number[]> };

export function createCtx(userId: string | null, user: SupabaseClient, admin: SupabaseClient, timezone = "UTC", action = "nutrition"): Ctx {
  const ctx = { userId, user, admin, timezone, aiCalls: 0, embeddings: new Map() } as Ctx;
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

// gte-small runs on the function's own CPU: embed each text once per request, one at a time.
const MAX_EMBEDS_PER_REQUEST = 6;
async function embedOnce(ctx: Ctx, text: string): Promise<number[] | null> {
  const key = text.trim().toLowerCase();
  const hit = ctx.embeddings.get(key);
  if (hit) return hit;
  if (ctx.embeddings.size >= MAX_EMBEDS_PER_REQUEST) return null; // trigram-only retrieval from here on
  const vector = await embed(key);
  ctx.embeddings.set(key, vector);
  return vector;
}

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

// New foods are embedded inline only while the per-request budget lasts; embed-worker catches the rest.
async function embedFoods(ctx: Ctx, ids: string[]): Promise<void> {
  if (ids.length) return; // embed-worker (pg_cron, every 5 minutes) embeds new foods; inline embedding hit the CPU limit
  const room = Math.min(ids.length, Math.max(0, MAX_EMBEDS_PER_REQUEST - ctx.embeddings.size));
  if (!room) return;
  const { data } = await ctx.admin.rpc("foods_to_embed", { p_limit: room, p_ids: ids.slice(0, room) });
  for (const row of (data ?? []) as Array<{ id: string; embedded_text: string }>) {
    try {
      const vector = await embed(row.embedded_text);
      ctx.embeddings.set(`food:${row.id}`, vector);
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

// Compact on purpose: Groq's free tier allows ~1000 output tokens per minute.
const PER100: JsonSchema = { type: "array", items: { type: "number" }, description: "[kcal, protein_g, carbs_g, fat_g, fibre_g] per 100 g" };

function toPer100(value: unknown): Per100 {
  if (Array.isArray(value)) {
    const [kcal, protein_g, carbs_g, fat_g, fibre_g] = value.map((v) => n(v));
    return { kcal, protein_g, carbs_g, fat_g, fibre_g: fibre_g ?? 0 };
  }
  return per100Of((value ?? {}) as Per100);
}

function normalizeDishes<T extends { per100: unknown; ingredients: Array<{ per100: unknown }> }>(dishes: T[]): T[] {
  return dishes.map((dish) => ({
    ...dish,
    per100: toPer100(dish.per100),
    ingredients: (dish.ingredients ?? []).map((ing) => ({ ...ing, per100: toPer100(ing.per100) })),
  }));
}
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

export const TEXT_SCHEMA: JsonSchema = {
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
          ingredients: { type: "array", items: INGREDIENT, description: "at most 6 main raw ingredients incl. cooking fat; skip salt and spices under 5 g; empty when matched" },
        },
        required: ["name", "matched_food_id", "is_dish", "quantity", "unit", "grams", "confidence", "per100", "ingredients"],
      },
    },
  },
  required: ["cuisine", "confidence", "question", "dishes"],
};

type AiIngredient = { name: string; matched_food_id: string | null; grams: number; notes: string | null; per100: Per100 };
type AiDish = { name: string; matched_food_id: string | null; is_dish: boolean; quantity: number; unit: Unit; grams: number; confidence: number; per100: Per100; ingredients: AiIngredient[] };

const GUIDE = `Portion guide: 1 roti ~40 g, 1 katori ~150 g, 1 ladle ~120 g, 1 idli ~40 g, 1 dosa ~100 g, 1 vada ~60 g, 1 cup cooked rice ~160 g, 1 plate ~300-350 g, 1 tbsp ~15 g.
Dish names are the food only, singular, without counts or units ("Roti", not "2 rotis").
grams is the total cooked weight eaten. Recipes are home-style: include the cooking fat (oil, ghee or butter), coconut, onion, tempering and so on.
Ingredient grams are raw weights for the whole amount eaten, so they are less than the cooked weight for dals, curries, rice and porridge (the rest is water). Example: 1 katori (150 g) cooked toor dal is about 40 g raw toor dal, 5 g ghee or oil, 15 g onion and tomato; about 190 kcal.
Every food needs real per100 numbers; zeros only for water, black coffee or tea, and diet drinks. Respect counts: "2 aloo paratha" is quantity 2.
Typical values per 100 g as served: chai with milk and sugar 50-70, croissant 400-430, cheeseburger 250-280, fries 280-320, biryani 160-200, aloo paratha 260-300, vada 280-320, oats cooked with milk 100-130, sausage roll 300-350, meat pie 230-270, dal 110-140 kcal, sambar 60-90, plain rice 130, roti 260-300, dosa 170-210, idli 130-150, chicken curry 150-200, paneer curry 200-260.`;

// "2 rotis" -> "Roti": counts and units belong to the portion, not the food name.
export function cleanName(name: string): string {
  const stripped = name
    .trim()
    .replace(/^(\d+(\.\d+)?|one|two|three|four|five|six|a|an|half)\s+/i, "")
    .replace(/^(katoris?|bowls?|cups?|plates?|pieces?|slices?|glass(es)?|ladles?)\s+(of\s+)?/i, "")
    .trim();
  const singular = /^[a-z]+s$/i.test(stripped) && !/ss$/i.test(stripped) && name.trim() !== stripped ? stripped.slice(0, -1) : stripped;
  const out = singular || name.trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// The text model sometimes leaves per100 at zero for foods it doesn't break down: one compact call fills them.
const ZERO_OK = /\b(water|black coffee|black tea|diet|zero|sugar[- ]free soda|soda water)\b/i;
const FILL_SCHEMA: JsonSchema = {
  type: "object",
  properties: { values: { type: "array", items: { type: "object", properties: { name: { type: "string" }, per100: PER100 }, required: ["name", "per100"] } } },
  required: ["values"],
};
async function fillMissing(ctx: Ctx, dishes: AiDish[], candidates: Candidate[]): Promise<AiDish[]> {
  const ids = new Set(candidates.map((c) => c.food_id));
  const missing = dishes.filter((d) => !(d.matched_food_id && ids.has(d.matched_food_id)) && !(d.ingredients ?? []).length && n(d.per100.kcal) <= 0 && !ZERO_OK.test(d.name));
  if (!missing.length) return dishes;
  const out = await generateJSON<{ values: Array<{ name: string; per100: unknown }> }>(
    `Give typical per-100 g nutrition as served, [kcal, protein_g, carbs_g, fat_g, fibre_g], for: ${missing.map((d) => d.name).join("; ")}. Same order. Never all zeros.`,
    FILL_SCHEMA,
    undefined,
    ctx.guard,
    "text",
  );
  return dishes.map((d) => {
    const i = missing.indexOf(d);
    const v = i >= 0 ? out.values?.[i] : undefined;
    return v ? { ...d, per100: checkPer100(toPer100(v.per100), true) } : d;
  });
}

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
        const found = (await retrieve(ctx, ing.name, null, null, 3))[0];
        cand = found && found.score >= THRESHOLDS.accept && found.kcal !== null && !found.is_dish ? found : null;
      }
      if (cand) {
        ingredients.push({ food_id: cand.food_id, name: cand.name, grams: round1(ing.grams), per100: per100Of(cand), source: sourceOf(cand), notes: ing.notes });
      } else {
        const id = await getOrCreateGlobalFood(ctx, { name: ing.name, per100: ing.per100, cuisine: null, isDish: false, source: "ai" }, created);
        ingredients.push({ food_id: id, name: ing.name, grams: round1(ing.grams), per100: ing.per100, source: "ai", notes: ing.notes });
      }
    }
    // The dish weight is what was eaten (cooked). Raw ingredients rarely add up to it: absorbed water fills
    // the gap at 0 kcal, and a recipe heavier than the dish is scaled down to it.
    const servedGrams = n(dish.grams) > 0 ? n(dish.grams) : ingredients.reduce((sum, ing) => sum + ing.grams, 0);
    const rawTotal = ingredients.reduce((sum, ing) => sum + ing.grams, 0);
    if (ingredients.length > 1 && servedGrams > 0 && rawTotal > servedGrams * 1.25) {
      const k = servedGrams / rawTotal;
      for (const ing of ingredients) ing.grams = round1(ing.grams * k);
    } else if (ingredients.length > 1 && servedGrams > 0 && rawTotal < servedGrams * 0.9) {
      const water = await getOrCreateGlobalFood(ctx, { name: "Water", per100: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 }, cuisine: null, isDish: false, source: "ai" }, created);
      ingredients.push({ food_id: water, name: "Water (absorbed in cooking)", grams: round1(servedGrams - rawTotal), per100: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 }, source: "ai", notes: null });
    }
    const base: DraftItem = {
      key,
      food_id: null,
      name: cleanName(dish.name),
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
      base.food_id = await getOrCreateGlobalFood(ctx, { name: base.name, per100: dish.per100, cuisine, isDish: false, source: "ai" }, created);
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
      model: draft.ai_calls ? (draft.input_type === "photo" ? `${aiInfo.visionModel}+${aiInfo.textModel}` : aiInfo.textModel) : null,
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
      source_version: draft.input_type === "photo" ? `${aiInfo.visionModel}+${aiInfo.textModel}` : aiInfo.textModel,
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
  const fullEmbedding = await embedOnce(ctx, input);
  const base = { analysis_id: null, input_type: "text" as const, input_text: input, image_path: null, meal_type: meta.meal_type ?? null, date: meta.date ?? null };

  // 1. Semantic cache: a confirmed analysis of (almost) the same words.
  if (ctx.userId) {
    const { data: cached } = fullEmbedding
      ? await ctx.user.rpc("match_analysis_cache", { query_embedding: toVector(fullEmbedding), min_similarity: THRESHOLDS.cacheSimilarity })
      : { data: [] };
    const hit = (cached ?? [])[0] as { draft: Draft; input_text: string | null } | undefined;
    if (hit?.draft?.items?.length && quantitySignature(hit.input_text ?? "") === quantitySignature(input)) {
      const draft: Draft = { ...hit.draft, ...base, cache_hit: true, ai_calls: 0, candidates_count: 0, question: null };
      return saveAnalysis(ctx, draft, { embedding: fullEmbedding, raw: { cache: true }, latency: performance.now() - started });
    }
  }

  // 2. Retrieval per segment; confident DB matches for every segment need no AI.
  const parsed = segments.map(parseSegment);
  const segmentEmbeddings: Array<number[] | null> = [];
  for (const p of parsed) segmentEmbeddings.push(await embedOnce(ctx, p.name));
  const perSegment = await Promise.all(parsed.map((p, i) => retrieve(ctx, p.name, segmentEmbeddings[i], null, 10)));
  const whole = await retrieve(ctx, input, fullEmbedding, null, 10);
  const candidates = mergeCandidates([...perSegment, whole]);
  const direct = perSegment.map((list) => list[0]).filter((c) => c && c.score >= THRESHOLDS.strong && c.kcal !== null);
  if (parsed.length > 0 && direct.length === parsed.length) {
    const recipes = await loadDishIngredients(ctx, direct.filter((c) => c.is_dish).map((c) => c.food_id));
    const checked = await sanityCheck(ctx, parsed.map((p, i) => itemFromCandidate(direct[i], p.quantity, p.unit, null, recipes.get(direct[i].food_id), `d${i}`)));
    const items = checked.items;
    const draft: Draft = { ...base, cuisine: direct[0].cuisine, confidence: summarize(items, 0.9), question: null, items, notes: checked.notes, cache_hit: false, ai_calls: 0, candidates_count: candidates.length };
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
  const ai = await generateJSON<{ cuisine: string; confidence: number; question: string | null; dishes: AiDish[] }>(prompt, TEXT_SCHEMA, undefined, ctx.guard, "text");
  const created: string[] = [];
  const cuisine = normalizeCuisine(ai.cuisine);
  const resolved = await resolveDishes(ctx, await fillMissing(ctx, cleanDishes(normalizeDishes(ai.dishes ?? [])), candidates), candidates, cuisine, created);
  await embedFoods(ctx, created);
  const checked = await sanityCheck(ctx, resolved);
  const confidence = Math.max(0, Math.min(1, n(ai.confidence)));
  const draft: Draft = {
    ...base,
    cuisine,
    confidence: Math.round(confidence * 100) / 100,
    question: confidence < 0.6 ? ai.question : null,
    items: checked.items,
    notes: checked.notes,
    cache_hit: false,
    ai_calls: ctx.aiCalls,
    candidates_count: candidates.length,
  };
  return saveAnalysis(ctx, draft, { embedding: fullEmbedding, raw: ai, latency: performance.now() - started });
}

// ---------- sanity checks (every draft passes these before it is returned) ----------

const CAP = { kcal: 900, protein_g: 90, carbs_g: 100, fat_g: 100, fibre_g: 60 };
const MIN_ITEM_CONFIDENCE = 0.3;

// Physical limits per 100 g, macro mass at most 100 g, and kcal within 15% of 4P + 4C + 9F.
export function checkPer100(per100: Per100, recomputeKcal: boolean): Per100 {
  const out: Per100 = {
    kcal: Math.min(Math.max(n(per100.kcal), 0), CAP.kcal),
    protein_g: Math.min(Math.max(n(per100.protein_g), 0), CAP.protein_g),
    carbs_g: Math.min(Math.max(n(per100.carbs_g), 0), CAP.carbs_g),
    fat_g: Math.min(Math.max(n(per100.fat_g), 0), CAP.fat_g),
    fibre_g: Math.min(Math.max(n(per100.fibre_g), 0), CAP.fibre_g),
  };
  const mass = out.protein_g + out.carbs_g + out.fat_g + out.fibre_g;
  if (mass > 100) {
    const k = 100 / mass;
    out.protein_g = round1(out.protein_g * k);
    out.carbs_g = round1(out.carbs_g * k);
    out.fat_g = round1(out.fat_g * k);
    out.fibre_g = round1(out.fibre_g * k);
  }
  const expected = 4 * out.protein_g + 4 * out.carbs_g + 9 * out.fat_g;
  if (recomputeKcal && expected > 5 && Math.abs(out.kcal - expected) / expected > 0.15) out.kcal = Math.min(round1(expected), CAP.kcal);
  return out;
}

// AI numbers are checked before anything is stored as a food.
function cleanDishes(dishes: AiDish[]): AiDish[] {
  return dishes.map((dish) => ({
    ...dish,
    per100: checkPer100(dish.per100, true),
    ingredients: (dish.ingredients ?? []).map((ing) => ({ ...ing, per100: checkPer100(ing.per100, true) })),
  }));
}

type PortionRange = { unit: string; name_pattern: string | null; min_g: number; max_g: number; note: string | null };
let rangesCache: { at: number; rows: PortionRange[] } | null = null;

async function portionRanges(ctx: Ctx): Promise<PortionRange[]> {
  if (rangesCache && Date.now() - rangesCache.at < 10 * 60_000) return rangesCache.rows;
  const { data, error } = await ctx.admin.from("portion_ranges").select("unit, name_pattern, min_g, max_g, note");
  if (error) {
    console.warn("portion_ranges unavailable", error.message);
    return rangesCache?.rows ?? [];
  }
  rangesCache = { at: Date.now(), rows: ((data ?? []) as PortionRange[]).map((r) => ({ ...r, min_g: n(r.min_g), max_g: n(r.max_g) })) };
  return rangesCache.rows;
}

export function rangeFor(ranges: PortionRange[], name: string, unit: Unit): PortionRange | null {
  if (unit === "g") return null;
  const units = unit === "serving" ? ["piece", "serving"] : [unit];
  const named = ranges.find((r) => r.name_pattern && units.includes(r.unit) && safeTest(r.name_pattern, name));
  return named ?? ranges.find((r) => !r.name_pattern && r.unit === unit) ?? null;
}

function safeTest(pattern: string, name: string): boolean {
  try {
    return new RegExp(`\\b(?:${pattern})`, "i").test(name);
  } catch {
    return false;
  }
}

export function applySanity(items: DraftItem[], ranges: PortionRange[]): { items: DraftItem[]; notes: string[] } {
  const notes: string[] = [];
  const kept: DraftItem[] = [];
  for (const original of items) {
    const item: DraftItem = {
      ...original,
      per100: checkPer100(original.per100, original.source === "ai"),
      ingredients: original.ingredients.map((ing) => ({ ...ing, per100: checkPer100(ing.per100, ing.source === "ai") })),
    };
    const quantity = item.quantity > 0 ? item.quantity : 1;
    const range = rangeFor(ranges, item.name, item.unit);
    if (range && item.grams > 0) {
      const each = item.grams / quantity;
      const clamped = Math.min(Math.max(each, range.min_g), range.max_g);
      if (Math.abs(clamped - each) > 0.5) {
        const factor = clamped / each;
        item.grams = round1(clamped * quantity);
        item.ingredients = item.ingredients.map((ing) => ({ ...ing, grams: round1(ing.grams * factor) }));
        item.confidence = round1(item.confidence * 0.7 * 100) / 100;
        notes.push(`${item.name}: ${Math.round(each)} g per ${item.unit} looked off, set to ${Math.round(clamped)} g (typical ${range.min_g}–${range.max_g} g).`);
      }
    }
    if (item.confidence < MIN_ITEM_CONFIDENCE) {
      notes.push(`Left out ${item.name}: not sure it was there. Add it back if it was.`);
      continue;
    }
    kept.push(item);
  }
  return { items: kept, notes };
}

async function sanityCheck(ctx: Ctx, items: DraftItem[]): Promise<{ items: DraftItem[]; notes: string[] }> {
  return applySanity(items, await portionRanges(ctx));
}

// ---------- analyze_photo: vision detects, retrieval grounds, the text model resolves ----------

const FAT_KINDS = ["none", "oil", "ghee", "butter", "cream"];
export const DETECT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    cuisine: CUISINE_ENUM,
    confidence: { type: "number", description: "0-1, how sure you are of the whole plate" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "specific dish name, e.g. masala dosa, dal tadka, flat white" },
          cuisine: CUISINE_ENUM,
          quantity: { type: "number" },
          unit: UNIT_ENUM,
          grams: { type: "number", description: "estimated total grams of this item" },
          portion_cues: { type: "string", description: "what the estimate is based on: plate size, katori, pieces, cutlery" },
          cooking_fat: { type: "string", enum: FAT_KINDS },
          fat_cues: { type: "string", description: "e.g. glistening ghee on top, oily surface; empty if none" },
          where: { type: "string", description: "position in the photo, e.g. top-left katori" },
          confidence: { type: "number" },
        },
        required: ["name", "cuisine", "quantity", "unit", "grams", "portion_cues", "cooking_fat", "fat_cues", "where", "confidence"],
      },
    },
  },
  required: ["cuisine", "confidence", "items"],
};

type Detected = { name: string; cuisine: string; quantity: number; unit: Unit; grams: number; portion_cues: string; cooking_fat: string; fat_cues: string; where: string; confidence: number };
type Detection = { cuisine: string; confidence: number; items: Detected[] };

const DETECT_PROMPT = `Look at this meal photo and list every separate food or drink you can see: main dishes, sides, chutneys, curries in katoris, breads, rice, salads, sauces, drinks.
For each give a specific name, its cuisine, quantity and unit, estimated grams, the visual cues for the portion (plate diameter, katori, ladle, piece count, cutlery for scale), any visible cooking fat (oil sheen, ghee, butter, cream) with its cues, where it is in the photo, and your confidence.
Do not list cooking fat as its own item; describe it on the dish. Do not guess foods you cannot see.
${"Portion guide: 1 roti ~40 g, 1 katori ~150 g, 1 ladle ~120 g, 1 idli ~40 g, 1 dosa ~100 g, 1 vada ~60 g, 1 cup cooked rice ~160 g, 1 plate ~300-350 g, 1 tbsp ~15 g."}`;

async function detect(ctx: Ctx, image: ImageInput): Promise<Detection> {
  const raw = await generateJSON<Detection>(DETECT_PROMPT, DETECT_SCHEMA, image, ctx.guard, "vision");
  const items = (raw.items ?? [])
    .filter((item) => item?.name && n(item.grams) > 0)
    .map((item) => ({ ...item, unit: (UNITS.includes(item.unit) ? item.unit : "serving") as Unit, quantity: n(item.quantity) > 0 ? n(item.quantity) : 1, grams: n(item.grams), confidence: Math.max(0, Math.min(1, n(item.confidence))) }))
    .slice(0, 10);
  return { cuisine: raw.cuisine, confidence: Math.max(0, Math.min(1, n(raw.confidence))), items };
}

function nameKey(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
}

export function sameFood(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x.length || !y.length) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const shared = x.filter((w) => y.includes(w)).length;
  return shared / Math.min(x.length, y.length) >= 0.5;
}

// Second look for unsure photos: items seen both times win; items seen once are kept at lower confidence.
export function mergeDetections(a: Detection, b: Detection): Detection {
  const used = new Set<number>();
  const items: Detected[] = [];
  for (const item of a.items) {
    const j = b.items.findIndex((other, index) => !used.has(index) && sameFood(item.name, other.name));
    if (j >= 0) {
      used.add(j);
      const other = b.items[j];
      items.push({ ...item, grams: round1((item.grams + other.grams) / 2), confidence: Math.max(item.confidence, other.confidence, 0.6) });
    } else {
      items.push({ ...item, confidence: round1(item.confidence * 0.6 * 100) / 100 });
    }
  }
  b.items.forEach((item, index) => {
    if (!used.has(index)) items.push({ ...item, confidence: round1(item.confidence * 0.6 * 100) / 100 });
  });
  const both = used.size;
  const confidence = items.length ? Math.max(a.confidence, b.confidence) * (both / items.length) + 0.3 * (1 - both / items.length) : 0;
  return { cuisine: a.cuisine || b.cuisine, confidence: Math.round(Math.min(1, confidence) * 100) / 100, items };
}

export async function analyzePhoto(ctx: Ctx, imagePath: string, image: ImageInput, meta: { meal_type?: MealType | null; date?: string | null } = {}): Promise<Draft> {
  const started = performance.now();

  // 1. Vision detection; a second look only when the first is unsure.
  let detection = await detect(ctx, image);
  let secondLook = false;
  if (detection.confidence < 0.6 || !detection.items.length) {
    detection = mergeDetections(detection, await detect(ctx, image));
    secondLook = true;
  }
  if (!detection.items.length) throw new AiError("invalid_output", "No food found in that photo. Try a closer shot, or describe it instead.");
  const cuisine = normalizeCuisine(detection.cuisine);

  // 2. Retrieval per detected item.
  const retrieved: Candidate[][] = [];
  for (const item of detection.items) retrieved.push(await retrieve(ctx, item.name, await embedOnce(ctx, item.name), normalizeCuisine(item.cuisine) ?? cuisine, 6));
  const candidates = mergeCandidates(retrieved);
  const strong = retrieved.map((list) => list[0]).map((c) => (c && c.score >= THRESHOLDS.photoStrong && c.kcal !== null ? c : null));

  // 3. Every item has a confident database match: no text call needed.
  let items: DraftItem[];
  let question: string | null = null;
  let textConfidence = 1;
  let raw: unknown = { detection, secondLook };
  const created: string[] = [];
  if (strong.every(Boolean)) {
    const recipes = await loadDishIngredients(ctx, strong.filter((c) => c!.is_dish).map((c) => c!.food_id));
    items = detection.items.map((d, i) => ({ ...itemFromCandidate(strong[i]!, d.quantity, d.unit, d.grams, recipes.get(strong[i]!.food_id), `p${i}`), confidence: Math.min(d.confidence, strong[i]!.score) }));
  } else {
    const ai = await generateJSON<{ cuisine: string; confidence: number; question: string | null; dishes: AiDish[] }>(
      `You are FitOS's nutrition analyst. A vision model saw these items in a ${cuisine ?? "home"} meal photo:
${detection.items.map((d, i) => `${i + 1}. ${d.name} (${d.cuisine}), ${d.quantity} ${d.unit}, about ${d.grams} g; portion cues: ${d.portion_cues || "-"}; cooking fat: ${d.cooking_fat}${d.fat_cues ? ` (${d.fat_cues})` : ""}; seen with confidence ${d.confidence}`).join("\n")}

Candidate foods from our database. Use these ids only; never invent an id. Use null when nothing fits.
${candidateLines(candidates)}

Return one dish per item above, in the same order and with the same quantity and unit.
1. If a candidate is the same dish, set matched_food_id and leave ingredients empty.
2. Otherwise give a typical home-style recipe of raw ingredients for the amount seen, preferring candidate raw ingredients (set their matched_food_id). Put the visible cooking fat inside that dish's ingredients; never as a separate dish.
3. Correct grams if the cues clearly disagree with the estimate. per100 is for the food as served (cooked).
4. Confidence 0-1 per dish and overall. Only if overall confidence is below 0.6, ask ONE short clarifying question; otherwise null.
${GUIDE}`,
      TEXT_SCHEMA,
      undefined,
      ctx.guard,
      "text",
    );
    textConfidence = Math.max(0, Math.min(1, n(ai.confidence)));
    question = ai.question;
    raw = { detection, secondLook, resolve: ai };
    const dishes = cleanDishes(normalizeDishes(ai.dishes ?? [])).map((dish, i) => ({ ...dish, confidence: Math.min(n(dish.confidence) || 0.5, detection.items[i]?.confidence ?? 0.5) }));
    items = (await resolveDishes(ctx, await fillMissing(ctx, dishes, candidates), candidates, cuisine, created)).map((item, i) => ({ ...item, key: `p${i}` }));
  }
  await embedFoods(ctx, created);
  const checked = await sanityCheck(ctx, items);

  const confidence = Math.round(Math.min(detection.confidence, textConfidence) * 100) / 100;
  const draft: Draft = {
    analysis_id: null,
    input_type: "photo",
    input_text: null,
    image_path: imagePath,
    cuisine,
    confidence,
    question: confidence < 0.6 ? question : null,
    items: checked.items,
    notes: secondLook ? ["Unsure photo: looked twice and kept what both looks agreed on.", ...checked.notes] : checked.notes,
    meal_type: meta.meal_type ?? null,
    date: meta.date ?? null,
    cache_hit: false,
    ai_calls: ctx.aiCalls,
    candidates_count: candidates.length,
  };
  return saveAnalysis(ctx, draft, { embedding: null, raw, latency: performance.now() - started });
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
  return retrieve(ctx, query, await embedOnce(ctx, query), cuisine, k);
}
