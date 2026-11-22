// Ported from backend/adapters/open_food_facts/client.py and backend/adapters/usda/client.py.

export type Macronutrients = { calories: number; protein_g: number; carbs_g: number; fat_g: number };

export type NutritionLookup = {
  name: string;
  brand: string | null;
  barcode: string | null;
  serving_grams: number;
  macros_per_serving: Macronutrients;
  provenance: { source: string; source_version: string; confidence: number };
  external_id: string;
};

const OFF_SOURCE = "open_food_facts";
const OFF_VERSION = "v2";
const USDA_SOURCE = "usda_fdc";
const USDA_VERSION = "v1";
const USER_AGENT = "FitOS/1.0 (https://fitos.pages.dev)";
const TIMEOUT_MS = 9000;

type Json = Record<string, unknown>;

const round = (value: number) => Math.round(value * 10) / 10;

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------- Open Food Facts ----------

function servingGrams(product: Json): number {
  const quantity = num(product.serving_quantity);
  const unit = String(product.serving_quantity_unit ?? "g").toLowerCase();
  if (quantity !== null && quantity > 0 && ["g", "gram", "grams", "ml"].includes(unit)) return quantity;
  return 100;
}

function per100(nutriments: Json, key: string): number {
  return num(nutriments[`${key}_100g`]) ?? 0;
}

function kcalPer100(nutriments: Json): number {
  const kcal = num(nutriments["energy-kcal_100g"]);
  if (kcal !== null) return kcal;
  const kj = num(nutriments["energy-kj_100g"]);
  return kj !== null ? kj / 4.184 : 0;
}

export function fromOffProduct(product: Json, barcode: string | null): NutritionLookup | null {
  const nutriments = (product.nutriments as Json | undefined) ?? {};
  const name = String(product.product_name || product.generic_name || "").trim();
  if (!name) return null;
  const serving = servingGrams(product);
  const factor = serving / 100;
  const hasNutrients = Object.keys(nutriments).length > 0;
  const rawBrand = Array.isArray(product.brands) ? product.brands[0] : product.brands;
  const brand = rawBrand ? String(rawBrand).split(",")[0].trim() : null;
  return {
    name,
    brand: brand || null,
    barcode,
    serving_grams: serving,
    macros_per_serving: {
      calories: round(kcalPer100(nutriments) * factor),
      protein_g: round(per100(nutriments, "proteins") * factor),
      carbs_g: round(per100(nutriments, "carbohydrates") * factor),
      fat_g: round(per100(nutriments, "fat") * factor),
    },
    provenance: { source: OFF_SOURCE, source_version: OFF_VERSION, confidence: hasNutrients ? 0.9 : 0.4 },
    external_id: barcode ?? String(product.code ?? name),
  };
}

export async function offLookupBarcode(barcode: string): Promise<NutritionLookup | null> {
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`open_food_facts_${response.status}`);
  const body = (await response.json()) as Json;
  if (body.status !== 1 || typeof body.product !== "object" || body.product === null) return null;
  return fromOffProduct(body.product as Json, barcode);
}

const OFF_FIELDS = "code,product_name,generic_name,brands,nutriments,serving_quantity,serving_quantity_unit";

function parseOffProducts(products: Json[]): NutritionLookup[] {
  return products
    .map((product) => fromOffProduct(product, product.code ? String(product.code) : null))
    .filter((item): item is NutritionLookup => item !== null && item.macros_per_serving.calories > 0);
}

// search.openfoodfacts.org is the current search service; the legacy cgi endpoint is a fallback.
export async function offSearch(query: string, limit: number): Promise<NutritionLookup[]> {
  const size = String(Math.min(limit, 50));
  try {
    const params = new URLSearchParams({ q: query, page_size: size, fields: OFF_FIELDS });
    const response = await fetch(`https://search.openfoodfacts.org/search?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`open_food_facts_search_${response.status}`);
    const body = (await response.json()) as Json;
    return parseOffProducts((body.hits as Json[] | undefined) ?? []);
  } catch (primaryError) {
    const params = new URLSearchParams({ search_terms: query, search_simple: "1", action: "process", json: "1", page_size: size, fields: OFF_FIELDS });
    const response = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw primaryError;
    const body = (await response.json()) as Json;
    return parseOffProducts((body.products as Json[] | undefined) ?? []);
  }
}

// ---------- USDA FoodData Central ----------

function usdaNutrient(nutrients: Json[], numbers: string[], names: string[]): number {
  for (const item of nutrients) {
    const number = String(item.nutrientNumber ?? "");
    const name = String(item.nutrientName ?? "");
    const unit = String(item.unitName ?? "").toUpperCase();
    if (numbers.includes(number) || names.includes(name)) {
      if (names[0] === "Energy" && unit === "KJ") return (num(item.value) ?? 0) / 4.184;
      return num(item.value) ?? 0;
    }
  }
  return 0;
}

function fromFdc(food: Json): NutritionLookup | null {
  if (food.fdcId === undefined || food.fdcId === null) return null;
  const nutrients = (food.foodNutrients as Json[] | undefined) ?? [];
  const brand = (food.brandOwner as string | undefined) ?? (food.brandName as string | undefined) ?? null;
  return {
    name: String(food.description ?? "USDA food"),
    brand,
    barcode: (food.gtinUpc as string | undefined) ?? null,
    serving_grams: 100,
    macros_per_serving: {
      calories: round(usdaNutrient(nutrients, ["208"], ["Energy"])),
      protein_g: round(usdaNutrient(nutrients, ["203"], ["Protein"])),
      carbs_g: round(usdaNutrient(nutrients, ["205"], ["Carbohydrate, by difference"])),
      fat_g: round(usdaNutrient(nutrients, ["204"], ["Total lipid (fat)"])),
    },
    provenance: { source: USDA_SOURCE, source_version: USDA_VERSION, confidence: 0.95 },
    external_id: String(food.fdcId),
  };
}

export async function usdaSearch(query: string, limit: number, apiKey: string): Promise<NutritionLookup[]> {
  if (!apiKey) return [];
  const params = new URLSearchParams({ api_key: apiKey, query, pageSize: String(Math.min(limit, 50)) });
  const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`usda_${response.status}`);
  const body = (await response.json()) as Json;
  return ((body.foods as Json[] | undefined) ?? [])
    .map(fromFdc)
    .filter((item): item is NutritionLookup => item !== null && item.macros_per_serving.calories > 0);
}

export async function usdaLookupBarcode(barcode: string, apiKey: string): Promise<NutritionLookup | null> {
  const matches = await usdaSearch(barcode, 5, apiKey);
  return matches.find((item) => item.barcode === barcode || item.barcode === barcode.replace(/^0+/, "")) ?? null;
}

export function normalizeBarcode(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}
