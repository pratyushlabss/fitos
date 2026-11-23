// Open Food Facts barcode lookup (no key). Ported from backend/adapters/open_food_facts/client.py.

export type Per100 = { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number };

export type OffProduct = {
  barcode: string;
  name: string;
  brand: string | null;
  serving_grams: number;
  serving_label: string | null;
  per100: Per100 & { sugar_g: number; sodium_mg: number; sat_fat_g: number };
  has_nutrients: boolean;
};

const USER_AGENT = "FitOS/1.0 (https://fitos.pages.dev)";
type Json = Record<string, unknown>;

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeBarcode(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

export async function offLookupBarcode(barcode: string): Promise<OffProduct | null> {
  const fields = "code,product_name,generic_name,brands,nutriments,serving_quantity,serving_quantity_unit,serving_size";
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(9000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`open_food_facts_${response.status}`);
  const body = (await response.json()) as Json;
  if (body.status !== 1 || typeof body.product !== "object" || body.product === null) return null;
  const product = body.product as Json;
  const n = (product.nutriments as Json | undefined) ?? {};
  const name = String(product.product_name || product.generic_name || "").trim();
  if (!name) return null;
  const rawBrand = Array.isArray(product.brands) ? product.brands[0] : product.brands;
  const quantity = num(product.serving_quantity);
  const unit = String(product.serving_quantity_unit ?? "g").toLowerCase();
  const kcal = n["energy-kcal_100g"] !== undefined ? num(n["energy-kcal_100g"]) : num(n["energy-kj_100g"]) / 4.184;
  return {
    barcode,
    name,
    brand: rawBrand ? String(rawBrand).split(",")[0].trim() || null : null,
    serving_grams: quantity > 0 && ["g", "gram", "grams", "ml"].includes(unit) ? quantity : 100,
    serving_label: product.serving_size ? String(product.serving_size) : null,
    per100: {
      kcal: Math.round(kcal * 10) / 10,
      protein_g: num(n.proteins_100g),
      carbs_g: num(n.carbohydrates_100g),
      fat_g: num(n.fat_100g),
      fibre_g: num(n.fiber_100g),
      sugar_g: num(n.sugars_100g),
      sodium_mg: num(n.sodium_100g) * 1000,
      sat_fat_g: num(n["saturated-fat_100g"]),
    },
    has_nutrients: Object.keys(n).length > 0,
  };
}
