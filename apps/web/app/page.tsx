"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronRight, Dumbbell, MessageCircle, Moon } from "lucide-react";
import Link from "next/link";

import { useProfile } from "@/components/auth/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { MacroBar } from "@/components/motion/MacroBar";
import { TiltCard } from "@/components/motion/TiltCard";
import { HomeHero } from "@/components/three/HomeHero";
import { Avatar } from "@/components/ui/Avatar";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { ShareCardButton } from "@/components/ui/ShareCardButton";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState, QueryView, Skeleton } from "@/components/ui/States";
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

  const kcalLeft = targets.calories - totals.calories;
  const ratio = targets.calories > 0 ? totals.calories / targets.calories : 0;
  const streakDays = streak.data ?? 0;

  return (
    <PullToRefresh onRefresh={() => queryClient.invalidateQueries()}>
      <ScreenHeader
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
        title={`${greeting()}, ${profile.display_name.split(" ")[0] || "athlete"}`}
        subtitle=""
      />
      <div className="space-y-4">
        <section className="texture-dots relative overflow-hidden rounded-card border border-line bg-surface-1" aria-label="Today's calories and streak">
          <div className="flex items-center justify-between px-5 pt-4">
            <p className="eyebrow">Today</p>
            <Link href="/nutrition" data-press className="press -mr-2 inline-flex min-h-[44px] items-center gap-1 px-2 text-xs font-medium text-fg">
              Log meal <ChevronRight size={14} strokeWidth={1.5} />
            </Link>
          </div>
          {meals.isPending ? (
            <div className="flex aspect-[11/8] items-center justify-center">
              <Skeleton className="h-40 w-40 !rounded-full" />
            </div>
          ) : (
            <HomeHero
              ratio={ratio}
              streak={streakDays}
              center={
                <div className="glow flex flex-col items-center text-center">
                  <AnimatedNumber value={totals.calories} className="text-[40px] font-semibold leading-none tracking-tightest text-max" />
                  <span className="num mt-1 text-[11px] text-muted">/ {targets.calories.toLocaleString()} kcal</span>
                  <span className={`mt-2 text-xs ${kcalLeft < 0 ? "font-bold text-fg" : "text-fg/80"}`}>
                    <span className="num">{Math.abs(kcalLeft).toLocaleString()}</span> {kcalLeft < 0 ? "over" : "left"}
                  </span>
                </div>
              }
              orbLabel={
                <div className="text-center">
                  <AnimatedNumber value={streakDays} className="block text-2xl font-semibold leading-none text-max" />
                  <span className="text-[11px] text-muted">day streak</span>
                </div>
              }
            />
          )}
          <div className="space-y-3 border-t border-line px-5 py-4">
            <MacroBar kind="protein" value={totals.protein_g} target={targets.protein_g} />
            <MacroBar kind="carbs" value={totals.carbs_g} target={targets.carbs_g} />
            <MacroBar kind="fat" value={totals.fat_g} target={targets.fat_g} />
            <MacroBar kind="fibre" value={totals.fibre_g} target={targets.fibre_g} />
          </div>
        </section>

        <TiltCard>
          {active.data ? (
            <WorkoutCard
              eyebrow="In progress"
              title={active.data.title}
              body={`${active.data.exercises.length} exercises · ${completedSetCount(active.data)} sets done`}
              cta="Resume session"
              href={`/workout/session?id=${active.data.id}`}
              strong
            />
          ) : todaysWorkout ? (
            <WorkoutCard
              eyebrow="Done today"
              title={todaysWorkout.title}
              body={`${formatVolume(todaysWorkout.total_volume_kg, units)} · ${formatDuration(workoutDurationSeconds(todaysWorkout))}`}
              cta="Open workout"
              href="/workout"
            />
          ) : (
            <WorkoutCard
              eyebrow="Today's workout"
              title="Start lifting"
              body="Log sets, reps, weight and RPE. Volume and PRs update as you go."
              cta="Open workout"
              href="/workout"
              strong
            />
          )}
        </TiltCard>

        <Link href="/recovery" data-press className="press flex items-center justify-between rounded-card border border-line bg-surface-1 px-5 py-4">
          <div>
            <p className="eyebrow">Recovery</p>
            <p className="mt-1 text-sm text-fg/80">{score === null ? "Check in to get a score" : recoveryLabel(score)}</p>
          </div>
          {recovery.isPending ? (
            <Skeleton className="h-9 w-12" />
          ) : (
            <span className="num text-[32px] font-semibold leading-none text-max">{score ?? "–"}</span>
          )}
        </Link>

        <section aria-label="Friend activity">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="eyebrow">Friends</h2>
            <Link href="/social" className="press -mr-2 inline-flex min-h-[44px] items-center px-2 text-xs font-medium text-fg">
              Feed <ChevronRight size={14} strokeWidth={1.5} />
            </Link>
          </div>
          <QueryView
            query={feed}
            skeleton={
              <div className="flex gap-3 overflow-hidden">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[112px] w-[148px] shrink-0 !rounded-card" />
                ))}
              </div>
            }
            isEmpty={() => friendPosts.length === 0}
            empty={
              <EmptyState
                title="No friend activity yet"
                body="Follow your training partners to see their sessions here."
                action={
                  <Link href="/social" data-press className={`${buttonClass.base} ${buttonClass.outline} w-full`}>
                    Find friends
                  </Link>
                }
              />
            }
          >
            {() => (
              <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
                {friendPosts.map((post) => (
                  <Link
                    key={post.id}
                    href={post.workout_id ? `/workout/detail?id=${post.workout_id}` : `/social/post?id=${post.id}`}
                    data-press
                    className="press flex w-[148px] shrink-0 snap-start flex-col justify-between gap-3 rounded-card border border-line bg-surface-1 p-4"
                  >
                    <Avatar name={post.display_name} url={post.avatar_url} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold tracking-tight text-fg">{post.display_name}</p>
                      <p className="truncate text-xs text-muted">
                        {post.post_type === "workout" ? post.workout_title ?? "Workout" : post.post_type === "activity" ? formatDistance(post.activity_distance_m ?? 0) : "Posted"} · {timeAgo(post.created_at)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </QueryView>
        </section>

        <section className="rounded-card border border-line bg-surface-1 p-5" aria-label="Coach">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="eyebrow">Coach</h2>
            <span className="num text-[11px] text-muted">&gt;_</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {["What should I eat tonight?", "How much protein is left?", "Plan tomorrow's session"].map((prompt) => (
              <Link key={prompt} href="/coach" data-press className="press inline-flex min-h-[44px] items-center rounded-full border border-line px-4 text-xs text-fg">
                {prompt}
              </Link>
            ))}
          </div>
        </section>

        {lastWorkout ? (
          <section className="rounded-card border border-line bg-surface-1 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="eyebrow">Last workout</h2>
              <span className="num text-[11px] text-muted">
                {timeAgo(lastWorkout.started_at)} · {formatDuration(workoutDurationSeconds(lastWorkout))}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Link href={`/workout/detail?id=${lastWorkout.id}`} className="min-w-0">
                <p className="truncate text-lg font-semibold tracking-tight text-fg">{lastWorkout.title}</p>
                <p className="mt-0.5 text-sm text-muted">
                  {lastWorkout.exercises.length} exercises · <span className="num">{formatVolume(lastWorkout.total_volume_kg, units)}</span>
                </p>
              </Link>
              <ShareCardButton data={share} filename={`fitos-${lastWorkout.id.slice(0, 8)}.png`} />
            </div>
          </section>
        ) : null}

        <div className="grid grid-cols-3 gap-2">
          {[
            { href: "/activity", label: "Activity", icon: Activity },
            { href: "/recovery", label: "Recovery", icon: Moon },
            { href: "/chat", label: "Messages", icon: MessageCircle },
          ].map((item) => (
            <Link key={item.href} href={item.href} data-press className="press flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-card border border-line bg-surface-1 text-xs text-fg/80">
              <item.icon size={18} strokeWidth={1.5} /> {item.label}
            </Link>
          ))}
        </div>
      </div>
    </PullToRefresh>
  );
}

function WorkoutCard({ eyebrow, title, body, cta, href, strong = false }: { eyebrow: string; title: string; body: string; cta: string; href: string; strong?: boolean }) {
  return (
    <Link href={href} className="texture-lines block rounded-card border border-line bg-surface-1 p-5">
      <div className="flex items-center justify-between">
        <p className="eyebrow">{eyebrow}</p>
        <Dumbbell size={16} strokeWidth={1.5} className="text-muted" />
      </div>
      <p className="mt-3 text-2xl font-semibold leading-tight tracking-tighter text-fg">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
      <span className={`${buttonClass.base} ${strong ? buttonClass.primary : buttonClass.outline} mt-5 w-full`}>{cta}</span>
    </Link>
  );
}
