// Imports fitos_food_db/ into the existing tables: foods, food_nutrition, food_servings, dish_ingredients.
// Upserts in batches of 500 on id. Text ids that aren't UUIDs map to a stable UUIDv5 and are kept in foods.external_id.
// Recipe dishes: dish_ingredients.csv has raw grams for the whole recipe; they're stored per serving of cooked dish
// (raw x serving_grams / cooked_total_g, cooked_total_g from source_ref), which is what the review draft scales.
// Then supersedes legacy rows the food DB replaces, writes apps/web/lib/dataSources.json from the README's
// attribution section and runs embed-worker until no food is missing an embedding.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Run: npx deno run -A --env-file=.env.local scripts/import_food_db.ts [--embed-only]
import { createClient } from "npm:@supabase/supabase-js@2";

const ROOT = new URL("../fitos_food_db/", import.meta.url);
const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!URL_ || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  Deno.exit(1);
}
const db = createClient(URL_, KEY, { auth: { persistSession: false } });
const BATCH = 500;
const EMBED_ONLY = Deno.args.includes("--embed-only");

// embed-worker embeds ~10 foods per call before hitting its compute limit, so missing ids are sent in chunks of
// EMBED_LIMIT across EMBED_PARALLEL concurrent calls. Repeats until nothing is missing or a pass makes no progress.
const EMBED_LIMIT = Number(Deno.env.get("EMBED_LIMIT") ?? 10);
const EMBED_PARALLEL = Number(Deno.env.get("EMBED_PARALLEL") ?? 6);
async function missingEmbeddings(): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("foods").select("id").is("embedding", null).order("id").range(from, from + 999);
    if (error) throw new Error(`foods without embedding: ${error.message}`);
    ids.push(...(data ?? []).map((r: { id: string }) => r.id));
    if ((data ?? []).length < 1000) return ids;
  }
}
async function embedChunk(ids: string[]): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = await fetch(`${URL_}/functions/v1/embed-worker`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ limit: ids.length, ids }) });
    const out = await r.json().catch(() => ({}));
    if (r.ok) return Number(out.foods ?? 0);
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
  }
  return 0;
}
async function embedAll() {
  for (let pass = 1; ; pass += 1) {
    const missing = await missingEmbeddings();
    console.log(`embeddings: ${missing.length} foods missing (pass ${pass})`);
    if (!missing.length) return;
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += EMBED_LIMIT) chunks.push(missing.slice(i, i + EMBED_LIMIT));
    let done = 0;
    let next = 0;
    await Promise.all(Array.from({ length: EMBED_PARALLEL }, async () => {
      while (next < chunks.length) {
        done += await embedChunk(chunks[next++]);
        if (next % 50 === 0) console.log(`embeddings: ${done}/${missing.length}`);
      }
    }));
    if (!done) throw new Error(`embed-worker made no progress; ${missing.length} foods still without an embedding`);
  }
}
if (EMBED_ONLY) {
  await embedAll();
  console.log("Done.");
  Deno.exit(0);
}

// ---------- CSV ----------
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}
async function readCsv(name: string) {
  try {
    return parseCsv(await Deno.readTextFile(new URL(name, ROOT)));
  } catch {
    console.warn(`${name} not found, skipped.`);
    return [];
  }
}
const pick = (row: Record<string, string>, ...keys: string[]) => { for (const k of keys) if (row[k] !== undefined && row[k] !== "") return row[k]; return ""; };
const num = (v: string) => (v === "" || isNaN(Number(v)) ? null : Number(v));
const bool = (v: string) => /^(1|true|yes|y|t)$/i.test(v);

// ---------- ids ----------
import { UUID, uuidFor } from "./import_food_db_ids.ts";


// foods.cuisine allows indian / south_indian / north_indian / australian / western / other (the pipeline's cuisine filter).
// "global" foods get no cuisine, so no cuisine filter hides them.
const CUISINES: Record<string, string | null> = {
  indian: "indian", south_indian: "south_indian", north_indian: "north_indian", west_indian: "indian", indo_chinese: "indian",
  australian: "australian", western: "western", european: "western", italian: "western", greek: "western", global: null,
};
const cuisineOf = (v: string) => (v ? (v.toLowerCase() in CUISINES ? CUISINES[v.toLowerCase()] : "other") : null);

const TIERS = ["user", "recipe_calculated", "lab_verified", "community", "ai_estimate"];
const UNITS: Record<string, string> = { roti: "roti", phulka: "roti", chapati: "roti", katori: "katori", bowl: "katori", ladle: "ladle", plate: "plate", piece: "piece", pc: "piece", slice: "piece", cup: "cup", glass: "glass", tbsp: "tbsp", tablespoon: "tbsp", tsp: "tsp", teaspoon: "tsp", scoop: "scoop", g: "g", gram: "g", serving: "serving" };

async function upsert(table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + BATCH), { onConflict });
    if (error) throw new Error(`${table} batch ${i / BATCH + 1}: ${error.message}`);
    console.log(`${table}: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
}

// ---------- foods + food_nutrition ----------
const foods = await readCsv("foods.csv");
if (!foods.length) {
  console.error("fitos_food_db/foods.csv is missing or empty.");
  Deno.exit(1);
}
const idMap = new Map<string, string>();
for (const row of foods) idMap.set(pick(row, "id", "food_id"), await uuidFor(pick(row, "id", "food_id")));

const foodRows = foods.map((row) => {
  const ext = pick(row, "id", "food_id");
  const tier = pick(row, "tier").toLowerCase();
  const aliasText = pick(row, "aliases", "alias", "local_names");
  return {
    id: idMap.get(ext),
    external_id: UUID.test(ext) ? null : ext,
    name: pick(row, "name", "food_name"),
    owner_id: null,
    source: pick(row, "source") || "community",
    source_ref: pick(row, "source_ref", "reference") || null,
    tier: TIERS.includes(tier) ? tier : "community",
    verified: pick(row, "verified") ? bool(pick(row, "verified")) : tier === "lab_verified" || tier === "recipe_calculated",
    energy_check: ["ok", "flag"].includes(pick(row, "energy_check").toLowerCase()) ? pick(row, "energy_check").toLowerCase() : null,
    notes: pick(row, "notes") || null,
    embed_text: pick(row, "embed_text") || null,
    is_dish: pick(row, "food_type").toLowerCase() === "dish" || bool(pick(row, "is_dish", "dish")) || tier === "recipe_calculated",
    cuisine: cuisineOf(pick(row, "cuisine", "region")),
    category: pick(row, "category", "group", "food_group") || null,
    aliases: aliasText ? aliasText.split(/[;|]/).map((a) => a.trim()).filter(Boolean) : [],
    confidence: tier === "lab_verified" || tier === "recipe_calculated" ? 0.95 : 0.8,
    serving_grams: null as number | null,
  };
});
const nutritionRows = foods.map((row) => {
  const kj = num(pick(row, "energy_kj", "enerc_kj"));
  const kcal = num(pick(row, "kcal", "energy_kcal", "calories", "energy")) ?? (kj !== null ? kj / 4.184 : 0);
  return {
    food_id: idMap.get(pick(row, "id", "food_id")),
    calories: kcal,
    protein_g: num(pick(row, "protein_g", "protein")) ?? 0,
    carbs_g: num(pick(row, "carbs_g", "carbohydrate_g", "carbs", "carbohydrate")) ?? 0,
    fat_g: num(pick(row, "fat_g", "fat", "total_fat_g")) ?? 0,
    fiber_g: num(pick(row, "fibre_g", "fiber_g", "fibre", "fiber")) ?? 0,
    sugar_g: num(pick(row, "sugar_g", "sugars_g", "sugar")),
    sodium_mg: num(pick(row, "sodium_mg", "sodium")),
    sat_fat_g: num(pick(row, "sat_fat_g", "saturated_fat_g")),
    iron_mg: num(pick(row, "iron_mg", "iron")),
    calcium_mg: num(pick(row, "calcium_mg", "calcium")),
    vitamin_c_mg: num(pick(row, "vit_c_mg", "vitamin_c_mg", "vitc_mg", "vitamin_c")),
    b12_ug: num(pick(row, "b12_ug", "vitamin_b12_ug", "b12")),
    potassium_mg: num(pick(row, "potassium_mg", "potassium")),
    alcohol_g: num(pick(row, "alcohol_g")) ?? 0,
    source: pick(row, "source") || "fitos_food_db",
    confidence: 0.9,
  };
});
// ---------- servings (parsed first: a dish's serving_grams is its first serving) ----------
// Units in food_servings.csv look like "piece", "2pc", "1katori", "serving-1", "medium". They map to the app's units
// with grams for ONE unit; one row per food and unit (the smallest count wins). Units with no app equivalent
// (g, ml, oz, tsp, half, handful...) are skipped: grams are always available.
const UNIT_WORDS: Record<string, string> = {
  ...UNITS, glass: "cup", mug: "cup", pcs: "piece", slices: "piece", idli: "piece", dos: "piece", dosa: "piece", egg: "piece", medium: "piece", small: "piece",
  large: "piece", fillet: "piece", skewer: "piece", kebab: "piece", steak: "piece", patty: "piece", breast: "piece", thigh: "piece", chop: "piece", sub: "piece",
  block: "piece", paratha: "roti", portion: "serving", scoop: "serving", tsp: "", g: "",
};
const servings = await readCsv("food_servings.csv");
const servingByKey = new Map<string, { food_id: string; unit: string; grams: number; label: string; count: number }>();
for (const row of servings) {
  const food = idMap.get(pick(row, "food_id")) ?? (UUID.test(pick(row, "food_id")) ? pick(row, "food_id") : null);
  const m = pick(row, "unit").toLowerCase().match(/^(\d+(?:\.\d+)?)?\s*([a-z]+)(?:-\d+)?$/);
  const unit = m ? UNIT_WORDS[m[2]] : undefined;
  const count = m?.[1] ? Number(m[1]) : 1;
  const total = num(pick(row, "grams", "weight_g", "typical_g"));
  if (!food || !unit || !total || !count) continue;
  const key = `${food}:${unit}`;
  if ((servingByKey.get(key)?.count ?? Infinity) <= count) continue;
  servingByKey.set(key, { food_id: food, unit, grams: Math.round((total / count) * 10) / 10, label: count === 1 ? pick(row, "label", "description") || `1 ${unit}` : `1 ${unit} (${Math.round(total / count)} g)`, count });
}
const servingRows = [];
for (const s of servingByKey.values()) servingRows.push({ id: await uuidFor(`serving:${s.food_id}:${s.unit}`), food_id: s.food_id, unit: s.unit, grams: s.grams, label: s.label });
const firstServing = new Map<string, number>();
for (const s of servingRows) if (!firstServing.has(s.food_id)) firstServing.set(s.food_id, s.grams);
for (const f of foodRows) if (f.is_dish) f.serving_grams = firstServing.get(f.id as string) ?? 100;

await upsert("foods", foodRows, "id");

// One nutrition row per food: replace the food DB's rows.
const ids = nutritionRows.map((r) => r.food_id as string);
for (let i = 0; i < ids.length; i += BATCH) await db.from("food_nutrition").delete().in("food_id", ids.slice(i, i + BATCH));
for (let i = 0; i < nutritionRows.length; i += BATCH) {
  const { error } = await db.from("food_nutrition").insert(nutritionRows.slice(i, i + BATCH));
  if (error) throw new Error(`food_nutrition: ${error.message}`);
  console.log(`food_nutrition: ${Math.min(i + BATCH, nutritionRows.length)}/${nutritionRows.length}`);
}

// Replace the food DB's servings (older imports used different ids).
const servedFoods = [...new Set(servingRows.map((r) => r.food_id))];
for (let i = 0; i < servedFoods.length; i += BATCH) await db.from("food_servings").delete().in("food_id", servedFoods.slice(i, i + BATCH));
if (servingRows.length) await upsert("food_servings", servingRows, "id");

// ---------- dish ingredients ----------
// raw_grams are for the whole recipe; stored as raw grams per serving_grams of cooked dish. cooked_total_g comes from
// source_ref ("cooked_total_g=950"), else from energy balance (raw kcal / dish kcal per gram).
// Needs migration 016: recompute_dish must not overwrite these dishes' lab-derived values.
const ingredients = await readCsv("dish_ingredients.csv");
const kcalOf = new Map(foods.map((row) => [pick(row, "id", "food_id"), num(pick(row, "kcal", "energy_kcal", "calories")) ?? 0]));
const refOf = new Map(foods.map((row) => [pick(row, "id", "food_id"), pick(row, "source_ref")]));
const recipes = new Map<string, Array<{ ing: string; raw: number; notes: string | null }>>();
for (const row of ingredients) {
  const dish = pick(row, "dish_id", "dish_food_id");
  const raw = num(pick(row, "raw_grams", "grams", "grams_per_serving"));
  if (!idMap.has(dish) || !idMap.has(pick(row, "ingredient_id", "ingredient_food_id")) || !raw) continue;
  recipes.set(dish, [...(recipes.get(dish) ?? []), { ing: pick(row, "ingredient_id", "ingredient_food_id"), raw, notes: pick(row, "notes") || null }]);
}
const ingredientRows = [];
for (const [dish, lines] of recipes) {
  const dishId = idMap.get(dish)!;
  const fromRef = Number((refOf.get(dish) ?? "").match(/cooked_total_g=(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const rawKcal = lines.reduce((t, l) => t + (l.raw * (kcalOf.get(l.ing) ?? 0)) / 100, 0);
  const cooked = fromRef || ((kcalOf.get(dish) ?? 0) > 0 ? (rawKcal / kcalOf.get(dish)!) * 100 : 0);
  if (!cooked) { console.warn(`${dish}: no cooked weight, ingredients skipped`); continue; }
  const serving = foodRows.find((f) => f.id === dishId)?.serving_grams ?? 100;
  for (const [position, l] of lines.entries()) {
    ingredientRows.push({ id: await uuidFor(`ing:${dishId}:${l.ing}:${position}`), dish_food_id: dishId, ingredient_food_id: idMap.get(l.ing)!, grams_per_serving: Math.max(0.01, Math.round((l.raw * serving / cooked) * 100) / 100), notes: l.notes, position });
  }
}
const dishIds = [...recipes.keys()].map((d) => idMap.get(d)!);
for (let i = 0; i < dishIds.length; i += BATCH) await db.from("dish_ingredients").delete().in("dish_food_id", dishIds.slice(i, i + BATCH));
if (ingredientRows.length) await upsert("dish_ingredients", ingredientRows, "id");

// ---------- legacy rows the food DB replaces (013 staples, old IFCT import) ----------
const { data: superseded, error: supersedeError } = await db.rpc("supersede_legacy_foods");
if (supersedeError) throw new Error(`supersede_legacy_foods (apply migration 016 first): ${supersedeError.message}`);
console.log(`superseded legacy foods: ${superseded}`);

// ---------- attribution for the app's Data sources screen ----------
try {
  const readme = await Deno.readTextFile(new URL("README.md", ROOT));
  const section = readme.split(/\n(?=#+\s)/).find((s) => /^#+\s*(attribution|sources|data sources|licen[cs]e)/i.test(s));
  const lines = (section ?? "").split("\n").slice(1).filter((l) => /^\s*[-*]\s/.test(l)).map((l) => l.replace(/^\s*[-*]\s*/, "").trim());
  await Deno.writeTextFile(new URL("../apps/web/lib/dataSources.json", import.meta.url), JSON.stringify({ sources: lines }, null, 2) + "\n");
  console.log(`attribution: ${lines.length} lines written to apps/web/lib/dataSources.json`);
} catch {
  console.warn("README.md not found: attribution not updated.");
}

// ---------- embeddings ----------
await embedAll();
console.log("Done.");
