import { ActionCard } from "@/components/ui/ActionCard";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <ScreenHeader
        eyebrow="FitOS"
        title="Ready when you are"
        subtitle="Workouts, meals, and GPS in one private OS."
      />
      <div className="space-y-5">
        <section className="rounded-3xl border border-emerald-300/20 bg-[linear-gradient(145deg,rgba(16,185,129,.18),rgba(15,23,42,.92))] p-5">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-emerald-200">Today&apos;s fitness score</p>
              <p className="mt-2 text-5xl font-semibold text-white">82</p>
            </div>
            <Link className="text-sm text-emerald-300" href="/recovery">View recovery</Link>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs text-slate-300">
            <div><strong className="block text-lg text-white">84</strong>ready</div>
            <div><strong className="block text-lg text-white">7.4h</strong>sleep</div>
            <div><strong className="block text-lg text-white">116</strong>load</div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Protein" value="126 g" hint="of 160 g" />
          <StatCard label="Steps" value="9,620" hint="on track" accent />
        </div>

        <ActionCard
          title="Start lifting"
          body="Log sets, reps, weight, and RPE. Volume and PRs update as you finish."
          cta="Open workout"
          href="/workout"
        />
        <ActionCard
          title="Log a meal"
          body="Photo, barcode, or search. Every prediction stores source, version, and confidence."
          cta="Open nutrition"
          href="/nutrition"
        />

        <SectionCard title="Workout posted" action={<span className="text-xs text-slate-500">Today · 42 min</span>}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-white">Upper Body Strength</p>
              <p className="mt-1 text-sm text-slate-400">8 exercises · 3,240 kg volume · 1 PR</p>
            </div>
            <Button variant="secondary">Share</Button>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
