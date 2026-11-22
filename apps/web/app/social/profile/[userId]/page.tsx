import Link from "next/link";
import { ArrowLeft, BarChart3, Dumbbell, MessageCircle, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";

export default async function SocialProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const maya = userId === "maya-chen";
  const athlete = maya ? { name: "Maya Chen", handle: "@mayamoves", initials: "MC", bio: "Running, lifting, and staying curious.", followers: 284, following: 192 } : { name: "Jordan Patel", handle: "@jordanp", initials: "JP", bio: "Strength-first. Consistency over intensity.", followers: 146, following: 88 };

  return (
    <>
      <Link href="/social" className="mb-5 inline-flex items-center gap-2 text-sm text-slate-400"><ArrowLeft size={16} /> Social</Link>
      <div className="space-y-5">
        <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-5"><div className="flex items-start gap-4"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400/15 text-lg font-semibold text-emerald-200">{athlete.initials}</span><div className="min-w-0 flex-1"><h1 className="text-2xl font-semibold text-white">{athlete.name}</h1><p className="text-sm text-emerald-300">{athlete.handle}</p><p className="mt-2 text-sm leading-6 text-slate-400">{athlete.bio}</p></div></div><div className="mt-5 grid grid-cols-3 gap-2 text-center"><div><strong className="block text-lg text-white">{athlete.followers}</strong><span className="text-xs text-slate-500">followers</span></div><div><strong className="block text-lg text-white">{athlete.following}</strong><span className="text-xs text-slate-500">following</span></div><div><strong className="block text-lg text-white">34</strong><span className="text-xs text-slate-500">workouts</span></div></div><div className="mt-4 grid grid-cols-2 gap-2"><Button className="gap-2"><UserPlus size={16} />Follow</Button><Button variant="secondary" className="gap-2"><MessageCircle size={16} />Message</Button></div></section>

        <div className="grid grid-cols-2 gap-3"><StatCard label="30-day volume" value="28.4k kg" hint="training load" accent /><StatCard label="Frequency" value="4.2 / wk" hint="last 30 days" /></div>
        <SectionCard title="Profile views"><div className="grid grid-cols-4 gap-2 border-b border-white/10 pb-3 text-center text-xs text-slate-500"><span className="border-b-2 border-emerald-400 pb-2 text-emerald-300">Overview</span><span>Workouts</span><span>Activity</span><span>Compare</span></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-950/60 p-3"><p className="text-xs text-slate-500">Current streak</p><p className="mt-1 text-xl font-semibold text-white">12 days</p></div><div className="rounded-xl bg-slate-950/60 p-3"><p className="text-xs text-slate-500">Recent PRs</p><p className="mt-1 text-xl font-semibold text-white">3</p></div></div></SectionCard>
        <SectionCard title="Recent workouts"><div className="space-y-2"><div className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-950/60 p-3"><Dumbbell size={17} className="text-emerald-300" /><div className="flex-1"><p className="text-sm font-medium text-white">Chest + Triceps</p><p className="text-xs text-slate-500">1h 09m · 5,916 kg · 9 PRs</p></div></div><div className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-950/60 p-3"><BarChart3 size={17} className="text-sky-300" /><div className="flex-1"><p className="text-sm font-medium text-white">Back + Biceps</p><p className="text-xs text-slate-500">58m · 4,820 kg · yesterday</p></div></div></div></SectionCard>
      </div>
    </>
  );
}