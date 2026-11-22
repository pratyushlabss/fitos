import { authenticate, serviceClient } from "../_shared/auth.ts";
import { fail, json, preflight } from "../_shared/cors.ts";
import { normalizeBarcode, type NutritionLookup, offLookupBarcode, usdaLookupBarcode } from "../_shared/nutrition.ts";

const USDA_API_KEY = Deno.env.get("USDA_API_KEY") ?? "";

type CachedRow = {
  barcode: string;
  brand: string | null;
  product_name: string | null;
  confidence: number;
  source: string;
  product_nutrition: Array<{
    serving_size_g: number | null;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    source: string;
    confidence: number;
  }>;
};

function fromCache(row: CachedRow): NutritionLookup | null {
  const nutrition = row.product_nutrition?.[0];
  if (!nutrition || !row.product_name) return null;
  return {
    name: row.product_name,
    brand: row.brand,
    barcode: row.barcode,
    serving_grams: Number(nutrition.serving_size_g) || 100,
    macros_per_serving: {
      calories: Number(nutrition.calories),
      protein_g: Number(nutrition.protein_g),
      carbs_g: Number(nutrition.carbs_g),
      fat_g: Number(nutrition.fat_g),
    },
    provenance: { source: nutrition.source, source_version: "cache", confidence: Number(nutrition.confidence) },
    external_id: row.barcode,
  };
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "Use POST.");
  if (!(await authenticate(req))) return fail(req, 401, "unauthorized", "Sign in again to scan barcodes.");

  let barcode: string | null = null;
  try {
    barcode = normalizeBarcode(String((await req.json())?.barcode ?? ""));
  } catch {
    return fail(req, 400, "invalid_body", "Send JSON with a barcode.");
  }
  if (!barcode) return fail(req, 400, "invalid_barcode", "Barcodes have 8 to 14 digits.");

  const admin = serviceClient();
  const { data: cached } = await admin
    .from("products")
    .select("barcode, brand, product_name, confidence, source, product_nutrition(serving_size_g, calories, protein_g, carbs_g, fat_g, source, confidence)")
    .eq("barcode", barcode)
    .is("user_id", null)
    .maybeSingle();
  const hit = cached ? fromCache(cached as CachedRow) : null;
  if (hit) return json(req, { result: hit });

  let result: NutritionLookup | null = null;
  try {
    result = (await offLookupBarcode(barcode)) ?? (await usdaLookupBarcode(barcode, USDA_API_KEY));
  } catch (error) {
    console.error("barcode lookup failed", error instanceof Error ? error.message : error);
    return fail(req, 502, "upstream_error", "The product database is not responding. Try again.");
  }
  if (!result) return json(req, { result: null });

  const { data: product, error } = await admin
    .from("products")
    .insert({
      barcode,
      brand: result.brand,
      product_name: result.name,
      confidence: result.provenance.confidence,
      source: result.provenance.source,
      status: "exact",
    })
    .select("id")
    .single();
  if (!error && product) {
    await admin.from("product_nutrition").insert({
      product_id: product.id,
      serving_size_g: result.serving_grams,
      calories: result.macros_per_serving.calories,
      protein_g: result.macros_per_serving.protein_g,
      carbs_g: result.macros_per_serving.carbs_g,
      fat_g: result.macros_per_serving.fat_g,
      source: result.provenance.source,
      source_url: result.provenance.source === "open_food_facts" ? `https://world.openfoodfacts.org/product/${barcode}` : null,
      confidence: result.provenance.confidence,
    });
  }
  return json(req, { result });
});
