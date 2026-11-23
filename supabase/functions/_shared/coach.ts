import { chat, type ChatMessage, type ToolDef } from "./ai.ts";
import { embed, toVector } from "./embed.ts";
import { analyzeText, confirmDraft, type Ctx, type Draft, localDate, type MealType, macrosFor, searchFoods } from "./pipeline.ts";

const TOOLS: ToolDef[] = [
  {
    name: "get_day_summary",
    description: "Exact totals, goals and logged items for one day (YYYY-MM-DD). Use for 'what did I eat', 'calories left'.",
    parameters: { type: "object", properties: { date: { type: "string" } }, required: ["date"] },
  },
  {
    name: "get_history",
    description: "Daily totals between two dates inclusive (max 31 days).",
    parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
  },
  {
    name: "search_foods",
    description: "Look up foods in the database with per-100 g macros and servings.",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  },
  {
    name: "draft_log",
    description: "Turn a description of food into a draft. Nothing is saved. Always show the draft and ask the user to confirm.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" }, meal_type: { type: "string", enum: ["breakfast", "lunch", "dinner", "snacks"] }, date: { type: "string" } },
      required: ["text", "meal_type", "date"],
    },
  },
  {
    name: "confirm_log",
    description: "Save a draft created earlier. Only call after the user has clearly said yes to that draft in a later message.",
    parameters: { type: "object", properties: { draft_id: { type: "string" } }, required: ["draft_id"] },
  },
  {
    name: "get_goals",
    description: "The user's daily calorie and macro goals.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "remember_note",
    description: "Store a short lasting preference the user stated about themselves, e.g. 'vegetarian', 'cooks with coconut oil'.",
    parameters: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
  },
];

type ToolOutput = { result: unknown; draft?: Draft };

async function runTool(ctx: Ctx, name: string, args: Record<string, unknown>): Promise<ToolOutput> {
  const user = ctx.user;
  const uid = ctx.userId!;
  switch (name) {
    case "get_day_summary": {
      const date = String(args.date ?? localDate(ctx.timezone));
      const [daily, meals, goals] = await Promise.all([
        user.from("nutrition_daily").select("kcal, protein_g, carbs_g, fat_g, fibre_g, per_meal").eq("user_id", uid).eq("log_date", date).maybeSingle(),
        user.from("meals").select("meal_type, meal_items(name, amount_grams, calories, protein_g)").eq("user_id", uid).eq("log_date", date),
        user.from("nutrition_goals").select("kcal, protein_g, carbs_g, fat_g").maybeSingle(),
      ]);
      return { result: { date, totals: daily.data ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 }, goals: goals.data, meals: meals.data ?? [] } };
    }
    case "get_history": {
      const from = String(args.from ?? "");
      const to = String(args.to ?? "");
      const { data } = await user.from("nutrition_daily").select("log_date, kcal, protein_g, carbs_g, fat_g").eq("user_id", uid).gte("log_date", from).lte("log_date", to).order("log_date").limit(31);
      return { result: data ?? [] };
    }
    case "search_foods": {
      const results = await searchFoods(ctx, String(args.q ?? ""), null, 5);
      return { result: results.map((r) => ({ name: r.name, per100g: { kcal: r.kcal, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g }, servings: r.servings.slice(0, 4), source: r.source })) };
    }
    case "draft_log": {
      const mealType = (["breakfast", "lunch", "dinner", "snacks"].includes(String(args.meal_type)) ? args.meal_type : "snacks") as MealType;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date)) ? String(args.date) : localDate(ctx.timezone);
      const draft = await analyzeText(ctx, String(args.text ?? ""), { meal_type: mealType, date });
      const items = draft.items.map((item) => ({ name: item.name, grams: item.grams, ...macrosFor(item) }));
      return { result: { draft_id: draft.analysis_id, meal_type: mealType, date, items, question: draft.question }, draft };
    }
    case "confirm_log": {
      const { data } = await user.from("food_analyses").select("id, draft, status").eq("id", String(args.draft_id ?? "")).eq("user_id", uid).maybeSingle();
      if (!data) return { result: { error: "Draft not found." } };
      if (data.status !== "pending") return { result: { error: "That draft was already saved or discarded." } };
      const draft = data.draft as Draft;
      const saved = await confirmDraft(ctx, {
        analysis_id: String(data.id),
        meal_type: draft.meal_type ?? "snacks",
        date: draft.date ?? localDate(ctx.timezone),
        source: "chat",
        items: draft.items,
      });
      return { result: { saved: saved.logged, meal_type: draft.meal_type, date: draft.date } };
    }
    case "get_goals": {
      const { data } = await user.from("nutrition_goals").select("kcal, protein_g, carbs_g, fat_g").maybeSingle();
      return { result: data };
    }
    case "remember_note": {
      const note = String(args.note ?? "").trim().slice(0, 280);
      if (!note) return { result: { error: "Empty note." } };
      await user.from("coach_memory").insert({ user_id: uid, note, embedding: toVector(await embed(note)) });
      return { result: { remembered: note } };
    }
    default:
      return { result: { error: `Unknown tool ${name}` } };
  }
}

// RAG context: what this user means by "my usual", "that paneer thing", and how they cook.
async function contextBlock(ctx: Ctx, message: string, today: string): Promise<string> {
  const uid = ctx.userId!;
  const vector = await embed(message);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const [foods, favourites, corrections, days, memory] = await Promise.all([
    searchFoods(ctx, message, null, 6).catch(() => []),
    ctx.user.from("favourite_meals").select("name, meal_type, favourite_meal_items(name, grams, calories, protein_g)").eq("user_id", uid).order("created_at", { ascending: false }).limit(5),
    ctx.user.from("user_corrections").select("created_at, original_payload, corrected_payload").eq("user_id", uid).order("created_at", { ascending: false }).limit(5),
    ctx.user.from("nutrition_daily").select("log_date, kcal, protein_g, carbs_g, fat_g").eq("user_id", uid).gte("log_date", weekAgo).order("log_date"),
    ctx.user.rpc("match_coach_memory", { query_embedding: toVector(vector), k: 5 }),
  ]);
  const lines: string[] = [`Today is ${today}.`];
  const notes = ((memory.data ?? []) as Array<{ note: string }>).map((m) => m.note);
  if (notes.length) lines.push(`About the user: ${notes.join("; ")}`);
  const favs = (favourites.data ?? []) as Array<{ name: string; meal_type: string | null; favourite_meal_items: Array<{ name: string; grams: number; calories: number; protein_g: number }> }>;
  if (favs.length) {
    lines.push(
      "Favourite meals: " +
        favs
          .map((f) => `${f.name}${f.meal_type ? ` (${f.meal_type})` : ""}: ${f.favourite_meal_items.map((i) => `${i.name} ${i.grams}g ${i.calories}kcal ${i.protein_g}gP`).join(", ")}`)
          .join(" | "),
    );
  }
  const corr = (corrections.data ?? []) as Array<{ original_payload: { name?: string; grams?: number }; corrected_payload: { name?: string; grams?: number; removed?: boolean; ingredients?: Array<{ name: string; grams: number }> } }>;
  if (corr.length) {
    lines.push(
      "Recent corrections: " +
        corr
          .map((c) => (c.corrected_payload.removed ? `removed ${c.original_payload.name}` : `${c.corrected_payload.name}: ${c.original_payload.grams ?? "?"}g -> ${c.corrected_payload.grams}g${c.corrected_payload.ingredients?.length ? ` (${c.corrected_payload.ingredients.map((i) => `${i.name} ${i.grams}g`).join(", ")})` : ""}`))
          .join("; "),
    );
  }
  const week = (days.data ?? []) as Array<{ log_date: string; kcal: number; protein_g: number }>;
  if (week.length) lines.push("Last 7 days: " + week.map((d) => `${d.log_date} ${Math.round(d.kcal)}kcal ${Math.round(d.protein_g)}gP`).join(", "));
  if (foods.length) lines.push("Possibly relevant foods: " + foods.map((f) => `${f.name} (${Math.round(Number(f.kcal ?? 0))} kcal/100g${f.is_own ? ", theirs" : ""})`).join(", "));
  return lines.join("\n");
}

export async function coachReply(ctx: Ctx, message: string): Promise<{ reply: string; drafts: Draft[] }> {
  const uid = ctx.userId!;
  const text = message.trim().slice(0, 1000);
  const today = localDate(ctx.timezone);
  const { data: history } = await ctx.user.from("coach_messages").select("role, content").eq("user_id", uid).in("role", ["user", "assistant"]).order("created_at", { ascending: false }).limit(12);
  const past: ChatMessage[] = ((history ?? []) as Array<{ role: "user" | "assistant"; content: string }>).reverse().map((m) => ({ role: m.role, content: m.content }) as ChatMessage);
  const system = `You are the FitOS nutrition coach. Be brief and friendly: 1-3 short sentences or a tiny list.
Use tools for exact numbers; never guess totals. Dates are YYYY-MM-DD in the user's timezone.
To log food: call draft_log, show the items with calories, and ask "Shall I log this?". Only call confirm_log after the user says yes in a later message.
When the user states a lasting preference about how they eat or cook, call remember_note.
You can only see this user's data.

Context:
${await contextBlock(ctx, text, today)}`;

  const messages: ChatMessage[] = [...past, { role: "user", content: text }];
  const drafts: Draft[] = [];
  const toolLog: Array<{ name: string; args: unknown }> = [];
  let reply = "";
  for (let round = 0; round < 5; round += 1) {
    const result = await chat(system, messages, TOOLS, ctx.meter);
    if (!result.toolCalls.length) {
      reply = result.text;
      break;
    }
    messages.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls, raw: result.raw });
    for (const call of result.toolCalls) {
      toolLog.push({ name: call.name, args: call.args });
      let output: ToolOutput;
      try {
        output = await runTool(ctx, call.name, call.args);
      } catch (error) {
        output = { result: { error: error instanceof Error ? error.message : "Tool failed" } };
      }
      if (output.draft) drafts.push(output.draft);
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(output.result).slice(0, 6000) });
    }
  }
  if (!reply) reply = drafts.length ? "Here's the draft. Shall I log this?" : "Sorry, I couldn't finish that. Try asking again.";
  await ctx.user.from("coach_messages").insert([
    { user_id: uid, role: "user", content: text },
    { user_id: uid, role: "assistant", content: reply, tool_calls: toolLog.length ? toolLog : null },
  ]);
  return { reply, drafts };
}
