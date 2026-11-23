// One AI provider behind one interface. Chosen by the AI_PROVIDER, AI_API_KEY and AI_MODEL secrets.
// Plain REST, no SDKs. Every request passes the spend guard first and logs tokens and cost after.
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

const PROVIDER = (Deno.env.get("AI_PROVIDER") ?? "gemini").toLowerCase() === "anthropic" ? "anthropic" : "gemini";
const API_KEY = Deno.env.get("AI_API_KEY") ?? "";
const MODEL = Deno.env.get("AI_MODEL") || (PROVIDER === "anthropic" ? "claude-opus-5-5" : "gemini-2.5-flash");
const TIMEOUT_MS = 60_000;

export const aiInfo = { provider: PROVIDER, model: MODEL, configured: Boolean(API_KEY) };

// ---------- spend guard ----------

const envNumber = (name: string, fallback: number) => {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value >= 0 && Deno.env.get(name) !== "" && Deno.env.get(name) !== undefined ? value : fallback;
};

// USD per 1M tokens. Defaults are list prices for the default models; set the secrets to override.
const DEFAULT_PRICES = PROVIDER === "anthropic" ? { in: 4, out: 20 } : { in: 0.3, out: 2.5 };
export const spendLimits = {
  priceInPerM: envNumber("AI_PRICE_IN_PER_M", DEFAULT_PRICES.in),
  priceOutPerM: envNumber("AI_PRICE_OUT_PER_M", DEFAULT_PRICES.out),
  monthlyBudgetUsd: envNumber("AI_MONTHLY_BUDGET_USD", 8),
  dailyCallCap: Math.floor(envNumber("AI_DAILY_CALL_CAP", 300)),
  userDailyLimit: 30,
};

export const PAUSED_MESSAGE = "AI logging paused for today, use search or manual log.";

type Usage = { tokensIn: number; tokensOut: number };

export type Guard = {
  reserve(): Promise<string>;
  record(id: string, usage: Usage): Promise<void>;
  release(id: string): Promise<void>;
};

export function estimateCost(usage: Usage): number {
  return Math.round(((usage.tokensIn / 1e6) * spendLimits.priceInPerM + (usage.tokensOut / 1e6) * spendLimits.priceOutPerM) * 1e6) / 1e6;
}

// Checks run in one locked SQL call: month spend < budget, today's global calls < cap, the user's calls < 30.
export function createGuard(admin: SupabaseClient, userId: string | null, action: string, onCall?: () => void): Guard {
  return {
    async reserve() {
      if (!userId) throw new AiError("limit", PAUSED_MESSAGE);
      const { data, error } = await admin.rpc("ai_guard_reserve", {
        p_user: userId,
        p_action: action,
        p_provider: PROVIDER,
        p_model: MODEL,
        p_user_daily_limit: spendLimits.userDailyLimit,
        p_global_daily_cap: spendLimits.dailyCallCap,
        p_monthly_budget_usd: spendLimits.monthlyBudgetUsd,
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
      const { error } = await admin.rpc("ai_guard_record", { p_id: id, p_tokens_in: usage.tokensIn, p_tokens_out: usage.tokensOut, p_cost_usd: estimateCost(usage) });
      if (error) console.error("ai usage record failed", error.message);
    },
    async release(id) {
      await admin.rpc("ai_guard_release", { p_id: id });
    },
  };
}

function geminiUsage(body: Record<string, unknown>): Usage {
  const meta = (body.usageMetadata ?? {}) as Record<string, number>;
  return { tokensIn: Number(meta.promptTokenCount ?? 0), tokensOut: Number(meta.candidatesTokenCount ?? 0) + Number(meta.thoughtsTokenCount ?? 0) };
}

function anthropicUsage(body: Record<string, unknown>): Usage {
  const usage = (body.usage ?? {}) as Record<string, number>;
  return {
    tokensIn: Number(usage.input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0),
    tokensOut: Number(usage.output_tokens ?? 0),
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

// Gemini's schema dialect has no union types; express ["x","null"] as nullable.
function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const main = types.find((t) => t !== "null") ?? "string";
    out.type = main;
    if (types.includes("null")) out.nullable = true;
  }
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.required = schema.required ?? Object.keys(schema.properties);
    out.propertyOrdering = Object.keys(schema.properties);
  }
  if (schema.items) out.items = toGeminiSchema(schema.items);
  return out;
}

// Anthropic structured outputs need additionalProperties:false on every object.
function toStrictSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...schema };
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toStrictSchema(v)]));
    out.required = schema.required ?? Object.keys(schema.properties);
    out.additionalProperties = false;
  }
  if (schema.items) out.items = toStrictSchema(schema.items);
  return out;
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new AiError("provider", `AI request failed: ${error instanceof Error ? error.message : "network error"}`);
  }
  const text = await response.text();
  if (!response.ok) {
    console.error(`ai ${PROVIDER} ${response.status}`, text.slice(0, 500));
    if (response.status === 402 || response.status === 403) throw new AiError("limit", PAUSED_MESSAGE);
    throw new AiError("provider", response.status === 429 ? "The AI service is busy. Try again in a minute." : `AI service error (${response.status}).`);
  }
  return JSON.parse(text);
}

// ---------- Gemini ----------

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function geminiJSON(prompt: string, schema: JsonSchema, image?: ImageInput): Promise<{ text: string; usage: Usage }> {
  const parts: unknown[] = [{ text: prompt }];
  if (image) parts.unshift({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
  const body = await post(`${GEMINI_BASE}/${MODEL}:generateContent`, { "x-goog-api-key": API_KEY }, {
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: toGeminiSchema(schema), temperature: 0.2 },
  });
  const candidate = (body.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined)?.[0];
  return { text: (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join(""), usage: geminiUsage(body) };
}

async function geminiChat(system: string, messages: ChatMessage[], tools: ToolDef[]): Promise<ChatResult & { usage: Usage }> {
  const contents = messages.map((message) => {
    if (message.role === "user") return { role: "user", parts: [{ text: message.content }] };
    if (message.role === "tool") {
      return { role: "user", parts: [{ functionResponse: { name: message.name, response: { result: safeParse(message.content) } } }] };
    }
    if (message.raw) return message.raw;
    return { role: "model", parts: [{ text: message.content }] };
  });
  const body = await post(`${GEMINI_BASE}/${MODEL}:generateContent`, { "x-goog-api-key": API_KEY }, {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    tools: tools.length ? [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: toGeminiSchema(tool.parameters) })) }] : undefined,
    generationConfig: { temperature: 0.4 },
  });
  const content = (body.candidates as Array<{ content?: { role?: string; parts?: Array<Record<string, unknown>> } }> | undefined)?.[0]?.content;
  const parts = content?.parts ?? [];
  const toolCalls: ToolCall[] = parts
    .filter((part) => part.functionCall)
    .map((part, index) => {
      const call = part.functionCall as { name: string; args?: Record<string, unknown> };
      return { id: `${call.name}-${index}`, name: call.name, args: call.args ?? {} };
    });
  const text = parts.map((part) => (typeof part.text === "string" ? part.text : "")).join("").trim();
  return { text, toolCalls, raw: { role: "model", parts }, usage: geminiUsage(body) };
}

// ---------- Anthropic ----------

const ANTHROPIC_HEADERS = () => ({
  "x-api-key": API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "server-side-fallback-2026-07-01",
});

function anthropicText(body: Record<string, unknown>): string {
  if (body.stop_reason === "refusal") throw new AiError("invalid_output", "The AI declined this request.");
  const content = (body.content as Array<{ type: string; text?: string }> | undefined) ?? [];
  return content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
}

async function anthropicJSON(prompt: string, schema: JsonSchema, image?: ImageInput): Promise<{ text: string; usage: Usage }> {
  const content: unknown[] = [{ type: "text", text: prompt }];
  if (image) content.unshift({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.base64 } });
  const body = await post("https://api.anthropic.com/v1/messages", ANTHROPIC_HEADERS(), {
    model: MODEL,
    max_tokens: 8000,
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: toStrictSchema(schema) } },
    messages: [{ role: "user", content }],
  });
  return { text: anthropicText(body), usage: anthropicUsage(body) };
}

async function anthropicChat(system: string, messages: ChatMessage[], tools: ToolDef[]): Promise<ChatResult & { usage: Usage }> {
  const out: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  for (const message of messages) {
    if (message.role === "user") out.push({ role: "user", content: message.content });
    else if (message.role === "assistant") out.push({ role: "assistant", content: message.raw ?? message.content });
    else {
      const block = { type: "tool_result", tool_use_id: message.toolCallId, content: message.content };
      const last = out.at(-1);
      if (last && last.role === "user" && Array.isArray(last.content)) (last.content as unknown[]).push(block);
      else out.push({ role: "user", content: [block] });
    }
  }
  const body = await post("https://api.anthropic.com/v1/messages", ANTHROPIC_HEADERS(), {
    model: MODEL,
    max_tokens: 4000,
    fallbacks: "default",
    output_config: { effort: "low" },
    system,
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
    messages: out,
  });
  if (body.stop_reason === "refusal") throw new AiError("invalid_output", "The AI declined this request.");
  const content = (body.content as Array<Record<string, unknown>> | undefined) ?? [];
  const toolCalls: ToolCall[] = content
    .filter((block) => block.type === "tool_use")
    .map((block) => ({ id: String(block.id), name: String(block.name), args: (block.input as Record<string, unknown>) ?? {} }));
  const text = content.filter((block) => block.type === "text").map((block) => String(block.text ?? "")).join("").trim();
  return { text, toolCalls, raw: content, usage: anthropicUsage(body) };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// ---------- public interface ----------

// Runs one provider request inside the guard: reserve, call, record tokens; release if nothing was billed.
async function guarded<R extends { usage: Usage }>(guard: Guard, call: () => Promise<R>): Promise<R> {
  const id = await guard.reserve();
  let result: R;
  try {
    result = await call();
  } catch (error) {
    await guard.release(id);
    throw error;
  }
  await guard.record(id, result.usage);
  return result;
}

export async function generateJSON<T>(prompt: string, schema: JsonSchema, image: ImageInput | undefined, guard: Guard): Promise<T> {
  if (!API_KEY) throw new AiError("not_configured", "AI is not set up yet. Log it manually for now.");
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const fullPrompt = feedback ? `${prompt}\n\nYour previous answer was invalid: ${feedback}\nReturn only JSON matching the schema.` : prompt;
    const { text } = await guarded(guard, () => (PROVIDER === "anthropic" ? anthropicJSON(fullPrompt, schema, image) : geminiJSON(fullPrompt, schema, image)));
    try {
      const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
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

export async function chat(system: string, messages: ChatMessage[], tools: ToolDef[], guard: Guard): Promise<ChatResult> {
  if (!API_KEY) throw new AiError("not_configured", "The coach is not set up yet.");
  return guarded(guard, () => (PROVIDER === "anthropic" ? anthropicChat(system, messages, tools) : geminiChat(system, messages, tools)));
}
