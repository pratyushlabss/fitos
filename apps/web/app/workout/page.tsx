import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { recommendationSeed } from "@/lib/demoData";

export default function WorkoutPage() {
  return (
    <>
      <ScreenHeader
        eyebrow="Workout"
        title="Strength plan"
        subtitle="Adaptive recommendations, session logging, and volume tracking"
      />

      <div className="space-y-5">
        <SectionCard
          title="Today’s workout"
          action={<span className="text-xs uppercase tracking-[0.14em] text-emerald-300">Upper body</span>}
        >
          <div className="space-y-3">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-emerald-300">Recommended set</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">Bench Press</h3>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-300">Target</p>
                  <p className="text-lg font-bold text-white">70 kg × 8</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Volume" value="210kg" hint="total" />
              <StatCard label="RPE" value="8.2" hint="target" />
              <StatCard label="Recovery" value="84%" hint="good" />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Adaptive recommendations">
          <div className="space-y-3">
            {recommendationSeed.map((item) => (
              <div key={item.exercise} className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-white">{item.exercise}</p>
                    <p className="mt-1 text-sm text-slate-300">{item.target}</p>
                  </div>
                  <Button variant="secondary" className="px-3 py-2 text-xs">Edit</Button>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-400">Reason: {item.reason}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Workout session controls">
          <div className="grid grid-cols-2 gap-2">
            <Button className="w-full">Start session</Button>
            <Button variant="secondary" className="w-full">Add exercise</Button>
            <Button variant="secondary" className="w-full">Replace</Button>
            <Button variant="ghost" className="w-full">Skip</Button>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
