// Search eval over fitos_food_db/eval_queries.csv through the same gate + match_foods pipeline as logging
// (nutrition-ai action "preview", no AI calls).
// exact / alias / typo / quantity / regional_name: expected_food_id in top 3 (report top-1 and top-3, target top-3 >= 90%).
// hallucination_trap: NO_MATCH (100%). partial_real_word: CLARIFY (100%).
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, EVAL_PASSWORD. Run: npx deno run -A --env-file=.env.local scripts/food_search_eval.ts
import { uuidFor } from "./import_food_db_ids.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const PASSWORD = Deno.env.get("EVAL_PASSWORD") ?? "evalpass123";

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const split = (line: string) => {
    const out: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { out.push(cell); cell = ""; }
      else cell += ch;
    }
    out.push(cell);
    return out.map((c) => c.trim());
  };
  const header = split(lines.shift() ?? "").map((h) => h.toLowerCase());
  return lines.map((l) => Object.fromEntries(split(l).map((c, i) => [header[i], c])));
}

const rows = parseCsv(await Deno.readTextFile(new URL("../fitos_food_db/eval_queries.csv", import.meta.url)));
const email = `fitos.test.search.${Date.now()}@example.com`;
const auth = await (await fetch(`${URL_}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) })).json();
const H = { apikey: ANON, Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json" };
await fetch(`${URL_}/rest/v1/profiles`, { method: "POST", headers: { ...H, Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ id: auth.user.id }) });

const RANKED = ["exact", "alias", "typo", "quantity", "regional_name"];
type Result = { category: string; query: string; ok: boolean; top1: boolean; detail: string };
const results: Result[] = [];
for (const row of rows) {
  const query = row.query ?? row.text ?? "";
  const category = (row.kind ?? row.category ?? row.type ?? "").toLowerCase();
  const expectedRaw = row.expected_food_id ?? row.expected ?? "";
  const r = await fetch(`${URL_}/functions/v1/nutrition-ai`, { method: "POST", headers: H, body: JSON.stringify({ action: "preview", text: query }) });
  const out = await r.json();
  const top = (out.candidates ?? []) as Array<{ food_id: string; external_id: string | null; name: string; tier: string; score: number }>;
  const fmt = top.slice(0, 3).map((c) => `${c.name} [${c.external_id ?? c.food_id}] ${c.score}`).join("; ");
  if (RANKED.includes(category)) {
    const expectedId = expectedRaw ? await uuidFor(expectedRaw) : "";
    const hit = (c: (typeof top)[number]) => c.external_id === expectedRaw || c.food_id === expectedRaw || c.food_id === expectedId;
    const idx = top.findIndex(hit);
    results.push({ category, query, ok: out.status === "OK" && idx >= 0 && idx < 3, top1: idx === 0, detail: `status ${out.status}; expected ${expectedRaw}; top: ${fmt}` });
  } else if (category === "hallucination_trap") {
    results.push({ category, query, ok: out.status === "NO_MATCH", top1: false, detail: `status ${out.status}; top: ${fmt}` });
  } else if (category === "partial_real_word") {
    results.push({ category, query, ok: out.status === "CLARIFY", top1: false, detail: `status ${out.status}; options: ${(out.options ?? []).join(", ")}` });
  }
}

const ranked = results.filter((r) => RANKED.includes(r.category));
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "n/a");
console.log(`## food search eval (${results.length} queries)`);
console.log(`ranked: top-1 ${pct(ranked.filter((r) => r.top1).length, ranked.length)}, top-3 ${pct(ranked.filter((r) => r.ok).length, ranked.length)} (target >= 90%)`);
for (const c of RANKED) {
  const list = ranked.filter((r) => r.category === c);
  if (list.length) console.log(`- ${c}: top-1 ${pct(list.filter((r) => r.top1).length, list.length)}, top-3 ${pct(list.filter((r) => r.ok).length, list.length)}`);
}
for (const c of ["hallucination_trap", "partial_real_word"]) {
  const list = results.filter((r) => r.category === c);
  if (list.length) console.log(`- ${c}: ${pct(list.filter((r) => r.ok).length, list.length)} (target 100%)`);
}
const failures = results.filter((r) => !r.ok);
if (failures.length) {
  console.log("\n### Failures");
  for (const f of failures) console.log(`- [${f.category}] "${f.query}": ${f.detail}`);
}
const pass = ranked.filter((r) => r.ok).length / Math.max(1, ranked.length) >= 0.9 && results.filter((r) => r.category !== "" && !RANKED.includes(r.category)).every((r) => r.ok);
console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"}`);
Deno.exit(pass ? 0 : 1);
