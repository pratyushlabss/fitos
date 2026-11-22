"use client";

import type { FoodItemPrediction, MealType, NewMealItem, NutritionLookup } from "@fitos/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, Mic, Plus, Search, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Segmented, TextInput } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/States";
import { lookupBarcode, recentFoods, saveCorrection, scanFoodPhoto, searchFoods } from "@/lib/data/nutrition";
import { MEAL_LABELS, MEAL_TYPES } from "@/lib/logic/dashboard";

const BarcodeScanner = dynamic(() => import("./BarcodeScanner").then((mod) => mod.BarcodeScanner), {
  ssr: false,
  loading: () => <div className="h-[200px] animate-pulse rounded-2xl bg-slate-800/70" />,
});

export type SheetKind = "manual" | "search" | "barcode" | "voice" | "scan" | "recent" | null;

type AddItems = (mealType: MealType, items: NewMealItem[]) => Promise<void>;

const round = (value: number) => Math.round(value * 10) / 10;

function MealTypePicker({ value, onChange }: { value: MealType; onChange: (value: MealType) => void }) {
  return <Segmented value={value} onChange={onChange} options={MEAL_TYPES.map((type) => ({ value: type, label: MEAL_LABELS[type] }))} />;
}

function lookupToItem(lookup: NutritionLookup, grams: number): NewMealItem {
  const factor = lookup.serving_grams > 0 ? grams / lookup.serving_grams : 1;
  return {
    name: lookup.brand ? `${lookup.name} (${lookup.brand})` : lookup.name,
    amount_grams: grams,
    calories: round(lookup.macros_per_serving.calories * factor),
    protein_g: round(lookup.macros_per_serving.protein_g * factor),
    carbs_g: round(lookup.macros_per_serving.carbs_g * factor),
    fat_g: round(lookup.macros_per_serving.fat_g * factor),
    source: lookup.provenance.source,
    source_version: lookup.provenance.source_version,
    confidence: lookup.provenance.confidence,
    prediction_id: null,
  };
}

function PortionForm({
  lookup,
  mealType,
  onMealType,
  onAdd,
  busy,
}: {
  lookup: NutritionLookup;
  mealType: MealType;
  onMealType: (value: MealType) => void;
  onAdd: (item: NewMealItem) => void;
  busy: boolean;
}) {
  const [grams, setGrams] = useState(String(Math.round(lookup.serving_grams)));
  const item = lookupToItem(lookup, Math.max(0, Number(grams) || 0));
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/5 p-3">
        <p className="font-medium text-white">{lookup.name}</p>
        <p className="text-xs text-slate-400">
          {lookup.brand ? `${lookup.brand} · ` : ""}
          {lookup.provenance.source.replace(/_/g, " ")}
        </p>
      </div>
      <Field label="Amount (g)">
        <TextInput inputMode="decimal" value={grams} onChange={(event) => setGrams(event.target.value.replace(/[^\d.]/g, ""))} />
      </Field>
      <p className="text-sm text-slate-300">
        {item.calories} kcal · {item.protein_g}P · {item.carbs_g}C · {item.fat_g}F
      </p>
      <MealTypePicker value={mealType} onChange={onMealType} />
      <Button className="w-full" disabled={busy || item.amount_grams <= 0} onClick={() => onAdd(item)}>
        {busy ? "Adding…" : "Add to log"}
      </Button>
    </div>
  );
}

function LookupList({ results, onPick }: { results: NutritionLookup[]; onPick: (lookup: NutritionLookup) => void }) {
  return (
    <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-slate-950/50">
      {results.map((result) => (
        <li key={`${result.provenance.source}-${result.external_id}`}>
          <button className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left" onClick={() => onPick(result)}>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-white">{result.name}</span>
              <span className="block truncate text-xs text-slate-500">
                {result.brand ? `${result.brand} · ` : ""}
                {Math.round(result.macros_per_serving.calories)} kcal / {Math.round(result.serving_grams)} g · {result.provenance.source === "usda_fdc" ? "USDA" : "Open Food Facts"}
              </span>
            </span>
            <Plus size={16} className="shrink-0 text-emerald-300" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function useAdd(onAdd: AddItems, onDone: () => void) {
  return useMutation({
    mutationFn: ({ mealType, items }: { mealType: MealType; items: NewMealItem[] }) => onAdd(mealType, items),
    onSuccess: onDone,
  });
}

export function ManualSheet({ open, onClose, onAdd, initialMeal }: { open: boolean; onClose: () => void; onAdd: AddItems; initialMeal: MealType }) {
  const [mealType, setMealType] = useState(initialMeal);
  const [form, setForm] = useState({ name: "", grams: "100", calories: "", protein: "", carbs: "", fat: "" });
  const add = useAdd(onAdd, () => {
    setForm({ name: "", grams: "100", calories: "", protein: "", carbs: "", fat: "" });
    onClose();
  });
  useEffect(() => setMealType(initialMeal), [initialMeal, open]);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm({ ...form, [key]: key === "name" ? event.target.value : event.target.value.replace(/[^\d.]/g, "") });

  return (
    <Sheet open={open} onClose={onClose} title="Add food">
      <form
        className="space-y-3 pb-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (!form.name.trim()) return;
          add.mutate({
            mealType,
            items: [
              {
                name: form.name.trim(),
                amount_grams: Number(form.grams) || 0,
                calories: Number(form.calories) || 0,
                protein_g: Number(form.protein) || 0,
                carbs_g: Number(form.carbs) || 0,
                fat_g: Number(form.fat) || 0,
                source: "manual",
                source_version: "1",
                confidence: 1,
                prediction_id: null,
              },
            ],
          });
        }}
      >
        <Field label="Food">
          <TextInput value={form.name} onChange={set("name")} placeholder="Homemade dal" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Amount (g)">
            <TextInput inputMode="decimal" value={form.grams} onChange={set("grams")} />
          </Field>
          <Field label="Calories">
            <TextInput inputMode="decimal" value={form.calories} onChange={set("calories")} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Protein g">
            <TextInput inputMode="decimal" value={form.protein} onChange={set("protein")} />
          </Field>
          <Field label="Carbs g">
            <TextInput inputMode="decimal" value={form.carbs} onChange={set("carbs")} />
          </Field>
          <Field label="Fat g">
            <TextInput inputMode="decimal" value={form.fat} onChange={set("fat")} />
          </Field>
        </div>
        <MealTypePicker value={mealType} onChange={setMealType} />
        {add.isError ? <p className="text-sm text-rose-300">{add.error.message}</p> : null}
        <Button type="submit" className="w-full" disabled={add.isPending || !form.name.trim()}>
          {add.isPending ? "Adding…" : "Add to log"}
        </Button>
      </form>
    </Sheet>
  );
}

export function SearchSheet({
  open,
  onClose,
  onAdd,
  initialMeal,
  initialQuery = "",
}: {
  open: boolean;
  onClose: () => void;
  onAdd: AddItems;
  initialMeal: MealType;
  initialQuery?: string;
}) {
  const [mealType, setMealType] = useState(initialMeal);
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [picked, setPicked] = useState<NutritionLookup | null>(null);
  useEffect(() => {
    if (!open) return;
    setMealType(initialMeal);
    setInput(initialQuery);
    setQuery(initialQuery);
    setPicked(null);
  }, [open, initialMeal, initialQuery]);
  const results = useQuery({ queryKey: ["food-search", query], queryFn: () => searchFoods(query), enabled: open && query.trim().length >= 2, staleTime: 5 * 60 * 1000 });
  const add = useAdd(onAdd, onClose);

  return (
    <Sheet open={open} onClose={onClose} title={picked ? "Portion" : "Search foods"}>
      <div className="space-y-3 pb-2">
        {picked ? (
          <>
            <PortionForm lookup={picked} mealType={mealType} onMealType={setMealType} busy={add.isPending} onAdd={(item) => add.mutate({ mealType, items: [item] })} />
            <Button variant="ghost" className="w-full" onClick={() => setPicked(null)}>
              Back to results
            </Button>
          </>
        ) : (
          <>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(input.trim());
              }}
            >
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5">
                <Search size={16} className="text-slate-500" />
                <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Greek yogurt, banana…" className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-600" autoFocus />
              </label>
              <Button type="submit">Search</Button>
            </form>
            {query.trim().length < 2 ? (
              <p className="text-xs text-slate-500">Results come from USDA FoodData Central and Open Food Facts.</p>
            ) : results.isPending ? (
              <SkeletonList rows={5} height="h-12" />
            ) : results.isError ? (
              <ErrorState message={results.error.message} onRetry={() => void results.refetch()} />
            ) : results.data.length === 0 ? (
              <EmptyState title="No matches" body="Try a simpler name, or add it manually." />
            ) : (
              <LookupList results={results.data} onPick={setPicked} />
            )}
          </>
        )}
        {add.isError ? <p className="text-sm text-rose-300">{add.error.message}</p> : null}
      </div>
    </Sheet>
  );
}

export function BarcodeSheet({ open, onClose, onAdd, initialMeal }: { open: boolean; onClose: () => void; onAdd: AddItems; initialMeal: MealType }) {
  const [mealType, setMealType] = useState(initialMeal);
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setMealType(initialMeal);
    setCode("");
    setSubmitted(null);
  }, [open, initialMeal]);
  const lookup = useQuery({ queryKey: ["barcode", submitted], queryFn: () => lookupBarcode(submitted!), enabled: Boolean(submitted), staleTime: 60 * 60 * 1000 });
  const add = useAdd(onAdd, onClose);

  return (
    <Sheet open={open} onClose={onClose} title="Scan barcode">
      <div className="space-y-3 pb-2">
        {!submitted ? (
          <>
            {open ? <BarcodeScanner onDetected={(value) => setSubmitted(value)} /> : null}
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (code.length >= 8) setSubmitted(code);
              }}
            >
              <TextInput inputMode="numeric" placeholder="Or type the barcode digits" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
              <Button type="submit" disabled={code.length < 8}>
                Look up
              </Button>
            </form>
          </>
        ) : lookup.isPending ? (
          <SkeletonList rows={2} height="h-20" />
        ) : lookup.isError ? (
          <ErrorState message={lookup.error.message} onRetry={() => void lookup.refetch()} />
        ) : !lookup.data ? (
          <EmptyState
            title={`No product for ${submitted}`}
            body="Open Food Facts does not know this barcode yet. Search by name or add it manually."
            action={
              <Button variant="secondary" className="w-full" onClick={() => setSubmitted(null)}>
                Scan again
              </Button>
            }
          />
        ) : (
          <PortionForm lookup={lookup.data} mealType={mealType} onMealType={setMealType} busy={add.isPending} onAdd={(item) => add.mutate({ mealType, items: [item] })} />
        )}
        {add.isError ? <p className="text-sm text-rose-300">{add.error.message}</p> : null}
      </div>
    </Sheet>
  );
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export function VoiceSheet({ open, onClose, onTranscript }: { open: boolean; onClose: () => void; onTranscript: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const supported =
    typeof window !== "undefined" &&
    Boolean((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition);

  useEffect(() => {
    if (!open) {
      recognition.current?.stop();
      setListening(false);
      setTranscript("");
      setError(null);
    }
  }, [open]);

  function start() {
    const Ctor = ((window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | undefined;
    if (!Ctor) return;
    const instance = new Ctor();
    instance.lang = navigator.language || "en-US";
    instance.interimResults = true;
    instance.onresult = (event) => {
      setTranscript(Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" "));
    };
    instance.onerror = (event) => setError(event.error === "not-allowed" ? "Microphone permission was denied." : `Voice input failed (${event.error}).`);
    instance.onend = () => setListening(false);
    recognition.current = instance;
    setError(null);
    setTranscript("");
    setListening(true);
    instance.start();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Voice">
      <div className="space-y-3 pb-2">
        {!supported ? (
          <EmptyState title="Voice input is not available here" body="Your browser does not support speech recognition. Use the keyboard microphone in Search instead." />
        ) : (
          <>
            <button
              className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full border ${listening ? "animate-pulse border-emerald-300 bg-emerald-400/20" : "border-white/15 bg-slate-900"}`}
              onClick={() => (listening ? recognition.current?.stop() : start())}
              aria-label={listening ? "Stop listening" : "Start listening"}
            >
              <Mic size={32} className="text-emerald-300" />
            </button>
            <p className="min-h-[48px] text-center text-base text-white">{transcript || (listening ? "Listening…" : "Tap and say what you ate, like “two eggs and toast”.")}</p>
            {error ? <p className="text-center text-sm text-rose-300">{error}</p> : null}
            <Button className="w-full" disabled={!transcript.trim() || listening} onClick={() => onTranscript(transcript.trim())}>
              Search for this
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

type EditableItem = { name: string; grams: string; calories: string; protein: string; carbs: string; fat: string; original: FoodItemPrediction | null };

function toEditable(item: FoodItemPrediction): EditableItem {
  return {
    name: item.name,
    grams: String(Math.round(item.portion_grams)),
    calories: String(Math.round(item.macros.calories)),
    protein: String(round(item.macros.protein_g)),
    carbs: String(round(item.macros.carbs_g)),
    fat: String(round(item.macros.fat_g)),
    original: item,
  };
}

export function ScanSheet({ open, onClose, onAdd, initialMeal }: { open: boolean; onClose: () => void; onAdd: AddItems; initialMeal: MealType }) {
  const [mealType, setMealType] = useState(initialMeal);
  const [preview, setPreview] = useState<string | null>(null);
  const [items, setItems] = useState<EditableItem[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const scan = useMutation({
    mutationFn: scanFoodPhoto,
    onSuccess: (result) => setItems(result.prediction.items.map(toEditable)),
  });
  const save = useMutation({
    mutationFn: async () => {
      const result = scan.data!;
      const meal: NewMealItem[] = items
        .filter((item) => item.name.trim())
        .map((item) => ({
          name: item.name.trim(),
          amount_grams: Number(item.grams) || 0,
          calories: Number(item.calories) || 0,
          protein_g: Number(item.protein) || 0,
          carbs_g: Number(item.carbs) || 0,
          fat_g: Number(item.fat) || 0,
          source: result.prediction.provenance.source,
          source_version: result.prediction.provenance.source_version,
          confidence: item.original?.provenance.confidence ?? result.prediction.overall_confidence,
          prediction_id: result.prediction_id,
        }));
      const edited =
        items.length !== result.prediction.items.length ||
        items.some((item) => {
          const o = item.original;
          return (
            !o ||
            o.name !== item.name.trim() ||
            Math.round(o.portion_grams) !== Number(item.grams) ||
            Math.round(o.macros.calories) !== Number(item.calories) ||
            round(o.macros.protein_g) !== Number(item.protein) ||
            round(o.macros.carbs_g) !== Number(item.carbs) ||
            round(o.macros.fat_g) !== Number(item.fat)
          );
        });
      if (edited) await saveCorrection(result.prediction_id, { items: meal, original: result.prediction });
      await onAdd(mealType, meal);
    },
    onSuccess: onClose,
  });

  useEffect(() => {
    if (!open) return;
    setMealType(initialMeal);
    setPreview(null);
    setItems([]);
    scan.reset();
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialMeal]);

  const patch = (index: number, key: keyof EditableItem) => (event: { target: { value: string } }) =>
    setItems(items.map((item, i) => (i === index ? { ...item, [key]: key === "name" ? event.target.value : event.target.value.replace(/[^\d.]/g, "") } : item)));

  return (
    <Sheet open={open} onClose={onClose} title="Scan a meal">
      <div className="space-y-3 pb-2">
        <input
          ref={fileInput}
          hidden
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setPreview(URL.createObjectURL(file));
            setItems([]);
            scan.mutate(file);
          }}
        />
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Meal" className="h-40 w-full rounded-2xl object-cover" />
        ) : (
          <button className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-slate-950/50 text-slate-400" onClick={() => fileInput.current?.click()}>
            <Camera size={28} className="text-emerald-300" />
            Take or choose a photo
          </button>
        )}
        {scan.isPending ? <SkeletonList rows={3} height="h-14" /> : null}
        {scan.isError ? <ErrorState message={scan.error.message} onRetry={() => fileInput.current?.click()} /> : null}
        {scan.data ? (
          <>
            <p className="text-xs text-slate-400">
              Estimated by AI with {Math.round(scan.data.prediction.overall_confidence * 100)}% confidence. Check portions before saving. {scan.data.scans_remaining} scans left today.
            </p>
            {items.map((item, index) => (
              <div key={index} className="space-y-2 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                <div className="flex items-center gap-2">
                  <TextInput value={item.name} onChange={patch(index, "name")} aria-label="Food name" />
                  <button className="rounded-lg p-2 text-rose-300" onClick={() => setItems(items.filter((_, i) => i !== index))} aria-label="Remove item">
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-5 gap-1.5 text-[10px] uppercase tracking-[0.1em] text-slate-500">
                  {(["grams", "calories", "protein", "carbs", "fat"] as const).map((key) => (
                    <label key={key} className="block">
                      <span className="mb-1 block">{key === "grams" ? "g" : key === "calories" ? "kcal" : key.slice(0, 1).toUpperCase()}</span>
                      <input inputMode="decimal" value={item[key]} onChange={patch(index, key)} className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-1.5 py-2 text-center text-base text-white outline-none" />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <Button
              variant="ghost"
              className="w-full gap-2 text-xs"
              onClick={() => setItems([...items, { name: "", grams: "100", calories: "0", protein: "0", carbs: "0", fat: "0", original: null }])}
            >
              <Plus size={14} /> Add missing item
            </Button>
            <MealTypePicker value={mealType} onChange={setMealType} />
            {save.isError ? <p className="text-sm text-rose-300">{save.error.message}</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                Retake
              </Button>
              <Button disabled={save.isPending || items.length === 0} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : "Save meal"}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

export function RecentSheet({ open, onClose, onAdd, initialMeal }: { open: boolean; onClose: () => void; onAdd: AddItems; initialMeal: MealType }) {
  const [mealType, setMealType] = useState(initialMeal);
  useEffect(() => setMealType(initialMeal), [initialMeal, open]);
  const recent = useQuery({ queryKey: ["recent-foods"], queryFn: () => recentFoods(), enabled: open });
  const add = useMutation({ mutationFn: (item: NewMealItem) => onAdd(mealType, [item]) });

  return (
    <Sheet open={open} onClose={onClose} title="Recent foods">
      <div className="space-y-3 pb-2">
        <MealTypePicker value={mealType} onChange={setMealType} />
        {recent.isPending ? (
          <SkeletonList rows={5} height="h-12" />
        ) : recent.isError ? (
          <ErrorState message={recent.error.message} onRetry={() => void recent.refetch()} />
        ) : recent.data.length === 0 ? (
          <EmptyState title="Nothing logged yet" body="Foods you log appear here for one-tap re-adding." />
        ) : (
          <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-slate-950/50">
            {recent.data.map(({ id, meal_id: _meal, ...item }) => (
              <li key={id}>
                <button className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left" disabled={add.isPending} onClick={() => add.mutate(item)}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white">{item.name}</span>
                    <span className="text-xs text-slate-500">
                      {Math.round(item.amount_grams)} g · {Math.round(item.calories)} kcal · {Math.round(item.protein_g)}P
                    </span>
                  </span>
                  <Plus size={16} className="shrink-0 text-emerald-300" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {add.isSuccess ? <p className="text-center text-xs text-emerald-300">Added. Tap more or close.</p> : null}
      </div>
    </Sheet>
  );
}
