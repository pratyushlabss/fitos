"use client";

import Link from "next/link";
import { Bell, Bookmark, ChevronRight, Heart, MessageCircle, Search, Share2, Users } from "lucide-react";
import { useState } from "react";

import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";

const athletes = [
  { id: "maya-chen", initials: "MC", name: "Maya Chen", handle: "@mayamoves", note: "8.4 km tempo run" },
  { id: "jordan-patel", initials: "JP", name: "Jordan Patel", handle: "@jordanp", note: "Upper body strength" },
];

const initialPosts = [
  { id: "post-1", athlete: athletes[0], title: "Tempo Run", time: "2h ago", stats: "8.4 km · 41 min · 420 kcal", caption: "Controlled pace, strong finish.", likes: 24, comments: 6, liked: false },
  { id: "post-2", athlete: athletes[1], title: "Upper Body Strength", time: "5h ago", stats: "3,240 kg · 42 min · 1 PR", caption: "Bench moved better than expected today.", likes: 18, comments: 3, liked: false },
];

export default function SocialPage() {
  const [query, setQuery] = useState("");
  const [posts, setPosts] = useState(initialPosts);
  const [following, setFollowing] = useState<string[]>([]);

  const filteredAthletes = query.trim() ? athletes.filter((athlete) => `${athlete.name} ${athlete.handle}`.toLowerCase().includes(query.toLowerCase())) : [];

  function toggleLike(id: string) {
    setPosts((current) => current.map((post) => post.id === id ? { ...post, liked: !post.liked, likes: post.likes + (post.liked ? -1 : 1) } : post));
  }

  function toggleFollow(id: string) {
    setFollowing((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <>
      <ScreenHeader eyebrow="Social" title="Train together" subtitle="Workouts, progress, and people who keep showing up." />
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/80 px-3 py-2.5"><Search size={17} className="text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find athletes" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600" /></label>
          <Button variant="secondary" aria-label="Notifications"><Bell size={17} /></Button>
        </div>

        {filteredAthletes.length > 0 ? <SectionCard title="People on FITOS">
          <div className="space-y-2">{filteredAthletes.map((athlete) => <div key={athlete.id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-950/50 p-3"><Link href={`/social/profile/${athlete.id}`} className="flex min-w-0 flex-1 items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-semibold text-emerald-200">{athlete.initials}</span><span><strong className="block text-sm text-white">{athlete.name}</strong><span className="text-xs text-slate-500">{athlete.handle}</span></span></Link><Button variant="secondary" onClick={() => toggleFollow(athlete.id)}>{following.includes(athlete.id) ? "Following" : "Follow"}</Button></div>)}</div>
        </SectionCard> : null}

        <SectionCard title="Discover athletes" action={<Link href="#discover" className="text-xs text-emerald-300">See all</Link>}>
          <div className="flex gap-2 overflow-x-auto pb-1">{athletes.map((athlete) => <Link href={`/social/profile/${athlete.id}`} key={athlete.id} className="min-w-[160px] rounded-2xl border border-white/10 bg-slate-950/60 p-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-emerald-200">{athlete.initials}</span><p className="mt-3 text-sm font-semibold text-white">{athlete.name}</p><p className="mt-1 text-xs text-slate-500">{athlete.note}</p></Link>)}</div>
        </SectionCard>

        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-300">Following feed</h2><span className="text-xs text-slate-500">Latest first</span></div>
        {posts.map((post) => <article key={post.id} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.3)]"><div className="flex items-center gap-3"><Link href={`/social/profile/${post.athlete.id}`} className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-semibold text-emerald-200">{post.athlete.initials}</Link><Link href={`/social/profile/${post.athlete.id}`} className="min-w-0 flex-1"><strong className="block text-sm text-white">{post.athlete.name}</strong><span className="text-xs text-slate-500">{post.time} · workout post</span></Link><button aria-label="Save workout" className="text-slate-500 hover:text-white"><Bookmark size={18} /></button></div><Link href={`/social/post/${post.id}`} className="mt-4 block rounded-2xl border border-emerald-300/15 bg-[linear-gradient(135deg,rgba(16,185,129,.12),rgba(15,23,42,.7))] p-4"><p className="text-xs uppercase tracking-[0.14em] text-emerald-200">Workout</p><h3 className="mt-2 text-xl font-semibold text-white">{post.title}</h3><p className="mt-1 text-sm text-slate-300">{post.stats}</p><p className="mt-4 text-sm leading-6 text-slate-400">{post.caption}</p><span className="mt-4 inline-flex items-center gap-1 text-xs text-emerald-300">View full workout <ChevronRight size={14} /></span></Link><div className="mt-3 flex items-center gap-5 text-sm text-slate-400"><button onClick={() => toggleLike(post.id)} className={`flex items-center gap-1.5 ${post.liked ? "text-rose-300" : "hover:text-white"}`}><Heart size={17} fill={post.liked ? "currentColor" : "none"} />{post.likes}</button><button className="flex items-center gap-1.5 hover:text-white"><MessageCircle size={17} />{post.comments}</button><button className="ml-auto flex items-center gap-1.5 hover:text-white"><Share2 size={17} />Share</button></div></article>)}

        <SectionCard title="Your circle" action={<Users size={17} className="text-emerald-300" />}><p className="text-sm leading-6 text-slate-400">Follow athletes to build a chronological feed of workouts, PRs, and activity. Private profiles and workouts stay protected by the backend.</p></SectionCard>
      </div>
    </>
  );
}