// Fills missing embeddings (foods and coach notes), up to `limit` per run (body {"limit": n, "ids"?: [...]}, default 10).
// More than ~10 per call hits the edge worker's compute limit (WORKER_RESOURCE_LIMIT). `ids` lets a bulk import
// run several calls in parallel on disjoint rows (scripts/import_food_db.ts).
// Scheduled every 5 minutes with pg_cron + pg_net; called with the service role key.
import { serviceClient } from "../_shared/auth.ts";
import { embed, toVector } from "../_shared/embed.ts";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!SERVICE_KEY || bearer !== SERVICE_KEY) return new Response("unauthorized", { status: 401 });

  const admin = serviceClient();
  const started = performance.now();
  let foods = 0;
  let notes = 0;
  let failed = 0;

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(100, Math.max(1, Number(body?.limit) || 10));
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).map(String).slice(0, limit) : null;
  const { data: pending, error } = await admin.rpc("foods_to_embed", { p_limit: limit, p_ids: ids });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  for (const row of (pending ?? []) as Array<{ id: string; embedded_text: string }>) {
    try {
      await admin.from("foods").update({ embedding: toVector(await embed(row.embedded_text)), embedded_text: row.embedded_text }).eq("id", row.id);
      foods += 1;
    } catch {
      failed += 1;
    }
  }

  const { data: memory } = await admin.from("coach_memory").select("id, note").is("embedding", null).limit(Math.max(0, limit - foods));
  for (const row of (memory ?? []) as Array<{ id: string; note: string }>) {
    try {
      await admin.from("coach_memory").update({ embedding: toVector(await embed(row.note)) }).eq("id", row.id);
      notes += 1;
    } catch {
      failed += 1;
    }
  }

  const { count } = await admin.from("foods").select("id", { count: "exact", head: true }).is("embedding", null);
  return Response.json({ foods, notes, failed, remaining: count ?? 0, ms: Math.round(performance.now() - started) });
});
