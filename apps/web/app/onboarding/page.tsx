"use client";

import type { Goal, UnitSystem, Visibility } from "@fitos/types";
import { useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import { useAuth, useProfile } from "@/components/auth/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Field, Segmented, SelectInput, TextInput } from "@/components/ui/Field";
import { addMeasurement } from "@/lib/data/body";
import { isUsernameAvailable, normalizeUsername, updateMyProfile, uploadAvatar } from "@/lib/data/profile";
import { GOALS, suggestedTargets } from "@/lib/logic/dashboard";
import { ACTIVITY, type ActivityLevel, type Sex } from "@/lib/logic/targets";
import { fromDisplayLength, fromDisplayWeight, lengthUnit, weightUnit } from "@/lib/logic/units";

export default function OnboardingPage() {
  const profile = useProfile();
  const { refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState(profile.username ?? "");
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [units, setUnits] = useState<UnitSystem>(profile.unit_system);
  const [goal, setGoal] = useState<Goal>(profile.goal ?? "general");
  const [visibility, setVisibility] = useState<Visibility>("friends");
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [sex, setSex] = useState<Sex>("other");
  const [birthYear, setBirthYear] = useState("");
  const [activity, setActivity] = useState<ActivityLevel>("moderate");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile.avatar_url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const handle = normalizeUsername(username);
    if (handle.length < 3) {
      setError("Usernames need at least 3 letters, numbers or underscores.");
      return;
    }
    if (!displayName.trim()) {
      setError("Add the name your friends know you by.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!(await isUsernameAvailable(handle))) {
        setError(`@${handle} is taken. Try another.`);
        setBusy(false);
        return;
      }
      const weightKg = weight ? fromDisplayWeight(Number(weight), units) : null;
      const heightCm = height ? fromDisplayLength(Number(height), units) : null;
      const avatarUrl = avatarFile ? await uploadAvatar(avatarFile) : profile.avatar_url;
      await updateMyProfile({
        username: handle,
        display_name: displayName.trim(),
        avatar_url: avatarUrl,
        unit_system: units,
        goal,
        default_visibility: visibility,
        height_cm: heightCm,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        sex,
        birth_year: birthYear ? Number(birthYear) : null,
        activity_level: activity,
        ...suggestedTargets({ weightKg, heightCm, goal, sex, activity, age: birthYear ? new Date().getFullYear() - Number(birthYear) : null }),
        onboarded_at: new Date().toISOString(),
      });
      if (weightKg) {
        await addMeasurement({
          measured_at: new Date().toISOString(),
          weight_kg: weightKg,
          body_fat_pct: null,
          waist_cm: null,
          chest_cm: null,
          arms_cm: null,
          legs_cm: null,
          notes: null,
        });
      }
      await queryClient.invalidateQueries();
      await refreshProfile();
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile.");
      setBusy(false);
    }
  }

  return (
    <>
      <ScreenHeader eyebrow="Welcome" title="Set up your profile" subtitle="This is what your friends will see." />
      <form className="space-y-5" onSubmit={submit}>
        <div className="flex items-center gap-4">
          <button type="button" className="relative" onClick={() => fileInput.current?.click()} aria-label="Choose profile photo">
            <Avatar name={displayName || username} url={avatarPreview} size="xl" />
            <span className="absolute bottom-0 right-0 rounded-full bg-emerald-400 p-1.5 text-slate-950">
              <Camera size={13} />
            </span>
          </button>
          <p className="text-sm text-slate-400">Add a photo so friends recognise you. It is compressed before upload.</p>
          <input
            ref={fileInput}
            hidden
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setAvatarFile(file);
              setAvatarPreview(URL.createObjectURL(file));
            }}
          />
        </div>

        <Field label="Username" hint="Letters, numbers and underscores.">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">@</span>
            <TextInput
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(event) => setUsername(normalizeUsername(event.target.value))}
              placeholder="alexlifts"
            />
          </div>
        </Field>
        <Field label="Display name">
          <TextInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Alex Morgan" />
        </Field>

        <Field label="Units">
          <Segmented
            value={units}
            onChange={setUnits}
            options={[
              { value: "metric", label: "kg / cm" },
              { value: "imperial", label: "lb / in" },
            ]}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`Weight (${weightUnit(units)})`}>
            <TextInput inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value.replace(/[^\d.]/g, ""))} placeholder="Optional" />
          </Field>
          <Field label={`Height (${lengthUnit(units)})`}>
            <TextInput inputMode="decimal" value={height} onChange={(event) => setHeight(event.target.value.replace(/[^\d.]/g, ""))} placeholder="Optional" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Sex" hint="For the BMR formula.">
            <SelectInput value={sex} onChange={(event) => setSex(event.target.value as Sex)}>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Prefer not to say</option>
            </SelectInput>
          </Field>
          <Field label="Birth year">
            <TextInput inputMode="numeric" value={birthYear} onChange={(event) => setBirthYear(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1995" />
          </Field>
        </div>
        <Field label="Activity">
          <SelectInput value={activity} onChange={(event) => setActivity(event.target.value as ActivityLevel)}>
            {ACTIVITY.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Main goal" hint="Used to suggest calorie and protein targets. You can change them later.">
          <SelectInput value={goal} onChange={(event) => setGoal(event.target.value as Goal)}>
            {GOALS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Who sees new workouts by default">
          <Segmented
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: "private", label: "Only me" },
              { value: "friends", label: "Followers" },
              { value: "public", label: "Everyone" },
            ]}
          />
        </Field>

        {error ? <p className="rounded-xl border border-rose-400/20 bg-rose-500/5 p-3 text-sm text-rose-200">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Saving…" : "Start using FitOS"}
        </Button>
      </form>
    </>
  );
}
