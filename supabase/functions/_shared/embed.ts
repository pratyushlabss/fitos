// gte-small (384 dims) runs inside the Supabase Edge Runtime: no API key, no external call.
type EmbeddingSession = { run(input: string, options: { mean_pool: boolean; normalize: boolean }): Promise<unknown> };
declare const Supabase: { ai: { Session: new (model: string) => EmbeddingSession } };

let session: EmbeddingSession | null = null;

export async function embed(text: string): Promise<number[]> {
  session ??= new Supabase.ai.Session("gte-small");
  const output = await session.run(text.slice(0, 2000), { mean_pool: true, normalize: true });
  return Array.from(output as ArrayLike<number>);
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) results.push(await embed(text));
  return results;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

// PostgREST accepts pgvector input as its text form.
export function toVector(values: number[]): string {
  return `[${values.map((value) => Number(value.toFixed(6))).join(",")}]`;
}
