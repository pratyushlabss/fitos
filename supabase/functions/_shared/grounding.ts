// Server-side grounding for coach replies: every nutrition number must trace to this turn's tool results.

export function collectFacts(value: unknown, facts: number[], estimates: Set<string>): void {
  if (typeof value === "number" && Number.isFinite(value)) facts.push(value);
  else if (typeof value === "string") {
    const m = value.match(/^(.*) \(estimate\)$/);
    if (m) estimates.add(m[1]);
  } else if (Array.isArray(value)) value.forEach((v) => collectFacts(v, facts, estimates));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectFacts(v, facts, estimates));
}

const NUM_UNIT = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(kcal|calories|cal\b|g\b|grams?\b|mg\b|mcg\b|µg|ug\b)/gi;

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.6, Math.abs(b) * 0.01);
}

// Numbers next to nutrition units that no tool produced (sums and differences of two facts are allowed).
export function untracedNumbers(reply: string, facts: number[], userText: string): string[] {
  const userNums = new Set((userText.match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
  const uniq = [...new Set(facts.map((f) => Math.round(f * 100) / 100))].slice(0, 400);
  const out: string[] = [];
  for (const m of reply.matchAll(NUM_UNIT)) {
    const v = Number(m[1].replace(/,/g, ""));
    if (userNums.has(v)) continue;
    if (uniq.some((f) => close(v, f))) continue;
    let ok = false;
    for (let i = 0; i < uniq.length && !ok; i += 1) for (let j = i + 1; j < uniq.length && !ok; j += 1) ok = close(v, uniq[i] + uniq[j]) || close(v, Math.abs(uniq[i] - uniq[j]));
    if (!ok) out.push(m[0]);
  }
  return out;
}

export function stripNumbers(reply: string, untraced: string[]): string {
  let out = reply;
  for (const u of untraced) out = out.replace(u, "").replace(/\(\s*\)/g, "");
  return `${out.replace(/[ \t]{2,}/g, " ").trim()}\n\nLet me check that with your log before giving numbers.`;
}

// Community and ai_estimate foods carry "(estimate)" wherever they're named.
export function tagEstimates(reply: string, names: Set<string>): string {
  let out = reply;
  for (const name of names) {
    const base = name.split(",")[0].trim();
    if (base.length < 3) continue;
    const re = new RegExp(`(${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?!\\s*\\(estimate\\))`, "i");
    out = out.replace(re, "$1 (estimate)");
  }
  return out;
}
