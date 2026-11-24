"use client";

import type { Goal, UnitSystem, Visibility } from "@fitos/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { CoachSettings } from "@/components/profile/CoachSettings";

import { useAuth, useProfile } from "@/components/auth/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Field, Segmented, SelectInput, TextArea, TextInput } from "@/components/ui/Field";
import { SectionCard } from "@/components/ui/SectionCard";
import { useToast } from "@/components/ui/Toast";
import { isUsernameAvailable, normalizeUsername, updateMyProfile } from "@/lib/data/profile";
import { GOALS } from "@/lib/logic/dashboard";
import { fromDisplayLength, lengthUnit, toDisplayLength } from "@/lib/logic/units";

export default function EditProfilePage() {
  const profile = useProfile();
  const { refreshProfile } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    display_name: profile.display_name,
    username: profile.username ?? "",
    bio: profile.bio ?? "",
    unit_system: profile.unit_system as UnitSystem,
    goal: (profile.goal ?? "general") as Goal,
    height: profile.height_cm !== null ? String(toDisplayLength(profile.height_cm, profile.unit_system)) : "",
    default_visibility: profile.default_visibility as Visibility,
    is_private: profile.is_private,
    calorie_target: String(profile.calorie_target),
    protein_target_g: String(profile.protein_target_g),
    carbs_target_g: String(profile.carbs_target_g),
    fat_target_g: String(profile.fat_target_g),
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm({ ...form, [key]: value });
  const digits = (value: string) => value.replace(/\D/g, "").slice(0, 5);

  const save = useMutation({
    mutationFn: async () => {
      const username = normalizeUsername(form.username);
      if (username.length < 3) throw new Error("Usernames need at least 3 letters, numbers or underscores.");
      if (username !== profile.username && !(await isUsernameAvailable(username))) throw new Error(`@${username} is taken.`);
      const calories = Number(form.calorie_target);
      if (!(calories >= 800 && calories <= 8000)) throw new Error("Calorie target must be between 800 and 8000.");
      return updateMyProfile({
        display_name: form.display_name.trim(),
        username,
        bio: form.bio.trim() || null,
        unit_system: form.unit_system,
        goal: form.goal,
        height_cm: form.height ? fromDisplayLength(Number(form.height), form.unit_system) : null,
        default_visibility: form.default_visibility,
        is_private: form.is_private,
        calorie_target: calories,
        protein_target_g: Number(form.protein_target_g) || 0,
        carbs_target_g: Number(form.carbs_target_g) || 0,
        fat_target_g: Number(form.fat_target_g) || 0,
      });
    },
    onSuccess: async () => {
      toast("Profile saved", "success");
      await refreshProfile();
      void queryClient.invalidateQueries({ queryKey: ["profile-card"] });
      router.push("/profile");
    },
    onError: (error) => toast(error.message, "error"),
  });

  return (
    <>
      <Link href="/profile" className="mb-5 inline-flex items-center gap-2 text-sm text-slate-400">
        <ArrowLeft size={16} /> Profile
      </Link>
      <ScreenHeader eyebrow="Profile" title="Edit profile" subtitle="Name, goals, targets and privacy" />
      <form
        className="space-y-5"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <SectionCard title="About you">
          <div className="space-y-3">
            <Field label="Display name">
              <TextInput value={form.display_name} onChange={(event) => set("display_name", event.target.value)} />
            </Field>
            <Field label="Username">
              <TextInput autoCapitalize="none" value={form.username} onChange={(event) => set("username", normalizeUsername(event.target.value))} />
            </Field>
            <Field label="Bio">
              <TextArea value={form.bio} onChange={(event) => set("bio", event.target.value.slice(0, 160))} placeholder="Strength-first. Consistency over intensity." />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Goals and targets">
          <div className="space-y-3">
            <Field label="Main goal">
              <SelectInput value={form.goal} onChange={(event) => set("goal", event.target.value as Goal)}>
                {GOALS.map((goal) => (
                  <option key={goal.value} value={goal.value}>
                    {goal.label}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Calories">
                <TextInput inputMode="numeric" value={form.calorie_target} onChange={(event) => set("calorie_target", digits(event.target.value))} />
              </Field>
              <Field label="Protein (g)">
                <TextInput inputMode="numeric" value={form.protein_target_g} onChange={(event) => set("protein_target_g", digits(event.target.value))} />
              </Field>
              <Field label="Carbs (g)">
                <TextInput inputMode="numeric" value={form.carbs_target_g} onChange={(event) => set("carbs_target_g", digits(event.target.value))} />
              </Field>
              <Field label="Fat (g)">
                <TextInput inputMode="numeric" value={form.fat_target_g} onChange={(event) => set("fat_target_g", digits(event.target.value))} />
              </Field>
            </div>
            <Field label={`Height (${lengthUnit(form.unit_system)})`}>
              <TextInput inputMode="decimal" value={form.height} onChange={(event) => set("height", event.target.value.replace(/[^\d.]/g, ""))} />
            </Field>
            <Field label="Units">
              <Segmented
                value={form.unit_system}
                onChange={(value) => set("unit_system", value)}
                options={[
                  { value: "metric", label: "kg / cm" },
                  { value: "imperial", label: "lb / in" },
                ]}
              />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Privacy">
          <div className="space-y-3">
            <Field label="Who sees new workouts by default">
              <Segmented
                value={form.default_visibility}
                onChange={(value) => set("default_visibility", value)}
                options={[
                  { value: "private", label: "Only me" },
                  { value: "friends", label: "Followers" },
                  { value: "public", label: "Everyone" },
                ]}
              />
            </Field>
            <label className="flex items-start gap-3 text-sm text-slate-300">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-emerald-400" checked={form.is_private} onChange={(event) => set("is_private", event.target.checked)} />
              <span>
                <strong className="block text-white">Private account</strong>
                You approve every new follower. Only approved followers see your posts and stats.
              </span>
            </label>
          </div>
        </SectionCard>

        <Button type="submit" className="w-full" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      </form>
      <div className="mt-5">
        <CoachSettings />
      </div>
    </>
  );
}
