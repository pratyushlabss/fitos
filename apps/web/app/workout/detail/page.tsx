"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Medal, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";

import { useAuth, useProfile } from "@/components/auth/AuthProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { ShareCardButton } from "@/components/ui/ShareCardButton";
import { StatCard } from "@/components/ui/StatCard";
import { ErrorState, SkeletonList } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { getProfileCard } from "@/lib/data/profile";
import { createPost } from "@/lib/data/social";
import { deleteWorkout, getWorkout, listRecordsForWorkout } from "@/lib/data/workouts";
import { formatDuration, shortDate } from "@/lib/logic/format";
import { formatVolume, formatWeight } from "@/lib/logic/units";
import { completedSetCount, RECORD_LABELS, workoutDurationSeconds } from "@/lib/logic/workout";
import type { ShareCardData } from "@/lib/shareCard";

export default function WorkoutDetailPage() {
  return (
    <Suspense fallback={<SkeletonList rows={4} height="h-24" />}>
      <WorkoutDetail />
    </Suspense>
  );
}

function WorkoutDetail() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const justFinished = params.get("done") === "1";
  const { userId } = useAuth();
  const profile = useProfile();
  const units = profile.unit_system;
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const workout = useQuery({ queryKey: ["workout", id], queryFn: () => getWorkout(id), enabled: Boolean(id) });
  const isMine = workout.data?.user_id === userId;
  const owner = useQuery({
    queryKey: ["profile-card", workout.data?.user_id],
    queryFn: () => getProfileCard(workout.data!.user_id),
    enabled: Boolean(workout.data && !isMine),
  });
  const records = useQuery({ queryKey: ["records", id], queryFn: () => listRecordsForWorkout(id), enabled: Boolean(isMine) });

  const post = useMutation({
    mutationFn: () => createPost({ post_type: "workout", workout_id: id, body: null, visibility: workout.data?.visibility === "public" ? "public" : "friends" }),
    onSuccess: () => {
      toast("Posted to your feed", "success");
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
    onError: (error) => toast(error.message, "error"),
  });
  const remove = useMutation({
    mutationFn: () => deleteWorkout(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workouts"] });
      router.replace("/workout");
    },
    onError: (error) => toast(error.message, "error"),
  });

  const shareData = useMemo<ShareCardData | null>(() => {
    const w = workout.data;
    if (!w) return null;
    const prCount = records.data?.length ?? 0;
    return {
      eyebrow: "Workout complete",
      title: w.title,
      subtitle: shortDate(w.started_at),
      stats: [
        { label: "Volume", value: formatVolume(w.total_volume_kg, units) },
        { label: "Duration", value: formatDuration(workoutDurationSeconds(w)) },
        { label: "Sets", value: String(completedSetCount(w)) },
        { label: "PRs", value: String(prCount) },
      ],
      lines: w.exercises.map((exercise) => {
        const top = exercise.sets.filter((set) => !set.is_warmup).sort((a, b) => b.weight_kg - a.weight_kg)[0];
        return `${exercise.exercise_name}${top ? ` · ${formatWeight(top.weight_kg, units)} × ${top.reps}` : ""}`;
      }),
      footer: `@${profile.username ?? "fitos"}`,
    };
  }, [workout.data, records.data, units, profile.username]);

  if (!id) return <ErrorState message="No workout selected." />;
  if (workout.isPending) return <SkeletonList rows={4} height="h-24" />;
  if (workout.isError) return <ErrorState message={workout.error.message} onRetry={() => void workout.refetch()} />;
  if (!workout.data) return <ErrorState message="This workout is private or no longer exists." />;
  const w = workout.data;

  return (
    <>
      <button onClick={() => router.back()} className="mb-5 inline-flex items-center gap-2 text-sm text-slate-400">
        <ArrowLeft size={16} /> Back
      </button>
      <header className="mb-5">
        {!isMine && owner.data ? (
          <Link href={`/social/profile?id=${owner.data.id}`} className="mb-3 flex items-center gap-2">
            <Avatar name={owner.data.display_name} url={owner.data.avatar_url} size="sm" />
            <span className="text-sm text-slate-300">{owner.data.display_name}</span>
          </Link>
        ) : null}
        <p className="text-xs uppercase tracking-[0.18em] text-accent">{justFinished ? "Workout saved" : "Workout"}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{w.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {shortDate(w.started_at)} · {w.visibility === "private" ? "Only you" : w.visibility === "friends" ? "Followers" : "Everyone"}
        </p>
      </header>

      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Volume" value={formatVolume(w.total_volume_kg, units)} accent />
          <StatCard label="Time" value={formatDuration(workoutDurationSeconds(w))} />
          <StatCard label="Sets" value={String(completedSetCount(w))} />
        </div>

        {isMine && (records.data?.length ?? 0) > 0 ? (
          <SectionCard title="Personal records" action={<Medal size={16} className="text-amber-300" />}>
            <div className="space-y-2">
              {records.data!.map((record) => (
                <div key={record.id} className="flex items-center justify-between rounded-xl border border-amber-300/15 bg-amber-300/5 px-3 py-2">
                  <span className="text-sm text-white">
                    {record.exercise_name} <span className="text-slate-400">· {RECORD_LABELS[record.record_type]}</span>
                  </span>
                  <strong className="text-sm text-amber-200">
                    {record.record_type === "max_reps" ? `${record.value} reps` : formatWeight(record.value, units)}
                  </strong>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : null}

        {w.notes ? <p className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-sm leading-6 text-slate-300">{w.notes}</p> : null}

        {w.exercises.map((exercise) => (
          <SectionCard
            key={exercise.id}
            title={exercise.exercise_name}
            action={
              isMine ? (
                <Link href={`/workout/exercise?name=${encodeURIComponent(exercise.exercise_name)}`} className="text-xs text-emerald-300">
                  Progress
                </Link>
              ) : undefined
            }
          >
            <div className="space-y-1">
              {exercise.sets.map((set, index) => (
                <div key={set.id} className="flex items-center justify-between rounded-lg bg-slate-950/60 px-3 py-2 text-sm">
                  <span className={set.is_warmup ? "text-amber-300" : "text-slate-400"}>{set.is_warmup ? "Warm-up" : `Set ${index + 1}`}</span>
                  <span className="text-white">
                    {set.weight_kg > 0 ? `${formatWeight(set.weight_kg, units)} × ` : ""}
                    {set.reps} reps
                    {set.rpe !== null ? <span className="text-slate-500"> · RPE {set.rpe}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>
        ))}

        {isMine ? (
          <div className="grid grid-cols-2 gap-2">
            <ShareCardButton data={shareData} filename={`fitos-${w.id.slice(0, 8)}.png`} label="Share card" className="w-full" />
            <Button variant="secondary" className="w-full gap-2" disabled={post.isPending || w.visibility === "private" || post.isSuccess} onClick={() => post.mutate()}>
              <Send size={15} /> {post.isSuccess ? "Posted" : "Post to feed"}
            </Button>
            <Button
              variant="ghost"
              className="col-span-2 w-full gap-2 text-rose-300"
              disabled={remove.isPending}
              onClick={() => window.confirm("Delete this workout permanently?") && remove.mutate()}
            >
              <Trash2 size={15} /> Delete workout
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
