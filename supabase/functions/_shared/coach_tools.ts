// Grounded food tools for the coach. Every number comes from compute_item (database rows x grams).
import { type Ctx, previewMatch, searchFoods } from "./pipeline.ts";

const r1 = (x: number) => Math.round(x * 10) / 10;
const num = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const ESTIMATE_TIERS = new Set(["community", "ai_estimate"]);
export const isEstimate = (tier: string | null | undefined) => ESTIMATE_TIERS.has(String(tier ?? ""));
export const label = (name: string, tier: string | null | undefined) => (isEstimate(tier) ? `${name} (estimate)` : name);
const UNIT_ORDER = ["piece", "roti", "katori", "plate", "glass", "cup", "ladle", "tbsp", "tsp", "scoop", "serving"];

export type Nutrients = { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number; sugar_g?: number | null; sat_fat_g?: number | null; micros?: Record<string, number> };

// compute_item, rounded only for display.
export async function compute(ctx: Ctx, foodId: string, grams: number, method: string | null = null): Promise<Nutrients> {
  const { data, error } = await ctx.user.rpc("compute_item", { p_food_id: foodId, p_grams: grams, p_method: method });
  if (error) throw new Error(`compute_item: ${error.message}`);
  const d = (data ?? {}) as Record<string, unknown>;
  const micros = Object.fromEntries(Object.entries((d.micros ?? {}) as Record<string, number>).map(([k, v]) => [k, r1(num(v))]));
  return {
    kcal: Math.round(num(d.kcal)),
    protein_g: r1(num(d.protein_g)),
    carbs_g: r1(num(d.carbs_g)),
    fat_g: r1(num(d.fat_g)),
    fibre_g: r1(num(d.fibre_g)),
    sugar_g: d.sugar_g == null ? null : r1(num(d.sugar_g)),
    sat_fat_g: d.sat_fat_g == null ? null : r1(num(d.sat_fat_g)),
    micros,
  };
}

type Serving = { unit: string; grams: number; label: string | null };

async function servingsOf(ctx: Ctx, foodId: string): Promise<Serving[]> {
  const { data } = await ctx.user.from("food_servings").select("unit, grams, label").eq("food_id", foodId);
  return ((data ?? []) as Serving[]).map((s) => ({ ...s, grams: num(s.grams) })).filter((s) => s.grams > 0);
}

// The user's usual portion of a food: their own average logged grams, expressed in the food's serving unit.
export async function usualPortion(ctx: Ctx, foodId: string): Promise<{ qty: number; unit: string; grams: number; text: string }> {
  const [servings, logged] = await Promise.all([
    servingsOf(ctx, foodId),
    ctx.user.from("meal_items").select("amount_grams, meals!inner(user_id)").eq("meals.user_id", ctx.userId!).eq("food_id", foodId).gt("amount_grams", 0).limit(30),
  ]);
  const rows = (logged.data ?? []) as Array<{ amount_grams: number }>;
  const avg = rows.length ? rows.reduce((s, r) => s + num(r.amount_grams), 0) / rows.length : 0;
  const unit = servings.filter((s) => s.unit !== "g").sort((a, b) => UNIT_ORDER.indexOf(a.unit) - UNIT_ORDER.indexOf(b.unit))[0];
  if (!unit) {
    const grams = Math.round(avg || 100);
    return { qty: grams, unit: "g", grams, text: `${grams} g` };
  }
  const qty = avg ? Math.max(0.5, Math.round((avg / unit.grams) * 2) / 2) : 1;
  const grams = r1(qty * unit.grams);
  return { qty, unit: unit.unit, grams, text: `${qty} ${unit.unit}${qty === 1 ? "" : "s"} (${Math.round(grams)} g)` };
}

export function portionText(qty: number, unit: string, grams: number): string {
  return unit === "g" ? `${Math.round(grams)} g` : `${qty} ${unit}${qty === 1 ? "" : "s"} (${Math.round(grams)} g)`;
}

type FoodRow = { id: string; name: string; tier: string | null; source: string | null; source_ref: string | null; category: string | null; cuisine: string | null; is_dish: boolean; aliases: string[] | null; notes: string | null; energy_check: string | null };

async function foodRow(ctx: Ctx, foodId: string): Promise<FoodRow | null> {
  const { data } = await ctx.user.from("foods").select("id, name, tier, source, source_ref, category, cuisine, is_dish, aliases, notes, energy_check").eq("id", foodId).maybeSingle();
  return (data as FoodRow) ?? null;
}

// ---------- lookup_food / explain_food ----------

// "IFCT 2017 (NIN Hyderabad) A014"; recipe dishes keep their cooked weight in source_ref, which isn't a reference.
const sourceLabel = (source: string | null | undefined, ref: string | null | undefined) =>
  ref && !ref.startsWith("cooked_total_g") ? (source ? `${source} ${ref}` : ref) : (source ?? "");

export async function lookupFood(ctx: Ctx, query: string) {
  const gate = await previewMatch(ctx, query);
  if (gate.status === "NO_MATCH") return { status: "unknown", message: `I don't know "${query}" yet. Offer to add it manually or by describing its ingredients. Do not guess numbers.` };
  if (gate.status === "CLARIFY") return { status: "clarify", question: `Which food did you mean by "${query}"?`, options: gate.options };
  // Hits come best first (tier breaks ties), so keep the first row per name: one "Idli", the food DB's.
  const seen = new Set<string>();
  const hits = (await searchFoods(ctx, query, null, 8))
    .filter((h) => h.kcal !== null && !seen.has(h.name.trim().toLowerCase()) && seen.add(h.name.trim().toLowerCase()))
    .slice(0, 3);
  const foods = [];
  for (const h of hits) {
    const portion = await usualPortion(ctx, h.food_id);
    foods.push({ food_id: h.food_id, name: label(h.name, h.tier), tier: h.tier ?? null, source: sourceLabel(h.source, h.source_ref), portion: portion.text, per_portion: await compute(ctx, h.food_id, portion.grams) });
  }
  return { status: "ok", foods };
}

export async function explainFood(ctx: Ctx, query: string) {
  const found = await lookupFood(ctx, query);
  if (found.status !== "ok" || !found.foods?.length) return found;
  const top = found.foods[0];
  const row = await foodRow(ctx, top.food_id);
  return {
    status: "ok",
    food_id: top.food_id,
    name: top.name,
    also_called: (row?.aliases ?? []).slice(0, 6),
    category: row?.category ?? null,
    cuisine: row?.cuisine ?? null,
    about: row?.notes ?? null,
    typical_portion: top.portion,
    per_portion: top.per_portion,
    source: top.source,
    tier: top.tier,
    check_values: row?.energy_check === "flag",
  };
}

// ---------- food_breakdown ----------

type Ingredient = { food_id: string; name: string; grams: number };

async function dishIngredients(ctx: Ctx, foodId: string): Promise<Ingredient[]> {
  const { data } = await ctx.user
    .from("dish_ingredients")
    .select("grams_per_serving, position, ingredient:foods!dish_ingredients_ingredient_food_id_fkey(id, name)")
    .eq("dish_food_id", foodId)
    .order("position");
  return ((data ?? []) as unknown as Array<{ grams_per_serving: number; ingredient: { id: string; name: string } | null }>)
    .filter((r) => r.ingredient)
    .map((r) => ({ food_id: r.ingredient!.id, name: r.ingredient!.name, grams: num(r.grams_per_serving) }));
}

export async function foodBreakdown(ctx: Ctx, foodId: string, grams: number | null) {
  const row = await foodRow(ctx, foodId);
  if (!row) return { status: "unknown", message: "That food isn't in the database." };
  const portion = grams && grams > 0 ? { grams, text: `${Math.round(grams)} g` } : await usualPortion(ctx, foodId);
  const total = await compute(ctx, foodId, portion.grams);
  const ingredients = await dishIngredients(ctx, foodId);
  const recipeGrams = ingredients.reduce((s, i) => s + i.grams, 0);
  const k = recipeGrams > 0 ? portion.grams / recipeGrams : 0;
  const parts = [];
  for (const ing of ingredients) {
    const g = r1(ing.grams * k);
    parts.push({ name: ing.name, grams: g, kcal: (await compute(ctx, ing.food_id, g)).kcal });
  }
  return { status: "ok", food_id: foodId, name: label(row.name, row.tier), tier: row.tier, source: row.source_ref || row.source, portion: portion.text, nutrients: total, ingredients: parts, check_values: row.energy_check === "flag" };
}

// ---------- tweak_dish ----------

export type Change = { ingredient: string; action: "scale" | "remove" | "add" | "replace"; factor?: number; grams?: number; with?: string };

async function bestFood(ctx: Ctx, query: string): Promise<{ food_id: string; name: string } | null> {
  const hit = (await searchFoods(ctx, query, null, 3)).find((h) => h.kcal !== null && h.score >= 0.55);
  return hit ? { food_id: hit.food_id, name: hit.name } : null;
}

async function totals(ctx: Ctx, parts: Ingredient[]): Promise<Nutrients> {
  const list = await Promise.all(parts.filter((p) => p.grams > 0).map((p) => compute(ctx, p.food_id, p.grams)));
  const s = list.reduce((a, b) => ({ kcal: a.kcal + b.kcal, protein_g: a.protein_g + b.protein_g, carbs_g: a.carbs_g + b.carbs_g, fat_g: a.fat_g + b.fat_g, fibre_g: a.fibre_g + b.fibre_g }), { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 });
  return { kcal: Math.round(s.kcal), protein_g: r1(s.protein_g), carbs_g: r1(s.carbs_g), fat_g: r1(s.fat_g), fibre_g: r1(s.fibre_g) };
}

export async function tweakDish(ctx: Ctx, foodId: string, changes: Change[], grams: number | null) {
  const row = await foodRow(ctx, foodId);
  if (!row) return { status: "unknown", message: "That food isn't in the database." };
  const ingredients = await dishIngredients(ctx, foodId);
  if (!ingredients.length) return { status: "no_recipe", message: `${row.name} has no ingredient recipe in the database, so only the portion can change.` };
  const portion = grams && grams > 0 ? { grams, text: `${Math.round(grams)} g` } : await usualPortion(ctx, foodId);
  const k = portion.grams / Math.max(1, ingredients.reduce((s, i) => s + i.grams, 0));
  const before = ingredients.map((i) => ({ ...i, grams: r1(i.grams * k) }));
  const after = before.map((i) => ({ ...i }));
  const applied: string[] = [];
  const find = (name: string) => after.find((i) => i.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(i.name.toLowerCase().split(",")[0]));
  for (const c of changes ?? []) {
    const target = c.ingredient ? find(c.ingredient) : undefined;
    if (c.action === "scale" && target) {
      target.grams = r1(target.grams * num(c.factor ?? 1));
      applied.push(`${target.name} ×${c.factor}`);
    } else if (c.action === "remove" && target) {
      target.grams = 0;
      applied.push(`no ${target.name}`);
    } else if (c.action === "add") {
      const food = await bestFood(ctx, c.with || c.ingredient);
      if (food && num(c.grams) > 0) {
        after.push({ food_id: food.food_id, name: food.name, grams: num(c.grams) });
        applied.push(`+${num(c.grams)} g ${food.name}`);
      } else applied.push(`couldn't find "${c.with || c.ingredient}" in the database`);
    } else if (c.action === "replace" && target) {
      const food = await bestFood(ctx, c.with ?? "");
      if (food) {
        applied.push(`${food.name} instead of ${target.name}`);
        target.food_id = food.food_id;
        target.name = food.name;
      } else applied.push(`couldn't find "${c.with}" in the database`);
    } else if (!target) applied.push(`"${c.ingredient}" isn't in this recipe`);
  }
  const [b, a] = await Promise.all([totals(ctx, before), totals(ctx, after)]);
  return {
    status: "ok",
    food_id: foodId,
    name: label(row.name, row.tier),
    portion: portion.text,
    changes: applied,
    before: b,
    after: a,
    delta: { kcal: a.kcal - b.kcal, protein_g: r1(a.protein_g - b.protein_g), fat_g: r1(a.fat_g - b.fat_g), carbs_g: r1(a.carbs_g - b.carbs_g) },
  };
}

// ---------- suggest_swaps ----------

export type SwapGoal = "more_protein" | "less_fat" | "more_fibre" | "less_sodium" | "fewer_kcal";

export async function suggestSwaps(ctx: Ctx, foodId: string, goal: SwapGoal) {
  const row = await foodRow(ctx, foodId);
  if (!row) return { status: "unknown", message: "That food isn't in the database." };
  const portion = await usualPortion(ctx, foodId);
  const base = await compute(ctx, foodId, portion.grams);
  let query = ctx.user.from("foods").select("id, name, tier, category, cuisine, is_dish, food_nutrition(calories, protein_g, fat_g, fiber_g, sodium_mg)").is("owner_id", null).in("tier", ["lab_verified", "recipe_calculated"]).neq("id", foodId).limit(300);
  query = row.category ? query.eq("category", row.category) : row.cuisine ? query.eq("cuisine", row.cuisine) : query.eq("is_dish", row.is_dish);
  const { data } = await query;
  const metric = (n: Record<string, number>) =>
    goal === "more_protein" ? num(n.protein_g) / Math.max(num(n.calories), 1) : goal === "more_fibre" ? num(n.fiber_g) / Math.max(num(n.calories), 1) : goal === "less_fat" ? -num(n.fat_g) : goal === "less_sodium" ? -num(n.sodium_mg) : -num(n.calories);
  const baseN = { calories: base.kcal, protein_g: base.protein_g, fat_g: base.fat_g, fiber_g: base.fibre_g, sodium_mg: base.micros?.sodium_mg ?? 0 };
  const baseScore = metric(Object.fromEntries(Object.entries(baseN).map(([k, v]) => [k, (num(v) * 100) / Math.max(portion.grams, 1)])));
  const ranked = ((data ?? []) as Array<{ id: string; name: string; tier: string; food_nutrition: Array<Record<string, number>> | Record<string, number> }>)
    .map((f) => ({ f, n: (Array.isArray(f.food_nutrition) ? f.food_nutrition[0] : f.food_nutrition) as Record<string, number> }))
    .filter((x) => x.n && num(x.n.calories) > 0 && (goal !== "less_sodium" || x.n.sodium_mg != null))
    .map((x) => ({ ...x, score: metric(x.n) }))
    .filter((x) => x.score > baseScore + Math.abs(baseScore) * 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  const swaps = [];
  for (const x of ranked) {
    if (swaps.length >= 3) break;
    const p = await usualPortion(ctx, x.f.id);
    const grams = p.unit === "g" ? portion.grams : p.grams;
    const v = await compute(ctx, x.f.id, grams);
    if ((goal === "more_protein" || goal === "more_fibre") && v.kcal > base.kcal * 1.2) continue;
    swaps.push({
      food_id: x.f.id,
      name: label(x.f.name, x.f.tier),
      portion: p.unit === "g" ? `${Math.round(grams)} g` : p.text,
      nutrients: v,
      delta: { kcal: v.kcal - base.kcal, protein_g: r1(v.protein_g - base.protein_g), fat_g: r1(v.fat_g - base.fat_g), fibre_g: r1(v.fibre_g - base.fibre_g), sodium_mg: v.micros?.sodium_mg != null && base.micros?.sodium_mg != null ? Math.round(v.micros.sodium_mg - base.micros.sodium_mg) : null },
    });
  }
  return { status: swaps.length ? "ok" : "none", food: { food_id: foodId, name: label(row.name, row.tier), portion: portion.text, nutrients: base }, goal, swaps };
}

// ---------- nutrient_gaps ----------

export async function nutrientGaps(ctx: Ctx, days: number, proteinTarget: number, sex: string | null) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { data } = await ctx.user.from("meal_items").select("name, protein_g, fibre_g, micros, meals!inner(user_id, log_date)").eq("meals.user_id", ctx.userId!).gte("meals.log_date", since).limit(2000);
  const rows = ((data ?? []) as unknown as Array<{ name: string; protein_g: number; fibre_g: number; micros: Record<string, number>; meals: { log_date: string } | Array<{ log_date: string }> }>).map((r) => ({ ...r, meals: Array.isArray(r.meals) ? r.meals[0] : r.meals }));
  const dayCount = new Set(rows.map((r) => r.meals.log_date)).size;
  if (!dayCount) return { status: "no_data", message: "No logged days in that range." };
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0) / dayCount;
  const has = (k: string) => rows.some((r) => r.micros?.[k] != null);
  const avg: Record<string, number | null> = {
    protein_g: r1(sum((r) => num(r.protein_g))),
    fibre_g: r1(sum((r) => num(r.fibre_g))),
    sodium_mg: has("sodium_mg") ? Math.round(sum((r) => num(r.micros?.sodium_mg))) : null,
    sugar_g: has("sugar_g") ? r1(sum((r) => num(r.micros?.sugar_g))) : null,
    iron_mg: has("iron_mg") ? r1(sum((r) => num(r.micros?.iron_mg))) : null,
    calcium_mg: has("calcium_mg") ? Math.round(sum((r) => num(r.micros?.calcium_mg))) : null,
  };
  const refs = [
    { key: "protein_g", min: proteinTarget, column: "protein_g" },
    { key: "fibre_g", min: 28, column: "fiber_g" },
    { key: "iron_mg", min: sex === "male" ? 8 : 18, column: "iron_mg" },
    { key: "calcium_mg", min: 1000, column: "calcium_mg" },
    { key: "sodium_mg", max: 2000 },
    { key: "sugar_g", max: 50 },
  ] as Array<{ key: string; min?: number; max?: number; column?: string }>;
  const gaps = refs
    .filter((g) => avg[g.key] != null)
    .map((g) => ({ ...g, value: avg[g.key] as number, severity: g.min ? (g.min - (avg[g.key] as number)) / g.min : ((avg[g.key] as number) - g.max!) / g.max! }))
    .filter((g) => g.severity > 0.05)
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 2);
  const out = [];
  for (const g of gaps) {
    if (g.min && g.column) {
      // Foods that close it: highest per 100 kcal among verified and recipe foods.
      const { data: foods } = await ctx.user.from("foods").select(`id, name, tier, food_nutrition!inner(calories, ${g.column})`).is("owner_id", null).in("tier", ["lab_verified", "recipe_calculated"]).gt(`food_nutrition.${g.column}`, 0).order(g.column, { referencedTable: "food_nutrition", ascending: false }).limit(40);
      const best = ((foods ?? []) as unknown as Array<{ id: string; name: string; tier: string; food_nutrition: Array<Record<string, number>> | Record<string, number> }>)
        .map((f) => ({ f, n: (Array.isArray(f.food_nutrition) ? f.food_nutrition[0] : f.food_nutrition) as Record<string, number> }))
        .filter((x) => num(x.n.calories) > 20)
        .sort((a, b) => num(b.n[g.column!]) / num(b.n.calories) - num(a.n[g.column!]) / num(a.n.calories))
        .slice(0, 3);
      const fixes = [];
      for (const x of best) {
        const p = await usualPortion(ctx, x.f.id);
        const v = await compute(ctx, x.f.id, p.grams);
        fixes.push({ food_id: x.f.id, name: label(x.f.name, x.f.tier), portion: p.text, adds: g.key === "protein_g" ? v.protein_g : g.key === "fibre_g" ? v.fibre_g : v.micros?.[g.key] ?? null, kcal: v.kcal });
      }
      out.push({ nutrient: g.key, average: g.value, target: g.min, fixes });
    } else {
      const key = g.key;
      const top = Object.entries(rows.reduce((acc, r) => ({ ...acc, [r.name]: (acc[r.name] ?? 0) + num(r.micros?.[key]) }), {} as Record<string, number>))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, total]) => ({ name, per_day: Math.round(total / dayCount) }));
      out.push({ nutrient: key, average: g.value, limit: g.max, biggest_sources: top });
    }
  }
  return { status: "ok", days, logged_days: dayCount, averages: avg, gaps: out };
}
