"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bookmark,
  ChevronRight,
  Copy,
  Download,
  LogOut,
  MessageCircle,
  Moon,
  Plug,
  QrCode,
  Ruler,
  Settings,
  Share2,
  Target,
  Upload,
} from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

import { useAuth, useProfile } from "@/components/auth/AuthProvider";
import { AdminUsageCard } from "@/components/profile/AdminUsageCard";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SectionCard } from "@/components/ui/SectionCard";
import { Sheet } from "@/components/ui/Sheet";
import { StatCard } from "@/components/ui/StatCard";
import { Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { signOut } from "@/lib/data/auth";
import { listMeasurements } from "@/lib/data/body";
import { exportMyData } from "@/lib/data/export";
import { getProfileCard, updateMyProfile, uploadAvatar } from "@/lib/data/profile";
import { GOALS } from "@/lib/logic/dashboard";
import { formatVolume, formatWeight } from "@/lib/logic/units";

const VISIBILITY_LABEL = { private: "Only me", friends: "Followers", public: "Everyone" } as const;

export default function ProfilePage() {
  const profile = useProfile();
  const { refreshProfile } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState(false);
  const [profileLink, setProfileLink] = useState("");

  useEffect(() => setProfileLink(`${window.location.origin}/social/profile?id=${profile.id}`), [profile.id]);

  const card = useQuery({ queryKey: ["profile-card", profile.id], queryFn: () => getProfileCard(profile.id) });
  const measurements = useQuery({ queryKey: ["measurements"], queryFn: () => listMeasurements(30) });
  const latestWeight = measurements.data?.find((item) => item.weight_kg !== null)?.weight_kg ?? null;

  const avatar = useMutation({
    mutationFn: async (file: File) => updateMyProfile({ avatar_url: await uploadAvatar(file) }),
    onSuccess: () => {
      toast("Photo updated", "success");
      void refreshProfile();
      void queryClient.invalidateQueries({ queryKey: ["profile-card"] });
    },
    onError: (error) => toast(error.message, "error"),
  });

  const exporter = useMutation({
    mutationFn: exportMyData,
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `fitos-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Export downloaded", "success");
    },
    onError: (error) => toast(error.message, "error"),
  });

  function shareProfile() {
    if (navigator.share) {
      navigator.share({ title: `${profile.display_name} on FitOS`, url: profileLink }).catch(() => undefined);
    } else {
      void copyLink();
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(profileLink);
      toast("Profile link copied", "success");
    } catch {
      toast("Could not copy. Long-press the link instead.", "error");
    }
  }

  async function openQr() {
    setQrOpen(true);
    if (!qr) setQr(await QRCode.toDataURL(profileLink, { width: 480, margin: 1, color: { dark: "#0B1220", light: "#ffffff" } }));
  }

  const goalLabel = GOALS.find((goal) => goal.value === profile.goal)?.label ?? "Not set";

  return (
    <PullToRefresh onRefresh={() => Promise.all([card.refetch(), measurements.refetch(), refreshProfile()])}>
      <ScreenHeader eyebrow="Profile" title={profile.display_name || "Your profile"} subtitle={goalLabel} />

      <div className="space-y-5">
        <section className="flex items-center gap-4 rounded-3xl border border-white/10 bg-slate-900/80 p-4">
          <button className="relative" onClick={() => fileInput.current?.click()} aria-label="Change profile photo" disabled={avatar.isPending}>
            <Avatar name={profile.display_name} url={profile.avatar_url} size="xl" />
            <span className="absolute bottom-0 right-0 rounded-full bg-emerald-400 p-1 text-slate-950">
              <Upload size={12} />
            </span>
          </button>
          <input
            ref={fileInput}
            hidden
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) avatar.mutate(file);
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-white">@{profile.username}</p>
            {card.isPending ? (
              <Skeleton className="mt-2 h-4 w-40" />
            ) : (
              <p className="mt-1 text-sm text-slate-400">
                {card.data?.followers ?? 0} followers · {card.data?.following ?? 0} following
              </p>
            )}
            {profile.bio ? <p className="mt-1 line-clamp-2 text-xs text-slate-500">{profile.bio}</p> : null}
          </div>
        </section>

        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" className="gap-2" onClick={shareProfile}>
            <Share2 size={15} />
            Share
          </Button>
          <Button variant="secondary" className="gap-2" onClick={() => void copyLink()}>
            <Copy size={15} />
            Link
          </Button>
          <Button variant="secondary" className="gap-2" onClick={() => void openQr()}>
            <QrCode size={15} />
            QR
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Workouts" value={card.data ? String(card.data.workouts ?? 0) : "–"} hint="all time" />
          <StatCard label="Streak" value={card.data ? `${card.data.streak ?? 0}d` : "–"} hint="active days" accent />
          <StatCard label="30 days" value={card.data ? formatVolume(card.data.volume_30d ?? 0, profile.unit_system) : "–"} hint="volume" />
        </div>

        <SectionCard title="Goals" action={<Link href="/profile/edit" className="text-xs text-emerald-300">Edit</Link>}>
          <div className="grid gap-3 text-sm text-slate-300">
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2">
              <span>Bodyweight</span>
              <strong className="text-white">{latestWeight !== null ? formatWeight(latestWeight, profile.unit_system) : "Not logged"}</strong>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2">
              <span>Calories</span>
              <strong className="text-white">{profile.calorie_target.toLocaleString()} kcal</strong>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2">
              <span>Protein</span>
              <strong className="text-white">{profile.protein_target_g} g</strong>
            </div>
          </div>
        </SectionCard>

        <AdminUsageCard />

        <SectionCard title="Privacy & sync">
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
              <span>New workouts visible to</span>
              <strong className="text-white">{VISIBILITY_LABEL[profile.default_visibility]}</strong>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
              <span>Account</span>
              <strong className="text-white">{profile.is_private ? "Private, approve followers" : "Public"}</strong>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
              <span>Units</span>
              <strong className="text-white">{profile.unit_system === "metric" ? "kg / cm" : "lb / in"}</strong>
            </div>
          </div>
        </SectionCard>

        <div className="grid grid-cols-2 gap-2">
          <Link href="/profile/edit" className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700">
            <Target size={15} /> Goals
          </Link>
          <Button variant="secondary" className="w-full gap-2" onClick={() => setIntegrations(true)}>
            <Plug size={15} /> Integrations
          </Button>
          <Link href="/profile/body" className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700">
            <Ruler size={15} /> Body data
          </Link>
          <Button variant="ghost" className="w-full gap-2" disabled={exporter.isPending} onClick={() => exporter.mutate()}>
            <Download size={15} /> {exporter.isPending ? "Exporting…" : "Export"}
          </Button>
        </div>

        <SectionCard title="More">
          <div className="divide-y divide-white/5">
            {[
              { href: "/chat", label: "Messages", icon: MessageCircle },
              { href: "/activity", label: "Activity and GPS", icon: Activity },
              { href: "/recovery", label: "Recovery check-in", icon: Moon },
              { href: "/social?tab=saved", label: "Saved posts", icon: Bookmark },
              { href: "/profile/edit", label: "Edit profile and privacy", icon: Settings },
            ].map((item) => (
              <Link key={item.href} href={item.href} className="flex items-center gap-3 py-3 text-sm text-white">
                <item.icon size={16} className="text-emerald-300" />
                <span className="flex-1">{item.label}</span>
                <ChevronRight size={16} className="text-slate-500" />
              </Link>
            ))}
          </div>
        </SectionCard>

        <Button
          variant="ghost"
          className="w-full gap-2 text-rose-300"
          onClick={() => {
            if (window.confirm("Sign out of FitOS on this device?")) void signOut();
          }}
        >
          <LogOut size={15} />
          Sign out
        </Button>
      </div>

      <Sheet open={qrOpen} onClose={() => setQrOpen(false)} title="Your profile QR">
        <div className="flex flex-col items-center gap-3 pb-4">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code linking to your FitOS profile" className="h-60 w-60 rounded-2xl bg-white p-2" />
          ) : (
            <Skeleton className="h-60 w-60" />
          )}
          <p className="text-center text-sm text-slate-400">Friends scan this with their camera to open your profile and follow you.</p>
        </div>
      </Sheet>

      <Sheet open={integrations} onClose={() => setIntegrations(false)} title="Integrations">
        <div className="space-y-3 pb-2 text-sm leading-6 text-slate-300">
          <p>
            <strong className="text-white">Apple Health and Health Connect</strong> are not available to web apps. iOS only lets native App Store apps read Health data.
          </p>
          <p>
            <strong className="text-white">GPS</strong> works directly in FitOS. Record runs, rides and walks from Activity, or import a GPX file exported from your watch.
          </p>
          <p>
            <strong className="text-white">Resting heart rate and sleep</strong> can be entered in the daily Recovery check-in.
          </p>
          <Link href="/activity" onClick={() => setIntegrations(false)} className="flex w-full items-center justify-center rounded-xl bg-accent py-2.5 text-sm font-semibold text-ink">
            Open Activity
          </Link>
        </div>
      </Sheet>
    </PullToRefresh>
  );
}
