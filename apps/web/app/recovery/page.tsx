"use client";

import { useState, type ReactNode } from "react";
import { Activity as ActivityIcon, Dumbbell, HeartPulse, Moon, Sparkles, Utensils } from "lucide-react";

import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";

export default function RecoveryPage() {
  const [sleep, setSleep] = useState(84);
  const [sleepHours, setSleepHours] = useState(7.4);
  const [stress, setStress] = useState(32);
  const [soreness, setSoreness] = useState(28);
  const [workoutMinutes, setWorkoutMinutes] = useState(42);
  const [workoutType, setWorkoutType] = useState("Upper body strength");
  const [nutrition, setNutrition] = useState(78);
  const [activity, setActivity] = useState(64);
  const components = {
    sleep: Math.round((sleep + Math.min(sleepHours / 8, 1) * 100) / 2),
    training: Math.max(35, Math.min(100, 88 - Math.max(workoutMinutes - 60, 0))),
    nutrition,
    activity,
    stress: 100 - stress,
  };
  const readiness = Math.round(
    components.sleep * 0.3 +
      components.training * 0.2 +
      components.nutrition * 0.2 +
      components.activity * 0.15 +
      components.stress * 0.15,
  );
  const trend = [68, 74, 71, 79, 76, 81, readiness];

  return (
    <>
      <ScreenHeader
        eyebrow="Recovery"
        title="Know your training window"
        subtitle="Manual inputs today. Connected health data can layer in later."
      />

      <div className="space-y-5">
        <section className="rounded-3xl border border-emerald-300/20 bg-[linear-gradient(145deg,rgba(16,185,129,.18),rgba(15,23,42,.92))] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-emerald-200">Readiness estimate</p>
              <p className="mt-3 text-5xl font-semibold tracking-tight text-white">{readiness}</p>
              <p className="mt-2 text-sm text-slate-300">{readiness >= 70 ? "Good window for strength work" : "Reduce intensity and prioritize recovery"}</p>
            </div>
            <HeartPulse className="text-emerald-300" size={28} />
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-950/70">
            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${readiness}%` }} />
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Sleep score" value={`${sleep}`} hint="manual today" accent />
          <StatCard label="Stress score" value={`${stress}`} hint="lower is better" />
          <StatCard label="Soreness" value={`${soreness}`} hint="lower is better" />
          <StatCard label="Recovery" value={readiness >= 70 ? "Ready" : "Reduce load"} hint="estimate" />
        </div>

        <SectionCard title="Seven-day readiness">
          <div className="flex h-36 items-end gap-2 border-b border-white/10 pb-2">
            {trend.map((value, index) => (
              <div key={`${value}-${index}`} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                <span className="text-[10px] text-slate-500">{value}</span>
                <div className={`w-full rounded-t-lg transition-all ${index === trend.length - 1 ? "bg-emerald-400" : "bg-slate-700"}`} style={{ height: `${Math.max(value, 8)}%` }} />
                <span className="text-[10px] text-slate-500">{["M", "T", "W", "T", "F", "S", "Today"][index]}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">Your latest check-in is highlighted. Scores are estimates, not medical measurements.</p>
        </SectionCard>

        <SectionCard title="Manual check-in">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="Sleep hours" value={sleepHours} step="0.1" min="0" max="16" onChange={setSleepHours} />
              <NumberInput label="Workout minutes" value={workoutMinutes} step="5" min="0" max="300" onChange={setWorkoutMinutes} />
            </div>
            <label className="block text-sm text-slate-300">
              <span className="mb-2 block">Workout division</span>
              <select value={workoutType} onChange={(event) => setWorkoutType(event.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-300/40">
                <option>Upper body strength</option>
                <option>Lower body strength</option>
                <option>Full body</option>
                <option>Conditioning</option>
                <option>Rest day</option>
              </select>
            </label>
            <MetricSlider label="Sleep score" value={sleep} onChange={setSleep} icon={<Moon size={16} />} />
            <MetricSlider label="Stress score" value={stress} onChange={setStress} icon={<Sparkles size={16} />} />
            <MetricSlider label="Muscle soreness" value={soreness} onChange={setSoreness} icon={<ActivityIcon size={16} />} />
            <MetricSlider label="Nutrition adherence" value={nutrition} onChange={setNutrition} icon={<Utensils size={16} />} />
            <MetricSlider label="Activity readiness" value={activity} onChange={setActivity} icon={<Dumbbell size={16} />} />
            <Button className="w-full">Save check-in</Button>
          </div>
        </SectionCard>

        <SectionCard title="What the engine used">
          <div className="space-y-3">
            <ComponentRow label="Sleep" value={components.sleep} detail={`${sleepHours.toFixed(1)} hours`} />
            <ComponentRow label="Training" value={components.training} detail={`${workoutMinutes} min · ${workoutType}`} />
            <ComponentRow label="Nutrition" value={components.nutrition} detail="manual adherence" />
            <ComponentRow label="Activity" value={components.activity} detail="manual readiness" />
            <ComponentRow label="Stress" value={components.stress} detail="inverse stress score" />
          </div>
        </SectionCard>

        <SectionCard title="Recovery coach">
          <div className="rounded-2xl border border-amber-300/15 bg-amber-300/5 p-4">
            <p className="text-sm leading-6 text-slate-200">
              {readiness >= 70
                ? "You can train today. Keep your first working set controlled and stop two reps before failure if fatigue rises."
                : "Choose an easier session today. Walk, hydrate, eat a protein-rich meal, and keep hard sets away from failure."}
            </p>
          </div>
          <p className="mt-3 text-xs text-slate-500">Estimate only, not a medical measurement.</p>
        </SectionCard>
      </div>
    </>
  );
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
      <input type="number" value={value} step={step} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-300/40" />
    </label>
  );
}

function ComponentRow({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm"><span className="text-slate-300">{label}</span><span className="text-white">{value}</span></div>
      <div className="h-2 rounded-full bg-slate-950/70"><div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${value}%` }} /></div>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function MetricSlider({
  label,
  value,
  onChange,
  icon,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  icon: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between text-sm text-slate-300">
        <span className="flex items-center gap-2">{icon}{label}</span>
        <strong className="text-white">{value}</strong>
      </span>
      <input
        className="h-2 w-full cursor-pointer accent-emerald-400"
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}