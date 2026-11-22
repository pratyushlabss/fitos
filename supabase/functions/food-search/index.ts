import { authenticate } from "../_shared/auth.ts";
import { fail, json, preflight } from "../_shared/cors.ts";
import { type NutritionLookup, offSearch, usdaSearch } from "../_shared/nutrition.ts";

const USDA_API_KEY = Deno.env.get("USDA_API_KEY") ?? "";

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "Use POST.");
  if (!(await authenticate(req))) return fail(req, 401, "unauthorized", "Sign in again to search foods.");

  let query = "";
  let limit = 20;
  try {
    const body = await req.json();
    query = String(body?.query ?? "").trim().slice(0, 100);
    limit = Math.max(1, Math.min(Number(body?.limit) || 20, 40));
  } catch {
    return fail(req, 400, "invalid_body", "Send JSON with a query.");
  }
  if (query.length < 2) return fail(req, 400, "query_too_short", "Type at least two letters.");

  // USDA first (verified nutrients), then Open Food Facts for branded products.
  const [usda, off] = await Promise.allSettled([usdaSearch(query, limit, USDA_API_KEY), offSearch(query, limit)]);
  if (usda.status === "rejected" && off.status === "rejected") {
    console.error("food-search failed", usda.reason, off.reason);
    return fail(req, 502, "upstream_error", "Food databases are not responding. Try again.");
  }

  const seen = new Set<string>();
  const results: NutritionLookup[] = [];
  const all = [...(usda.status === "fulfilled" ? usda.value : []), ...(off.status === "fulfilled" ? off.value : [])];
  for (const item of all) {
    const key = `${item.name.toLowerCase()}|${(item.brand ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
    if (results.length >= limit) break;
  }
  return json(req, { results });
});
