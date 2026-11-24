// The single AI provider: Groq (OpenAI-compatible chat completions), plain REST, no SDK.
// Two roles on one key: AI_VISION_MODEL reads photos, AI_TEXT_MODEL reasons over candidates and runs the coach.
// Model ids come only from secrets. Every request passes the call guard (per-user and global daily caps).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  additionalProperties?: boolean;
};

export type ImageInput = { mimeType: string; base64: string };

export type ToolDef = { name: string; description: string; parameters: JsonSchema };
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; raw?: unknown }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ChatResult = { text: string; toolCalls: ToolCall[]; raw: unknown };

export class AiError extends Error {
  constructor(public code: "not_configured" | "limit" | "provider" | "invalid_output", message: string) {
    super(message);
  }
}

const PROVIDER = "groq";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const API_KEY = Deno.env.get("AI_API_KEY") ?? "";
// AI_MODEL is the legacy single-model secret, used only when a role-specific secret is missing.
const VISION_MODEL = Deno.env.get("AI_VISION_MODEL") || Deno.env.get("AI_MODEL") || "";
const TEXT_MODEL = Deno.env.get("AI_TEXT_MODEL") || Deno.env.get("AI_MODEL") || "";
export type Role = "vision" | "text";
const modelFor = (role: Role) => (role === "vision" ? VISION_MODEL : TEXT_MODEL);
const TIMEOUT_MS = 60_000;
const MAX_IMAGES = 3;
// Groq free tier: 8,000 tokens per minute per model. Reasoning tokens count as output, so text gets more room.
const VISION_MAX_TOKENS = envIntRaw("AI_MAX_OUTPUT_TOKENS", 950);
const TEXT_MAX_TOKENS = envIntRaw("AI_TEXT_MAX_OUTPUT_TOKENS", 2400);

function envIntRaw(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const aiInfo = { provider: PROVIDER, model: TEXT_MODEL, visionModel: VISION_MODEL, textModel: TEXT_MODEL, configured: Boolean(API_KEY && VISION_MODEL && TEXT_MODEL) };
// Daily caps reached (ours): nothing more today.
export const PAUSED_MESSAGE = "AI paused for today, use search or manual log.";
// Provider rate limit or timeout: transient.
export const BUSY_MESSAGE = "AI busy, try again or log manually.";

const envInt = (name: string, fallback: number) => {
  const value = Number(Deno.env.get(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export const callLimits = {
  dailyCallCap: envInt("AI_DAILY_CALL_CAP", 300),
  userDailyLimit: 30,
};

// ---------- call guard ----------

type Usage = { tokensIn: number; tokensOut: number };

export type Guard = {
  reserve(model: string): Promise<string>;
  record(id: string, usage: Usage): Promise<void>;
  release(id: string): Promise<void>;
};

// One locked SQL call checks the user's calls today (< 30) and everyone's calls today (< AI_DAILY_CALL_CAP).
export function createGuard(admin: SupabaseClient, userId: string | null, action: string, onCall?: () => void): Guard {
  return {
    async reserve(model) {
      if (!userId) throw new AiError("limit", PAUSED_MESSAGE);
      const { data, error } = await admin.rpc("ai_guard_reserve", {
        p_user: userId,
        p_action: action,
        p_provider: PROVIDER,
        p_model: model,
        p_user_daily_limit: callLimits.userDailyLimit,
        p_global_daily_cap: callLimits.dailyCallCap,
      });
      if (error) {
        console.error("ai guard check failed", error.message);
        throw new AiError("limit", PAUSED_MESSAGE);
      }
      const result = data as { allowed: boolean; reason?: string; usage_id?: string };
      if (!result?.allowed || !result.usage_id) {
        console.warn(`ai guard blocked: ${result?.reason ?? "unknown"} (user ${userId})`);
        throw new AiError("limit", PAUSED_MESSAGE);
      }
      onCall?.();
      return result.usage_id;
    },
    async record(id, usage) {
      const { error } = await admin.rpc("ai_guard_record", { p_id: id, p_tokens_in: usage.tokensIn, p_tokens_out: usage.tokensOut });
      if (error) console.error("ai usage record failed", error.message);
    },
    async release(id) {
      await admin.rpc("ai_guard_release", { p_id: id });
    },
  };
}

// ---------- validation ----------

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

export function validate(value: unknown, schema: JsonSchema, path = "$"): string[] {
  const errors: string[] = [];
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const ok = allowed.some((t) => t === actual || (t === "number" && actual === "integer"));
    if (!ok) return [`${path} should be ${allowed.join("|")}, got ${actual}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
  if (typeOf(value) === "object" && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in obj)) errors.push(`${path}.${key} is required`);
    for (const [key, sub] of Object.entries(schema.properties)) if (key in obj) errors.push(...validate(obj[key], sub, `${path}.${key}`));
  }
  if (typeOf(value) === "array" && schema.items) {
    (value as unknown[]).forEach((item, index) => errors.push(...validate(item, schema.items!, `${path}[${index}]`)));
  }
  return errors.slice(0, 10);
}

// ---------- Groq REST ----------

type GroqMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | Array<Record<string, unknown>>;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

type GroqResponse = {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: GroqMessage["tool_calls"] } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

// Qwen 3 on Groq: reasoning_effort "none" turns thinking off; reasoning_format "hidden" keeps it out of the reply.
function reasoningParams(model: string, thinking: boolean): Record<string, unknown> {
  if (model.startsWith("qwen/")) return thinking ? { reasoning_format: "hidden" } : { reasoning_effort: "none" };
  if (model.startsWith("openai/gpt-oss")) return { reasoning_effort: thinking ? "medium" : "low", include_reasoning: false };
  return {};
}

async function groq(model: string, body: Record<string, unknown>): Promise<GroqResponse & { usage_parsed: Usage }> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", "User-Agent": "FitOS/1.0" },
      body: JSON.stringify({ model, ...body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error("groq request failed", error instanceof Error ? `${error.name}: ${error.message}` : error);
    throw new AiError("limit", BUSY_MESSAGE);
  }
  const text = await response.text();
  if (!response.ok) {
    console.error(`groq ${response.status}`, text.slice(0, 500));
    // Rate limits, quota, overload, gateway timeouts: tell the user, never retry in a loop.
    if ([402, 403, 429, 498, 500, 502, 503, 504].includes(response.status)) throw new AiError("limit", BUSY_MESSAGE);
    throw new AiError("provider", `AI service error (${response.status}).`);
  }
  const parsed = JSON.parse(text) as GroqResponse;
  return { ...parsed, usage_parsed: { tokensIn: Number(parsed.usage?.prompt_tokens ?? 0), tokensOut: Number(parsed.usage?.completion_tokens ?? 0) } };
}

// Runs one provider request inside the guard: reserve, call, record tokens; release if it failed.
async function guarded<R extends { usage_parsed: Usage }>(guard: Guard, model: string, call: () => Promise<R>): Promise<R> {
  const id = await guard.reserve(model);
  let result: R;
  try {
    result = await call();
  } catch (error) {
    await guard.release(id);
    throw error;
  }
  await guard.record(id, result.usage_parsed);
  return result;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// ---------- public interface ----------

// Logging path: JSON mode, schema in the system prompt, light thinking. Validated, retried once.
// Images force the vision model; otherwise the role picks the model.
export async function generateJSON<T>(prompt: string, schema: JsonSchema, images: ImageInput | ImageInput[] | undefined, guard: Guard, role: Role = "text"): Promise<T> {
  const useRole: Role = images ? "vision" : role;
  const model = modelFor(useRole);
  if (!API_KEY || !model) throw new AiError("not_configured", "AI is not set up yet. Log it manually for now.");
  const imageList = (Array.isArray(images) ? images : images ? [images] : []).slice(0, MAX_IMAGES);
  const system =
    "You are a precise nutrition data extractor. Reply with one minified JSON object on a single line, no prose and no extra whitespace, " +
    "that matches this JSON Schema exactly (every required key present, numbers as numbers rounded to 1 decimal, null where allowed, short names):\n" +
    JSON.stringify(schema);
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = feedback ? `${prompt}\n\nYour previous JSON was invalid: ${feedback}\nReturn corrected JSON only.` : prompt;
    const content: Array<Record<string, unknown>> = [{ type: "text", text }];
    for (const image of imageList) content.push({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}` } });
    const result = await guarded(guard, model, () =>
      groq(model, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: imageList.length ? content : text },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_completion_tokens: useRole === "vision" ? VISION_MAX_TOKENS : TEXT_MAX_TOKENS,
        ...reasoningParams(model, false),
      }),
    );
    const raw = result.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      const errors = validate(parsed, schema);
      if (errors.length === 0) return parsed as T;
      feedback = errors.join("; ");
    } catch {
      feedback = "it was not valid JSON";
    }
    console.warn(`ai invalid output (attempt ${attempt + 1}): ${feedback}`);
  }
  throw new AiError("invalid_output", "The AI gave an answer we could not read. Try rephrasing, or log it manually.");
}

// Coach path: the text model with OpenAI-style tools, thinking allowed (hidden from the reply).
export async function chat(system: string, messages: ChatMessage[], tools: ToolDef[], guard: Guard): Promise<ChatResult> {
  const model = TEXT_MODEL;
  if (!API_KEY || !model) throw new AiError("not_configured", "The coach is not set up yet.");
  const out: GroqMessage[] = [{ role: "system", content: system }];
  for (const message of messages) {
    if (message.role === "user") out.push({ role: "user", content: message.content });
    else if (message.role === "tool") out.push({ role: "tool", tool_call_id: message.toolCallId, content: message.content });
    else if (message.raw) out.push(message.raw as GroqMessage);
    else out.push({ role: "assistant", content: message.content });
  }
  const result = await guarded(guard, model, () =>
    groq(model, {
      messages: out,
      tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
      tool_choice: "auto",
      temperature: 0.5,
      max_completion_tokens: TEXT_MAX_TOKENS,
      ...reasoningParams(model, true),
    }),
  );
  const message = result.choices?.[0]?.message ?? {};
  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call) => {
    const args = safeParse(call.function.arguments || "{}");
    return { id: call.id, name: call.function.name, args: typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {} };
  });
  const text = (message.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const raw: GroqMessage = { role: "assistant", content: message.content ?? "", ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
  return { text, toolCalls, raw };
}
