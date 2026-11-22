"use client";

import type { RecoveryCheckIn } from "@fitos/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity as ActivityIcon, HeartPulse, Moon, Sparkles } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { useProfile } from "@/components/auth/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { localDayKey } from "@/lib/data/base";
import { getCheckIn, listRecoveryDays, loadDayFeatures, saveCheckIn, saveRecoveryDay } from "@/lib/data/recovery";
import { daysAgoKey } from "@/lib/logic/format";
import { type ComponentKey, componentName, explain, scoreDay } from "@/lib/logic/recovery";

type Form = { sleep_hours: number; sleep_quality: number; stress: number; soreness: number; resting_hr: string };

const DEFAULT_FORM: Form = { sleep_hours: 7.5, sleep_quality: 70, stress: 30, soreness: 25, resting_hr: "" };

export default function RecoveryPage() {
  const profile = useProfile();
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = localDayKey();

  const checkIn = useQuery({ queryKey: ["checkin", today], queryFn: () => getCheckIn(today) });
  const trend = useQuery({ queryKey: ["recovery", "days", 7], queryFn: () => listRecoveryDays(daysAgoKey(6)) });
  const [form, setForm] = useState<Form>(DEFAULT_FORM);

  useEffect(() => {
    const saved = checkIn.data;
    if (!saved) return;
    setForm({
      sleep_hours: saved.sleep_hours ?? DEFAULT_FORM.sleep_hours,
      sleep_quality: saved.sleep_quality ?? DEFAULT_FORM.sleep_quality,
      stress: saved.stress ?? DEFAULT_FORM.stress,
      soreness: saved.soreness ?? DEFAULT_FORM.soreness,
      resting_hr: saved.resting_hr === null ? "" : String(saved.resting_hr),
    });
  }, [checkIn.data]);

  const draftCheckIn: RecoveryCheckIn = {
    day: today,
    sleep_hours: form.sleep_hours,
    sleep_quality: form.sleep_quality,
    stress: form.stress,
    soreness: form.soreness,
    resting_hr: form.resting_hr ? Number(form.resting_hr) : null,
    notes: null,
  };

  const base = useQuery({ queryKey: ["recovery-features", today], queryFn: () => loadDayFeatures(today, profile, null) });
  const features = useMemo(
    () =>
      base.data
        ? {
            ...base.data,
            sleep_hours: draftCheckIn.sleep_hours,
            sleep_score: draftCheckIn.sleep_quality,
            stress_score: draftCheckIn.stress,
            soreness_score: draftCheckIn.soreness,
            resting_hr: draftCheckIn.resting_hr,
          }
        : undefined,
    [base.data, draftCheckIn.sleep_hours, draftCheckIn.sleep_quality, draftCheckIn.stress, draftCheckIn.soreness, draftCheckIn.resting_hr],
  );
  const result = useMemo(() => (features ? scoreDay(features) : null), [features]);
  const advice = result ? explain(result, form.soreness) : null;
  const score = result?.recovery_score ?? null;

  const save = useMutation({
    mutationFn: async () => {
      await saveCheckIn(draftCheckIn);
      const fresh = scoreDay(await loadDayFeatures(today, profile, draftCheckIn));
      void queryClient.invalidateQueries({ queryKey: ["recovery-features", today] });
      await saveRecoveryDay(today, fresh);
    },
    onSuccess: () => {
      toast("Check-in saved", "success");
      void queryClient.invalidateQueries({ queryKey: ["checkin", today] });
      void queryClient.invalidateQueries({ queryKey: ["recovery"] });
    },
    onError: (error) => toast(error.message, "error"),
  });

  const days = Array.from({ length: 7 }, (_, index) => daysAgoKey(6 - index));
  const bars = days.map((day) => {
    if (day === today && score !== null) return score;
    return trend.data?.find((item) => item.day === day)?.recovery_score ?? null;
  });

  return (
    <PullToRefresh onRefresh={() => Promise.all([checkIn.refetch(), trend.refetch(), base.refetch()])}>
      <ScreenHeader eyebrow="Recovery" title="Know your training window" subtitle="Your check-in plus today's training and meals." />

      <div className="space-y-5">
        <section className="rounded-3xl border border-emerald-300/20 bg-[linear-gradient(145deg,rgba(16,185,129,.18),rgba(15,23,42,.92))] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-emerald-200">Readiness estimate</p>
              {result ? (
                <p className="mt-3 text-5xl font-semibold tracking-tight text-white">{result.readiness_score ?? "–"}</p>
              ) : (
                <Skeleton className="mt-3 h-12 w-24" />
              )}
              <p className="mt-2 text-sm text-slate-300">
                {score === null ? "Add a check-in to get a score" : score >= 70 ? "Good window for strength work" : "Reduce intensity and prioritise recovery"}
              </p>
            </div>
            <HeartPulse className="text-emerald-300" size={28} />
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-950/70">
            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${result?.readiness_score ?? 0}%` }} />
          </div>
        </section>

        {checkIn.isError ? <ErrorState message={checkIn.error.message} onRetry={() => void checkIn.refetch()} /> : null}

        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Recovery" value={score === null ? "–" : String(score)} hint={checkIn.data ? "checked in" : "not saved yet"} accent />
          <StatCard label="Confidence" value={result ? `${Math.round(result.confidence * 100)}%` : "–"} hint={result ? `${result.data_completeness}% data` : ""} />
          <StatCard label="Stress" value={`${form.stress}`} hint="lower is better" />
          <StatCard label="Soreness" value={`${form.soreness}`} hint="lower is better" />
        </div>

        <SectionCard title="Seven-day recovery">
          <div className="flex h-36 items-end gap-2 border-b border-white/10 pb-2">
            {bars.map((value, index) => (
              <div key={days[index]} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                <span className="text-[10px] text-slate-500">{value ?? "–"}</span>
                <div
                  className={`w-full rounded-t-lg transition-all ${index === bars.length - 1 ? "bg-emerald-400" : value === null ? "bg-slate-800" : "bg-slate-700"}`}
                  style={{ height: `${Math.max(value ?? 4, 4)}%` }}
                />
                <span className="text-[10px] text-slate-500">
                  {index === bars.length - 1 ? "Today" : new Date(`${days[index]}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" })}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">Saved check-ins are shown. Scores are estimates, not medical measurements.</p>
        </SectionCard>

        <SectionCard title="Daily check-in">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="Sleep hours" value={form.sleep_hours} step="0.25" min="0" max="16" onChange={(value) => setForm({ ...form, sleep_hours: value })} />
              <label className="block text-sm text-slate-300">
                <span className="mb-2 block">Resting HR (bpm)</span>
                <input
                  inputMode="numeric"
                  value={form.resting_hr}
                  placeholder="Optional"
                  onChange={(event) => setForm({ ...form, resting_hr: event.target.value.replace(/\D/g, "").slice(0, 3) })}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-base text-white outline-none focus:border-emerald-300/40"
                />
              </label>
            </div>
            <MetricSlider label="Sleep quality" value={form.sleep_quality} onChange={(value) => setForm({ ...form, sleep_quality: value })} icon={<Moon size={16} />} />
            <MetricSlider label="Stress" value={form.stress} onChange={(value) => setForm({ ...form, stress: value })} icon={<Sparkles size={16} />} />
            <MetricSlider label="Muscle soreness" value={form.soreness} onChange={(value) => setForm({ ...form, soreness: value })} icon={<ActivityIcon size={16} />} />
            <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : checkIn.data ? "Update check-in" : "Save check-in"}
            </Button>
          </div>
        </SectionCard>

        <SectionCard title="What the engine used">
          {result ? (
            <div className="space-y-3">
              {(Object.keys(result.inputs) as ComponentKey[]).map((key) => (
                <ComponentRow key={key} label={componentName(key)} value={result.inputs[key]} detail={detailFor(key, features)} />
              ))}
            </div>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </SectionCard>

        <SectionCard title="Recovery coach">
          {advice ? (
            <div className="rounded-2xl border border-amber-300/15 bg-amber-300/5 p-4">
              <p className="font-semibold text-white">{advice.headline}</p>
              <p className="mt-2 text-sm leading-6 text-slate-200">{advice.recommendation}</p>
              <p className="mt-2 text-xs leading-5 text-slate-400">{advice.body}</p>
              <p className="mt-3 text-xs text-amber-200">Focus: {advice.focus.join(" · ")}</p>
            </div>
          ) : (
            <Skeleton className="h-28 w-full" />
          )}
          <p className="mt-3 text-xs text-slate-500">Estimate only, not a medical measurement.</p>
        </SectionCard>
      </div>
    </PullToRefresh>
  );
}

function detailFor(key: ComponentKey, f: Awaited<ReturnType<typeof loadDayFeatures>> | undefined): string {
  if (!f) return "";
  switch (key) {
    case "sleep":
      return f.sleep_hours !== null ? `${f.sleep_hours} hours, quality ${f.sleep_score ?? "–"}` : "not logged";
    case "training_load":
      return f.training_load !== null ? `load ${Math.round(f.training_load)} from today's workouts` : "no workout today";
    case "activity_load":
      return f.activity_load !== null ? `${Math.round(f.activity_load)} active minutes` : "no activity today";
    case "nutrition":
      return f.calories !== null ? `${f.calories} kcal, ${f.protein_g} g protein` : "no meals logged";
    case "cardio":
      return f.resting_hr !== null ? `resting HR ${f.resting_hr}` : "add resting HR to include";
    case "stress":
      return f.stress_score !== null ? `stress ${f.stress_score}` : "not logged";
    case "soreness":
      return f.soreness_score !== null ? `soreness ${f.soreness_score}` : "not logged";
  }
}

function NumberInput({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: string;
  min: string;
  max: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-sm text-slate-300">
      <span className="mb-2 block">{label}</span>
      <input type="number" inputMode="decimal" value={value} step={step} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-base text-white outline-none focus:border-emerald-300/40" />
    </label>
  );
}

function ComponentRow({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="capitalize text-slate-300">{label}</span>
        <span className="text-white">{value === null ? "missing" : Math.round(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-950/70">
        <div className={`h-full rounded-full ${value === null ? "" : "bg-emerald-400/80"}`} style={{ width: `${value ?? 0}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function MetricSlider({ label, value, onChange, icon }: { label: string; value: number; onChange: (value: number) => void; icon: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between text-sm text-slate-300">
        <span className="flex items-center gap-2">
          {icon}
          {label}
        </span>
        <strong className="text-white">{value}</strong>
      </span>
      <input className="h-2 w-full cursor-pointer accent-emerald-400" type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
