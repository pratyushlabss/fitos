// Retrieval eval: recall@5 and MRR for 30 everyday queries, score distributions for threshold tuning,
// and the semantic-cache hit rate from logged analyses.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> \
//   npx deno run -A scripts/rag_eval.ts
//
// It searches global foods only (service role, no user), through the deployed nutrition-ai function,
// so it measures exactly what the app retrieves. Run it after scripts/import_ifct.ts and some real use.
const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!URL_ || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  Deno.exit(1);
}

// query -> any of these substrings in a top-5 name counts as a hit
export const CASES: Array<[string, string[]]> = [
  ["dosa", ["dosa"]],
  ["masala dosa", ["masala dosa"]],
  ["2 plain dosai", ["dosa"]],
  ["idli sambar", ["idli", "sambar"]],
  ["2 idli", ["idli"]],
  ["2 roti dal", ["roti", "chapati", "dal"]],
  ["1 katori toor dal", ["dal", "red gram", "toor"]],
  ["paneer butter masala", ["paneer butter masala", "paneer"]],
  ["that paneer curry", ["paneer"]],
  ["chicken biryani", ["biryani"]],
  ["veg biryani", ["biryani"]],
  ["curd rice", ["curd rice"]],
  ["poha", ["poha", "flattened rice", "rice flakes"]],
  ["upma", ["upma"]],
  ["vada pav", ["vada pav"]],
  ["medu vada", ["vada"]],
  ["chicken tikka", ["chicken tikka"]],
  ["rajma chawal", ["rajma", "kidney bean"]],
  ["chole bhature", ["chole", "chickpea", "bhatura"]],
  ["aloo paratha", ["paratha"]],
  ["sambar", ["sambar"]],
  ["coconut chutney", ["coconut chutney", "chutney"]],
  ["Vegemite toast", ["vegemite", "toast"]],
  ["avocado toast", ["avocado toast", "avocado"]],
  ["protein shake", ["protein shake", "whey"]],
  ["flat white", ["flat white", "coffee"]],
  ["meat pie", ["meat pie", "pie"]],
  ["banana", ["banana"]],
  ["greek yoghurt", ["yoghurt", "yogurt", "curd"]],
  ["boiled egg", ["egg"]],
];

type Hit = { name: string; score: number; source: string };

async function search(q: string): Promise<Hit[]> {
  const response = await fetch(`${URL_}/functions/v1/nutrition-ai`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "search", q, k: 5 }),
  });
  if (!response.ok) throw new Error(`search ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { results: Hit[] }).results;
}

let hits = 0;
let reciprocal = 0;
const correctTop: number[] = [];
const wrongTop: number[] = [];
console.log("query".padEnd(26), "rank", "top score", "top result");
for (const [query, expected] of CASES) {
  const results = await search(query);
  const rank = results.findIndex((r) => expected.some((e) => r.name.toLowerCase().includes(e.toLowerCase())));
  if (rank >= 0) {
    hits += 1;
    reciprocal += 1 / (rank + 1);
  }
  const top = results[0];
  if (top) (rank === 0 ? correctTop : wrongTop).push(top.score);
  console.log(query.padEnd(26), String(rank >= 0 ? rank + 1 : "-").padEnd(4), (top?.score ?? 0).toFixed(3).padEnd(9), top ? `${top.name} [${top.source}]` : "(none)");
}

const pct = (values: number[], p: number) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)] : NaN);
console.log(`\nrecall@5 ${(hits / CASES.length).toFixed(2)}  MRR ${(reciprocal / CASES.length).toFixed(2)}  (${hits}/${CASES.length})`);
console.log(`correct top-1 score: min ${pct(correctTop, 0).toFixed(3)} p10 ${pct(correctTop, 0.1).toFixed(3)} median ${pct(correctTop, 0.5).toFixed(3)}`);
console.log(`wrong top-1 score:   max ${pct(wrongTop, 1).toFixed(3)} p90 ${pct(wrongTop, 0.9).toFixed(3)} median ${pct(wrongTop, 0.5).toFixed(3)}`);
console.log("Pick `accept` between the wrong p90 and the correct p10, and `strong` above the wrong max.");

const since = new Date(Date.now() - 30 * 86400000).toISOString();
const response = await fetch(`${URL_}/rest/v1/food_analyses?select=cache_hit,ai_calls,candidates_count,latency_ms&input_type=eq.text&created_at=gte.${since}`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
});
const rows = response.ok ? ((await response.json()) as Array<{ cache_hit: boolean; ai_calls: number; candidates_count: number; latency_ms: number | null }>) : [];
if (rows.length) {
  const cache = rows.filter((r) => r.cache_hit).length;
  const noAi = rows.filter((r) => !r.cache_hit && r.ai_calls === 0).length;
  const latency = rows.map((r) => r.latency_ms ?? 0);
  console.log(`\nLast 30 days: ${rows.length} text analyses · cache hits ${((cache / rows.length) * 100).toFixed(0)}% · DB-only ${((noAi / rows.length) * 100).toFixed(0)}% · AI ${(((rows.length - cache - noAi) / rows.length) * 100).toFixed(0)}% · median latency ${pct(latency, 0.5)} ms`);
} else {
  console.log("\nNo text analyses logged yet, so there is no cache hit rate to report.");
}
