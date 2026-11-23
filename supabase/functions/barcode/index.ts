// Open Food Facts barcode -> global food (source=barcode) with servings -> draft for review/confirm.
import { authenticate, serviceClient } from "../_shared/auth.ts";
import { fail, json, preflight } from "../_shared/cors.ts";
import { embed, toVector } from "../_shared/embed.ts";
import { normalizeBarcode, offLookupBarcode } from "../_shared/off.ts";
import type { Draft, DraftItem, Serving } from "../_shared/pipeline.ts";

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "Use POST.");
  const auth = await authenticate(req);
  if (!auth) return fail(req, 401, "unauthorized", "Sign in again to scan barcodes.");

  let barcode: string | null = null;
  try {
    barcode = normalizeBarcode(String((await req.json())?.barcode ?? ""));
  } catch {
    return fail(req, 400, "invalid_body", "Send JSON with a barcode.");
  }
  if (!barcode) return fail(req, 400, "invalid_barcode", "Barcodes have 8 to 14 digits.");

  const admin = serviceClient();
  let food = await admin
    .from("foods")
    .select("id, name, serving_grams, food_nutrition(calories, protein_g, carbs_g, fat_g, fiber_g), food_servings(unit, grams, label)")
    .is("owner_id", null)
    .eq("source", "barcode")
    .contains("aliases", [barcode])
    .limit(1)
    .maybeSingle();

  if (!food.data) {
    let product;
    try {
      product = await offLookupBarcode(barcode);
    } catch (error) {
      console.error("barcode lookup failed", error instanceof Error ? error.message : error);
      return fail(req, 502, "upstream_error", "The product database is not responding. Try again or add it manually.");
    }
    if (!product) return json(req, { draft: null, message: "Open Food Facts doesn't know this barcode. Add it manually instead." });
    const name = (product.brand && !product.name.toLowerCase().includes(product.brand.toLowerCase()) ? `${product.name} (${product.brand})` : product.name).slice(0, 110);
    let inserted = await admin
      .from("foods")
      .insert({ name, brand: product.brand, owner_id: null, source: "barcode", verified: false, aliases: [barcode], serving_grams: product.serving_grams, confidence: product.has_nutrients ? 0.9 : 0.4, category: "packaged" })
      .select("id")
      .single();
    if (inserted.error) {
      inserted = await admin
        .from("foods")
        .insert({ name: `${name} ${barcode}`, brand: product.brand, owner_id: null, source: "barcode", verified: false, aliases: [barcode], serving_grams: product.serving_grams, category: "packaged" })
        .select("id")
        .single();
    }
    if (inserted.error) return fail(req, 500, "save_failed", "Could not save this product.");
    const id = String(inserted.data.id);
    const p = product.per100;
    await admin.from("food_nutrition").insert({
      food_id: id,
      calories: p.kcal,
      protein_g: p.protein_g,
      carbs_g: p.carbs_g,
      fat_g: p.fat_g,
      fiber_g: p.fibre_g,
      sugar_g: p.sugar_g,
      sodium_mg: p.sodium_mg,
      sat_fat_g: p.sat_fat_g,
      source: "open_food_facts",
      source_url: `https://world.openfoodfacts.org/product/${barcode}`,
      confidence: product.has_nutrients ? 0.9 : 0.4,
    });
    await admin.from("food_servings").insert({ food_id: id, unit: "serving", grams: product.serving_grams, label: product.serving_label ?? `1 serving (${product.serving_grams} g)` });
    const { data: text } = await admin.rpc("foods_to_embed", { p_limit: 1, p_ids: [id] });
    const embedded = (text ?? [])[0] as { embedded_text: string } | undefined;
    if (embedded) {
      try {
        await admin.from("foods").update({ embedding: toVector(await embed(embedded.embedded_text)), embedded_text: embedded.embedded_text }).eq("id", id);
      } catch {
        // embed-worker fills it in later
      }
    }
    food = await admin
      .from("foods")
      .select("id, name, serving_grams, food_nutrition(calories, protein_g, carbs_g, fat_g, fiber_g), food_servings(unit, grams, label)")
      .eq("id", id)
      .maybeSingle();
  }

  const row = food.data as unknown as {
    id: string;
    name: string;
    serving_grams: number | null;
    food_nutrition: Record<string, number> | Record<string, number>[] | null;
    food_servings: Array<{ unit: Serving["unit"]; grams: number; label: string | null }>;
  };
  const nutrition = Array.isArray(row.food_nutrition) ? row.food_nutrition[0] : row.food_nutrition;
  const grams = Number(row.serving_grams) || 100;
  const item: DraftItem = {
    key: "b0",
    food_id: row.id,
    name: row.name,
    is_dish: false,
    cuisine: null,
    quantity: 1,
    unit: "serving",
    grams,
    per100: {
      kcal: Number(nutrition?.calories ?? 0),
      protein_g: Number(nutrition?.protein_g ?? 0),
      carbs_g: Number(nutrition?.carbs_g ?? 0),
      fat_g: Number(nutrition?.fat_g ?? 0),
      fibre_g: Number(nutrition?.fiber_g ?? 0),
    },
    source: "barcode",
    own: false,
    confidence: 0.9,
    match_score: 1,
    ingredients: [],
    servings: (row.food_servings ?? []).map((s) => ({ ...s, specific: true })),
  };
  const draft: Draft = {
    analysis_id: null,
    input_type: "barcode",
    input_text: barcode,
    image_path: null,
    cuisine: null,
    confidence: 0.9,
    question: null,
    items: [item],
    meal_type: null,
    date: null,
    cache_hit: false,
    ai_calls: 0,
    candidates_count: 0,
  };
  return json(req, { draft });
});
