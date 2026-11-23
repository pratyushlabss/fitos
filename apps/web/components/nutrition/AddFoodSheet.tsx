"use client";

import type { FavouriteMeal, FoodDraft, FoodHit, MealItemSource, MealType, ServingUnit } from "@fitos/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, Plus, Search, Star, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { DraftReview, SourceBadge } from "@/components/nutrition/DraftReview";
import { Button } from "@/components/ui/Button";
import { Field, Segmented, SelectInput, TextArea, TextInput } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/States";
import {
  analyzePhoto,
  analyzeText,
  createMyFood,
  deleteFavourite,
  listFavourites,
  logFavourite,
  logItems,
  lookupBarcode,
  myFoods,
  recentFoods,
  searchFoods,
} from "@/lib/data/nutrition";
import { MEAL_LABELS, MEAL_TYPES } from "@/lib/logic/dashboard";
import { defaultPortion, draftItemFromHit, macrosFor, UNIT_LABEL } from "@/lib/logic/nutrition";

const BarcodeScanner = dynamic(() => import("./BarcodeScanner").then((mod) => mod.BarcodeScanner), {
  ssr: false,
  loading: () => <div className="h-[200px] animate-pulse rounded-2xl bg-slate-800/70" />,
});

type Tab = "search" | "describe" | "photo" | "barcode" | "manual";
type SearchScope = "recent" | "favourites" | "mine" | "all";
type Review = { draft: FoodDraft; source: MealItemSource; text?: string };

export function AddFoodSheet({
  open,
  onClose,
  day,
  mealType: initialMeal,
  onLogged,
  initialTab = "search",
}: {
  open: boolean;
  onClose: () => void;
  day: string;
  mealType: MealType;
  onLogged: (message: string) => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [mealType, setMealType] = useState<MealType>(initialMeal);
  const [review, setReview] = useState<Review | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setMealType(initialMeal);
    setReview(null);
  }, [open, initialMeal, initialTab]);

  const done = (message: string) => {
    onLogged(message);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={review ? "Review before saving" : `Add to ${MEAL_LABELS[mealType]}`}>
      {review ? (
        <DraftReview
          draft={review.draft}
          mealType={mealType}
          date={day}
          source={review.source}
          onDone={done}
          onCancel={() => setReview(null)}
          onReanalyze={
            review.text
              ? (answer) => {
                  const text = `${review.text} (${answer})`;
                  void analyzeText(text, mealType, day).then(({ draft }) => setReview({ draft, source: "text_ai", text }));
                }
              : undefined
          }
        />
      ) : (
        <div className="space-y-3 pb-2">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {(
              [
                ["search", "Search"],
                ["describe", "Describe"],
                ["photo", "Photo"],
                ["barcode", "Barcode"],
                ["manual", "Manual"],
              ] as Array<[Tab, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${tab === value ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-200" : "border-white/10 text-slate-400"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Segmented value={mealType} onChange={setMealType} options={MEAL_TYPES.map((type) => ({ value: type, label: MEAL_LABELS[type] }))} />
          {tab === "search" ? <SearchTab day={day} mealType={mealType} onLogged={done} /> : null}
          {tab === "describe" ? <DescribeTab day={day} mealType={mealType} onDraft={setReview} onManual={() => setTab("manual")} /> : null}
          {tab === "photo" ? <PhotoTab day={day} mealType={mealType} onDraft={setReview} onManual={() => setTab("manual")} /> : null}
          {tab === "barcode" ? <BarcodeTab onDraft={setReview} onManual={() => setTab("manual")} /> : null}
          {tab === "manual" ? <ManualTab day={day} mealType={mealType} onLogged={done} /> : null}
        </div>
      )}
    </Sheet>
  );
}

function PortionForm({ hit, onAdd, busy }: { hit: FoodHit; onAdd: (quantity: number, unit: ServingUnit) => void; busy: boolean }) {
  const initial = defaultPortion(hit);
  const [quantity, setQuantity] = useState(String(initial.quantity));
  const [unit, setUnit] = useState<ServingUnit>(initial.unit);
  const units = Array.from(new Set<ServingUnit>([initial.unit, ...hit.servings.map((s) => s.unit), "g"]));
  const item = draftItemFromHit(hit, Number(quantity) || 0, unit);
  const m = macrosFor(item);
  return (
    <div className="space-y-2 rounded-2xl border border-emerald-300/15 bg-emerald-300/5 p-3">
      <div className="grid grid-cols-2 gap-2">
        <TextInput inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value.replace(/[^\d.]/g, ""))} aria-label="Quantity" />
        <SelectInput value={unit} onChange={(event) => setUnit(event.target.value as ServingUnit)} aria-label="Unit">
          {units.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABEL[u]}
              {u !== "g" ? ` (${hit.servings.find((s) => s.unit === u)?.grams ?? hit.serving_grams ?? 100} g)` : ""}
            </option>
          ))}
        </SelectInput>
      </div>
      <p className="text-sm text-slate-300">
        {item.grams} g · {Math.round(m.kcal)} kcal · {m.protein_g}P {m.carbs_g}C {m.fat_g}F
      </p>
      <Button className="w-full" disabled={busy || item.grams <= 0} onClick={() => onAdd(Number(quantity) || 0, unit)}>
        {busy ? "Adding…" : "Add to log"}
      </Button>
    </div>
  );
}

function HitList({ hits, onPick, picked }: { hits: FoodHit[]; onPick: (hit: FoodHit) => void; picked: string | null }) {
  return (
    <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-slate-950/50">
      {hits.map((hit) => (
        <li key={hit.food_id}>
          <button className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left ${picked === hit.food_id ? "bg-emerald-400/10" : ""}`} onClick={() => onPick(hit)}>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-white">{hit.name}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                <SourceBadge source={hit.is_own ? "user" : hit.source} />
                {hit.kcal !== null ? `${Math.round(hit.kcal)} kcal / 100 g` : "no nutrition yet"}
              </span>
            </span>
            <Plus size={16} className="shrink-0 text-emerald-300" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function SearchTab({ day, mealType, onLogged }: { day: string; mealType: MealType; onLogged: (message: string) => void }) {
  const [scope, setScope] = useState<SearchScope>("recent");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<FoodHit | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);
  const searching = query.length >= 2;
  const recents = useQuery({ queryKey: ["foods", "recent"], queryFn: () => recentFoods(), enabled: !searching && scope === "recent" });
  const mine = useQuery({ queryKey: ["foods", "mine"], queryFn: myFoods, enabled: !searching && scope === "mine" });
  const favourites = useQuery({ queryKey: ["favourites"], queryFn: listFavourites, enabled: !searching && scope === "favourites" });
  const results = useQuery({ queryKey: ["foods", "search", query], queryFn: () => searchFoods(query), enabled: searching, staleTime: 60_000 });
  const add = useMutation({
    mutationFn: ({ hit, quantity, unit }: { hit: FoodHit; quantity: number; unit: ServingUnit }) => logItems(day, mealType, [draftItemFromHit(hit, quantity, unit)], "search"),
    onSuccess: (_data, { hit }) => onLogged(`Added ${hit.name}`),
  });
  const logFav = useMutation({ mutationFn: (fav: FavouriteMeal) => logFavourite(fav, day, mealType), onSuccess: (_d, fav) => onLogged(`Added ${fav.name}`) });
  const removeFav = useMutation({ mutationFn: deleteFavourite, onSuccess: () => void favourites.refetch() });

  const list = searching ? results : scope === "recent" ? recents : scope === "mine" ? mine : null;
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5">
        <Search size={16} className="text-slate-500" />
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Search dosa, paneer, Vegemite…" className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-600" />
      </label>
      {!searching ? (
        <Segmented
          value={scope}
          onChange={(value) => {
            setScope(value);
            setPicked(null);
          }}
          options={[
            { value: "recent", label: "Recents" },
            { value: "favourites", label: "Favourites" },
            { value: "mine", label: "My foods" },
            { value: "all", label: "All" },
          ]}
        />
      ) : null}
      {picked ? <PortionForm key={picked.food_id} hit={picked} busy={add.isPending} onAdd={(quantity, unit) => add.mutate({ hit: picked, quantity, unit })} /> : null}
      {add.isError ? <p className="text-sm text-rose-300">{add.error.message}</p> : null}

      {!searching && scope === "all" ? <p className="text-xs text-slate-500">Type at least two letters to search every food you can see: yours and the shared database.</p> : null}
      {!searching && scope === "favourites" ? (
        favourites.isPending ? (
          <SkeletonList rows={3} height="h-14" />
        ) : favourites.isError ? (
          <ErrorState message={favourites.error.message} onRetry={() => void favourites.refetch()} />
        ) : (favourites.data ?? []).length === 0 ? (
          <EmptyState icon={<Star size={18} />} title="No favourites yet" body="Save a meal from your log to add it here in one tap." />
        ) : (
          <ul className="space-y-2">
            {favourites.data!.map((fav) => {
              const kcal = Math.round(fav.favourite_meal_items.reduce((sum, i) => sum + i.calories, 0));
              return (
                <li key={fav.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/50 p-3">
                  <button className="min-w-0 flex-1 text-left" disabled={logFav.isPending} onClick={() => logFav.mutate(fav)}>
                    <span className="block truncate text-sm font-medium text-white">{fav.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {kcal} kcal · {fav.favourite_meal_items.map((i) => i.name).join(", ")}
                    </span>
                  </button>
                  <button className="p-1.5 text-slate-500 hover:text-rose-300" aria-label={`Delete ${fav.name}`} onClick={() => window.confirm(`Delete “${fav.name}”?`) && removeFav.mutate(fav.id)}>
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
      {list ? (
        list.isPending ? (
          <SkeletonList rows={5} height="h-12" />
        ) : list.isError ? (
          <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState
            title={searching ? `No foods match “${query}”` : scope === "recent" ? "Nothing logged yet" : "You have not created any foods"}
            body={searching ? "Try Describe to let AI work it out, or Manual to add it yourself." : "Foods appear here as you log them."}
          />
        ) : (
          <HitList hits={list.data!} picked={picked?.food_id ?? null} onPick={setPicked} />
        )
      ) : null}
    </div>
  );
}

function AiFailure({ message, onManual }: { message: string; onManual: () => void }) {
  return (
    <div className="space-y-2 rounded-2xl border border-rose-400/20 bg-rose-500/5 p-3 text-sm text-rose-100">
      <p>{message}</p>
      <Button variant="secondary" className="w-full" onClick={onManual}>
        Log it manually
      </Button>
    </div>
  );
}

function DescribeTab({ day, mealType, onDraft, onManual }: { day: string; mealType: MealType; onDraft: (review: Review) => void; onManual: () => void }) {
  const [text, setText] = useState("");
  const analyze = useMutation({ mutationFn: () => analyzeText(text, mealType, day), onSuccess: ({ draft }) => onDraft({ draft, source: "text_ai", text }) });
  return (
    <div className="space-y-3">
      <TextArea value={text} onChange={(event) => setText(event.target.value.slice(0, 500))} placeholder="2 masala dosa with sambar and chutney, or 1 katori dal and 2 roti" autoFocus />
      <Button className="w-full" disabled={analyze.isPending || text.trim().length < 2} onClick={() => analyze.mutate()}>
        {analyze.isPending ? "Working it out…" : "Work out calories"}
      </Button>
      {analyze.isPending ? <SkeletonList rows={3} height="h-12" /> : null}
      {analyze.isError ? <AiFailure message={analyze.error.message} onManual={onManual} /> : null}
      <p className="text-xs text-slate-500">Known foods are matched from the database first. AI is only used for new dishes, and nothing is saved until you confirm.</p>
    </div>
  );
}

function PhotoTab({ day, mealType, onDraft, onManual }: { day: string; mealType: MealType; onDraft: (review: Review) => void; onManual: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const analyze = useMutation({ mutationFn: (file: File) => analyzePhoto(file, mealType, day), onSuccess: ({ draft }) => onDraft({ draft, source: "photo_ai" }) });
  return (
    <div className="space-y-3">
      <input
        ref={input}
        hidden
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setPreview(URL.createObjectURL(file));
          analyze.mutate(file);
        }}
      />
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Meal" className="h-44 w-full rounded-2xl object-cover" />
      ) : (
        <button className="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-slate-950/50 text-slate-400" onClick={() => input.current?.click()}>
          <Camera size={28} className="text-emerald-300" />
          Photograph your plate or thali
        </button>
      )}
      {analyze.isPending ? <SkeletonList rows={3} height="h-12" /> : null}
      {analyze.isError ? <AiFailure message={analyze.error.message} onManual={onManual} /> : null}
      {preview && !analyze.isPending ? (
        <Button variant="secondary" className="w-full" onClick={() => input.current?.click()}>
          Retake
        </Button>
      ) : null}
      <p className="text-xs text-slate-500">The photo is shrunk to 1024 px and kept private to you.</p>
    </div>
  );
}

function BarcodeTab({ onDraft, onManual }: { onDraft: (review: Review) => void; onManual: () => void }) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  const lookup = useMutation({
    mutationFn: lookupBarcode,
    onSuccess: (result) => {
      if (result.draft) onDraft({ draft: result.draft, source: "barcode" });
      else setMessage(result.message ?? "Product not found.");
    },
  });
  return (
    <div className="space-y-3">
      {scanning ? (
        <BarcodeScanner
          onDetected={(value) => {
            setScanning(false);
            setCode(value);
            lookup.mutate(value);
          }}
        />
      ) : null}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length >= 8) lookup.mutate(code);
        }}
      >
        <TextInput inputMode="numeric" placeholder="Or type the barcode digits" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
        <Button type="submit" disabled={code.length < 8 || lookup.isPending}>
          Look up
        </Button>
      </form>
      {lookup.isPending ? <SkeletonList rows={1} height="h-16" /> : null}
      {lookup.isError ? <AiFailure message={lookup.error.message} onManual={onManual} /> : null}
      {message ? <AiFailure message={message} onManual={onManual} /> : null}
      {!scanning ? (
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => {
            setMessage(null);
            setScanning(true);
          }}
        >
          Scan again
        </Button>
      ) : null}
    </div>
  );
}

function ManualTab({ day, mealType, onLogged }: { day: string; mealType: MealType; onLogged: (message: string) => void }) {
  const [form, setForm] = useState({ name: "", unit: "serving" as ServingUnit, grams: "100", kcal: "", protein: "", carbs: "", fat: "", fibre: "", eaten: "1" });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm({ ...form, [key]: key === "name" || key === "unit" ? event.target.value : event.target.value.replace(/[^\d.]/g, "") });
  const save = useMutation({
    mutationFn: async () => {
      const hit = await createMyFood({
        name: form.name,
        servingUnit: form.unit,
        servingGrams: Number(form.grams) || 100,
        perServing: { kcal: Number(form.kcal) || 0, protein_g: Number(form.protein) || 0, carbs_g: Number(form.carbs) || 0, fat_g: Number(form.fat) || 0, fibre_g: Number(form.fibre) || 0 },
      });
      const quantity = Number(form.eaten) || 1;
      const unit: ServingUnit = form.unit === "g" ? "g" : form.unit;
      await logItems(day, mealType, [draftItemFromHit(hit, unit === "g" ? quantity * (Number(form.grams) || 100) : quantity, unit)], "manual");
      return hit;
    },
    onSuccess: (hit) => onLogged(`Saved ${hit.name} to My foods and logged it`),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (form.name.trim()) save.mutate();
      }}
    >
      <Field label="Food name">
        <TextInput value={form.name} onChange={set("name")} placeholder="Amma's sambar" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Serving">
          <SelectInput value={form.unit} onChange={set("unit")}>
            {(["serving", "katori", "ladle", "piece", "roti", "plate", "cup", "tbsp", "g"] as ServingUnit[]).map((unit) => (
              <option key={unit} value={unit}>
                1 {UNIT_LABEL[unit]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Grams per serving">
          <TextInput inputMode="decimal" value={form.grams} onChange={set("grams")} />
        </Field>
      </div>
      <p className="text-xs text-slate-500">Macros per serving</p>
      <div className="grid grid-cols-5 gap-1.5">
        {(
          [
            ["kcal", "kcal"],
            ["protein", "P"],
            ["carbs", "C"],
            ["fat", "F"],
            ["fibre", "Fib"],
          ] as Array<[keyof typeof form, string]>
        ).map(([key, label]) => (
          <label key={key} className="text-[10px] uppercase text-slate-500">
            {label}
            <input inputMode="decimal" value={form[key]} onChange={set(key)} className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-1.5 py-2 text-center text-base text-white outline-none" />
          </label>
        ))}
      </div>
      <Field label="Servings eaten now">
        <TextInput inputMode="decimal" value={form.eaten} onChange={set("eaten")} />
      </Field>
      {save.isError ? <p className="text-sm text-rose-300">{save.error.message}</p> : null}
      <Button type="submit" className="w-full" disabled={save.isPending || !form.name.trim()}>
        {save.isPending ? "Saving…" : "Save to My foods and log"}
      </Button>
    </form>
  );
}
