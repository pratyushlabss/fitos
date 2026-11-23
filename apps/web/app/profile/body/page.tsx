"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Lock, Trash2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useProfile } from "@/components/auth/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SectionCard } from "@/components/ui/SectionCard";
import { Sheet } from "@/components/ui/Sheet";
import { EmptyState, QueryView, Skeleton, SkeletonList } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { addMeasurement, addProgressPhoto, deleteMeasurement, deleteProgressPhoto, listMeasurements, listProgressPhotos, type ProgressPhotoWithUrl } from "@/lib/data/body";
import { shortDate } from "@/lib/logic/format";
import { fromDisplayLength, fromDisplayWeight, lengthUnit, toDisplayLength, toDisplayWeight, weightUnit } from "@/lib/logic/units";

const LENGTH_FIELDS = [
  { key: "waist", label: "Waist" },
  { key: "chest", label: "Chest" },
  { key: "arms", label: "Arms" },
  { key: "legs", label: "Legs" },
] as const;

export default function BodyPage() {
  const units = useProfile().unit_system;
  const toast = useToast();
  const queryClient = useQueryClient();
  const photoInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ weight: "", body_fat: "", waist: "", chest: "", arms: "", legs: "" });
  const [viewing, setViewing] = useState<ProgressPhotoWithUrl | null>(null);

  const measurements = useQuery({ queryKey: ["measurements"], queryFn: () => listMeasurements(120) });
  const photos = useQuery({ queryKey: ["progress-photos"], queryFn: listProgressPhotos });

  const chart = useMemo(
    () =>
      [...(measurements.data ?? [])]
        .filter((item) => item.weight_kg !== null)
        .reverse()
        .map((item) => ({
          date: new Date(item.measured_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          weight: toDisplayWeight(item.weight_kg!, units),
        })),
    [measurements.data, units],
  );

  const add = useMutation({
    mutationFn: () => {
      const length = (value: string) => (value ? fromDisplayLength(Number(value), units) : null);
      return addMeasurement({
        measured_at: new Date().toISOString(),
        weight_kg: form.weight ? fromDisplayWeight(Number(form.weight), units) : null,
        body_fat_pct: form.body_fat ? Number(form.body_fat) : null,
        waist_cm: length(form.waist),
        chest_cm: length(form.chest),
        arms_cm: length(form.arms),
        legs_cm: length(form.legs),
        notes: null,
      });
    },
    onSuccess: () => {
      toast("Logged", "success");
      setForm({ weight: "", body_fat: "", waist: "", chest: "", arms: "", legs: "" });
      void queryClient.invalidateQueries({ queryKey: ["measurements"] });
    },
    onError: (error) => toast(error.message, "error"),
  });

  const remove = useMutation({
    mutationFn: deleteMeasurement,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["measurements"] }),
    onError: (error) => toast(error.message, "error"),
  });

  const upload = useMutation({
    mutationFn: (file: File) => addProgressPhoto(file, null),
    onSuccess: () => {
      toast("Photo saved privately", "success");
      void queryClient.invalidateQueries({ queryKey: ["progress-photos"] });
    },
    onError: (error) => toast(error.message, "error"),
  });

  const removePhoto = useMutation({
    mutationFn: deleteProgressPhoto,
    onSuccess: () => {
      setViewing(null);
      void queryClient.invalidateQueries({ queryKey: ["progress-photos"] });
    },
    onError: (error) => toast(error.message, "error"),
  });

  const clean = (value: string) => value.replace(/[^\d.]/g, "").slice(0, 6);
  const hasInput = Object.values(form).some(Boolean);

  return (
    <PullToRefresh onRefresh={() => Promise.all([measurements.refetch(), photos.refetch()])}>
      <Link href="/profile" className="mb-5 inline-flex items-center gap-2 text-sm text-slate-400">
        <ArrowLeft size={16} /> Profile
      </Link>
      <ScreenHeader eyebrow="Body" title="Body data" subtitle="Weight, measurements and private progress photos" />
      <div className="space-y-5">
        <SectionCard title={`Weight trend (${weightUnit(units)})`}>
          {measurements.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : chart.length < 2 ? (
            <EmptyState title="Not enough data yet" body="Log your weight on two or more days to see a trend." />
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,.12)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#8B98B3", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#8B98B3", fontSize: 11 }} tickLine={false} axisLine={false} domain={["dataMin - 1", "dataMax + 1"]} />
                  <Tooltip contentStyle={{ background: "#121A2B", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, color: "#fff" }} />
                  <Line type="monotone" dataKey="weight" stroke="#3DDC97" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Log today">
          <form
            className="space-y-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (hasInput) add.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <Field label={`Weight (${weightUnit(units)})`}>
                <TextInput inputMode="decimal" value={form.weight} onChange={(event) => setForm({ ...form, weight: clean(event.target.value) })} />
              </Field>
              <Field label="Body fat (%)">
                <TextInput inputMode="decimal" value={form.body_fat} onChange={(event) => setForm({ ...form, body_fat: clean(event.target.value) })} />
              </Field>
              {LENGTH_FIELDS.map((item) => (
                <Field key={item.key} label={`${item.label} (${lengthUnit(units)})`}>
                  <TextInput inputMode="decimal" value={form[item.key]} onChange={(event) => setForm({ ...form, [item.key]: clean(event.target.value) })} />
                </Field>
              ))}
            </div>
            <Button type="submit" className="w-full" disabled={!hasInput || add.isPending}>
              {add.isPending ? "Saving…" : "Save entry"}
            </Button>
          </form>
        </SectionCard>

        <SectionCard title="History">
          <QueryView
            query={measurements}
            isEmpty={(data) => data.length === 0}
            empty={<EmptyState title="No entries yet" body="Your weight and measurements will be listed here." />}
          >
            {(data) => (
              <div className="space-y-2">
                {data.slice(0, 30).map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-slate-950/60 p-3 text-sm">
                    <div className="min-w-0">
                      <p className="text-white">{item.weight_kg !== null ? `${toDisplayWeight(item.weight_kg, units)} ${weightUnit(units)}` : "Measurements"}</p>
                      <p className="truncate text-xs text-slate-500">
                        {shortDate(item.measured_at)}
                        {item.body_fat_pct !== null ? ` · ${item.body_fat_pct}% fat` : ""}
                        {LENGTH_FIELDS.map((field) => {
                          const value = item[`${field.key}_cm` as const];
                          return value !== null ? ` · ${field.label.toLowerCase()} ${toDisplayLength(value, units)}` : "";
                        }).join("")}
                      </p>
                    </div>
                    <button className="p-1 text-slate-500 hover:text-rose-300" aria-label="Delete entry" onClick={() => window.confirm("Delete this entry?") && remove.mutate(item.id)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </QueryView>
        </SectionCard>

        <SectionCard title="Progress photos" action={<span className="inline-flex items-center gap-1 text-xs text-slate-500"><Lock size={12} /> Only you</span>}>
          <input
            ref={photoInput}
            hidden
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload.mutate(file);
            }}
          />
          <QueryView
            query={photos}
            skeleton={<SkeletonList rows={1} height="h-28" />}
            isEmpty={(data) => data.length === 0}
            empty={<EmptyState title="No progress photos" body="Photos are compressed, stripped of location data and visible only to you." />}
          >
            {(data) => (
              <div className="grid grid-cols-3 gap-2">
                {data.map((photo) => (
                  <button key={photo.id} className="aspect-[3/4] overflow-hidden rounded-xl bg-slate-800" onClick={() => setViewing(photo)} aria-label={`Photo from ${shortDate(photo.taken_at)}`}>
                    {photo.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </QueryView>
          <Button variant="secondary" className="mt-3 w-full gap-2" disabled={upload.isPending} onClick={() => photoInput.current?.click()}>
            <Camera size={15} /> {upload.isPending ? "Uploading…" : "Add photo"}
          </Button>
        </SectionCard>
      </div>

      <Sheet open={viewing !== null} onClose={() => setViewing(null)} title={viewing ? shortDate(viewing.taken_at) : "Photo"}>
        {viewing ? (
          <div className="space-y-3 pb-2">
            {viewing.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewing.url} alt="Progress photo" className="max-h-[60dvh] w-full rounded-2xl object-contain" />
            ) : null}
            <Button variant="ghost" className="w-full gap-2 text-rose-300" disabled={removePhoto.isPending} onClick={() => window.confirm("Delete this photo?") && removePhoto.mutate(viewing)}>
              <Trash2 size={15} /> Delete photo
            </Button>
          </div>
        ) : null}
      </Sheet>
    </PullToRefresh>
  );
}
