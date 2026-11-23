"use client";

import type { LeaderboardRow } from "@fitos/types";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Bell, Flame, MessageCircle, PenSquare, Search, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth, useProfile } from "@/components/auth/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Composer } from "@/components/social/Composer";
import { PersonRow } from "@/components/social/PersonRow";
import { PostCard } from "@/components/social/PostCard";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Field";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SectionCard } from "@/components/ui/SectionCard";
import { Sheet } from "@/components/ui/Sheet";
import { EmptyState, ErrorState, QueryView, SkeletonList } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { listConversations } from "@/lib/data/messaging";
import { searchProfiles } from "@/lib/data/profile";
import { getFeed, getLeaderboard, getNotifications, respondToFollowRequest, subscribeToNewPosts } from "@/lib/data/social";
import { timeAgo } from "@/lib/logic/format";
import { formatVolume } from "@/lib/logic/units";

type Tab = "feed" | "saved" | "leaderboard" | "people";
const PAGE = 15;

export default function SocialPage() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("feed");
  const [query, setQuery] = useState("");
  const [composer, setComposer] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [newPosts, setNewPosts] = useState(false);
  const term = query.trim();

  const feed = useInfiniteQuery({
    queryKey: ["feed", "main"],
    queryFn: ({ pageParam }) => getFeed({ before: pageParam ?? undefined, limit: PAGE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.length === PAGE ? last.at(-1)!.created_at : null),
  });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: getNotifications, refetchInterval: 60_000 });
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: listConversations });
  const results = useQuery({ queryKey: ["people", "search", term], queryFn: () => searchProfiles(term), enabled: term.length >= 2 });

  const requests = (notifications.data ?? []).filter((item) => item.kind === "follow_request").length;
  const unread = (conversations.data ?? []).reduce((sum, item) => sum + item.unread, 0);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested === "saved" || requested === "leaderboard" || requested === "people") setTab(requested);
  }, []);

  useEffect(
    () =>
      subscribeToNewPosts((authorId) => {
        if (authorId && authorId !== userId) setNewPosts(true);
      }),
    [userId],
  );

  async function refresh() {
    setNewPosts(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["feed"] }),
      notifications.refetch(),
      conversations.refetch(),
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
      queryClient.invalidateQueries({ queryKey: ["people"] }),
    ]);
  }

  const posts = feed.data?.pages.flat() ?? [];

  return (
    <PullToRefresh onRefresh={refresh}>
      <ScreenHeader eyebrow="Social" title="Train together" subtitle="Workouts, progress, and people who keep showing up." />
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/80 px-3 py-2.5">
            <Search size={17} className="text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find athletes"
              autoCapitalize="none"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
            />
          </label>
          <Button variant="secondary" aria-label="Notifications" className="relative" onClick={() => setNotificationsOpen(true)}>
            <Bell size={17} />
            {requests > 0 ? <span className="absolute -right-1 -top-1 h-4 min-w-4 rounded-full bg-rose-500 px-1 text-[10px] leading-4 text-white">{requests}</span> : null}
          </Button>
          <Link href="/chat" aria-label="Messages" className="relative inline-flex items-center justify-center rounded-xl bg-slate-800 px-4 py-2.5 text-white hover:bg-slate-700">
            <MessageCircle size={17} />
            {unread > 0 ? <span className="absolute -right-1 -top-1 h-4 min-w-4 rounded-full bg-rose-500 px-1 text-[10px] leading-4 text-white">{unread}</span> : null}
          </Link>
        </div>

        {term.length >= 2 ? (
          <SectionCard title="People on FitOS">
            <QueryView
              query={results}
              skeleton={<SkeletonList rows={2} height="h-14" />}
              isEmpty={(data) => data.length === 0}
              empty={<EmptyState title={`No one matches “${term}”`} body="Search by username or display name." />}
            >
              {(data) => (
                <div className="space-y-2">
                  {data.map((person) => (
                    <PersonRow key={person.id} person={person} />
                  ))}
                </div>
              )}
            </QueryView>
          </SectionCard>
        ) : null}

        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "feed", label: "Feed" },
            { value: "saved", label: "Saved" },
            { value: "leaderboard", label: "Leaderboard" },
            { value: "people", label: "Discover" },
          ]}
        />

        {tab === "feed" ? (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-300">Following feed</h2>
              <Button variant="secondary" className="gap-2 px-3 py-2 text-xs" onClick={() => setComposer(true)}>
                <PenSquare size={14} /> Post
              </Button>
            </div>
            {newPosts ? (
              <button
                className="sticky top-[calc(env(safe-area-inset-top)+8px)] z-10 mx-auto flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink shadow-lg"
                onClick={() => {
                  void refresh();
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                <ArrowUp size={15} /> New posts
              </button>
            ) : null}
            {feed.isPending ? (
              <SkeletonList rows={3} height="h-48" />
            ) : feed.isError ? (
              <ErrorState message={feed.error.message} onRetry={() => void feed.refetch()} />
            ) : posts.length === 0 ? (
              <EmptyState
                icon={<Users size={20} />}
                title="Your feed is empty"
                body="Follow your training partners, or finish a workout and post it."
                action={
                  <Button className="w-full" onClick={() => setTab("people")}>
                    Discover people
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4">
                {posts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
                {feed.hasNextPage ? (
                  <Button variant="secondary" className="w-full" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
                    {feed.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                ) : (
                  <p className="text-center text-xs text-slate-600">You are all caught up.</p>
                )}
              </div>
            )}
          </>
        ) : null}

        {tab === "saved" ? <SavedPosts /> : null}
        {tab === "leaderboard" ? <Leaderboard /> : null}
        {tab === "people" ? <Discover /> : null}
      </div>

      <Composer open={composer} onClose={() => setComposer(false)} />
      <NotificationsSheet open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </PullToRefresh>
  );
}

function SavedPosts() {
  const saved = useQuery({ queryKey: ["feed", "saved"], queryFn: () => getFeed({ saved: true, limit: 50 }) });
  return (
    <QueryView
      query={saved}
      skeleton={<SkeletonList rows={2} height="h-48" />}
      isEmpty={(data) => data.length === 0}
      empty={<EmptyState title="No saved posts" body="Tap the bookmark on a post to keep it here." />}
    >
      {(data) => (
        <div className="space-y-4">
          {data.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </QueryView>
  );
}

function Leaderboard() {
  const units = useProfile().unit_system;
  const [metric, setMetric] = useState<"volume" | "workouts" | "streak">("volume");
  const board = useQuery({ queryKey: ["leaderboard"], queryFn: getLeaderboard });
  const value = (row: LeaderboardRow) => (metric === "volume" ? row.volume_kg : metric === "workouts" ? row.workouts : row.streak);
  return (
    <SectionCard title="This week" action={<Trophy size={16} className="text-amber-300" />}>
      <div className="mb-4">
        <Segmented
          value={metric}
          onChange={setMetric}
          options={[
            { value: "volume", label: "Volume" },
            { value: "workouts", label: "Workouts" },
            { value: "streak", label: "Streak" },
          ]}
        />
      </div>
      <QueryView
        query={board}
        isEmpty={(data) => data.length <= 1}
        empty={<EmptyState title="Just you so far" body="Follow friends to compete on weekly volume, workouts and streaks." />}
      >
        {(data) => (
          <ol className="space-y-2">
            {[...data]
              .sort((a, b) => value(b) - value(a))
              .map((row, index) => (
                <li key={row.user_id}>
                  <Link
                    href={row.is_me ? "/profile" : `/social/profile?id=${row.user_id}`}
                    className={`flex items-center gap-3 rounded-xl border p-3 ${row.is_me ? "border-emerald-300/30 bg-emerald-400/10" : "border-white/5 bg-slate-950/50"}`}
                  >
                    <span className={`w-6 text-center text-sm font-bold ${index === 0 ? "text-amber-300" : "text-slate-400"}`}>{index + 1}</span>
                    <Avatar name={row.display_name} url={row.avatar_url} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm text-white">{row.is_me ? "You" : row.display_name}</span>
                    <strong className="flex items-center gap-1 text-sm text-white">
                      {metric === "streak" ? <Flame size={14} className="text-amber-300" /> : null}
                      {metric === "volume" ? formatVolume(row.volume_kg, units) : metric === "workouts" ? row.workouts : `${row.streak}d`}
                    </strong>
                  </Link>
                </li>
              ))}
          </ol>
        )}
      </QueryView>
      <p className="mt-3 text-xs text-slate-500">Counts workouts shared with followers or everyone. Week starts Monday.</p>
    </SectionCard>
  );
}

function Discover() {
  const people = useQuery({ queryKey: ["people", "discover"], queryFn: () => searchProfiles("") });
  return (
    <SectionCard title="Discover athletes">
      <QueryView
        query={people}
        skeleton={<SkeletonList rows={4} height="h-14" />}
        isEmpty={(data) => data.length === 0}
        empty={<EmptyState title="No one new to follow" body="Invite friends with your profile link from the Profile tab." />}
      >
        {(data) => (
          <div className="space-y-2">
            {data.map((person) => (
              <PersonRow key={person.id} person={person} />
            ))}
          </div>
        )}
      </QueryView>
    </SectionCard>
  );
}

function NotificationsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: getNotifications, enabled: open });
  const respond = useMutation({
    mutationFn: ({ actor, accept }: { actor: string; accept: boolean }) => respondToFollowRequest(actor, accept),
    onSuccess: (_data, { accept }) => {
      toast(accept ? "Request accepted" : "Request declined");
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["profile-card"] });
    },
    onError: (error) => toast(error.message, "error"),
  });

  return (
    <Sheet open={open} onClose={onClose} title="Notifications">
      <div className="pb-2">
        <QueryView
          query={notifications}
          skeleton={<SkeletonList rows={4} height="h-14" />}
          isEmpty={(data) => data.length === 0}
          empty={<EmptyState icon={<Bell size={20} />} title="Nothing new" body="Likes, comments and follows show up here." />}
        >
          {(data) => (
            <ul className="space-y-2">
              {data.map((item, index) => (
                <li key={`${item.kind}-${item.actor_id}-${item.created_at}-${index}`} className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-950/50 p-3">
                  <Link href={`/social/profile?id=${item.actor_id}`} onClick={onClose}>
                    <Avatar name={item.display_name} url={item.avatar_url} size="sm" />
                  </Link>
                  <Link href={item.post_id ? `/social/post?id=${item.post_id}` : `/social/profile?id=${item.actor_id}`} onClick={onClose} className="min-w-0 flex-1">
                    <p className="text-sm text-white">
                      <strong>{item.display_name || item.username}</strong>{" "}
                      {item.kind === "like" ? "liked your post" : item.kind === "comment" ? "commented" : item.kind === "follow" ? "followed you" : "wants to follow you"}
                    </p>
                    {item.body ? <p className="truncate text-xs text-slate-400">“{item.body}”</p> : null}
                    <p className="text-xs text-slate-500">{timeAgo(item.created_at)}</p>
                  </Link>
                  {item.kind === "follow_request" ? (
                    <div className="flex gap-1">
                      <Button className="px-3 py-2 text-xs" disabled={respond.isPending} onClick={() => respond.mutate({ actor: item.actor_id, accept: true })}>
                        Accept
                      </Button>
                      <Button variant="ghost" className="px-2 py-2 text-xs" disabled={respond.isPending} onClick={() => respond.mutate({ actor: item.actor_id, accept: false })}>
                        Decline
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </div>
    </Sheet>
  );
}
