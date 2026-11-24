// Actions: analyze_text, analyze_photo, confirm, search, chat. Nothing is logged until confirm.
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

import { AiError, aiInfo, callLimits } from "../_shared/ai.ts";
import { authenticate, serviceClient } from "../_shared/auth.ts";
import { coachReply } from "../_shared/coach.ts";
import { foodBreakdown } from "../_shared/coach_tools.ts";
import { corsHeaders, fail, json, preflight } from "../_shared/cors.ts";
import { analyzePhoto, analyzeText, confirmDraft, createCtx, type MealType, previewMatch, searchFoods, THRESHOLDS } from "../_shared/pipeline.ts";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_USER_ID = Deno.env.get("ADMIN_USER_ID") ?? "";

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "Use POST.");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(req, 400, "invalid_body", "Send JSON.");
  }
  const action = String(body.action ?? "");
  const admin = serviceClient();

  // Retrieval-only access with the service key, used by scripts/rag_eval.ts (global foods only).
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (action === "search" && SERVICE_KEY && bearer === SERVICE_KEY) {
    const ctx = createCtx(null, admin, admin);
    const results = await searchFoods(ctx, String(body.q ?? ""), (body.cuisine as string) ?? null, Number(body.k) || 15);
    return json(req, { results, thresholds: THRESHOLDS });
  }

  const auth = await authenticate(req);
  if (!auth) return fail(req, 401, "unauthorized", "Sign in again.");
  const { data: profile } = await auth.userClient.from("profiles").select("timezone").eq("id", auth.user.id).maybeSingle();
  const ctx = createCtx(auth.user.id, auth.userClient, admin, profile?.timezone ?? "UTC", action === "chat" ? "coach" : action);
  const meta = {
    meal_type: (["breakfast", "lunch", "dinner", "snacks"].includes(String(body.meal_type)) ? body.meal_type : null) as MealType | null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) ? String(body.date) : null,
  };

  try {
    switch (action) {
      case "analyze_text":
        return json(req, { draft: await analyzeText(ctx, String(body.text ?? ""), meta) });
      case "analyze_photo": {
        const path = String(body.image_path ?? "");
        if (!path.startsWith(`${auth.user.id}/`)) return fail(req, 400, "invalid_image", "Upload the photo first.");
        const { data: blob, error } = await auth.userClient.storage.from("food-photos").download(path);
        if (error || !blob) return fail(req, 404, "image_not_found", "The photo could not be read. Try again.");
        if (blob.size > 1.5 * 1024 * 1024) return fail(req, 413, "image_too_large", "The photo is too large.");
        const mimeType = blob.type && blob.type.startsWith("image/") ? blob.type : "image/webp";
        const image = { mimeType, base64: encodeBase64(new Uint8Array(await blob.arrayBuffer())) };
        return json(req, { draft: await analyzePhoto(ctx, path, image, meta) });
      }
      case "confirm": {
        const result = await confirmDraft(ctx, {
          analysis_id: body.analysis_id ? String(body.analysis_id) : null,
          meal_type: String(body.meal_type) as MealType,
          date: String(body.date ?? ""),
          source: String(body.source ?? "manual"),
          items: Array.isArray(body.items) ? body.items : [],
        });
        return json(req, result);
      }
      case "discard": {
        await auth.userClient.from("food_analyses").update({ status: "discarded" }).eq("id", String(body.analysis_id ?? "")).eq("status", "pending");
        return json(req, { ok: true });
      }
      case "breakdown":
        return json(req, await foodBreakdown(ctx, String(body.food_id ?? ""), Number(body.grams) || null));
      case "preview":
        return json(req, await previewMatch(ctx, String(body.text ?? "")));
      case "search":
        return json(req, { results: await searchFoods(ctx, String(body.q ?? ""), (body.cuisine as string) ?? null, Number(body.k) || 15) });
      case "chat":
        return json(req, await coachReply(ctx, String(body.message ?? "")));
      case "chat_stream": {
        // Server-sent events: {type:"tool"|"delta"} while working, then {type:"done", ...result} or {type:"error"}.
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            try {
              const result = await coachReply(ctx, String(body.message ?? ""), send);
              send({ type: "done", ...result });
            } catch (error) {
              send({ type: "error", message: error instanceof Error ? error.message : "Coach failed." });
            }
            controller.close();
          },
        });
        return new Response(stream, { headers: { ...corsHeaders(req), "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
      }
      case "admin_usage": {
        if (!ADMIN_USER_ID || auth.user.id !== ADMIN_USER_ID) return fail(req, 403, "forbidden", "Not available.");
        const { data, error } = await admin.rpc("ai_spend_summary");
        if (error) return fail(req, 500, "failed", error.message);
        return json(req, {
          ...(data as Record<string, number>),
          daily_call_cap: callLimits.dailyCallCap,
          user_daily_limit: callLimits.userDailyLimit,
          provider: aiInfo.provider,
          model: aiInfo.model,
        });
      }
      case "status":
        return json(req, { provider: aiInfo.provider, vision_model: aiInfo.visionModel, text_model: aiInfo.textModel, configured: aiInfo.configured });
      default:
        return fail(req, 400, "unknown_action", "Unknown action.");
    }
  } catch (error) {
    if (error instanceof AiError) {
      const status = error.code === "limit" ? 429 : error.code === "not_configured" ? 503 : error.code === "invalid_output" ? 422 : 502;
      return fail(req, status, error.code, error.message);
    }
    console.error(`nutrition-ai ${action} failed`, error instanceof Error ? error.message : error);
    return fail(req, 500, "failed", error instanceof Error ? error.message : "Something went wrong.");
  }
});
