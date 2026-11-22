import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { activitySeed } from "@/lib/demoData";
import { Clock3, MapPin, Share2 } from "lucide-react";

export default function ActivityPage() {
  return (
    <>
      <ScreenHeader
        eyebrow="Activity"
        title="Movement log"
        subtitle="Run, ride, walk, and native GPS tracking without Strava dependency"
      />

      <div className="space-y-5">
        <SectionCard title="Start activity" action={<span className="text-xs text-slate-500">GPS ready</span>}>
          <div className="grid grid-cols-3 gap-2">
            <Button className="w-full">Run</Button>
            <Button variant="secondary" className="w-full">Ride</Button>
            <Button variant="secondary" className="w-full">Walk</Button>
          </div>
        </SectionCard>

        <section className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/80">
          <div className="flex h-36 items-center justify-center bg-[radial-gradient(circle_at_48%_45%,rgba(16,185,129,.24),transparent_34%),linear-gradient(135deg,#101827,#071019)]">
            <div className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-slate-950/70 px-4 py-2 text-sm text-emerald-200">
              <MapPin size={16} /> Route preview · 8.4 km
            </div>
          </div>
          <div className="flex items-center justify-between p-4">
            <div>
              <p className="font-semibold text-white">Tempo run</p>
              <p className="mt-1 flex items-center gap-2 text-xs text-slate-400"><Clock3 size={13} /> 41 min · 4:52/km · 420 kcal</p>
            </div>
            <Button variant="ghost"><Share2 size={16} /> Share</Button>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Distance" value="18.6 km" hint="week total" />
          <StatCard label="Time" value="1h 42m" hint="active" />
          <StatCard label="Calories" value="1,040" hint="burned" />
          <StatCard label="Pace" value="4:46" hint="avg" />
        </div>

        <SectionCard title="Recent activity">
          <div className="space-y-2">
            {activitySeed.map((item) => (
              <div key={item.title} className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 p-3">
                <div>
                  <p className="font-medium text-white">{item.title}</p>
                  <p className="text-xs text-slate-400">{item.distance} • {item.duration}</p>
                </div>
                <span className="text-sm text-slate-200">{item.calories}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  );
}
