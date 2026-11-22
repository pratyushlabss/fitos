import type { AppNotification, FeedPost, LeaderboardRow, PostComment, PostType, Visibility } from "@fitos/types";

import { currentUserId, num, numOrNull, supabase, unwrap, type Row } from "./base";
import { signedImageUrls, uploadImage } from "./storage";

export type FeedPostWithMedia = FeedPost & { media_url: string | null };

function toPost(row: Record<string, unknown>): FeedPost {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    username: (row.username as string | null) ?? null,
    display_name: String(row.display_name ?? ""),
    avatar_url: (row.avatar_url as string | null) ?? null,
    post_type: row.post_type as PostType,
    body: (row.body as string | null) ?? null,
    media_path: (row.media_path as string | null) ?? null,
    workout_id: (row.workout_id as string | null) ?? null,
    workout_title: (row.workout_title as string | null) ?? null,
    workout_volume_kg: numOrNull(row.workout_volume_kg),
    workout_started_at: (row.workout_started_at as string | null) ?? null,
    workout_completed_at: (row.workout_completed_at as string | null) ?? null,
    workout_exercise_count: numOrNull(row.workout_exercise_count),
    activity_id: (row.activity_id as string | null) ?? null,
    activity_sport: (row.activity_sport as FeedPost["activity_sport"]) ?? null,
    activity_distance_m: numOrNull(row.activity_distance_m),
    activity_duration_s: numOrNull(row.activity_duration_s),
    visibility: row.visibility as Visibility,
    created_at: String(row.created_at),
    like_count: num(row.like_count),
    comment_count: num(row.comment_count),
    liked_by_me: Boolean(row.liked_by_me),
    saved_by_me: Boolean(row.saved_by_me),
  };
}

export type FeedQuery = { author?: string; postId?: string; saved?: boolean; before?: string; limit?: number };

export async function getFeed(query: FeedQuery = {}): Promise<FeedPostWithMedia[]> {
  const rows = unwrap(
    await supabase.rpc("get_feed", {
      p_author: query.author ?? null,
      p_post: query.postId ?? null,
      p_saved: query.saved ?? false,
      p_before: query.before ?? null,
      p_limit: query.limit ?? 20,
    }),
  ) as Record<string, unknown>[] | null;
  const posts = (rows ?? []).map(toPost);
  const urls = await signedImageUrls("post-media", posts.map((post) => post.media_path ?? ""));
  return posts.map((post) => ({ ...post, media_url: post.media_path ? urls[post.media_path] ?? null : null }));
}

export async function getPost(id: string): Promise<FeedPostWithMedia | null> {
  const posts = await getFeed({ postId: id, limit: 1 });
  return posts[0] ?? null;
}

export async function createPost(input: {
  post_type: PostType;
  body: string | null;
  visibility: Visibility;
  workout_id?: string | null;
  activity_id?: string | null;
  photo?: Blob | null;
}): Promise<string> {
  const userId = await currentUserId();
  const mediaPath = input.photo ? await uploadImage("post-media", input.photo) : null;
  const row = unwrap(
    await supabase
      .from("posts")
      .insert({
        user_id: userId,
        post_type: input.post_type,
        body: input.body?.trim() || null,
        visibility: input.visibility,
        workout_id: input.workout_id ?? null,
        activity_id: input.activity_id ?? null,
        media_path: mediaPath,
      })
      .select("id")
      .single(),
  );
  return String(row.id);
}

export async function deletePost(id: string): Promise<void> {
  unwrap(await supabase.from("posts").update({ deleted_at: new Date().toISOString() }).eq("id", id));
}

export async function setLiked(postId: string, liked: boolean): Promise<void> {
  const userId = await currentUserId();
  if (liked) {
    unwrap(
      await supabase
        .from("post_reactions")
        .upsert({ post_id: postId, user_id: userId, kind: "like" }, { onConflict: "post_id,user_id,kind", ignoreDuplicates: true }),
    );
  } else {
    unwrap(await supabase.from("post_reactions").delete().eq("post_id", postId).eq("user_id", userId).eq("kind", "like"));
  }
}

export async function setSaved(postId: string, saved: boolean): Promise<void> {
  const userId = await currentUserId();
  if (saved) {
    unwrap(
      await supabase
        .from("post_saves")
        .upsert({ post_id: postId, user_id: userId }, { onConflict: "user_id,post_id", ignoreDuplicates: true }),
    );
  } else {
    unwrap(await supabase.from("post_saves").delete().eq("post_id", postId).eq("user_id", userId));
  }
}

export async function listComments(postId: string): Promise<PostComment[]> {
  const rows = unwrap(
    await supabase
      .from("comments")
      .select("id, post_id, user_id, body, created_at, profiles(username, display_name, avatar_url)")
      .eq("post_id", postId)
      .order("created_at")
      .limit(200),
  );
  return (rows ?? []) as unknown as PostComment[];
}

export async function addComment(postId: string, body: string): Promise<void> {
  const userId = await currentUserId();
  unwrap(await supabase.from("comments").insert({ post_id: postId, user_id: userId, body: body.trim() }));
}

export async function deleteComment(id: string): Promise<void> {
  unwrap(await supabase.from("comments").delete().eq("id", id));
}

export async function followUser(userId: string): Promise<"pending" | "accepted"> {
  return unwrap(await supabase.rpc("follow_user", { p_target: userId })) as "pending" | "accepted";
}

export async function unfollowUser(userId: string): Promise<void> {
  const me = await currentUserId();
  unwrap(await supabase.from("follows").delete().eq("follower_id", me).eq("following_id", userId));
}

export async function respondToFollowRequest(followerId: string, accept: boolean): Promise<void> {
  const me = await currentUserId();
  const query = supabase.from("follows");
  if (accept) {
    unwrap(await query.update({ status: "accepted", updated_at: new Date().toISOString() }).eq("follower_id", followerId).eq("following_id", me));
  } else {
    unwrap(await query.delete().eq("follower_id", followerId).eq("following_id", me));
  }
}

export async function blockUser(userId: string): Promise<void> {
  const me = await currentUserId();
  unwrap(await supabase.from("blocks").upsert({ blocker_id: me, blocked_id: userId }, { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true }));
  await supabase.from("follows").delete().eq("follower_id", me).eq("following_id", userId);
  await supabase.from("follows").delete().eq("follower_id", userId).eq("following_id", me);
}

export async function unblockUser(userId: string): Promise<void> {
  const me = await currentUserId();
  unwrap(await supabase.from("blocks").delete().eq("blocker_id", me).eq("blocked_id", userId));
}

export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const rows = unwrap(await supabase.rpc("weekly_leaderboard")) as Record<string, unknown>[] | null;
  return (rows ?? []).map((row: Row) => ({
    user_id: String(row.user_id),
    username: (row.username as string | null) ?? null,
    display_name: String(row.display_name ?? ""),
    avatar_url: (row.avatar_url as string | null) ?? null,
    volume_kg: num(row.volume_kg),
    workouts: num(row.workouts),
    streak: num(row.streak),
    is_me: Boolean(row.is_me),
  }));
}

export async function getNotifications(): Promise<AppNotification[]> {
  const rows = unwrap(await supabase.rpc("get_notifications")) as AppNotification[] | null;
  return rows ?? [];
}

export function subscribeToNewPosts(onInsert: (authorId: string) => void): () => void {
  const channel = supabase
    .channel(`feed-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, (payload) => {
      onInsert(String((payload.new as { user_id?: string }).user_id ?? ""));
    })
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToPostActivity(postId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`post-${postId}-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: `post_id=eq.${postId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "post_reactions", filter: `post_id=eq.${postId}` }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
