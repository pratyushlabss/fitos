"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronRight, Flame, MessageCircle, Moon } from "lucide-react";
import Link from "next/link";

import { useProfile } from "@/components/auth/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { ActionCard } from "@/components/ui/ActionCard";
import { Avatar } from "@/components/ui/Avatar";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SectionCard } from "@/components/ui/SectionCard";
import { ShareCardButton } from "@/components/ui/ShareCardButton";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, QueryView, Skeleton, SkeletonList } from "@/components/ui/States";
import { localDayKey } from "@/lib/data/base";
import { getMealsForDay } from "@/lib/data/nutrition";
import { getMyStreak } from "@/lib/data/profile";
import { listRecoveryDays } from "@/lib/data/recovery";
import { getFeed } from "@/lib/data/social";
import { getActiveWorkout, listWorkouts } from "@/lib/data/workouts";
import { greeting, recoveryLabel, targetsFor, totalsFor } from "@/lib/logic/dashboard";
import { formatDuration, timeAgo } from "@/lib/logic/format";
import { formatDistance } from "@/lib/logic/geo";
import { formatVolume } from "@/lib/logic/units";
import { completedSetCount, workoutDurationSeconds } from "@/lib/logic/workout";
import type { ShareCardData } from "@/lib/shareCard";

export default function HomePage() {
  const profile = useProfile();
  const units = profile.unit_system;
  const queryClient = useQueryClient();
  const today = localDayKey();

  const recovery = useQuery({ queryKey: ["recovery", "days", 0], queryFn: () => listRecoveryDays(today) });
  const streak = useQuery({ queryKey: ["streak"], queryFn: getMyStreak });
  const meals = useQuery({ queryKey: ["meals", today], queryFn: () => getMealsForDay(today) });
  const active = useQuery({ queryKey: ["workout", "active"], queryFn: getActiveWorkout });
  const recent = useQuery({ queryKey: ["workouts", "recent"], queryFn: () => listWorkouts({ limit: 10 }) });
  const feed = useQuery({ queryKey: ["feed", "home"], queryFn: () => getFeed({ limit: 6 }) });

  const score = recovery.data?.find((day) => day.day === today)?.recovery_score ?? null;
  const totals = totalsFor(meals.data ?? []);
  const targets = targetsFor(profile);
  const lastWorkout = recent.data?.[0] ?? null;
  const todaysWorkout = lastWorkout && localDayKey(new Date(lastWorkout.started_at)) === today ? lastWorkout : null;
  const friendPosts = (feed.data ?? []).filter((post) => post.user_id !== profile.id).slice(0, 3);

  const share: ShareCardData | null = lastWorkout
    ? {
        eyebrow: "Workout complete",
        title: lastWorkout.title,
        subtitle: new Date(lastWorkout.started_at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
        stats: [
          { label: "Volume", value: formatVolume(lastWorkout.total_volume_kg, units) },
          { label: "Duration", value: formatDuration(workoutDurationSeconds(lastWorkout)) },
          { label: "Sets", value: String(completedSetCount(lastWorkout)) },
          { label: "Streak", value: `${streak.data ?? 0} days` },
        ],
        lines: lastWorkout.exercises.map((exercise) => exercise.exercise_name),
        footer: `@${profile.username ?? "fitos"}`,
      }
    : null;

  return (
    <PullToRefresh onRefresh={() => queryClient.invalidateQueries()}>
      <ScreenHeader
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
        title={`${greeting()}, ${profile.display_name.split(" ")[0] || "athlete"}`}
        subtitle="Workouts, meals, and GPS in one private OS."
      />
      <div className="space-y-5">
        <section className="rounded-3xl border border-emerald-300/20 bg-[linear-gradient(145deg,rgba(16,185,129,.18),rgba(15,23,42,.92))] p-5">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-emerald-200">Today&apos;s recovery</p>
              {recovery.isPending ? (
                <Skeleton className="mt-2 h-12 w-20" />
              ) : (
                <p className="mt-2 text-5xl font-semibold text-white">{score ?? "–"}</p>
              )}
              <p className="mt-1 text-sm text-slate-300">{score === null ? "Check in to get a score" : recoveryLabel(score)}</p>
            </div>
            <Link className="text-sm text-emerald-300" href="/recovery">
              {score === null ? "Check in" : "View recovery"}
            </Link>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs text-slate-300">
            <div>
              <strong className="flex items-center justify-center gap-1 text-lg text-white">
                <Flame size={16} className={streak.data ? "text-amber-300" : "text-slate-500"} />
                {streak.data ?? "–"}
              </strong>
              day streak
            </div>
            <div>
              <strong className="block text-lg text-white">{totals.calories.toLocaleString()}</strong>kcal eaten
            </div>
            <div>
              <strong className="block text-lg text-white">{todaysWorkout ? formatVolume(todaysWorkout.total_volume_kg, units) : "–"}</strong>lifted today
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Protein" value={`${totals.protein_g} g`} hint={`of ${targets.protein_g} g`} />
          <StatCard
            label="Calories"
            value={totals.calories.toLocaleString()}
            hint={totals.calories <= targets.calories ? `${(targets.calories - totals.calories).toLocaleString()} left` : "over target"}
            accent
          />
        </div>

        {active.data ? (
          <ActionCard
            title={`Resume ${active.data.title}`}
            body={`${active.data.exercises.length} exercises · ${completedSetCount(active.data)} sets done so far.`}
            cta="Resume session"
            href={`/workout/session?id=${active.data.id}`}
          />
        ) : (
          <ActionCard
            title={todaysWorkout ? "Nice work today" : "Start lifting"}
            body={
              todaysWorkout
                ? `${todaysWorkout.title} · ${formatVolume(todaysWorkout.total_volume_kg, units)}. Log another or check your plan.`
                : "Log sets, reps, weight, and RPE. Volume and PRs update as you finish."
            }
            cta="Open workout"
            href="/workout"
          />
        )}
        <ActionCard
          title="Log a meal"
          body="Photo, barcode, or search. Every prediction stores source, version, and confidence."
          cta="Open nutrition"
          href="/nutrition"
        />

        <div className="grid grid-cols-3 gap-2">
          <Link href="/activity" className="flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-panel p-3 text-xs text-slate-300">
            <Activity size={18} className="text-emerald-300" /> Activity
          </Link>
          <Link href="/recovery" className="flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-panel p-3 text-xs text-slate-300">
            <Moon size={18} className="text-emerald-300" /> Recovery
          </Link>
          <Link href="/chat" className="flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-panel p-3 text-xs text-slate-300">
            <MessageCircle size={18} className="text-emerald-300" /> Messages
          </Link>
        </div>

        {lastWorkout ? (
          <SectionCard title="Last workout" action={<span className="text-xs text-slate-500">{timeAgo(lastWorkout.started_at)} · {formatDuration(workoutDurationSeconds(lastWorkout))}</span>}>
            <div className="flex items-center justify-between gap-3">
              <Link href={`/workout/detail?id=${lastWorkout.id}`} className="min-w-0">
                <p className="truncate font-semibold text-white">{lastWorkout.title}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {lastWorkout.exercises.length} exercises · {formatVolume(lastWorkout.total_volume_kg, units)} volume
                </p>
              </Link>
              <ShareCardButton data={share} filename={`fitos-${lastWorkout.id.slice(0, 8)}.png`} />
            </div>
          </SectionCard>
        ) : null}

        <SectionCard title="Friends" action={<Link href="/social" className="inline-flex items-center text-xs text-emerald-300">Feed <ChevronRight size={14} /></Link>}>
          <QueryView
            query={feed}
            skeleton={<SkeletonList rows={2} height="h-14" />}
            isEmpty={() => friendPosts.length === 0}
            empty={
              <EmptyState
                title="No friend activity yet"
                body="Follow your training partners to see their sessions here."
                action={
                  <Link href="/social" className="flex w-full items-center justify-center rounded-xl bg-accent py-2.5 text-sm font-semibold text-ink">
                    Find friends
                  </Link>
                }
              />
            }
          >
            {() => (
              <div className="space-y-2">
                {friendPosts.map((post) => (
                  <Link key={post.id} href={post.workout_id ? `/workout/detail?id=${post.workout_id}` : `/social/post?id=${post.id}`} className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-950/60 p-3">
                    <Avatar name={post.display_name} url={post.avatar_url} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-white">
                        <strong>{post.display_name}</strong>{" "}
                        {post.post_type === "workout" ? `finished ${post.workout_title ?? "a workout"}` : post.post_type === "activity" ? `logged ${formatDistance(post.activity_distance_m ?? 0)}` : "posted"}
                      </p>
                      <p className="text-xs text-slate-500">{timeAgo(post.created_at)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </QueryView>
        </SectionCard>
      </div>
    </PullToRefresh>
  );
}
