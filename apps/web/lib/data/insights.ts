import { currentUserId, supabase, unwrap } from "./base";

export type CoachInsight = { id: string; kind: "weekly_review" | "nudge" | "target_change" | "check_in"; title: string; body: string; created_at: string; read_at: string | null };
export type CoachMemory = { id: string; note: string; created_at: string };

// Newest unread insight from the last 8 days (weekly review, nudge, target change or check-in).
export async function latestInsight(): Promise<CoachInsight | null> {
  const since = new Date(Date.now() - 8 * 86400000).toISOString();
  const rows = unwrap(await supabase.from("coach_insights").select("id, kind, title, body, created_at, read_at").is("read_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(1));
  return ((rows ?? []) as CoachInsight[])[0] ?? null;
}

export async function dismissInsight(id: string): Promise<void> {
  unwrap(await supabase.from("coach_insights").update({ read_at: new Date().toISOString() }).eq("id", id));
}

export async function listMemories(): Promise<CoachMemory[]> {
  const userId = await currentUserId();
  return (unwrap(await supabase.from("coach_memory").select("id, note, created_at").eq("user_id", userId).order("created_at", { ascending: false })) ?? []) as CoachMemory[];
}

export async function deleteMemory(id: string): Promise<void> {
  unwrap(await supabase.from("coach_memory").delete().eq("id", id));
}
