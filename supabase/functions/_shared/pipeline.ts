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
  tier?: string | null;
  energy_check?: string | null;
  source_ref?: string | null;
  confidence_level?: "high" | "medium" | "low";
  portion?: { min: number; typical: number; max: number } | null;
  cooking_method?: string | null;
  oil_for?: string | null; // key of the dish this oil line belongs to
  oil_level?: OilLevel | null;
  oil_base_grams?: number | null; // grams at "normal"
};
export type OilLevel = "none" | "light" | "normal" | "heavy";
export const OIL_FACTOR: Record<OilLevel, number> = { none: 0, light: 0.5, normal: 1, heavy: 1.8 };
export type QuickQuestion = { item_key: string; text: string; options: number[] };
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
  quick_question?: QuickQuestion | null;
  // "clarify": a real food word mixed with unknown words; "no_match": nothing known. Items are empty then.
  status?: "ok" | "clarify" | "no_match";
  options?: string[];
  unknown?: string[];
  message?: string | null;
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
  tier?: string | null;
  energy_check?: string | null;
  source_ref?: string | null;
  external_id?: string | null;
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
    (!unit ? servings.find((s) => s.specific && s.unit !== "g") ?? servings.find((s) => s.unit !== "g" && s.unit !== "serving") : undefined);
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
    tier: c.tier ?? null,
    energy_check: c.energy_check ?? null,
    source_ref: c.source_ref ?? null,
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

const INGREDIENT: JsonSchema = {
  type: "object",
  properties: {
    matched_food_id: { type: "string", description: "id from the candidate list" },
    grams: { type: "number", description: "grams of this ingredient in the amount eaten" },
  },
  required: ["matched_food_id", "grams"],
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
          matched_food_id: { type: ["string", "null"], description: "candidate id of the same food, or null" },
          quantity: { type: "number" },
          unit: UNIT_ENUM,
          grams: { type: "number", description: "total grams eaten" },
          confidence: { type: "number" },
          ingredients: { type: "array", items: INGREDIENT, description: "only when matched_food_id is null: the dish built from candidate ingredients; empty if it can't be built" },
        },
        required: ["name", "matched_food_id", "quantity", "unit", "grams", "confidence", "ingredients"],
      },
    },
  },
  required: ["cuisine", "confidence", "question", "dishes"],
};

type AiIngredient = { matched_food_id: string | null; grams: number };
type AiDish = { name: string; matched_food_id: string | null; quantity: number; unit: Unit; grams: number; confidence: number; ingredients: AiIngredient[] };

const GUIDE = `Portion guide: 1 roti ~40 g, 1 katori ~150 g, 1 ladle ~120 g, 1 idli ~40 g, 1 dosa ~100 g, 1 vada ~60 g, 1 cup cooked rice ~160 g, 1 plate ~300-350 g, 1 tbsp ~15 g.
Dish names are the food only, singular, without counts or units ("Roti", not "2 rotis").
grams is the total cooked weight eaten. Recipes are home-style: include the cooking fat (oil, ghee or butter), coconut, onion, tempering and so on.
Ingredient grams are raw weights for the whole amount eaten, so they are less than the cooked weight for dals, curries, rice and porridge (the rest is water). Example: 1 katori (150 g) cooked toor dal is about 40 g raw toor dal, 5 g ghee or oil, 15 g onion and tomato; about 190 kcal.
Every food needs real per100 numbers; zeros only for water, black coffee or tea, and diet drinks. Respect counts: "2 aloo paratha" is quantity 2.
Typical values per 100 g as served: chai with milk and sugar 50-70, croissant 400-430, cheeseburger 250-280, fries 280-320, biryani 160-200, aloo paratha 260-300, vada 280-320, oats cooked with milk 100-130, sausage roll 300-350, meat pie 230-270, dal 110-140 kcal, sambar 60-90, plain rice 130, roti 260-300, dosa 170-210, idli 130-150, chicken curry 150-200, paneer curry 200-260.`;

// Dry staples absorb water when cooked; only recipes with these get a water line.
const DRY = /\b(raw|dry|uncooked|flour|atta|maida|besan|sooji|suji|rava|poha flakes|flakes|lentils?|dal\b(?!.*cooked)|toor|moong|masoor|urad|chana dal|rice(?!,? cooked)(?! cooked)|oats|pasta|noodles|rajma|kidney beans|chickpeas)\b/i;

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

// No-hallucination resolver. The model may only pick candidate ids, give grams, or build a dish from candidate
// ingredients. Every nutrient number comes from database rows x grams. Anything else is "unknown".
async function resolveDishes(ctx: Ctx, dishes: AiDish[], candidates: Candidate[], cuisine: string | null, created: string[]): Promise<{ items: DraftItem[]; unknown: string[] }> {
  const byId = new Map(candidates.map((c) => [c.food_id, c]));
  const usable = (id: string | null | undefined) => (id && byId.has(id) && byId.get(id)!.kcal !== null ? byId.get(id)! : null);
  const matchedDishIds = dishes.map((d) => usable(d.matched_food_id)).filter((c): c is Candidate => Boolean(c?.is_dish)).map((c) => c.food_id);
  const recipes = await loadDishIngredients(ctx, matchedDishIds);
  const items: DraftItem[] = [];
  const unknown: string[] = [];

  for (const [index, dish] of dishes.entries()) {
    const key = `d${index}`;
    const quantity = n(dish.quantity) > 0 ? n(dish.quantity) : 1;
    const match = usable(dish.matched_food_id);
    if (match && match.score >= THRESHOLDS.accept) {
      items.push({ ...itemFromCandidate(match, quantity, dish.unit, n(dish.grams) || null, recipes.get(match.food_id), key), confidence: Math.min(n(dish.confidence) || 0.8, match.score) });
      continue;
    }
    const ingredients: DraftIngredient[] = [];
    for (const ing of dish.ingredients ?? []) {
      const c = usable(ing.matched_food_id);
      if (!c || !(n(ing.grams) > 0)) continue;
      ingredients.push({ food_id: c.food_id, name: c.name, grams: round1(n(ing.grams)), per100: per100Of(c), source: sourceOf(c), notes: null });
    }
    if (ingredients.length < 2) {
      unknown.push(cleanName(dish.name));
      continue;
    }
    // The dish weight is what was eaten. Dry staples absorb water (0 kcal); recipes in cooked weights scale to the portion.
    const servedGrams = n(dish.grams) > 0 ? n(dish.grams) : ingredients.reduce((sum, ing) => sum + ing.grams, 0);
    const rawTotal = ingredients.reduce((sum, ing) => sum + ing.grams, 0);
    if (servedGrams > 0 && rawTotal > servedGrams * 1.25) {
      const k = servedGrams / rawTotal;
      for (const ing of ingredients) ing.grams = round1(ing.grams * k);
    } else if (servedGrams > 0 && rawTotal < servedGrams * 0.9 && !ingredients.some((ing) => DRY.test(ing.name))) {
      const k = servedGrams / rawTotal;
      for (const ing of ingredients) ing.grams = round1(ing.grams * k);
    } else if (servedGrams > 0 && rawTotal < servedGrams * 0.9) {
      const water = await getOrCreateGlobalFood(ctx, { name: "Water", per100: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 }, cuisine: null, isDish: false, source: "verified" }, created);
      ingredients.push({ food_id: water, name: "Water (absorbed in cooking)", grams: round1(servedGrams - rawTotal), per100: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 }, source: "verified", notes: null });
    }
    const total = ingredients.reduce((sum, ing) => sum + ing.grams, 0);
    const sum = macrosFor({ grams: total, per100: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 }, ingredients });
    const item: DraftItem = {
      key,
      food_id: null,
      name: cleanName(dish.name),
      is_dish: true,
      cuisine: normalizeCuisine(cuisine),
      quantity,
      unit: dish.unit,
      grams: round1(total),
      per100: { kcal: round1((sum.kcal / total) * 100), protein_g: round1((sum.protein_g / total) * 100), carbs_g: round1((sum.carbs_g / total) * 100), fat_g: round1((sum.fat_g / total) * 100), fibre_g: round1((sum.fibre_g / total) * 100) },
      source: "ai",
      own: false,
      confidence: Math.max(0, Math.min(1, n(dish.confidence) || 0.6)),
      match_score: null,
      ingredients,
      servings: [],
      tier: "ai_estimate",
    };
    item.food_id = await saveDish(ctx, item, ingredients, created);
    items.push(item);
  }
  return { items, unknown };
}

// ---------- the gate: before any AI call, every word must be a known food word or a harmless modifier ----------

const MODIFIERS = new Set(("a an and the with of some small large medium big half full plain homemade home made fried deep grilled boiled steamed roasted baked " +
  "spicy sweet salted fresh hot cold warm cup cups glass glasses bowl bowls plate plates slice slices piece pieces tsp tbsp teaspoon tablespoon ml gm gms kg gram grams " +
  "serving servings extra less light heavy style my usual today for breakfast lunch dinner snack snacks ate had eaten just side mixed veg nonveg non can cans bottle " +
  "scoop scoops katori katoris roti rotis ladle ladles one two three four five six seven eight nine ten few couple handful little lot also then plus without no " +
  "medium-sized topped stuffed filled spread on in from at to my our some about approx around spiced").split(/\s+/));

// Generic dish forms: real words, but they don't say which food. "blorp kebab" is unknown, not "which kebab?".
const GENERIC = new Set(("pie pies stew stews bake bakes baked kebab kebabs noodle noodles soup soups salad salads cake cakes roll rolls wrap wraps " +
  "casserole bowl sandwich sandwiches curry curries fry dish dishes snack mix gravy masala").split(/\s+/));

let vocabCache: { at: number; words: Set<string> } | null = null;
async function vocabulary(ctx: Ctx): Promise<Set<string>> {
  if (!vocabCache || Date.now() - vocabCache.at > 10 * 60_000) {
    // One array, not rows: row results are capped at 1,000 by PostgREST (migration 018).
    const { data, error } = await ctx.admin.rpc("food_vocabulary_words");
    if (error) throw new Error(`food_vocabulary_words: ${error.message}`);
    vocabCache = { at: Date.now(), words: new Set((data ?? []) as string[]) };
  }
  if (!ctx.userId) return vocabCache.words;
  const { data } = await ctx.user.from("foods").select("name, aliases").eq("owner_id", ctx.userId).limit(500);
  const words = new Set(vocabCache.words);
  for (const f of (data ?? []) as Array<{ name: string; aliases: string[] | null }>) for (const w of `${f.name} ${(f.aliases ?? []).join(" ")}`.toLowerCase().split(/[^a-z]+/)) if (w.length >= 3) words.add(w);
  return words;
}

function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Typos keep their first letter ("masla", "pngal"); without that, 10k+ food words make most invented words
// one or two edits from something ("moonberry" -> "goosberry", "krellish" -> "relish").
export function knownWord(word: string, vocab: Set<string>): boolean {
  if (vocab.has(word) || vocab.has(word.replace(/(es|s)$/, "")) || vocab.has(`${word}s`)) return true;
  if (word.length < 4) return false;
  const max = word.length >= 7 ? 2 : 1;
  for (const v of vocab) if (v[0] === word[0] && Math.abs(v.length - word.length) <= max && lev(word, v, max) <= max) return true;
  return false;
}

// Does any word of `names` account for `word`: same word, plural, prefix ("ghe" -> ghee) or a one-letter typo?
function covers(word: string, names: string[]): boolean {
  for (const w of names) {
    if (w === word || w === word.replace(/(es|s)$/, "") || `${w}s` === word) return true;
    if (word.length >= 3 && w.startsWith(word)) return true;
    if (word.length >= 4 && w[0] === word[0] && Math.abs(w.length - word.length) <= 1 && lev(word, w, 1) <= 1) return true;
  }
  return false;
}

// Coverage: a segment of two or more food words must be explained by one of its top candidates (name or aliases),
// or it's a real word plus something we don't know ("unicorn roti") and gets a clarifying question instead of a
// silent match. Returns the gate result to use, or null when covered.
export async function coverageGate(ctx: Ctx, segment: string, candidates: Candidate[]): Promise<GateResult | null> {
  const words = parseSegment(segment).name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !MODIFIERS.has(w));
  if (words.length < 2 || !candidates.length) return null;
  const top = candidates.slice(0, 3);
  const { data } = await (ctx.userId ? ctx.user : ctx.admin).from("foods").select("id, name, aliases").in("id", top.map((c) => c.food_id));
  let best: string[] = [];
  for (const f of (data ?? []) as Array<{ name: string; aliases: string[] | null }>) {
    const names = `${f.name} ${(f.aliases ?? []).join(" ")}`.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    const hit = words.filter((w) => covers(w, names));
    if (hit.length === words.length) return null;
    if (hit.length > best.length) best = hit;
  }
  const unknown = words.filter((w) => !best.includes(w));
  const specific = best.filter((w) => !GENERIC.has(w));
  return { status: specific.length ? "clarify" : "no_match", segment, known: best, unknown };
}

export type GateResult = { status: "ok" | "no_match" | "clarify"; segment: string; known: string[]; unknown: string[] };

export function gateSegment(segment: string, vocab: Set<string>): GateResult {
  const words = segment.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !MODIFIERS.has(w));
  const known = words.filter((w) => knownWord(w, vocab));
  const unknown = words.filter((w) => !known.includes(w));
  if (!words.length || !unknown.length) return { status: "ok", segment, known, unknown };
  return { status: known.some((w) => !GENERIC.has(w)) ? "clarify" : "no_match", segment, known, unknown };
}

const NO_MATCH_MESSAGE = (names: string[]) =>
  `I don't know ${names.length === 1 ? `“${names[0]}”` : "these"} yet. Add it manually or describe the ingredients, and I'll remember it.`;

// Base ingredients the model may use to build an unknown dish (global foods only, cached).
const BASE_INGREDIENTS = ["oil", "ghee", "butter", "onion", "tomato", "rice", "wheat flour", "potato", "paneer", "chicken", "egg", "milk", "sugar", "curd", "coconut", "peanut", "lentil", "dal", "bread", "cheese", "cream", "spinach", "peas", "carrot", "besan", "semolina"];
let baseCache: { at: number; list: Candidate[] } | null = null;
async function baseCandidates(ctx: Ctx): Promise<Candidate[]> {
  if (baseCache && Date.now() - baseCache.at < 10 * 60_000) return baseCache.list;
  const lists = await Promise.all(BASE_INGREDIENTS.map((q) => retrieve({ ...ctx, userId: null } as Ctx, q, null, null, 2).catch(() => [])));
  baseCache = { at: Date.now(), list: lists.flat().filter((c) => !c.is_dish && c.score >= 0.5 && c.kcal !== null) };
  return baseCache.list;
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

// Same gate and retrieval as logging, without any AI call: used by the search eval and for instant previews.
export async function previewMatch(ctx: Ctx, text: string): Promise<{ status: "OK" | "NO_MATCH" | "CLARIFY"; options: string[]; candidates: Array<{ food_id: string; external_id: string | null; name: string; tier: string | null; score: number }> }> {
  const input = text.trim().slice(0, 200);
  const segments = splitSegments(input);
  const vocab = await vocabulary(ctx);
  const gates = (segments.length ? segments : [input]).map((segment) => gateSegment(segment, vocab));
  const clarify = gates.find((g) => g.status === "clarify");
  if (clarify) {
    const options = (await retrieve(ctx, clarify.known.join(" "), null, null, 6)).map((c) => c.name).slice(0, 3);
    return { status: "CLARIFY", options: [...options, "Something else"], candidates: [] };
  }
  const ok = gates.filter((g) => g.status === "ok");
  if (!ok.length) return { status: "NO_MATCH", options: [], candidates: [] };
  const name = parseSegment(ok[0].segment).name;
  const list = await retrieve(ctx, name, await embedOnce(ctx, name), null, 5);
  const uncovered = await coverageGate(ctx, ok[0].segment, list);
  if (uncovered?.status === "clarify") {
    const options = (await retrieve(ctx, uncovered.known.join(" "), null, null, 6)).map((c) => c.name).slice(0, 3);
    return { status: "CLARIFY", options: [...options, "Something else"], candidates: [] };
  }
  if (uncovered) return { status: "NO_MATCH", options: [], candidates: [] };
  const candidates = list.map((c) => ({ food_id: c.food_id, external_id: c.external_id ?? null, name: c.name, tier: c.tier ?? null, score: Math.round(c.score * 1000) / 1000 }));
  return { status: list[0] && list[0].score >= THRESHOLDS.accept ? "OK" : "NO_MATCH", options: [], candidates };
}

function noMatchDraft(base: Pick<Draft, "analysis_id" | "input_type" | "input_text" | "image_path" | "meal_type" | "date">, unknown: string[]): Draft {
  return { ...base, cuisine: null, confidence: 0, question: null, items: [], notes: [], cache_hit: false, ai_calls: 0, candidates_count: 0, status: "no_match", unknown, message: NO_MATCH_MESSAGE(unknown) };
}

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

  // 2. Gate: words that aren't food words never reach the model.
  const vocab = await vocabulary(ctx);
  const gates = segments.map((segment) => gateSegment(segment, vocab));
  const clarify = gates.find((g) => g.status === "clarify");
  if (clarify) {
    const options = (await retrieve(ctx, clarify.known.join(" "), null, null, 8)).filter((c) => c.kcal !== null).map((c) => c.name).filter((name, i, list) => list.indexOf(name) === i).slice(0, 3);
    return { ...base, cuisine: null, confidence: 0, question: `Which food did you mean by “${clarify.segment.trim()}”?`, items: [], notes: [], cache_hit: false, ai_calls: 0, candidates_count: options.length, status: "clarify", options: [...options, "Something else"], unknown: clarify.unknown, message: null };
  }
  const gateUnknown = gates.filter((g) => g.status === "no_match").map((g) => cleanName(parseSegment(g.segment).name));
  const okSegments = segments.filter((_, i) => gates[i].status === "ok");
  if (!okSegments.length) return noMatchDraft(base, gateUnknown);

  // 3. Retrieval per segment; confident DB matches for every segment need no AI.
  const parsed = okSegments.map(parseSegment);
  const segmentEmbeddings: Array<number[] | null> = [];
  for (const p of parsed) segmentEmbeddings.push(await embedOnce(ctx, p.name));
  const perSegment = await Promise.all(parsed.map((p, i) => retrieve(ctx, p.name, segmentEmbeddings[i], null, 10)));
  const uncovered = (await Promise.all(okSegments.map((seg, i) => coverageGate(ctx, seg, perSegment[i])))).find(Boolean);
  if (uncovered?.status === "clarify") {
    const options = (await retrieve(ctx, uncovered.known.join(" "), null, null, 8)).filter((c) => c.kcal !== null).map((c) => c.name).filter((name, i, list) => list.indexOf(name) === i).slice(0, 3);
    return { ...base, cuisine: null, confidence: 0, question: `Which food did you mean by “${uncovered.segment.trim()}”?`, items: [], notes: [], cache_hit: false, ai_calls: 0, candidates_count: options.length, status: "clarify", options: [...options, "Something else"], unknown: uncovered.unknown, message: null };
  }
  if (uncovered) return noMatchDraft(base, [cleanName(parseSegment(uncovered.segment).name)]);
  const whole = await retrieve(ctx, input, fullEmbedding, null, 10);
  const candidates = mergeCandidates([...perSegment, whole]);
  const direct = perSegment.map((list) => list[0]).filter((c) => c && c.score >= THRESHOLDS.strong && c.kcal !== null);
  if (parsed.length > 0 && direct.length === parsed.length) {
    const recipes = await loadDishIngredients(ctx, direct.filter((c) => c.is_dish).map((c) => c.food_id));
    const checked = await sanityCheck(ctx, parsed.map((p, i) => itemFromCandidate(direct[i], p.quantity, p.unit, null, recipes.get(direct[i].food_id), `d${i}`)));
    const items = checked.items;
    const notes = gateUnknown.length ? [...checked.notes, NO_MATCH_MESSAGE(gateUnknown)] : checked.notes;
    const draft: Draft = { ...base, cuisine: direct[0].cuisine, confidence: summarize(items, 0.9), question: null, items, notes, quick_question: checked.quick, unknown: gateUnknown, status: "ok", cache_hit: false, ai_calls: 0, candidates_count: candidates.length };
    return saveAnalysis(ctx, draft, { embedding: fullEmbedding, raw: { db_match: true }, latency: performance.now() - started });
  }

  // 4. The model only picks candidate ids and grams, or builds a dish from candidate ingredients. No numbers of its own.
  const pool = mergeCandidates([candidates, await baseCandidates(ctx)]).concat((await baseCandidates(ctx)).filter((b) => !candidates.some((c) => c.food_id === b.food_id))).slice(0, 45);
  const prompt = `You are FitOS's food matcher for home-style food, especially Indian and Australian meals.
The user ate: "${okSegments.join(", ")}"

Candidate foods from our database (id | name | cuisine | dish or ingredient | source | per 100 g). Use these ids only; never invent an id.
${candidateLines(pool)}

1. List every food eaten with quantity, unit and total grams. Understand roti, katori, ladle, plate, piece, and counts of idli, dosa, vada.
2. If a candidate is the same food, set matched_food_id to its id and leave ingredients empty.
3. Otherwise, if the dish can be made from candidate ingredients, set matched_food_id null and list those ingredient ids with grams for the amount eaten (raw grams for dry staples). If it can't be built from the candidates, leave ingredients empty.
4. Never output nutrient numbers. Confidence 0-1 per food and overall; only below 0.6, ask ONE short question, otherwise null.
${GUIDE}`;
  const ai = await generateJSON<{ cuisine: string; confidence: number; question: string | null; dishes: AiDish[] }>(prompt, TEXT_SCHEMA, undefined, ctx.guard, "text");
  const created: string[] = [];
  const cuisine = normalizeCuisine(ai.cuisine);
  const counted = (ai.dishes ?? []).map((dish) => {
    const seg = parsed.find((p) => p.quantity > 1 && sameFood(p.name, dish.name));
    if (!seg || n(dish.quantity) === seg.quantity || n(dish.quantity) <= 0) return dish;
    const k = seg.quantity / n(dish.quantity);
    return { ...dish, quantity: seg.quantity, grams: round1(n(dish.grams) * k), ingredients: (dish.ingredients ?? []).map((ing) => ({ ...ing, grams: round1(n(ing.grams) * k) })) };
  });
  const resolved = await resolveDishes(ctx, counted, pool, cuisine, created);
  await embedFoods(ctx, created);
  const unknown = [...gateUnknown, ...resolved.unknown];
  const checked = await sanityCheck(ctx, resolved.items);
  if (!checked.items.length) return noMatchDraft(base, unknown.length ? unknown : [input]);
  const confidence = Math.max(0, Math.min(1, n(ai.confidence)));
  const draft: Draft = {
    ...base,
    cuisine,
    confidence: Math.round(confidence * 100) / 100,
    question: confidence < 0.6 ? ai.question : null,
    items: checked.items,
    notes: unknown.length ? [...checked.notes, NO_MATCH_MESSAGE(unknown)] : checked.notes,
    quick_question: checked.quick,
    status: "ok",
    unknown,
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
  if (out.fibre_g > out.carbs_g) out.fibre_g = out.carbs_g;
  // Atwater: kcal within 10% of 4P + 4C + 9F (+ 7 x alcohol where known).
  const expected = 4 * out.protein_g + 4 * out.carbs_g + 9 * out.fat_g + 7 * n((per100 as Per100 & { alcohol_g?: number }).alcohol_g);
  if (recomputeKcal && expected > 5 && Math.abs(out.kcal - expected) / expected > 0.1) out.kcal = Math.min(round1(expected), CAP.kcal);
  return out;
}

type PortionRange = { unit: string; name_pattern: string | null; min_g: number; max_g: number; typical_g: number | null; note: string | null };
type Yield = { category: string; method: string; ratio: number };
type DishMethod = { name_pattern: string; method: string; category: string | null };
type Pref = { food_id: string; grams_per_unit: number | null; oil_level: OilLevel | null; corrections: number };
export type Ref = { ranges: PortionRange[]; yields: Yield[]; fat: Record<string, number>; methods: DishMethod[]; prefs: Map<string, Pref> };

let refCache: { at: number; ref: Omit<Ref, "prefs"> } | null = null;

async function loadRef(ctx: Ctx): Promise<Ref> {
  if (!refCache || Date.now() - refCache.at > 10 * 60_000) {
    const [ranges, yields, fat, methods] = await Promise.all([
      ctx.admin.from("portion_ranges").select("unit, name_pattern, min_g, max_g, typical_g, note"),
      ctx.admin.from("yield_factors").select("category, method, ratio"),
      ctx.admin.from("fat_absorption").select("method, pct"),
      ctx.admin.from("dish_methods").select("name_pattern, method, category"),
    ]);
    refCache = {
      at: Date.now(),
      ref: {
        ranges: ((ranges.data ?? []) as PortionRange[]).map((r) => ({ ...r, min_g: n(r.min_g), max_g: n(r.max_g), typical_g: r.typical_g === null ? null : n(r.typical_g) })),
        yields: ((yields.data ?? []) as Yield[]).map((y) => ({ ...y, ratio: n(y.ratio) })),
        fat: Object.fromEntries(((fat.data ?? []) as Array<{ method: string; pct: number }>).map((f) => [f.method, n(f.pct)])),
        methods: (methods.data ?? []) as DishMethod[],
      },
    };
  }
  const prefs = new Map<string, Pref>();
  if (ctx.userId) {
    const { data } = await ctx.user.from("user_dish_prefs").select("food_id, grams_per_unit, oil_level, corrections").eq("user_id", ctx.userId).gte("corrections", 2);
    for (const p of (data ?? []) as Pref[]) prefs.set(p.food_id, { ...p, grams_per_unit: p.grams_per_unit === null ? null : n(p.grams_per_unit) });
  }
  return { ...refCache.ref, prefs };
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

const CATEGORY_WORDS: Array<[string, RegExp]> = [
  ["rice", /\b(rice|basmati|poha)\b/i],
  ["millet", /\b(ragi|jowar|bajra|quinoa|millet)\b/i],
  ["pulse", /\b(dal|lentil|gram|rajma|chana|chickpea|moong|toor|tur|urad|masoor|kidney bean)\b/i],
  ["pasta", /\b(pasta|spaghetti|noodle|macaroni)\b/i],
  ["oats", /\b(oats|oatmeal|porridge)\b/i],
  ["meat", /\b(chicken|mutton|lamb|beef|pork|fish|prawn)\b/i],
];
const COOK_METHOD: Record<string, string> = { rice: "boiled", millet: "boiled", pulse: "cooked", pasta: "boiled", oats: "cooked", meat: "grilled" };
const RAW_WORDS = /\b(raw|dry|dried|uncooked|unprocessed)\b/i;
const FAT_WORDS = /\b(oil|ghee|butter|vanaspati|dalda)\b/i;
const OIL_PER100: Per100 = { kcal: 884, protein_g: 0, carbs_g: 0, fat_g: 100, fibre_g: 0 };
const COUNT_UNITS: Unit[] = ["roti", "piece"];

export function methodFor(ref: Pick<Ref, "methods">, name: string): DishMethod | null {
  return ref.methods.find((m) => safeTest(m.name_pattern, name)) ?? null;
}

function levelOf(confidence: number): "high" | "medium" | "low" {
  return confidence >= 0.75 ? "high" : confidence >= 0.5 ? "medium" : "low";
}

function plural(name: string): string {
  const base = name.toLowerCase().replace(/\s*\(.*\)$/, "");
  return /s$/.test(base) ? base : `${base}s`;
}

// Deterministic macro engine. Every draft passes through here before it is returned.
export function applySanity(items: DraftItem[], ref: Ref | PortionRange[]): { items: DraftItem[]; notes: string[]; quick: QuickQuestion | null } {
  const r: Ref = Array.isArray(ref) ? { ranges: ref, yields: [], fat: {}, methods: [], prefs: new Map() } : ref;
  const notes: string[] = [];
  const kept: DraftItem[] = [];
  for (const original of items) {
    // 1. Validation: caps, fibre <= carbs, Atwater within 10% for AI values.
    const checkedPer100 = checkPer100(original.per100, original.source === "ai");
    const recomputed = Math.abs(checkedPer100.kcal - n(original.per100.kcal)) > 0.5;
    const item: DraftItem = {
      ...original,
      per100: checkedPer100,
      ingredients: original.ingredients.map((ing) => ({ ...ing, per100: checkPer100(ing.per100, ing.source === "ai") })),
    };
    const quantity = item.quantity > 0 ? item.quantity : 1;

    // 2. Raw database values for a food eaten cooked: per-100 g cooked = raw / yield ratio.
    if (!item.ingredients.length && RAW_WORDS.test(item.name) && item.source !== "ai") {
      const category = CATEGORY_WORDS.find(([, re]) => re.test(item.name))?.[0];
      const y = category ? r.yields.find((x) => x.category === category && x.method === COOK_METHOD[category]) : undefined;
      if (y && y.ratio > 0) {
        const k = 1 / y.ratio;
        item.per100 = { kcal: round1(item.per100.kcal * k), protein_g: round1(item.per100.protein_g * k), carbs_g: round1(item.per100.carbs_g * k), fat_g: round1(item.per100.fat_g * k), fibre_g: round1(item.per100.fibre_g * k) };
        item.cooking_method = y.method;
        notes.push(`${item.name}: raw values converted to ${y.method} (${y.ratio}× weight when cooked).`);
      }
    }

    // 3. Learned portion for this user's version of the dish.
    const pref = item.food_id ? r.prefs.get(item.food_id) : undefined;
    if (pref?.grams_per_unit && item.unit !== "g") {
      const factor = (pref.grams_per_unit * quantity) / Math.max(item.grams, 1);
      item.grams = round1(pref.grams_per_unit * quantity);
      item.ingredients = item.ingredients.map((ing) => ({ ...ing, grams: round1(ing.grams * factor) }));
    }

    // 4. Portion: clamp to the plausible range and expose min / typical / max for the slider.
    const range = rangeFor(r.ranges, item.name, item.unit);
    let portionCertainty = item.unit === "g" ? 1 : range ? 0.85 : 0.7;
    if (pref?.grams_per_unit) portionCertainty = 0.95;
    if (range && item.grams > 0) {
      const each = item.grams / quantity;
      const clamped = Math.min(Math.max(each, range.min_g), range.max_g);
      if (Math.abs(clamped - each) > 0.5) {
        const factor = clamped / each;
        item.grams = round1(clamped * quantity);
        item.ingredients = item.ingredients.map((ing) => ({ ...ing, grams: round1(ing.grams * factor) }));
        portionCertainty = 0.5;
        notes.push(`${item.name}: ${Math.round(each)} g per ${item.unit} looked off, set to ${Math.round(clamped)} g (typical ${range.min_g}–${range.max_g} g).`);
      }
      item.portion = { min: round1(range.min_g * quantity), typical: round1((range.typical_g ?? (range.min_g + range.max_g) / 2) * quantity), max: round1(range.max_g * quantity) };
    } else if (item.unit !== "g" && item.grams > 0) {
      item.portion = { min: round1(item.grams * 0.5), typical: item.grams, max: round1(item.grams * 1.8) };
    }

    // 5. Confidence = match + portion certainty + validation.
    const match = item.match_score ?? item.confidence;
    item.confidence = Math.round((0.5 * Math.min(1, match) + 0.3 * portionCertainty + 0.2 * (recomputed ? 0.6 : 1)) * 100) / 100;
    item.confidence_level = levelOf(item.confidence);
    if (Math.min(1, match) < MIN_ITEM_CONFIDENCE) {
      notes.push(`Left out ${item.name}: not sure it was there. Add it back if it was.`);
      continue;
    }

    // 6. Cooking fat as its own adjustable line: moved out of the recipe, or added from the method's absorption.
    const method = methodFor(r, item.name);
    item.cooking_method = item.cooking_method ?? method?.method ?? null;
    let oil = 0;
    let oilName = "Oil";
    let oilFood: string | null = null;
    const fats = item.ingredients.filter((ing) => FAT_WORDS.test(ing.name));
    if (fats.length) {
      // Cap recipe fat at 10% of the dish (min 5 g): AI recipes tend to overdo it. The user can still pick "heavy".
      oil = Math.min(fats.reduce((sum, ing) => sum + ing.grams, 0), Math.max(5, item.grams * 0.1));
      oilName = /ghee/i.test(fats[0].name) ? "Ghee" : /butter/i.test(fats[0].name) ? "Butter" : "Oil";
      oilFood = fats[0].food_id;
      item.ingredients = item.ingredients.filter((ing) => !FAT_WORDS.test(ing.name));
      item.grams = round1(Math.max(1, item.grams - oil));
    } else if (method && (r.fat[method.method] ?? 0) > 0 && item.source === "ai" && !item.own && item.ingredients.length > 0) {
      oil = ((r.fat[method.method] ?? 0) / 100) * item.grams;
    }
    kept.push(item);
    if (oil >= 1) {
      const level: OilLevel = pref?.oil_level ?? "normal";
      const base = round1(oil);
      kept.push({
        key: `${item.key}-oil`,
        food_id: oilFood,
        name: `${oilName} for ${item.name}`,
        is_dish: false,
        cuisine: item.cuisine,
        quantity: round1(base * OIL_FACTOR[level]),
        unit: "g",
        grams: round1(base * OIL_FACTOR[level]),
        per100: OIL_PER100,
        source: "ai",
        own: false,
        confidence: item.confidence,
        confidence_level: item.confidence_level,
        match_score: null,
        ingredients: [],
        servings: [],
        oil_for: item.key,
        oil_level: level,
        oil_base_grams: base,
      });
    }
  }
  const unsure = kept
    .filter((k) => !k.oil_for && COUNT_UNITS.includes(k.unit) && k.confidence < 0.75)
    .sort((a, b) => a.confidence - b.confidence)[0];
  const quick = unsure ? { item_key: unsure.key, text: `How many ${plural(unsure.name)}?`, options: [1, 2, 3, 4] } : null;
  return { items: kept, notes, quick };
}

async function sanityCheck(ctx: Ctx, items: DraftItem[]): Promise<{ items: DraftItem[]; notes: string[]; quick: QuickQuestion | null }> {
  return applySanity(items, await loadRef(ctx));
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
  let photoUnknown: string[] = [];
  const photoPool = mergeCandidates([candidates]).concat((await baseCandidates(ctx)).filter((b) => !candidates.some((c) => c.food_id === b.food_id))).slice(0, 45);
  let question: string | null = null;
  let textConfidence = 1;
  let raw: unknown = { detection, secondLook };
  const created: string[] = [];
  if (strong.every(Boolean)) {
    const recipes = await loadDishIngredients(ctx, strong.filter((c) => c!.is_dish).map((c) => c!.food_id));
    items = detection.items.map((d, i) => ({ ...itemFromCandidate(strong[i]!, d.quantity, d.unit, d.grams, recipes.get(strong[i]!.food_id), `p${i}`), confidence: Math.min(d.confidence, strong[i]!.score) }));
  } else {
    const ai = await generateJSON<{ cuisine: string; confidence: number; question: string | null; dishes: AiDish[] }>(
      `You are FitOS's food matcher. A vision model saw these items in a ${cuisine ?? "home"} meal photo:
${detection.items.map((d, i) => `${i + 1}. ${d.name} (${d.cuisine}), ${d.quantity} ${d.unit}, about ${d.grams} g; portion cues: ${d.portion_cues || "-"}; cooking fat: ${d.cooking_fat}${d.fat_cues ? ` (${d.fat_cues})` : ""}; seen with confidence ${d.confidence}`).join("\n")}

Candidate foods from our database (id | name | cuisine | dish or ingredient | source | per 100 g). Use these ids only; never invent an id.
${candidateLines(photoPool)}

Return one dish per item above, in the same order and with the same quantity and unit.
1. If a candidate is the same food, set matched_food_id and leave ingredients empty.
2. Otherwise, if it can be made from candidate ingredients, set matched_food_id null and list ingredient ids with grams for the amount seen, including the visible cooking fat. If it can't be built from the candidates, leave ingredients empty.
3. Correct grams if the cues clearly disagree with the estimate. Never output nutrient numbers.
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
    const dishes = (ai.dishes ?? []).map((dish, i) => ({ ...dish, confidence: Math.min(n(dish.confidence) || 0.5, detection.items[i]?.confidence ?? 0.5) }));
    const resolved = await resolveDishes(ctx, dishes, photoPool, cuisine, created);
    photoUnknown = resolved.unknown;
    items = resolved.items.map((item, i) => ({ ...item, key: `p${i}` }));
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
    quick_question: checked.quick,
    status: checked.items.length ? "ok" : "no_match",
    unknown: photoUnknown,
    message: checked.items.length ? null : NO_MATCH_MESSAGE(photoUnknown.length ? photoUnknown : ["this dish"]),
    notes: [...(secondLook ? ["Unsure photo: looked twice and kept what both looks agreed on."] : []), ...checked.notes, ...(photoUnknown.length && checked.items.length ? [NO_MATCH_MESSAGE(photoUnknown)] : [])],
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
  // Micronutrients come from the same deterministic calculation (compute_item), per food or per ingredient.
  const microsFor = async (item: DraftItem): Promise<Record<string, number>> => {
    const parts = item.ingredients.length ? item.ingredients.map((i) => ({ id: i.food_id, g: i.grams })) : [{ id: item.food_id, g: item.grams }];
    const total: Record<string, number> = {};
    for (const part of parts) {
      if (!part.id || !(part.g > 0)) continue;
      const { data } = await ctx.user.rpc("compute_item", { p_food_id: part.id, p_grams: part.g, p_method: null });
      for (const [k, v] of Object.entries(((data ?? {}) as { micros?: Record<string, number> }).micros ?? {})) total[k] = (total[k] ?? 0) + n(v);
    }
    return total;
  };
  const micros = await Promise.all(items.map(microsFor));
  const rows = items.map((item, index) => {
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
      micros: micros[index],
      oil_level: item.oil_level ?? null,
      cooking_method: item.cooking_method ?? null,
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

    // Per-user dish profile: corrected portion and oil level; after 2 corrections they become the default.
    for (const item of items.filter((i) => i.food_id && !i.oil_for && i.unit !== "g" && changed(original.find((o) => o.key === i.key), i) || (i.oil_for && changed(original.find((o) => o.key === i.key), i)))) {
      const dish = item.oil_for ? items.find((d) => d.key === item.oil_for) : item;
      if (!dish?.food_id) continue;
      const oilLine = items.find((o) => o.oil_for === dish.key);
      const { data: prev } = await ctx.user.from("user_dish_prefs").select("corrections").eq("user_id", ctx.userId).eq("food_id", dish.food_id).maybeSingle();
      await ctx.user.from("user_dish_prefs").upsert({
        user_id: ctx.userId,
        food_id: dish.food_id,
        grams_per_unit: dish.unit !== "g" ? round1(dish.grams / Math.max(dish.quantity, 0.25)) : null,
        oil_level: oilLine?.oil_level ?? null,
        corrections: n(prev?.corrections) + 1,
        updated_at: new Date().toISOString(),
      });
    }
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
