"use client";

import { useRef, useState } from "react";
import { Copy, LogOut, MessageCircle, QrCode, Share2, Upload } from "lucide-react";
import Image from "next/image";

import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Button } from "@/components/ui/Button";
import { signOut } from "@/lib/data/auth";

export default function ProfilePage() {
  const [avatar, setAvatar] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const profileLink = "https://fitos.app/u/alex-morgan";

  async function shareProfile() {
    if (navigator.share) await navigator.share({ title: "Alex Morgan on FITOS", url: profileLink });
    else await navigator.clipboard?.writeText(profileLink);
  }

  return (
    <>
      <ScreenHeader
        eyebrow="Profile"
        title="Alex Morgan"
        subtitle="Strength • nutrition • recovery"
      />

      <div className="space-y-5">
        <section className="flex items-center gap-4 rounded-3xl border border-white/10 bg-slate-900/80 p-4">
          <button className="relative h-20 w-20 overflow-hidden rounded-full border border-emerald-300/30 bg-slate-800" onClick={() => fileInput.current?.click()} aria-label="Change profile photo">
            {avatar ? <Image src={avatar} alt="Profile" fill unoptimized className="object-cover" /> : <span className="flex h-full items-center justify-center text-2xl font-semibold text-emerald-300">AM</span>}
            <span className="absolute bottom-0 right-0 rounded-full bg-emerald-400 p-1 text-slate-950"><Upload size={12} /></span>
          </button>
          <input ref={fileInput} hidden type="file" accept="image/*" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) setAvatar(URL.createObjectURL(file));
          }} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-white">@alexmorgan</p>
            <p className="text-sm text-slate-400">FITOS ID · fitos_8K2M4</p>
            <p className="mt-1 text-xs text-slate-500">76 followers · 24 following</p>
          </div>
        </section>

        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" className="gap-2" onClick={shareProfile}><Share2 size={15} />Share</Button>
          <Button variant="secondary" className="gap-2" onClick={() => navigator.clipboard?.writeText(profileLink)}><Copy size={15} />Link</Button>
          <Button variant="secondary" className="gap-2"><QrCode size={15} />QR</Button>
        </div>

        <SectionCard title="Social">
          <Button variant="secondary" className="w-full gap-2" onClick={() => window.location.assign("/chat")}><MessageCircle size={16} />Open messages</Button>
        </SectionCard>
        <SectionCard title="Goals">
          <div className="grid gap-3 text-sm text-slate-300">
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2">
              <span>Bodyweight</span>
              <strong className="text-white">76.5 kg</strong>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2">
              <span>Calories</span>
              <strong className="text-white">2,100 kcal</strong>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2">
              <span>Protein</span>
              <strong className="text-white">160 g</strong>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Privacy & sync">
          <div className="space-y-2">
            <div className="rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">Visibility: friends</div>
            <div className="rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">Apple Health: connected</div>
            <div className="rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">Food AI consent: off</div>
          </div>
        </SectionCard>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" className="w-full">Goals</Button>
          <Button variant="secondary" className="w-full">Integrations</Button>
          <Button variant="secondary" className="w-full">Body data</Button>
          <Button variant="ghost" className="w-full">Export</Button>
        </div>
        <Button variant="ghost" className="w-full gap-2 text-rose-300" onClick={() => void signOut()}><LogOut size={15} />Sign out</Button>
      </div>
    </>
  );
}
