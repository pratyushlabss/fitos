import type { Profile, ProfileCard, ProfileSearchResult } from "@fitos/types";

import { currentUserId, num, numOrNull, supabase, unwrap, type Row } from "./base";
import { publicImageUrl, uploadImage } from "./storage";

function toProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    username: (row.username as string | null) ?? null,
    display_name: String(row.display_name ?? ""),
    avatar_url: (row.avatar_url as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    is_private: Boolean(row.is_private),
    unit_system: row.unit_system === "imperial" ? "imperial" : "metric",
    default_visibility: (row.default_visibility as Profile["default_visibility"]) ?? "friends",
    goal: (row.goal as Profile["goal"]) ?? null,
    height_cm: numOrNull(row.height_cm),
    calorie_target: num(row.calorie_target) || 2200,
    protein_target_g: num(row.protein_target_g) || 160,
    carbs_target_g: num(row.carbs_target_g) || 250,
    fat_target_g: num(row.fat_target_g) || 70,
    timezone: String(row.timezone ?? "UTC"),
    onboarded_at: (row.onboarded_at as string | null) ?? null,
    sex: (row.sex as Profile["sex"]) ?? null,
    birth_year: row.birth_year === null || row.birth_year === undefined ? null : num(row.birth_year),
    activity_level: (row.activity_level as Profile["activity_level"]) ?? "moderate",
    nudges_enabled: row.nudges_enabled === undefined ? true : Boolean(row.nudges_enabled),
    tdee_estimate: row.tdee_estimate === null || row.tdee_estimate === undefined ? null : num(row.tdee_estimate),
  };
}

export async function getMyProfile(): Promise<Profile | null> {
  const userId = await currentUserId();
  const row = unwrap(await supabase.from("profiles").select("*").eq("id", userId).maybeSingle());
  return row ? toProfile(row) : null;
}

export async function ensureMyProfile(): Promise<Profile> {
  const existing = await getMyProfile();
  if (existing) return existing;
  const userId = await currentUserId();
  unwrap(await supabase.from("profiles").upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true }));
  const created = await getMyProfile();
  if (!created) throw new Error("Could not create your profile");
  return created;
}

export type ProfileUpdate = Partial<Omit<Profile, "id">>;

export async function updateMyProfile(patch: ProfileUpdate): Promise<Profile> {
  const userId = await currentUserId();
  const row = unwrap(
    await supabase
      .from("profiles")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("*")
      .single(),
  );
  return toProfile(row);
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const userId = await currentUserId();
  const rows = unwrap(
    await supabase.from("profiles").select("id").eq("username", normalizeUsername(username)).neq("id", userId).limit(1),
  );
  return (rows ?? []).length === 0;
}

export async function uploadAvatar(file: Blob): Promise<string> {
  const path = await uploadImage("avatars", file);
  return publicImageUrl("avatars", path);
}

export async function getProfileCard(userId: string): Promise<ProfileCard | null> {
  const rows = unwrap(await supabase.rpc("get_profile_card", { p_user: userId })) as Record<string, unknown>[] | null;
  const row = rows?.[0];
  if (!row) return null;
  return {
    id: String(row.id),
    username: (row.username as string | null) ?? null,
    display_name: String(row.display_name ?? ""),
    avatar_url: (row.avatar_url as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    is_private: Boolean(row.is_private),
    followers: num(row.followers),
    following: num(row.following),
    workouts: num(row.workouts),
    follow_status: (row.follow_status as ProfileCard["follow_status"]) ?? null,
    follows_me: Boolean(row.follows_me),
    blocked_by_me: Boolean(row.blocked_by_me),
    can_view: Boolean(row.can_view),
    streak: numOrNull(row.streak),
    volume_30d: numOrNull(row.volume_30d),
    workouts_30d: numOrNull(row.workouts_30d),
    prs_30d: numOrNull(row.prs_30d),
  };
}

export async function searchProfiles(query: string): Promise<ProfileSearchResult[]> {
  const rows = unwrap(await supabase.rpc("search_profiles", { q: query.trim() })) as Record<string, unknown>[] | null;
  return (rows ?? []).map((row: Row) => ({
    id: String(row.id),
    username: (row.username as string | null) ?? null,
    display_name: String(row.display_name ?? ""),
    avatar_url: (row.avatar_url as string | null) ?? null,
    is_private: Boolean(row.is_private),
    follow_status: (row.follow_status as ProfileSearchResult["follow_status"]) ?? null,
  }));
}

export async function getMyStreak(): Promise<number> {
  const userId = await currentUserId();
  return num(unwrap(await supabase.rpc("get_streak", { p_user: userId })));
}
