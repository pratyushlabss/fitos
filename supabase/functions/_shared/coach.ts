import { chat, chatStream, type ChatMessage, type ToolDef } from "./ai.ts";
import { COACH_PROMPT, TOOL_RULES } from "./coach_prompt.ts";
import { embed, toVector } from "./embed.ts";
import { analyzeText, confirmDraft, type Ctx, type Draft, type DraftItem, localDate, type MealType, macrosFor, type Per100, searchFoods } from "./pipeline.ts";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required }) as ToolDef["parameters"];
const DATE = { type: "string", description: "YYYY-MM-DD" };
const DIET = { type: "string", enum: ["any", "veg", "nonveg"] };
const MEAL = { type: "string", enum: ["breakfast", "lunch", "dinner", "snacks"] };

export const TOOLS: ToolDef[] = [
  { name: "get_day_summary", description: "Exact totals, targets, remaining and logged items for one day.", parameters: obj({ date: DATE }) },
  { name: "get_history", description: "Daily totals between two dates (max 31 days).", parameters: obj({ from: DATE, to: DATE }, ["from", "to"]) },
  { name: "get_workouts", description: "Recent workouts with volume and duration, plus recent PRs.", parameters: obj({ limit: { type: "integer" } }) },
  { name: "get_weight_trend", description: "Weigh-ins over the last 30 days: latest, 7-day average, change per week.", parameters: obj({}) },
  { name: "get_targets", description: "Calorie and macro targets, estimated TDEE, and today's training bonus.", parameters: obj({}) },
  { name: "search_foods", description: "Foods in the database with per-100 g macros and servings.", parameters: obj({ q: { type: "string" } }, ["q"]) },
  { name: "draft_log", description: "Turn food the user ate into a draft. Nothing is saved until confirm_log.", parameters: obj({ text: { type: "string" }, meal_type: MEAL, date: DATE }, ["text"]) },
  { name: "confirm_log", description: "Save a draft after the user said yes in a later message.", parameters: obj({ draft_id: { type: "string" } }, ["draft_id"]) },
  { name: "suggest_meals", description: "3 meal options with exact macros that fit what's left today, from the user's own foods first.", parameters: obj({ meal_type: MEAL, diet: DIET, cuisine: { type: "string" }, kcal: { type: "number", description: "optional kcal budget for this meal" }, protein_g: { type: "number", description: "optional protein to cover" } }) },
  { name: "plan_day", description: "A full day of meals hitting targets within ±5% kcal and ±10 g protein, using foods the user eats.", parameters: obj({ diet: DIET, kcal: { type: "number" }, protein_g: { type: "number" } }) },
  { name: "weekly_review", description: "This week's averages vs targets, adherence, protein days, weight change, training, one win, one focus.", parameters: obj({}) },
  { name: "save_memory", description: "Store a lasting preference the user stated about themselves.", parameters: obj({ note: { type: "string" } }, ["note"]) },
];

export const TOOL_LABELS: Record<string, string> = {
  get_day_summary: "checked today's log",
  get_history: "looked at your history",
  get_workouts: "checked your workouts",
  get_weight_trend: "checked your weight trend",
  get_targets: "checked your targets",
  search_foods: "searched foods",
  draft_log: "drafted a log",
  confirm_log: "logged it",
  suggest_meals: "picked meal options",
  plan_day: "planned a day",
  weekly_review: "reviewed your week",
  save_memory: "saved a note",
};

// ---------- deterministic helpers ----------

const r1 = (x: number) => Math.round(x * 10) / 10;
const num = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const at = (per100: Per100, grams: number): Per100 => ({
  kcal: (per100.kcal * grams) / 100,
  protein_g: (per100.protein_g * grams) / 100,
  carbs_g: (per100.carbs_g * grams) / 100,
  fat_g: (per100.fat_g * grams) / 100,
  fibre_g: (per100.fibre_g * grams) / 100,
});
const sum = (list: Per100[]): Per100 => list.reduce((a, b) => ({ kcal: a.kcal + b.kcal, protein_g: a.protein_g + b.protein_g, carbs_g: a.carbs_g + b.carbs_g, fat_g: a.fat_g + b.fat_g, fibre_g: a.fibre_g + b.fibre_g }), { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 });
const rounded = (m: Per100) => ({ kcal: Math.round(m.kcal), protein_g: r1(m.protein_g), carbs_g: r1(m.carbs_g), fat_g: r1(m.fat_g), fibre_g: r1(m.fibre_g) });

type Profile = { calorie_target: number; protein_target_g: number; carbs_target_g: number; fat_target_g: number; goal: string | null; sex: string | null; birth_year: number | null; tdee_estimate: number | null; height_cm: number | null; timezone: string | null };

async function profileOf(ctx: Ctx): Promise<Profile> {
  const { data } = await ctx.user.from("profiles").select("calorie_target, protein_target_g, carbs_target_g, fat_target_g, goal, sex, birth_year, tdee_estimate, height_cm, timezone").eq("id", ctx.userId!).single();
  return data as Profile;
}

async function trainedMinutesToday(ctx: Ctx, today: string): Promise<number> {
  const { data } = await ctx.user.from("workouts").select("started_at, completed_at").eq("user_id", ctx.userId!).not("completed_at", "is", null).gte("started_at", `${today}T00:00:00`).limit(5);
  return ((data ?? []) as Array<{ started_at: string; completed_at: string }>).reduce((s, w) => s + Math.max(0, (Date.parse(w.completed_at) - Date.parse(w.started_at)) / 60000), 0);
}

async function targets(ctx: Ctx, today: string) {
  const p = await profileOf(ctx);
  const bonus = Math.min(60, Math.round(await trainedMinutesToday(ctx, today)));
  return { kcal: p.calorie_target + bonus * 4, protein_g: p.protein_target_g, carbs_g: p.carbs_target_g + bonus, fat_g: p.fat_target_g, training_bonus_carbs_g: bonus, tdee_estimate: p.tdee_estimate, goal: p.goal };
}

async function daySummary(ctx: Ctx, date: string) {
  const [daily, meals, t] = await Promise.all([
    ctx.user.from("nutrition_daily").select("kcal, protein_g, carbs_g, fat_g, fibre_g").eq("user_id", ctx.userId!).eq("log_date", date).maybeSingle(),
    ctx.user.from("meals").select("meal_type, meal_items(name, amount_grams, calories, protein_g)").eq("user_id", ctx.userId!).eq("log_date", date),
    targets(ctx, date),
  ]);
  const totals = (daily.data ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 }) as Record<string, number>;
  const eaten = { kcal: Math.round(num(totals.kcal)), protein_g: r1(num(totals.protein_g)), carbs_g: r1(num(totals.carbs_g)), fat_g: r1(num(totals.fat_g)), fibre_g: r1(num(totals.fibre_g)) };
  return {
    date,
    eaten,
    targets: { kcal: t.kcal, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g },
    remaining: { kcal: t.kcal - eaten.kcal, protein_g: r1(t.protein_g - eaten.protein_g), carbs_g: r1(t.carbs_g - eaten.carbs_g), fat_g: r1(t.fat_g - eaten.fat_g) },
    meals: ((meals.data ?? []) as Array<{ meal_type: string; meal_items: Array<{ name: string; amount_grams: number; calories: number; protein_g: number }> }>).map((m) => ({
      meal: m.meal_type,
      items: m.meal_items.map((i) => `${i.name} ${Math.round(num(i.amount_grams))}g ${Math.round(num(i.calories))}kcal ${r1(num(i.protein_g))}gP`),
    })),
  };
}

// ---------- food pool for suggestions and plans: the user's foods first, then verified staples ----------

type PoolFood = { food_id: string | null; name: string; per100: Per100; serving: number; uses: number; own: boolean };
const MEAT = /\b(chicken|mutton|lamb|beef|pork|fish|prawn|shrimp|egg|tuna|salmon|bacon|ham|sausage|keema)\b/i;
const STAPLE = /\b(rice|roti|chapati|phulka|paratha|bread|oats|poha|upma|idli|dosa|potato|quinoa|millet|banana|apple|pasta|noodle)\b/i;

async function memoryNotes(ctx: Ctx): Promise<string[]> {
  const { data } = await ctx.user.from("coach_memory").select("note").eq("user_id", ctx.userId!).order("created_at", { ascending: false }).limit(20);
  return ((data ?? []) as Array<{ note: string }>).map((m) => m.note);
}

function dislikes(notes: string[]): RegExp | null {
  const words = notes.flatMap((n) => [...n.matchAll(/\b(?:hate|hates|dislike|dislikes|allergic to|avoid|don't eat|dont eat)\s+([a-z ]{3,20})/gi)].map((m) => m[1].trim().split(" ")[0]));
  const clean = words.map((w) => w.replace(/[^a-z]/gi, "")).filter(Boolean);
  return clean.length ? new RegExp(`\\b(${clean.join("|")})`, "i") : null;
}

function vegToday(notes: string[], timezone: string): boolean {
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: timezone }).format(new Date());
  return notes.some((n) => /\bvegetarian|vegan|\bveg\b/i.test(n) && (!/\bon\s+\w+days?\b/i.test(n) || new RegExp(day, "i").test(n)));
}

async function foodPool(ctx: Ctx, diet: string, cuisine: string | null): Promise<PoolFood[]> {
  const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const [mine, verified, notes, profile] = await Promise.all([
    ctx.user.from("meal_items").select("name, food_id, amount_grams, calories, protein_g, carbs_g, fat_g, fibre_g, meals!inner(user_id, log_date)").eq("meals.user_id", ctx.userId!).gte("meals.log_date", since).gt("amount_grams", 0).limit(400),
    ctx.user.from("foods").select("id, name, cuisine, food_nutrition(calories, protein_g, carbs_g, fat_g, fiber_g), food_servings(grams)").is("owner_id", null).eq("verified", true).limit(200),
    memoryNotes(ctx),
    profileOf(ctx),
  ]);
  const byName = new Map<string, PoolFood & { g: number; m: Per100 }>();
  for (const row of (mine.data ?? []) as Array<Record<string, unknown>>) {
    const key = String(row.name).toLowerCase();
    if (/^(oil|ghee|butter) for /.test(key)) continue;
    const entry = byName.get(key) ?? { food_id: (row.food_id as string) ?? null, name: String(row.name), per100: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 }, serving: 0, uses: 0, own: true, g: 0, m: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 } };
    entry.uses += 1;
    entry.g += num(row.amount_grams);
    entry.m = sum([entry.m, { kcal: num(row.calories), protein_g: num(row.protein_g), carbs_g: num(row.carbs_g), fat_g: num(row.fat_g), fibre_g: num(row.fibre_g) }]);
    byName.set(key, entry);
  }
  const pool: PoolFood[] = [...byName.values()].filter((e) => e.g > 0).map((e) => ({ food_id: e.food_id, name: e.name, per100: at(e.m, 10000 / e.g), serving: e.g / e.uses, uses: e.uses, own: true }));
  for (const f of (verified.data ?? []) as Array<{ id: string; name: string; cuisine: string | null; food_nutrition: Array<Record<string, number>> | Record<string, number>; food_servings: Array<{ grams: number }> }>) {
    if (byName.has(f.name.toLowerCase())) continue;
    const n = Array.isArray(f.food_nutrition) ? f.food_nutrition[0] : f.food_nutrition;
    if (!n) continue;
    if (cuisine && f.cuisine && /indian/i.test(cuisine) !== /indian/i.test(f.cuisine) && !/western/i.test(f.cuisine)) continue;
    pool.push({ food_id: f.id, name: f.name, per100: { kcal: num(n.calories), protein_g: num(n.protein_g), carbs_g: num(n.carbs_g), fat_g: num(n.fat_g), fibre_g: num(n.fiber_g) }, serving: num(f.food_servings?.[0]?.grams) || 100, uses: 0, own: false });
  }
  const veg = diet === "veg" || (diet !== "nonveg" && vegToday(notes, profile?.timezone ?? "UTC"));
  const avoid = dislikes(notes);
  return pool.filter((f) => f.per100.kcal > 0 && (!veg || !MEAT.test(f.name)) && (!avoid || !avoid.test(f.name)));
}

export type Option = { title: string; why: string; items: DraftItem[]; totals: ReturnType<typeof rounded> };

function asItem(f: PoolFood, grams: number, key: string): DraftItem {
  const g = Math.max(5, Math.round(grams / 5) * 5);
  return { key, food_id: f.food_id, name: f.name, is_dish: false, cuisine: null, quantity: g, unit: "g", grams: g, per100: f.per100, source: f.own ? "user" : "verified", own: f.own, confidence: 0.9, match_score: 1, ingredients: [], servings: [] };
}

function optionTotals(items: DraftItem[]) {
  return rounded(sum(items.map((i) => at(i.per100, i.grams))));
}

// A protein source sized to the protein goal, then a staple to fill the kcal budget. Exact maths, no AI.
export function buildOptions(pool: PoolFood[], kcal: number, protein: number, count = 3, avoid: Set<string> = new Set()): Option[] {
  const proteins = pool
    .filter((f) => (f.per100.protein_g * 4) / Math.max(f.per100.kcal, 1) >= 0.22 && !avoid.has(f.name))
    .sort((a, b) => Number(b.own) - Number(a.own) || b.uses - a.uses || b.per100.protein_g / b.per100.kcal - a.per100.protein_g / a.per100.kcal);
  const staples = pool.filter((f) => STAPLE.test(f.name) && !avoid.has(f.name)).sort((a, b) => Number(b.own) - Number(a.own) || b.uses - a.uses);
  const options: Option[] = [];
  for (const p of proteins) {
    if (options.length >= count) break;
    const gP = Math.min(Math.max((protein * 0.8 * 100) / Math.max(p.per100.protein_g, 1), p.serving * 0.5), p.serving * 3, (kcal * 0.85 * 100) / Math.max(p.per100.kcal, 1));
    const items = [asItem(p, gP, `o${options.length}a`)];
    const left = kcal - at(p.per100, items[0].grams).kcal;
    const s = staples.find((x) => x.name !== p.name && !options.some((o) => o.items[1]?.name === x.name)) ?? staples.find((x) => x.name !== p.name);
    if (s && left > 80) items.push(asItem(s, Math.min((left * 100) / Math.max(s.per100.kcal, 1), s.serving * 3), `o${options.length}b`));
    const totals = optionTotals(items);
    options.push({ title: items.map((i) => i.name).join(" + "), why: `${p.own ? `You eat ${p.name} often` : `${p.name} is protein-dense`}; ${Math.round(totals.protein_g)} g protein for ${totals.kcal} kcal.`, items, totals });
  }
  return options;
}

const MEAL_SHARE: Record<MealType, number> = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snacks: 0.1 };

export function planDay(pool: PoolFood[], kcal: number, protein: number) {
  const used = new Set<string>();
  const meals = (Object.keys(MEAL_SHARE) as MealType[]).map((meal) => {
    const option = buildOptions(pool, kcal * MEAL_SHARE[meal], protein * MEAL_SHARE[meal], 1, used)[0];
    option?.items.forEach((i) => used.add(i.name));
    return { meal, items: option?.items ?? [] };
  });
  // Scale portions until kcal is within 5% and protein within 10 g.
  for (let round = 0; round < 10; round += 1) {
    const all = meals.flatMap((m) => m.items);
    if (!all.length) break;
    const proteinItems = all.filter((i) => (i.per100.protein_g * 4) / Math.max(i.per100.kcal, 1) >= 0.22);
    const t = sum(all.map((i) => at(i.per100, i.grams)));
    if (Math.abs(t.protein_g - protein) > 8 && proteinItems.length) {
      const pp = sum(proteinItems.map((i) => at(i.per100, i.grams))).protein_g;
      const k = Math.min(1.6, Math.max(0.6, 1 + (protein - t.protein_g) / Math.max(pp, 1)));
      proteinItems.forEach((i) => (i.grams = i.quantity = Math.max(5, Math.round((i.grams * k) / 5) * 5)));
    }
    const t2 = sum(all.map((i) => at(i.per100, i.grams)));
    const others = all.filter((i) => !proteinItems.includes(i));
    if (Math.abs(t2.kcal - kcal) / kcal > 0.04 && others.length) {
      const otherKcal = sum(others.map((i) => at(i.per100, i.grams))).kcal;
      const k = Math.min(2, Math.max(0.3, 1 + (kcal - t2.kcal) / Math.max(otherKcal, 1)));
      others.forEach((i) => (i.grams = i.quantity = Math.max(5, Math.round((i.grams * k) / 5) * 5)));
    }
  }
  const totals = optionTotals(meals.flatMap((m) => m.items));
  return { meals: meals.map((m) => ({ ...m, totals: optionTotals(m.items) })), totals, within: { kcal: Math.abs(totals.kcal - kcal) / kcal <= 0.05, protein: Math.abs(totals.protein_g - protein) <= 10 } };
}

// ---------- tools ----------

export type Card = { kind: "options" | "plan" | "review"; title: string; options?: Option[]; plan?: ReturnType<typeof planDay>; body?: string };
type ToolOutput = { result: unknown; draft?: Draft; card?: Card };

function defaultMeal(timezone: string): MealType {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: timezone }).format(new Date()));
  return hour < 11 ? "breakfast" : hour < 15 ? "lunch" : hour < 18 ? "snacks" : "dinner";
}

async function weightTrend(ctx: Ctx) {
  const { data } = await ctx.user.from("body_measurements").select("measured_at, weight_kg").eq("user_id", ctx.userId!).not("weight_kg", "is", null).gte("measured_at", new Date(Date.now() - 30 * 86400000).toISOString()).order("measured_at");
  const rows = ((data ?? []) as Array<{ measured_at: string; weight_kg: number }>).map((r) => ({ t: Date.parse(r.measured_at) / 86400000, w: num(r.weight_kg) }));
  if (!rows.length) return { weigh_ins: 0, latest_kg: null, avg_7d_kg: null, change_kg_per_week: null };
  const last7 = rows.filter((r) => r.t >= rows[rows.length - 1].t - 7);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  let slope = 0;
  if (rows.length >= 2) {
    const mt = mean(rows.map((r) => r.t));
    const mw = mean(rows.map((r) => r.w));
    slope = rows.reduce((s, r) => s + (r.t - mt) * (r.w - mw), 0) / Math.max(rows.reduce((s, r) => s + (r.t - mt) ** 2, 0), 1e-9);
  }
  return { weigh_ins: rows.length, latest_kg: rows[rows.length - 1].w, avg_7d_kg: r1(mean(last7.map((r) => r.w))), change_kg_per_week: Math.round(slope * 7 * 100) / 100 };
}

async function runTool(ctx: Ctx, name: string, args: Record<string, unknown>, today: string): Promise<ToolOutput> {
  const user = ctx.user;
  const uid = ctx.userId!;
  const date = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : today);
  switch (name) {
    case "get_day_summary":
      return { result: await daySummary(ctx, date(args.date)) };
    case "get_history": {
      const { data } = await user.from("nutrition_daily").select("log_date, kcal, protein_g").eq("user_id", uid).gte("log_date", date(args.from)).lte("log_date", date(args.to)).order("log_date").limit(31);
      return { result: (data ?? []).map((d: Record<string, unknown>) => ({ date: d.log_date, kcal: Math.round(num(d.kcal)), protein_g: r1(num(d.protein_g)) })) };
    }
    case "get_workouts": {
      const [w, prs] = await Promise.all([
        user.from("workouts").select("title, started_at, completed_at, total_volume_kg").eq("user_id", uid).not("completed_at", "is", null).order("started_at", { ascending: false }).limit(Math.min(10, num(args.limit) || 5)),
        user.from("personal_records").select("exercise_name, record_type, value, achieved_at").eq("user_id", uid).order("achieved_at", { ascending: false }).limit(5),
      ]);
      return { result: { workouts: (w.data ?? []).map((x: Record<string, unknown>) => ({ title: x.title, date: String(x.started_at).slice(0, 10), minutes: Math.round((Date.parse(String(x.completed_at)) - Date.parse(String(x.started_at))) / 60000), volume_kg: Math.round(num(x.total_volume_kg)) })), recent_prs: prs.data ?? [] } };
    }
    case "get_weight_trend":
      return { result: await weightTrend(ctx) };
    case "get_targets":
      return { result: await targets(ctx, today) };
    case "search_foods": {
      const results = await searchFoods(ctx, String(args.q ?? ""), null, 5);
      return { result: results.map((r) => ({ name: r.name, per100g: { kcal: r.kcal, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g }, source: r.source })) };
    }
    case "draft_log": {
      const mealType = (["breakfast", "lunch", "dinner", "snacks"].includes(String(args.meal_type)) ? args.meal_type : defaultMeal(ctx.timezone)) as MealType;
      const draft = await analyzeText(ctx, String(args.text ?? ""), { meal_type: mealType, date: date(args.date) });
      if (draft.status === "clarify") return { result: { status: "clarify", question: draft.question, options: draft.options } };
      if (draft.status === "no_match") return { result: { status: "unknown_food", message: draft.message, offer: "manual entry or describe the ingredients" } };
      const items = draft.items.map((item) => ({ name: item.name, grams: Math.round(item.grams), ...rounded(macrosFor(item)) }));
      return { result: { draft_id: draft.analysis_id, meal_type: mealType, items, total: rounded(sum(draft.items.map(macrosFor))), question: draft.question ?? draft.quick_question?.text ?? null }, draft };
    }
    case "confirm_log": {
      const { data } = await user.from("food_analyses").select("id, draft, status").eq("id", String(args.draft_id ?? "")).eq("user_id", uid).maybeSingle();
      if (!data) return { result: { error: "Draft not found." } };
      if (data.status !== "pending") return { result: { error: "That draft was already saved or discarded." } };
      const draft = data.draft as Draft;
      const saved = await confirmDraft(ctx, { analysis_id: String(data.id), meal_type: draft.meal_type ?? "snacks", date: draft.date ?? today, source: "chat", items: draft.items });
      return { result: { saved: saved.logged, meal_type: draft.meal_type, date: draft.date } };
    }
    case "suggest_meals": {
      const summary = await daySummary(ctx, today);
      const meal = (["breakfast", "lunch", "dinner", "snacks"].includes(String(args.meal_type)) ? args.meal_type : defaultMeal(ctx.timezone)) as MealType;
      const kcal = num(args.kcal) || Math.max(200, Math.min(summary.remaining.kcal, summary.targets.kcal * MEAL_SHARE[meal] * 1.3));
      const protein = num(args.protein_g) || Math.max(10, Math.min(summary.remaining.protein_g, 50));
      const options = buildOptions(await foodPool(ctx, String(args.diet ?? "any"), (args.cuisine as string) ?? null), kcal, protein);
      return { result: { meal_type: meal, budget: { kcal: Math.round(kcal), protein_g: Math.round(protein) }, options: options.map((o) => ({ title: o.title, why: o.why, items: o.items.map((i) => `${i.name} ${i.grams}g`), totals: o.totals })) }, card: { kind: "options", title: `Options for ${meal}`, options } };
    }
    case "plan_day": {
      const t = await targets(ctx, today);
      const kcal = num(args.kcal) || t.kcal;
      const protein = num(args.protein_g) || t.protein_g;
      const plan = planDay(await foodPool(ctx, String(args.diet ?? "any"), null), kcal, protein);
      return {
        result: { target: { kcal, protein_g: protein }, totals: plan.totals, within_targets: plan.within, meals: plan.meals.map((m) => ({ meal: m.meal, items: m.items.map((i) => `${i.name} ${i.grams}g`), totals: m.totals })) },
        card: { kind: "plan", title: "Day plan", plan },
      };
    }
    case "weekly_review": {
      const { data } = await user.rpc("my_weekly_review");
      const review = ((data ?? []) as Array<{ body: string; data: unknown }>)[0];
      return review ? { result: { review: review.body, data: review.data }, card: { kind: "review", title: "Your week", body: review.body } } : { result: { review: null, note: "No logged days this week yet." } };
    }
    case "save_memory": {
      const note = String(args.note ?? "").trim().slice(0, 280);
      if (!note) return { result: { error: "Empty note." } };
      await user.from("coach_memory").insert({ user_id: uid, note, embedding: toVector(await embed(note)) });
      return { result: { saved: note } };
    }
    default:
      return { result: { error: `Unknown tool ${name}` } };
  }
}

// ---------- compact context (well under ~1,500 tokens) ----------

async function contextBlock(ctx: Ctx, message: string, today: string): Promise<string> {
  const uid = ctx.userId!;
  const vector = await embed(message);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const [p, summary, days, workouts, weight, streak, memory, foods, favourites] = await Promise.all([
    profileOf(ctx),
    daySummary(ctx, today),
    ctx.user.from("nutrition_daily").select("log_date, kcal, protein_g").eq("user_id", uid).gte("log_date", weekAgo).lt("log_date", today).order("log_date"),
    ctx.user.from("workouts").select("title, started_at, total_volume_kg").eq("user_id", uid).not("completed_at", "is", null).order("started_at", { ascending: false }).limit(5),
    weightTrend(ctx),
    ctx.user.rpc("get_streak", { p_user: uid }),
    ctx.user.rpc("match_coach_memory", { query_embedding: toVector(vector), k: 5 }),
    searchFoods(ctx, message, null, 5).catch(() => []),
    ctx.user.from("favourite_meals").select("name").eq("user_id", uid).limit(5),
  ]);
  const age = p.birth_year ? new Date().getFullYear() - p.birth_year : null;
  const lines = [
    `Today ${today}. Goal ${p.goal ?? "general"}${p.sex ? `, ${p.sex}` : ""}${age ? `, ${age}y` : ""}${weight.weigh_ins ? `, ${weight.latest_kg} kg (${weight.change_kg_per_week} kg/week)` : ""}.`,
    `Targets: ${summary.targets.kcal} kcal, P${summary.targets.protein_g} C${summary.targets.carbs_g} F${summary.targets.fat_g}${p.tdee_estimate ? `; estimated TDEE ${p.tdee_estimate}` : ""}.`,
    `Today so far: ${summary.eaten.kcal} kcal, P${summary.eaten.protein_g}. Left: ${summary.remaining.kcal} kcal, P${summary.remaining.protein_g}.`,
  ];
  const week = (days.data ?? []) as Array<{ log_date: string; kcal: number; protein_g: number }>;
  if (week.length) lines.push(`Last 7 days: ${week.map((d) => `${d.log_date.slice(5)} ${Math.round(num(d.kcal))}/${Math.round(num(d.protein_g))}P`).join(", ")}.`);
  const w = (workouts.data ?? []) as Array<{ title: string; started_at: string; total_volume_kg: number }>;
  if (w.length) lines.push(`Recent workouts: ${w.map((x) => `${x.started_at.slice(5, 10)} ${x.title} ${Math.round(num(x.total_volume_kg))}kg`).join("; ")}.`);
  lines.push(`Streak: ${num(streak.data)} days.`);
  const notes = ((memory.data ?? []) as Array<{ note: string }>).map((m) => m.note);
  if (notes.length) lines.push(`About the user: ${notes.join("; ")}.`);
  const favs = ((favourites.data ?? []) as Array<{ name: string }>).map((f) => f.name);
  if (favs.length) lines.push(`Favourite meals: ${favs.join(", ")}.`);
  if (foods.length) lines.push(`Foods matching the message: ${foods.map((f) => `${f.name} ${Math.round(num(f.kcal))}kcal/100g`).join(", ")}.`);
  return lines.join("\n");
}

// ---------- the loop ----------

export type CoachEvent = { type: "tool"; name: string; label: string } | { type: "delta"; text: string };
export type CoachResult = { reply: string; drafts: Draft[]; cards: Card[]; tools_used: string[]; logged: number };

export async function coachReply(ctx: Ctx, message: string, onEvent?: (event: CoachEvent) => void): Promise<CoachResult> {
  const uid = ctx.userId!;
  const text = message.trim().slice(0, 1000);
  const today = localDate(ctx.timezone);
  const { data: history } = await ctx.user.from("coach_messages").select("role, content").eq("user_id", uid).in("role", ["user", "assistant"]).order("created_at", { ascending: false }).limit(6);
  const past: ChatMessage[] = ((history ?? []) as Array<{ role: "user" | "assistant"; content: string }>).reverse().map((m) => ({ role: m.role, content: m.content }) as ChatMessage);
  const system = `${COACH_PROMPT}\n\n${TOOL_RULES}\n\nContext:\n${await contextBlock(ctx, text, today)}`;

  const messages: ChatMessage[] = [...past, { role: "user", content: text }];
  const drafts: Draft[] = [];
  const cards: Card[] = [];
  const toolsUsed: string[] = [];
  let logged = 0;
  let reply = "";
  for (let round = 0; round < 5; round += 1) {
    const result = onEvent ? await chatStream(system, messages, TOOLS, ctx.guard, (delta) => onEvent({ type: "delta", text: delta })) : await chat(system, messages, TOOLS, ctx.guard);
    if (!result.toolCalls.length) {
      reply = result.text;
      break;
    }
    messages.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls, raw: result.raw });
    for (const call of result.toolCalls) {
      toolsUsed.push(call.name);
      onEvent?.({ type: "tool", name: call.name, label: TOOL_LABELS[call.name] ?? call.name });
      let output: ToolOutput;
      try {
        output = await runTool(ctx, call.name, call.args, today);
      } catch (error) {
        output = { result: { error: error instanceof Error ? error.message : "Tool failed" } };
      }
      if (output.draft) drafts.push(output.draft);
      if (output.card) cards.push(output.card);
      if (call.name === "confirm_log") logged += num((output.result as { saved?: number }).saved);
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(output.result).slice(0, 2500) });
    }
  }
  if (!reply) reply = drafts.length ? "Here's the draft. Log this?" : "Sorry, I couldn't finish that. Try asking again.";
  await ctx.user.from("coach_messages").insert([
    { user_id: uid, role: "user", content: text },
    { user_id: uid, role: "assistant", content: reply, tool_calls: toolsUsed.length ? toolsUsed : null },
  ]);
  return { reply, drafts, cards, tools_used: toolsUsed, logged };
}
