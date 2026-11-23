"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Flame, Lock, MessageCircle, MoreHorizontal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useAuth, useProfile } from "@/components/auth/AuthProvider";
import { FollowButton } from "@/components/social/FollowButton";
import { PostCard } from "@/components/social/PostCard";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Field";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SectionCard } from "@/components/ui/SectionCard";
import { Sheet } from "@/components/ui/Sheet";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, ErrorState, QueryView, SkeletonList } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { openConversation } from "@/lib/data/messaging";
import { getProfileCard } from "@/lib/data/profile";
import { blockUser, getFeed, unblockUser } from "@/lib/data/social";
import { formatVolume } from "@/lib/logic/units";

type Tab = "overview" | "workouts" | "activity" | "compare";

export default function SocialProfilePage() {
  return (
    <Suspense fallback={<SkeletonList rows={3} height="h-32" />}>
      <SocialProfile />
    </Suspense>
  );
}

function SocialProfile() {
  const userId = useSearchParams().get("id") ?? "";
  const { userId: me } = useAuth();
  const units = useProfile().unit_system;
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (userId && userId === me) router.replace("/profile");
  }, [userId, me, router]);

  const card = useQuery({ queryKey: ["profile-card", userId], queryFn: () => getProfileCard(userId), enabled: Boolean(userId) });
  const mine = useQuery({ queryKey: ["profile-card", me], queryFn: () => getProfileCard(me!), enabled: Boolean(me) && tab === "compare" });
  const posts = useQuery({
    queryKey: ["feed", "author", userId],
    queryFn: () => getFeed({ author: userId, limit: 30 }),
    enabled: Boolean(userId) && Boolean(card.data?.can_view) && (tab === "workouts" || tab === "activity"),
  });

  const message = useMutation({
    mutationFn: () => openConversation(userId),
    onSuccess: (conversationId) => router.push(`/chat/thread?id=${conversationId}`),
    onError: (error) => toast(error.message.includes("follow_required") ? "Follow each other before messaging a private account." : error.message, "error"),
  });

  const block = useMutation({
    mutationFn: (blocked: boolean) => (blocked ? unblockUser(userId) : blockUser(userId)),
    onSuccess: (_data, wasBlocked) => {
      toast(wasBlocked ? "Unblocked" : "Blocked. They can no longer see your profile or posts.");
      setMenu(false);
      void queryClient.invalidateQueries();
    },
    onError: (error) => toast(error.message, "error"),
  });

  if (!userId) return <ErrorState message="No athlete selected." />;

  return (
    <PullToRefresh onRefresh={() => Promise.all([card.refetch(), posts.refetch()])}>
      <button onClick={() => router.back()} className="mb-5 inline-flex items-center gap-2 text-sm text-slate-400">
        <ArrowLeft size={16} /> Back
      </button>
      <QueryView
        query={card}
        skeleton={<SkeletonList rows={3} height="h-32" />}
        isEmpty={(data) => data === null}
        empty={<ErrorState message="This profile is not available." />}
      >
        {(athlete) =>
          athlete ? (
            <div className="space-y-5">
              <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-5">
                <div className="flex items-start gap-4">
                  <Avatar name={athlete.display_name} url={athlete.avatar_url} size="lg" />
                  <div className="min-w-0 flex-1">
                    <h1 className="flex items-center gap-2 text-2xl font-semibold text-white">
                      <span className="truncate">{athlete.display_name || athlete.username}</span>
                      {athlete.is_private ? <Lock size={16} className="shrink-0 text-slate-500" /> : null}
                    </h1>
                    <p className="text-sm text-emerald-300">@{athlete.username}</p>
                    {athlete.follows_me ? <p className="mt-1 text-xs text-slate-500">Follows you</p> : null}
                    {athlete.bio ? <p className="selectable mt-2 text-sm leading-6 text-slate-400">{athlete.bio}</p> : null}
                  </div>
                  <button className="rounded-full p-2 text-slate-400 hover:bg-white/5" aria-label="More options" onClick={() => setMenu(true)}>
                    <MoreHorizontal size={18} />
                  </button>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <strong className="block text-lg text-white">{athlete.followers}</strong>
                    <span className="text-xs text-slate-500">followers</span>
                  </div>
                  <div>
                    <strong className="block text-lg text-white">{athlete.following}</strong>
                    <span className="text-xs text-slate-500">following</span>
                  </div>
                  <div>
                    <strong className="block text-lg text-white">{athlete.workouts ?? "–"}</strong>
                    <span className="text-xs text-slate-500">workouts</span>
                  </div>
                </div>
                {athlete.blocked_by_me ? (
                  <Button variant="secondary" className="mt-4 w-full" onClick={() => block.mutate(true)}>
                    Unblock
                  </Button>
                ) : (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <FollowButton userId={athlete.id} status={athlete.follow_status} className="w-full py-2.5 text-sm" />
                    <Button variant="secondary" className="gap-2" disabled={message.isPending} onClick={() => message.mutate()}>
                      <MessageCircle size={16} />
                      Message
                    </Button>
                  </div>
                )}
              </section>

              {athlete.blocked_by_me ? (
                <EmptyState icon={<Ban size={20} />} title="You blocked this account" body="Unblock to see their posts again. They are not told." />
              ) : !athlete.can_view ? (
                <EmptyState
                  icon={<Lock size={20} />}
                  title="This account is private"
                  body={athlete.follow_status === "pending" ? "Your follow request is waiting for approval." : "Follow to see their workouts and stats."}
                />
              ) : (
                <>
                  <Segmented
                    value={tab}
                    onChange={setTab}
                    options={[
                      { value: "overview", label: "Overview" },
                      { value: "workouts", label: "Workouts" },
                      { value: "activity", label: "Activity" },
                      { value: "compare", label: "Compare" },
                    ]}
                  />

                  {tab === "overview" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <StatCard label="30-day volume" value={formatVolume(athlete.volume_30d ?? 0, units)} hint="shared workouts" accent />
                      <StatCard label="Frequency" value={`${(((athlete.workouts_30d ?? 0) / 30) * 7).toFixed(1)} / wk`} hint="last 30 days" />
                      <StatCard label="Current streak" value={`${athlete.streak ?? 0} days`} hint="active days" />
                      <StatCard label="Recent PRs" value={String(athlete.prs_30d ?? 0)} hint="last 30 days" />
                    </div>
                  ) : null}

                  {tab === "workouts" || tab === "activity" ? (
                    <QueryView
                      query={posts}
                      skeleton={<SkeletonList rows={2} height="h-48" />}
                      isEmpty={(data) => data.filter((post) => (tab === "workouts" ? post.post_type !== "activity" : post.post_type === "activity")).length === 0}
                      empty={<EmptyState title={tab === "workouts" ? "No shared workouts" : "No shared activities"} body="Posts they share with you appear here." />}
                    >
                      {(data) => (
                        <div className="space-y-4">
                          {data
                            .filter((post) => (tab === "workouts" ? post.post_type !== "activity" : post.post_type === "activity"))
                            .map((post) => (
                              <PostCard key={post.id} post={post} />
                            ))}
                        </div>
                      )}
                    </QueryView>
                  ) : null}

                  {tab === "compare" ? (
                    <SectionCard title="You vs them · last 30 days">
                      {mine.isPending ? (
                        <SkeletonList rows={3} height="h-10" />
                      ) : (
                        <div className="space-y-2">
                          {[
                            { label: "Volume", you: mine.data?.volume_30d ?? 0, them: athlete.volume_30d ?? 0, format: (v: number) => formatVolume(v, units) },
                            { label: "Workouts", you: mine.data?.workouts_30d ?? 0, them: athlete.workouts_30d ?? 0, format: (v: number) => String(v) },
                            { label: "Streak", you: mine.data?.streak ?? 0, them: athlete.streak ?? 0, format: (v: number) => `${v}d` },
                            { label: "PRs", you: mine.data?.prs_30d ?? 0, them: athlete.prs_30d ?? 0, format: (v: number) => String(v) },
                          ].map((row) => {
                            const total = row.you + row.them || 1;
                            return (
                              <div key={row.label} className="rounded-xl bg-slate-950/60 p-3">
                                <div className="flex items-center justify-between text-sm">
                                  <span className={row.you >= row.them ? "font-semibold text-emerald-300" : "text-slate-300"}>{row.format(row.you)}</span>
                                  <span className="text-xs uppercase tracking-[0.12em] text-slate-500">{row.label}</span>
                                  <span className={row.them > row.you ? "font-semibold text-emerald-300" : "text-slate-300"}>{row.format(row.them)}</span>
                                </div>
                                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-800">
                                  <div className="bg-emerald-400" style={{ width: `${(row.you / total) * 100}%` }} />
                                  <div className="bg-sky-400" style={{ width: `${(row.them / total) * 100}%` }} />
                                </div>
                              </div>
                            );
                          })}
                          <p className="flex items-center gap-1 pt-1 text-xs text-slate-500">
                            <Flame size={12} className="text-amber-300" /> You on the left, {athlete.display_name.split(" ")[0]} on the right.
                          </p>
                        </div>
                      )}
                    </SectionCard>
                  ) : null}
                </>
              )}

              <Sheet open={menu} onClose={() => setMenu(false)} title={athlete.display_name}>
                <button
                  className="mb-2 flex w-full items-center gap-3 rounded-xl border border-rose-400/20 bg-rose-500/5 p-3 text-left text-sm text-rose-200"
                  disabled={block.isPending}
                  onClick={() => {
                    if (athlete.blocked_by_me || window.confirm(`Block ${athlete.display_name}? You will unfollow each other.`)) block.mutate(athlete.blocked_by_me);
                  }}
                >
                  <Ban size={16} /> {athlete.blocked_by_me ? "Unblock" : "Block"}
                </button>
              </Sheet>
            </div>
          ) : null
        }
      </QueryView>
    </PullToRefresh>
  );
}
