// Imports data/ifct2017.csv (Indian Food Composition Tables 2017) as global, verified raw ingredients,
// then runs embed-worker until every food has an embedding.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> \
//   npx deno run -A scripts/import_ifct.ts
//
// Accepted columns (case-insensitive, first match wins):
//   name: name | food_name | food | description      energy: enerc (kJ) | energy_kj | energy_kcal | kcal | energy
//   protein: protcnt | protein | protein_g            fat: fatce | fat | total_fat | fat_g
//   carbs: choavldf | carbohydrate | carbs | carbs_g   fibre: fibtg | fibre | fiber | dietary_fibre
//   sugar: fsugar | sugars | sugar                     sodium (mg): na | sodium | sodium_mg
//   saturated fat: fasat | saturated_fat | sat_fat     group: grup | group | category
//   local names (aliases, ';' or ',' separated): lang | aliases | local_names
// Values are per 100 g edible portion, as published in IFCT.
import { createClient } from "npm:@supabase/supabase-js@2";

const FILE = new URL("../data/ifct2017.csv", import.meta.url);
const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

try {
  await Deno.stat(FILE);
} catch {
  console.log("data/ifct2017.csv not found, skipping IFCT import.");
  console.log("Download the IFCT 2017 composition table as CSV, save it as data/ifct2017.csv and run this again.");
  Deno.exit(0);
}
if (!URL_ || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your shell first.");
  Deno.exit(1);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const rows = parseCsv(await Deno.readTextFile(FILE));
const header = rows[0].map((h) => h.trim().toLowerCase());
const col = (...names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
const idx = {
  name: col("name", "food_name", "food", "description"),
  enerc: col("enerc", "energy_kj"),
  kcal: col("energy_kcal", "kcal", "energy"),
  protein: col("protcnt", "protein", "protein_g"),
  fat: col("fatce", "fat", "total_fat", "fat_g"),
  carbs: col("choavldf", "carbohydrate", "carbs", "carbs_g"),
  fibre: col("fibtg", "fibre", "fiber", "dietary_fibre"),
  sugar: col("fsugar", "sugars", "sugar"),
  sodium: col("na", "sodium", "sodium_mg"),
  satfat: col("fasat", "saturated_fat", "sat_fat"),
  group: col("grup", "group", "category"),
  aliases: col("lang", "aliases", "local_names"),
};
if (idx.name < 0 || (idx.enerc < 0 && idx.kcal < 0)) {
  console.error(`Could not find name and energy columns. Header: ${header.join(", ")}`);
  Deno.exit(1);
}

const num = (row: string[], i: number) => {
  if (i < 0) return 0;
  const value = Number(String(row[i] ?? "").replace(/[^\d.\-eE]/g, ""));
  return Number.isFinite(value) ? value : 0;
};

type Entry = { name: string; category: string | null; aliases: string[]; n: Record<string, number> };
const entries = new Map<string, Entry>();
for (const row of rows.slice(1)) {
  const name = String(row[idx.name] ?? "").trim().replace(/\s+/g, " ");
  if (!name || entries.has(name.toLowerCase())) continue;
  const kcal = idx.enerc >= 0 ? num(row, idx.enerc) / 4.184 : num(row, idx.kcal);
  entries.set(name.toLowerCase(), {
    name: name.slice(0, 120),
    category: idx.group >= 0 ? String(row[idx.group] ?? "").trim() || null : null,
    aliases: idx.aliases >= 0 ? String(row[idx.aliases] ?? "").split(/[;,]/).map((a) => a.trim()).filter(Boolean).slice(0, 8) : [],
    n: {
      calories: Math.round(kcal * 10) / 10,
      protein_g: num(row, idx.protein),
      carbs_g: num(row, idx.carbs),
      fat_g: num(row, idx.fat),
      fiber_g: num(row, idx.fibre),
      sugar_g: num(row, idx.sugar),
      sodium_mg: num(row, idx.sodium),
      sat_fat_g: num(row, idx.satfat),
    },
  });
}
console.log(`Parsed ${entries.size} foods from IFCT.`);

const admin = createClient(URL_, KEY, { auth: { persistSession: false } });
let inserted = 0;
let skipped = 0;
const list = [...entries.values()];
for (let i = 0; i < list.length; i += 200) {
  const batch = list.slice(i, i + 200);
  const { data: existing } = await admin.from("foods").select("name").is("owner_id", null).in("name", batch.map((e) => e.name));
  const have = new Set((existing ?? []).map((r: { name: string }) => r.name.toLowerCase()));
  const fresh = batch.filter((e) => !have.has(e.name.toLowerCase()));
  skipped += batch.length - fresh.length;
  if (!fresh.length) continue;
  const { data: foods, error } = await admin
    .from("foods")
    .insert(fresh.map((e) => ({ name: e.name, owner_id: null, source: "ifct", verified: true, is_dish: false, cuisine: "indian", category: e.category, aliases: e.aliases, serving_grams: 100, confidence: 0.95 })))
    .select("id, name");
  if (error) {
    console.error(`Batch ${i / 200 + 1} failed: ${error.message}`);
    continue;
  }
  const byName = new Map(fresh.map((e) => [e.name.toLowerCase(), e]));
  const nutrition = (foods ?? []).map((f: { id: string; name: string }) => ({ food_id: f.id, ...byName.get(f.name.toLowerCase())!.n, source: "ifct", confidence: 0.95 }));
  const { error: nError } = await admin.from("food_nutrition").upsert(nutrition, { onConflict: "food_id" });
  if (nError) console.error(`Nutrition batch ${i / 200 + 1} failed: ${nError.message}`);
  inserted += foods?.length ?? 0;
  console.log(`Inserted ${inserted} (skipped ${skipped} already present)`);
}

console.log("Backfilling embeddings with embed-worker…");
for (let round = 0; round < 300; round += 1) {
  const response = await fetch(`${URL_}/functions/v1/embed-worker`, { method: "POST", headers: { Authorization: `Bearer ${KEY}` } });
  if (!response.ok) {
    console.error(`embed-worker returned ${response.status}: ${await response.text()}`);
    break;
  }
  const result = (await response.json()) as { foods: number; remaining: number };
  console.log(`  embedded ${result.foods}, remaining ${result.remaining}`);
  if (result.remaining === 0 || result.foods === 0) break;
}
console.log(`Done. ${inserted} IFCT foods added.`);
