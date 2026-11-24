// Imports fitos_food_db/ into the existing tables: foods, food_nutrition, food_servings, dish_ingredients.
// Upserts in batches of 500 on id. Text ids that aren't UUIDs map to a stable UUIDv5 and are kept in foods.external_id.
// Then writes apps/web/lib/dataSources.json from the README's attribution section and runs embed-worker until done.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Run: deno run -A scripts/import_food_db.ts
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
    is_dish: bool(pick(row, "is_dish", "dish")) || pick(row, "tier") === "recipe_calculated",
    cuisine: pick(row, "cuisine", "region") || null,
    category: pick(row, "category", "group", "food_group") || null,
    aliases: aliasText ? aliasText.split(/[;|]/).map((a) => a.trim()).filter(Boolean) : [],
    confidence: pick(row, "tier") === "lab_verified" ? 0.95 : 0.8,
    embedding: null,
  };
});
await upsert("foods", foodRows, "id");

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
    vitamin_c_mg: num(pick(row, "vitamin_c_mg", "vitc_mg", "vitamin_c")),
    b12_ug: num(pick(row, "b12_ug", "vitamin_b12_ug", "b12")),
    potassium_mg: num(pick(row, "potassium_mg", "potassium")),
    alcohol_g: num(pick(row, "alcohol_g")) ?? 0,
    source: pick(row, "source") || "fitos_food_db",
    confidence: 0.9,
  };
});
// One nutrition row per food: replace the food DB's rows.
const ids = nutritionRows.map((r) => r.food_id as string);
for (let i = 0; i < ids.length; i += BATCH) await db.from("food_nutrition").delete().in("food_id", ids.slice(i, i + BATCH));
for (let i = 0; i < nutritionRows.length; i += BATCH) {
  const { error } = await db.from("food_nutrition").insert(nutritionRows.slice(i, i + BATCH));
  if (error) throw new Error(`food_nutrition: ${error.message}`);
  console.log(`food_nutrition: ${Math.min(i + BATCH, nutritionRows.length)}/${nutritionRows.length}`);
}

// ---------- servings ----------
const servings = await readCsv("food_servings.csv");
const servingRows = [];
for (const row of servings) {
  const food = idMap.get(pick(row, "food_id")) ?? (UUID.test(pick(row, "food_id")) ? pick(row, "food_id") : null);
  const unit = UNITS[pick(row, "unit").toLowerCase()] ?? "serving";
  const grams = num(pick(row, "grams", "weight_g", "typical_g"));
  if (!food || !grams) continue;
  servingRows.push({ id: pick(row, "id") ? await uuidFor(`serving:${pick(row, "id")}`) : await uuidFor(`serving:${food}:${unit}:${grams}`), food_id: food, unit, grams, label: pick(row, "label", "description") || `1 ${unit}` });
}
if (servingRows.length) await upsert("food_servings", servingRows, "id");

// ---------- dish ingredients ----------
const ingredients = await readCsv("dish_ingredients.csv");
const ingredientRows = [];
for (const [position, row] of ingredients.entries()) {
  const dish = idMap.get(pick(row, "dish_id", "dish_food_id")) ?? null;
  const ing = idMap.get(pick(row, "ingredient_id", "ingredient_food_id")) ?? null;
  const grams = num(pick(row, "grams", "grams_per_serving"));
  if (!dish || !ing || !grams) continue;
  ingredientRows.push({ id: pick(row, "id") ? await uuidFor(`ing:${pick(row, "id")}`) : await uuidFor(`ing:${dish}:${ing}:${position}`), dish_food_id: dish, ingredient_food_id: ing, grams_per_serving: grams, notes: pick(row, "notes") || null, position: num(pick(row, "position")) ?? position });
}
if (ingredientRows.length) await upsert("dish_ingredients", ingredientRows, "id");

// ---------- attribution for the app's Data sources screen ----------
try {
  const readme = await Deno.readTextFile(new URL("README.md", ROOT));
  const section = readme.split(/\n(?=#+\s)/).find((s) => /^#+\s*(attribution|sources|data sources|licen[cs]e)/i.test(s));
  const lines = (section ?? "").split("\n").slice(1).map((l) => l.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
  await Deno.writeTextFile(new URL("../apps/web/lib/dataSources.json", import.meta.url), JSON.stringify({ sources: lines }, null, 2) + "\n");
  console.log(`attribution: ${lines.length} lines written to apps/web/lib/dataSources.json`);
} catch {
  console.warn("README.md not found: attribution not updated.");
}

// ---------- embeddings ----------
for (let round = 0; round < 200; round += 1) {
  const r = await fetch(`${URL_}/functions/v1/embed-worker`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: "{}" });
  const out = await r.json().catch(() => ({}));
  console.log(`embed-worker: ${JSON.stringify(out)}`);
  if (!r.ok || !out.remaining || !out.foods) break;
}
console.log("Done.");
