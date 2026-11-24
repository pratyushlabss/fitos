// Food AI accuracy eval against the deployed nutrition-ai function.
// Reports item recall, kcal MAPE and how many cases asked a clarifying question.
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, EVAL_EMAIL, EVAL_PASSWORD (an account used only for evals; created if missing).
// Optional: EVAL_ONLY=text|photo, EVAL_GAP_MS (pause between calls, default 20000 to stay under Groq's per-minute limit).
// Run: deno run -A scripts/food_eval.ts
const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const EMAIL = (Deno.env.get("EVAL_EMAIL") ?? "fitos.test.eval@example.com").replace("@", `.${Date.now()}@`);
const PASSWORD = Deno.env.get("EVAL_PASSWORD")!;
const ONLY = Deno.env.get("EVAL_ONLY") ?? "";
const GAP = Number(Deno.env.get("EVAL_GAP_MS") ?? 20000);
if (!URL_ || !ANON || !PASSWORD) throw new Error("Set SUPABASE_URL, SUPABASE_ANON_KEY, EVAL_PASSWORD (EVAL_EMAIL optional; a fresh address is derived per run)");

type Case = { input?: string; file?: string; items: string[]; kcal: number; protein?: number };
type Item = { name: string; grams: number; per100: { kcal: number; protein_g: number }; ingredients: Array<{ grams: number; per100: { kcal: number; protein_g: number } }> };
const root = new URL("../tests/food-eval/", import.meta.url);
const cases = JSON.parse(await Deno.readTextFile(new URL("cases.json", root))) as { text: Case[]; photos: Case[] };

async function auth(path: string, body: unknown) {
  const r = await fetch(`${URL_}/auth/v1/${path}`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
let session = await auth("token?grant_type=password", { email: EMAIL, password: PASSWORD });
if (!session.access_token) session = await auth("signup", { email: EMAIL, password: PASSWORD });
const token: string = session.access_token;
const userId: string = session.user.id;
const headers = { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
await fetch(`${URL_}/rest/v1/profiles`, { method: "POST", headers: { ...headers, Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ id: userId }) });

const proteinOf = (item: Item) =>
  item.ingredients?.length ? item.ingredients.reduce((s, i) => s + (i.grams * i.per100.protein_g) / 100, 0) : (item.grams * item.per100.protein_g) / 100;
const kcalOf = (item: Item) =>
  item.ingredients?.length ? item.ingredients.reduce((s, i) => s + (i.grams * i.per100.kcal) / 100, 0) : (item.grams * item.per100.kcal) / 100;

async function call(body: Record<string, unknown>) {
  const t = performance.now();
  const r = await fetch(`${URL_}/functions/v1/nutrition-ai`, { method: "POST", headers, body: JSON.stringify(body) });
  const json = await r.json();
  return { status: r.status, json, ms: Math.round(performance.now() - t) };
}

type Row = { kind: string; label: string; ok: boolean; recall: number; kcal: number; expected: number; ape: number; protein: number; pape: number | null; asked: boolean; items: string; ms: number; error?: string };
const rows: Row[] = [];
const date = new Date().toISOString().slice(0, 10);

async function run(kind: "text" | "photo", c: Case) {
  let res;
  if (kind === "text") {
    res = await call({ action: "analyze_text", text: c.input, meal_type: "lunch", date });
  } else {
    const bytes = await Deno.readFile(new URL(`images/${c.file}`, root));
    const ext = c.file!.split(".").pop()!.toLowerCase();
    const path = `${userId}/eval-${c.file}`;
    await fetch(`${URL_}/storage/v1/object/food-photos/${path}`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg", "x-upsert": "true" }, body: bytes });
    res = await call({ action: "analyze_photo", image_path: path, meal_type: "lunch", date });
  }
  const label = kind === "text" ? c.input! : c.file!;
  const draft = res.json?.draft;
  if (res.status !== 200 || !draft) {
    rows.push({ kind, label, ok: false, recall: 0, kcal: 0, expected: c.kcal, ape: 1, protein: 0, pape: null, asked: false, items: "", ms: res.ms, error: res.json?.message ?? `HTTP ${res.status}` });
    return;
  }
  const items = draft.items as Item[];
  const names = items.map((i) => i.name.toLowerCase());
  const found = c.items.filter((want) => names.some((n) => n.includes(want.toLowerCase()) || want.toLowerCase().split(" ").every((w) => n.includes(w))));
  const kcal = Math.round(items.reduce((s, i) => s + kcalOf(i), 0));
  const protein = Math.round(items.reduce((s, i) => s + proteinOf(i), 0) * 10) / 10;
  if (draft.analysis_id) await call({ action: "discard", analysis_id: draft.analysis_id });
  console.error(`done ${rows.length + 1}: ${label}`);
  rows.push({ kind, label, ok: true, recall: c.items.length ? found.length / c.items.length : 1, kcal, expected: c.kcal, ape: Math.abs(kcal - c.kcal) / c.kcal, protein, pape: c.protein ? Math.abs(protein - c.protein) / c.protein : null, asked: Boolean(draft.question), items: items.map((i) => `${i.name} ${Math.round(i.grams)}g ${Math.round(kcalOf(i))}`).join("; "), ms: res.ms });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
if (ONLY !== "photo") for (const c of cases.text) { await run("text", c); await sleep(GAP); }
if (ONLY !== "text") {
  for (const c of cases.photos.filter((p) => p.kcal > 0)) {
    try { await Deno.stat(new URL(`images/${c.file}`, root)); } catch { continue; }
    await run("photo", c);
    await sleep(GAP);
  }
}

for (const kind of ["text", "photo"]) {
  const list = rows.filter((r) => r.kind === kind);
  if (!list.length) continue;
  const okList = list.filter((r) => r.ok);
  const recall = okList.reduce((s, r) => s + r.recall, 0) / Math.max(1, okList.length);
  const mape = okList.reduce((s, r) => s + r.ape, 0) / Math.max(1, okList.length);
  console.log(`\n## ${kind}: ${list.length} cases, ${list.length - okList.length} errors`);
  const pList = okList.filter((r) => r.pape !== null);
  const pmape = pList.reduce((s, r) => s + (r.pape ?? 0), 0) / Math.max(1, pList.length);
  console.log(`item recall ${(recall * 100).toFixed(0)}% | kcal MAPE ${(mape * 100).toFixed(1)}% | protein MAPE ${(pmape * 100).toFixed(1)}% | asked a question ${okList.filter((r) => r.asked).length}/${okList.length}`);
  console.log("| Case | Ref kcal | Got kcal | kcal error | Got protein | Recall | Items |\n|---|---|---|---|---|---|---|");
  for (const r of list) console.log(`| ${r.label} | ${r.expected} | ${r.ok ? r.kcal : "-"} | ${r.ok ? `${Math.round(r.ape * 100)}%` : r.error} | ${r.ok ? r.protein : "-"} | ${Math.round(r.recall * 100)}% | ${r.items} |`);
}
