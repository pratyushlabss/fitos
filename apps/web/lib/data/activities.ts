import type { Activity, ActivitySource, ActivitySport, GeoPoint, Visibility } from "@fitos/types";

import { currentUserId, num, numOrNull, supabase, unwrap } from "./base";

function toActivity(row: Record<string, unknown>): Activity {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    sport: row.sport as ActivitySport,
    source: row.source as ActivitySource,
    started_at: String(row.started_at),
    ended_at: (row.ended_at as string | null) ?? null,
    duration_s: num(row.duration_s),
    distance_m: num(row.distance_m),
    elevation_gain_m: num(row.elevation_gain_m),
    avg_pace_s_per_km: numOrNull(row.avg_pace_s_per_km),
    polyline: (row.polyline as GeoPoint[] | null) ?? [],
    visibility: (row.visibility as Visibility) ?? "private",
    title: (row.title as string | null) ?? null,
  };
}

export async function listActivities(options: { limit?: number; since?: string } = {}): Promise<Activity[]> {
  const userId = await currentUserId();
  let query = supabase
    .from("activities")
    .select("*")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(options.limit ?? 30);
  if (options.since) query = query.gte("started_at", options.since);
  return (unwrap(await query) ?? []).map(toActivity);
}

export async function getActivity(id: string): Promise<Activity | null> {
  const row = unwrap(await supabase.from("activities").select("*").eq("id", id).maybeSingle());
  return row ? toActivity(row) : null;
}

export type ActivityDraft = Omit<Activity, "id" | "user_id">;

export async function saveActivity(draft: ActivityDraft): Promise<Activity> {
  const userId = await currentUserId();
  const row = unwrap(
    await supabase
      .from("activities")
      .insert({ ...draft, user_id: userId, distance_m: Math.round(draft.distance_m * 100) / 100 })
      .select("*")
      .single(),
  );
  return toActivity(row);
}

export async function deleteActivity(id: string): Promise<void> {
  unwrap(await supabase.from("activities").delete().eq("id", id));
}
