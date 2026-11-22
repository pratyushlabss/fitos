// Meal photo -> foods, portions and macros. Ported from backend/adapters/claude/vision.py.
import Anthropic from "npm:@anthropic-ai/sdk@^1";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

import { authenticate, serviceClient } from "../_shared/auth.ts";
import { fail, json, preflight } from "../_shared/cors.ts";

const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-5-5";
const DAILY_LIMIT = 20;
const MAX_BYTES = 1.5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const SYSTEM_PROMPT =
  "You are FitOS meal vision. Identify distinct edible foods in the photo, estimate " +
  "edible portion mass in grams, and estimate calories and macros for those portions. " +
  "Do not invent branded barcodes. If the photo shows no food, return an empty items list and explain in notes.";

// Same fields as the Python MEAL_TOOL input schema. Numeric ranges are enforced after parsing.
const MEAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overall_confidence", "items", "notes"],
  properties: {
    overall_confidence: { type: "number", description: "Confidence in the full meal parse, 0 to 1." },
    notes: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "brand", "portion_grams", "calories", "protein_g", "carbs_g", "fat_g", "confidence"],
        properties: {
          name: { type: "string" },
          brand: { type: ["string", "null"] },
          portion_grams: { type: "number" },
          calories: { type: "number" },
          protein_g: { type: "number" },
          carbs_g: { type: "number" },
          fat_g: { type: "number" },
          confidence: { type: "number" },
        },
      },
    },
  },
} as const;

type RawItem = {
  name: string;
  brand: string | null;
  portion_grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: number;
};
type RawMeal = { overall_confidence: number; notes: string | null; items: RawItem[] };

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const nonNegative = (value: number) => Math.max(0, Number.isFinite(value) ? Math.round(value * 10) / 10 : 0);

function toPrediction(raw: RawMeal, model: string) {
  const items = raw.items
    .filter((item) => item.name?.trim() && item.portion_grams > 0)
    .map((item) => {
      const confidence = clamp01(item.confidence);
      return {
        name: item.name.trim(),
        portion_grams: nonNegative(item.portion_grams),
        brand: item.brand,
        barcode: null,
        usda_fdc_id: null,
        macros: {
          calories: nonNegative(item.calories),
          protein_g: nonNegative(item.protein_g),
          carbs_g: nonNegative(item.carbs_g),
          fat_g: nonNegative(item.fat_g),
        },
        provenance: { source: "claude_vision", source_version: model, confidence },
      };
    });
  const overall = clamp01(raw.overall_confidence);
  return {
    items,
    overall_confidence: overall,
    notes: raw.notes ?? null,
    provenance: { source: "claude_vision", source_version: model, confidence: overall },
  };
}

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "" });

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "Use POST.");
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return fail(req, 503, "not_configured", "Photo scanning is not set up yet.");

  const auth = await authenticate(req);
  if (!auth) return fail(req, 401, "unauthorized", "Sign in again to scan food.");

  let image: File;
  let locale = "";
  try {
    const form = await req.formData();
    const value = form.get("image");
    if (!(value instanceof File)) return fail(req, 400, "missing_image", "Attach a photo.");
    image = value;
    locale = String(form.get("locale") ?? "").slice(0, 20);
  } catch {
    return fail(req, 400, "invalid_body", "Send the photo as multipart form data.");
  }
  if (!ALLOWED_TYPES.has(image.type)) return fail(req, 415, "unsupported_image", "Use a JPEG, PNG or WebP photo.");
  if (image.size > MAX_BYTES) return fail(req, 413, "image_too_large", "The photo is too large. Try again.");

  const admin = serviceClient();
  const { data: remaining, error: limitError } = await admin.rpc("consume_food_scan", { p_user: auth.user.id, p_limit: DAILY_LIMIT });
  if (limitError) return fail(req, 500, "rate_limit_unavailable", "Could not check your daily scan limit.");
  if (remaining === -1) return fail(req, 429, "daily_limit_reached", `You have used all ${DAILY_LIMIT} photo scans for today.`);

  const refund = () => admin.rpc("refund_food_scan", { p_user: auth.user.id });

  try {
    const data = encodeBase64(new Uint8Array(await image.arrayBuffer()));
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: MEAL_SCHEMA } },
      system: SYSTEM_PROMPT + (locale ? ` User locale: ${locale}.` : ""),
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.type as "image/jpeg", data } },
            { type: "text", text: "Identify every distinct food and estimate portions and macros." },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      await refund();
      return fail(req, 422, "declined", "This photo could not be analysed. Try another photo or search instead.");
    }
    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") throw new Error("no_text_block");
    const prediction = toPrediction(JSON.parse(text.text) as RawMeal, response.model);
    if (prediction.items.length === 0) {
      await refund();
      return fail(req, 422, "no_food_found", prediction.notes ?? "No food was found in this photo.");
    }

    const { data: saved, error: saveError } = await auth.userClient
      .from("food_predictions")
      .insert({
        user_id: auth.user.id,
        source: prediction.provenance.source,
        source_version: prediction.provenance.source_version,
        confidence: prediction.overall_confidence,
        image_storage_path: null,
        prediction,
      })
      .select("id")
      .single();
    if (saveError || !saved) throw new Error(saveError?.message ?? "save_failed");

    return json(req, { prediction_id: saved.id, prediction, scans_remaining: remaining });
  } catch (error) {
    await refund();
    console.error("food-scan failed", error instanceof Error ? error.message : error);
    if (error instanceof Anthropic.RateLimitError) return fail(req, 503, "busy", "The food scanner is busy. Try again in a minute.");
    if (error instanceof Anthropic.APIError) return fail(req, 502, "upstream_error", "The food scanner had a problem. Try again.");
    return fail(req, 500, "scan_failed", "Could not analyse this photo. Try again.");
  }
});
