"use client";

import { Activity, Bookmark, ChevronRight, Heart, MessageCircle, MoreHorizontal, Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useAuth, useProfile } from "@/components/auth/AuthProvider";
import { usePostActions } from "@/components/social/usePostActions";
import { Avatar } from "@/components/ui/Avatar";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import type { FeedPostWithMedia } from "@/lib/data/social";
import { formatDuration, timeAgo } from "@/lib/logic/format";
import { formatDistance } from "@/lib/logic/geo";
import { formatVolume } from "@/lib/logic/units";

const KIND_LABEL: Record<string, string> = {
  workout: "workout",
  activity: "activity",
  photo: "photo",
  text: "update",
  achievement: "achievement",
  challenge: "challenge",
};

export function PostCard({ post, linkToPost = true }: { post: FeedPostWithMedia; linkToPost?: boolean }) {
  const { userId } = useAuth();
  const units = useProfile().unit_system;
  const toast = useToast();
  const { like, save, remove } = usePostActions();
  const [menu, setMenu] = useState(false);
  const mine = post.user_id === userId;
  const postHref = `/social/post?id=${post.id}`;
  const duration =
    post.workout_started_at && post.workout_completed_at
      ? (Date.parse(post.workout_completed_at) - Date.parse(post.workout_started_at)) / 1000
      : null;

  function share() {
    const url = `${window.location.origin}${postHref}`;
    const title = post.workout_title ?? (post.body?.slice(0, 60) || "FitOS post");
    if (navigator.share) {
      navigator.share({ title, text: `${post.display_name} on FitOS`, url }).catch(() => undefined);
    } else {
      void navigator.clipboard?.writeText(url).then(() => toast("Link copied"));
    }
  }

  return (
    <article className="rounded-3xl border border-white/10 bg-slate-900/80 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.3)]">
      <div className="flex items-center gap-3">
        <Link href={`/social/profile?id=${post.user_id}`} aria-label={post.display_name}>
          <Avatar name={post.display_name} url={post.avatar_url} />
        </Link>
        <Link href={`/social/profile?id=${post.user_id}`} className="min-w-0 flex-1">
          <strong className="block truncate text-sm text-white">{post.display_name || post.username}</strong>
          <span className="text-xs text-slate-500">
            {timeAgo(post.created_at)} · {KIND_LABEL[post.post_type] ?? "post"}
            {post.visibility === "public" ? " · public" : ""}
          </span>
        </Link>
        <button
          aria-label={post.saved_by_me ? "Remove from saved" : "Save post"}
          className={post.saved_by_me ? "text-emerald-300" : "text-slate-500 hover:text-white"}
          onClick={() => save.mutate({ post, saved: !post.saved_by_me })}
        >
          <Bookmark size={18} fill={post.saved_by_me ? "currentColor" : "none"} />
        </button>
        {mine ? (
          <button aria-label="Post options" className="text-slate-500 hover:text-white" onClick={() => setMenu(true)}>
            <MoreHorizontal size={18} />
          </button>
        ) : null}
      </div>

      {post.body && post.post_type !== "workout" ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">{post.body}</p> : null}

      {post.media_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.media_url} alt="" loading="lazy" className="mt-3 max-h-[420px] w-full rounded-2xl object-cover" />
      ) : null}

      {post.workout_id ? (
        <Link
          href={`/workout/detail?id=${post.workout_id}`}
          className="mt-4 block rounded-2xl border border-emerald-300/15 bg-[linear-gradient(135deg,rgba(16,185,129,.12),rgba(15,23,42,.7))] p-4"
        >
          <p className="text-xs uppercase tracking-[0.14em] text-emerald-200">Workout</p>
          <h3 className="mt-2 text-xl font-semibold text-white">{post.workout_title ?? "Workout"}</h3>
          <p className="mt-1 text-sm text-slate-300">
            {[
              post.workout_volume_kg ? formatVolume(post.workout_volume_kg, units) : null,
              duration ? formatDuration(duration) : null,
              post.workout_exercise_count ? `${post.workout_exercise_count} exercises` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {post.body ? <p className="mt-4 text-sm leading-6 text-slate-400">{post.body}</p> : null}
          <span className="mt-4 inline-flex items-center gap-1 text-xs text-emerald-300">
            View full workout <ChevronRight size={14} />
          </span>
        </Link>
      ) : null}

      {post.activity_id ? (
        <Link href={`/activity/detail?id=${post.activity_id}`} className="mt-4 flex items-center gap-3 rounded-2xl border border-sky-300/15 bg-sky-500/5 p-4">
          <Activity size={20} className="text-sky-300" />
          <div className="flex-1">
            <p className="text-xs uppercase tracking-[0.14em] text-sky-200">{post.activity_sport ?? "activity"}</p>
            <p className="mt-1 text-sm text-white">
              {formatDistance(post.activity_distance_m ?? 0)} · {formatDuration(post.activity_duration_s)}
            </p>
          </div>
          <ChevronRight size={16} className="text-sky-300" />
        </Link>
      ) : null}

      <div className="mt-3 flex items-center gap-5 text-sm text-slate-400">
        <button
          onClick={() => like.mutate({ post, liked: !post.liked_by_me })}
          className={`flex items-center gap-1.5 ${post.liked_by_me ? "text-rose-300" : "hover:text-white"}`}
          aria-label={post.liked_by_me ? "Unlike" : "Like"}
          aria-pressed={post.liked_by_me}
        >
          <Heart size={17} fill={post.liked_by_me ? "currentColor" : "none"} />
          {post.like_count}
        </button>
        {linkToPost ? (
          <Link href={postHref} className="flex items-center gap-1.5 hover:text-white" aria-label="Comments">
            <MessageCircle size={17} />
            {post.comment_count}
          </Link>
        ) : (
          <span className="flex items-center gap-1.5">
            <MessageCircle size={17} />
            {post.comment_count}
          </span>
        )}
        <button className="ml-auto flex items-center gap-1.5 hover:text-white" onClick={share}>
          <Share2 size={17} />
          Share
        </button>
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} title="Your post">
        <button
          className="mb-2 flex w-full items-center gap-3 rounded-xl border border-rose-400/20 bg-rose-500/5 p-3 text-left text-sm text-rose-200"
          onClick={() => {
            setMenu(false);
            if (window.confirm("Delete this post? The workout itself is kept.")) remove.mutate(post);
          }}
        >
          <Trash2 size={16} /> Delete post
        </button>
      </Sheet>
    </article>
  );
}
