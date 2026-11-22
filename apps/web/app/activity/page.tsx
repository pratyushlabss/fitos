"use client";

import type { ActivitySport, GeoPoint, Visibility } from "@fitos/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, FileUp, Pause, Play, Square } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { RouteMap } from "@/components/activity/RouteMap";
import { useGpsTracker } from "@/components/activity/useGpsTracker";
import { useProfile } from "@/components/auth/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Field, Segmented, TextInput } from "@/components/ui/Field";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SectionCard } from "@/components/ui/SectionCard";
import { Sheet } from "@/components/ui/Sheet";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, QueryView } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { listActivities, saveActivity } from "@/lib/data/activities";
import { createPost } from "@/lib/data/social";
import { formatClock, formatDuration, shortDate, startOfWeekIso } from "@/lib/logic/format";
import { caloriesEstimate, elevationGain, formatDistance, formatPace, paceSecondsPerKm, parseGpx, simplify, totalDistance } from "@/lib/logic/geo";

const SPORT_LABELS: Record<ActivitySport, string> = { run: "Run", ride: "Ride", walk: "Walk", hike: "Hike", other: "Activity" };

type Draft = {
  sport: ActivitySport;
  source: "native_gps" | "gpx";
  startedAt: string;
  endedAt: string;
  durationS: number;
  distanceM: number;
  points: GeoPoint[];
  title: string;
};

export default function ActivityPage() {
  const profile = useProfile();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const tracker = useGpsTracker();
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState<Draft | null>(null);
  const gpxInput = useRef<HTMLInputElement>(null);

  const activities = useQuery({ queryKey: ["activities"], queryFn: () => listActivities({ limit: 30 }) });
  const week = (activities.data ?? []).filter((activity) => activity.started_at >= startOfWeekIso());
  const weekDistance = week.reduce((sum, a) => sum + a.distance_m, 0);
  const weekTime = week.reduce((sum, a) => sum + a.duration_s, 0);
  const weekCalories = week.reduce((sum, a) => sum + caloriesEstimate(a.sport, a.distance_m), 0);

  useEffect(() => {
    if (!tracker.state) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [tracker.state]);

  const live = tracker.state;
  const moving = tracker.movingSeconds(now);
  const elevation = live ? elevationGain(live.points) : 0;

  function finishTracking() {
    if (!live) return;
    tracker.pause();
    const duration = Math.round(tracker.movingSeconds(Date.now()));
    setDraft({
      sport: live.sport,
      source: "native_gps",
      startedAt: live.startedAt,
      endedAt: new Date().toISOString(),
      durationS: duration,
      distanceM: live.distanceM,
      points: live.points,
      title: `${new Date(live.startedAt).getHours() < 12 ? "Morning" : new Date(live.startedAt).getHours() < 17 ? "Afternoon" : "Evening"} ${SPORT_LABELS[live.sport].toLowerCase()}`,
    });
  }

  async function importGpx(file: File) {
    try {
      const { points, name } = parseGpx(await file.text());
      const times = points.map((p) => (p.recorded_at ? Date.parse(p.recorded_at) : NaN)).filter(Number.isFinite);
      const startedAt = times.length ? new Date(Math.min(...times)).toISOString() : new Date().toISOString();
      const endedAt = times.length ? new Date(Math.max(...times)).toISOString() : startedAt;
      setDraft({
        sport: "run",
        source: "gpx",
        startedAt,
        endedAt,
        durationS: Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000),
        distanceM: totalDistance(points),
        points,
        title: name ?? "Imported activity",
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not read that file", "error");
    }
  }

  return (
    <PullToRefresh onRefresh={() => activities.refetch()}>
      <ScreenHeader eyebrow="Activity" title="Movement log" subtitle="Run, ride and walk with native GPS. No Strava needed." />

      <div className="space-y-5">
        {live ? (
          <section className="overflow-hidden rounded-3xl border border-emerald-300/30 bg-slate-900/80">
            <RouteMap points={live.points} label={tracker.error ?? (live.points.length ? undefined : "Waiting for GPS…")} height={180} />
            <div className="p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-emerald-300">
                {SPORT_LABELS[live.sport]} · {live.resumedAt === null ? "Paused" : "Recording"}
                {tracker.accuracy !== null ? ` · ±${Math.round(tracker.accuracy)} m` : ""}
              </p>
              <p className="mt-2 text-5xl font-semibold tabular-nums text-white">{formatClock(moving)}</p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-slate-400">
                <div>
                  <strong className="block text-lg text-white">{formatDistance(live.distanceM)}</strong>distance
                </div>
                <div>
                  <strong className="block text-lg text-white">
                    {live.sport === "ride" ? `${moving > 0 ? ((live.distanceM / 1000) / (moving / 3600)).toFixed(1) : "0.0"} km/h` : formatPace(paceSecondsPerKm(live.distanceM, moving))}
                  </strong>
                  {live.sport === "ride" ? "speed" : "pace"}
                </div>
                <div>
                  <strong className="block text-lg text-white">{elevation} m</strong>climb
                </div>
              </div>
              {tracker.error ? <p className="mt-3 text-xs text-amber-200">{tracker.error}</p> : null}
              <p className="mt-3 text-xs text-slate-500">Keep FitOS open with the screen on. iPhone pauses web GPS when the app is in the background.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {live.resumedAt === null ? (
                  <Button className="w-full gap-2" onClick={tracker.resume}>
                    <Play size={15} /> Resume
                  </Button>
                ) : (
                  <Button variant="secondary" className="w-full gap-2" onClick={tracker.pause}>
                    <Pause size={15} /> Pause
                  </Button>
                )}
                <Button className="w-full gap-2" onClick={finishTracking}>
                  <Square size={14} /> Finish
                </Button>
              </div>
              <Button variant="ghost" className="mt-2 w-full text-xs text-rose-300" onClick={() => window.confirm("Discard this activity?") && tracker.reset()}>
                Discard
              </Button>
            </div>
          </section>
        ) : (
          <SectionCard title="Start activity" action={<span className="text-xs text-slate-500">GPS ready</span>}>
            <div className="grid grid-cols-3 gap-2">
              <Button className="w-full" onClick={() => tracker.start("run")}>
                Run
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => tracker.start("ride")}>
                Ride
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => tracker.start("walk")}>
                Walk
              </Button>
            </div>
            <Button variant="ghost" className="mt-2 w-full gap-2 text-xs" onClick={() => gpxInput.current?.click()}>
              <FileUp size={14} /> Import a GPX file
            </Button>
            <input
              ref={gpxInput}
              hidden
              type="file"
              accept=".gpx,application/gpx+xml,application/xml,text/xml"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importGpx(file);
              }}
            />
          </SectionCard>
        )}

        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Distance" value={formatDistance(weekDistance)} hint="this week" />
          <StatCard label="Time" value={formatDuration(weekTime)} hint="moving" />
          <StatCard label="Calories" value={weekCalories.toLocaleString()} hint="estimated" />
          <StatCard label="Pace" value={formatPace(paceSecondsPerKm(weekDistance, weekTime)).replace("/km", "")} hint="avg /km" />
        </div>

        <SectionCard title="Recent activity">
          <QueryView
            query={activities}
            isEmpty={(data) => data.length === 0}
            empty={<EmptyState title="No activities yet" body="Tap Run, Ride or Walk to record your first one." />}
          >
            {(data) => (
              <div className="space-y-2">
                {data.map((item) => (
                  <Link key={item.id} href={`/activity/detail?id=${item.id}`} className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 p-3">
                    <div>
                      <p className="font-medium text-white">{item.title ?? SPORT_LABELS[item.sport]}</p>
                      <p className="flex items-center gap-1 text-xs text-slate-400">
                        <Clock3 size={12} /> {shortDate(item.started_at)} · {formatDistance(item.distance_m)} • {formatDuration(item.duration_s)}
                      </p>
                    </div>
                    <span className="text-sm text-slate-200">{caloriesEstimate(item.sport, item.distance_m)} kcal</span>
                  </Link>
                ))}
              </div>
            )}
          </QueryView>
        </SectionCard>
      </div>

      <SaveActivitySheet
        draft={draft}
        defaultVisibility={profile.default_visibility}
        onClose={() => setDraft(null)}
        onSaved={(id) => {
          tracker.reset();
          setDraft(null);
          void queryClient.invalidateQueries({ queryKey: ["activities"] });
          void queryClient.invalidateQueries({ queryKey: ["streak"] });
          void queryClient.invalidateQueries({ queryKey: ["feed"] });
          router.push(`/activity/detail?id=${id}`);
        }}
      />
    </PullToRefresh>
  );
}

function SaveActivitySheet({
  draft,
  defaultVisibility,
  onClose,
  onSaved,
}: {
  draft: Draft | null;
  defaultVisibility: Visibility;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState<ActivitySport>("run");
  const [visibility, setVisibility] = useState<Visibility>(defaultVisibility);
  const [share, setShare] = useState(defaultVisibility !== "private");
  const [key, setKey] = useState<string | null>(null);
  if (draft && key !== draft.startedAt) {
    setKey(draft.startedAt);
    setTitle(draft.title);
    setSport(draft.sport);
  }
  const save = useMutation({
    mutationFn: async () => {
      const d = draft!;
      const points = simplify(d.points);
      const activity = await saveActivity({
        sport,
        source: d.source,
        started_at: d.startedAt,
        ended_at: d.endedAt,
        duration_s: d.durationS,
        distance_m: d.distanceM,
        elevation_gain_m: elevationGain(d.points),
        avg_pace_s_per_km: paceSecondsPerKm(d.distanceM, d.durationS),
        polyline: points,
        visibility,
        title: title.trim() || SPORT_LABELS[sport],
      });
      if (share && visibility !== "private") await createPost({ post_type: "activity", activity_id: activity.id, body: null, visibility });
      return activity.id;
    },
    onSuccess: onSaved,
    onError: (error) => toast(error.message, "error"),
  });

  return (
    <Sheet open={draft !== null} onClose={onClose} title="Save activity">
      {draft ? (
        <div className="space-y-4 pb-2">
          <p className="text-sm text-slate-300">
            {formatDistance(draft.distanceM)} · {formatDuration(draft.durationS)} · {formatPace(paceSecondsPerKm(draft.distanceM, draft.durationS))}
          </p>
          {draft.distanceM < 50 ? <p className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-100">Very little distance was recorded. GPS may not have had a signal.</p> : null}
          <Field label="Title">
            <TextInput value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Type">
            <Segmented
              value={sport}
              onChange={setSport}
              options={[
                { value: "run", label: "Run" },
                { value: "ride", label: "Ride" },
                { value: "walk", label: "Walk" },
                { value: "hike", label: "Hike" },
              ]}
            />
          </Field>
          <Field label="Who can see it">
            <Segmented
              value={visibility}
              onChange={(value) => {
                setVisibility(value);
                if (value === "private") setShare(false);
              }}
              options={[
                { value: "private", label: "Only me" },
                { value: "friends", label: "Followers" },
                { value: "public", label: "Everyone" },
              ]}
            />
          </Field>
          <label className="flex items-center gap-3 text-sm text-slate-300">
            <input type="checkbox" className="h-5 w-5 accent-emerald-400" checked={share} disabled={visibility === "private"} onChange={(event) => setShare(event.target.checked)} />
            Post to my feed
          </label>
          <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save activity"}
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}
