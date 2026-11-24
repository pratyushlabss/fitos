"use client";

import type { DraftItem, FoodDraft, MealItemSource, MealType, ServingUnit } from "@fitos/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Sparkles, Trash2, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Field";
import { confirmDraft, discardDraft, searchFoods } from "@/lib/data/nutrition";
import { MEAL_LABELS, MEAL_TYPES } from "@/lib/logic/dashboard";
import { defaultPortion, draftItemFromHit, macrosFor, round1, SOURCE_BADGE, sumMacros, UNIT_LABEL, withAmount } from "@/lib/logic/nutrition";

const numberInput =
  "w-full rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1.5 text-center text-base text-white outline-none focus:border-emerald-300/40";

function ConfidenceDot({ value }: { value: number }) {
  const tone = value >= 0.75 ? "bg-emerald-400" : value >= 0.5 ? "bg-amber-300" : "bg-rose-400";
  const label = value >= 0.75 ? "High" : value >= 0.5 ? "Medium" : "Low";
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400" title={`Confidence ${Math.round(value * 100)}%`}>
      <span className={`h-2 w-2 rounded-full ${tone}`} /> {label}
    </span>
  );
}

export function SourceBadge({ source }: { source: DraftItem["source"] }) {
  const badge = SOURCE_BADGE[source] ?? SOURCE_BADGE.ai;
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${badge.className}`}>{badge.label}</span>;
}

function unitsFor(item: DraftItem): ServingUnit[] {
  const units = new Set<ServingUnit>([item.unit, "g"]);
  item.servings.forEach((s) => units.add(s.unit));
  return Array.from(units);
}

export function DraftReview({
  draft,
  mealType: initialMeal,
  date,
  source,
  onDone,
  onCancel,
  onReanalyze,
}: {
  draft: FoodDraft;
  mealType: MealType;
  date: string;
  source: MealItemSource;
  onDone: (message: string) => void;
  onCancel: () => void;
  onReanalyze?: (answer: string) => void;
}) {
  const [items, setItems] = useState<DraftItem[]>(draft.items);
  const [open, setOpen] = useState<string | null>(draft.items.length === 1 ? draft.items[0].key : null);
  const [mealType, setMealType] = useState<MealType>(draft.meal_type ?? initialMeal);
  const [answer, setAnswer] = useState("");
  const totals = useMemo(() => sumMacros(items.map(macrosFor)), [items]);

  const save = useMutation({
    mutationFn: () => confirmDraft({ analysis_id: draft.analysis_id, meal_type: mealType, date: draft.date ?? date, source, items }),
    onSuccess: (result) =>
      onDone(
        result.personalised.length
          ? `Logged. Your own version of ${items.find((i) => i.is_dish)?.name ?? "this dish"} will be used from now on.`
          : `Logged ${result.logged} item${result.logged === 1 ? "" : "s"}`,
      ),
  });

  function patch(key: string, next: DraftItem) {
    setItems(items.map((item) => (item.key === key ? next : item)));
  }

  return (
    <div className="space-y-3 pb-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <ConfidenceDot value={draft.confidence} />
        {draft.cache_hit ? (
          <span className="inline-flex items-center gap-1 text-emerald-300">
            <Zap size={12} /> From your past log
          </span>
        ) : draft.ai_calls === 0 && draft.input_type !== "barcode" ? (
          <span className="inline-flex items-center gap-1 text-emerald-300">
            <Zap size={12} /> Matched in your food database
          </span>
        ) : draft.ai_calls > 0 ? (
          <span className="inline-flex items-center gap-1 text-amber-200">
            <Sparkles size={12} /> AI estimate, check the amounts
          </span>
        ) : null}
      </div>

      {draft.notes?.length ? (
        <ul className="space-y-1 rounded-[14px] border border-dashed border-line p-3 text-xs leading-5 text-muted">
          {draft.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      {draft.question ? (
        <div className="rounded-2xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">
          <p>{draft.question}</p>
          {onReanalyze ? (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (answer.trim()) onReanalyze(answer.trim());
              }}
            >
              <input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Your answer" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1.5 text-base text-white outline-none" />
              <Button type="submit" variant="secondary" className="px-3 py-1.5 text-xs" disabled={!answer.trim()}>
                Update
              </Button>
            </form>
          ) : (
            <p className="mt-1 text-xs text-amber-200/70">Adjust the amounts below if needed.</p>
          )}
        </div>
      ) : null}

      <div className="space-y-2">
        {items.map((item) => {
          const m = macrosFor(item);
          const expanded = open === item.key;
          return (
            <div key={item.key} className="rounded-2xl border border-white/10 bg-slate-950/60">
              <div className="flex items-center gap-2 p-3">
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(expanded ? null : item.key)} aria-expanded={expanded}>
                  {item.ingredients.length ? expanded ? <ChevronDown size={16} className="shrink-0 text-slate-400" /> : <ChevronRight size={16} className="shrink-0 text-slate-400" /> : <span className="w-4" />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white">{item.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                      <SourceBadge source={item.source} />
                      {Math.round(m.kcal)} kcal · {m.protein_g}P {m.carbs_g}C {m.fat_g}F
                    </span>
                  </span>
                </button>
                <button className="p-1.5 text-slate-500 hover:text-rose-300" aria-label={`Remove ${item.name}`} onClick={() => setItems(items.filter((i) => i.key !== item.key))}>
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 pb-3">
                <label className="text-[10px] uppercase tracking-[0.1em] text-slate-500">
                  Qty
                  <input
                    className={numberInput}
                    inputMode="decimal"
                    value={item.quantity}
                    onChange={(event) => {
                      const quantity = Number(event.target.value.replace(/[^\d.]/g, "")) || 0;
                      patch(item.key, withAmount(item, quantity, item.unit));
                    }}
                  />
                </label>
                <label className="text-[10px] uppercase tracking-[0.1em] text-slate-500">
                  Unit
                  <select className={`${numberInput} px-1`} value={item.unit} onChange={(event) => patch(item.key, withAmount(item, item.unit === "g" ? 1 : item.quantity, event.target.value as ServingUnit))}>
                    {unitsFor(item).map((unit) => (
                      <option key={unit} value={unit}>
                        {UNIT_LABEL[unit]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[10px] uppercase tracking-[0.1em] text-slate-500">
                  Grams
                  <input
                    className={numberInput}
                    inputMode="decimal"
                    value={item.grams}
                    onChange={(event) => {
                      const grams = Number(event.target.value.replace(/[^\d.]/g, "")) || 0;
                      const factor = item.grams > 0 ? grams / item.grams : 1;
                      patch(item.key, { ...item, grams, unit: "g", quantity: grams, ingredients: item.ingredients.map((ing) => ({ ...ing, grams: round1(ing.grams * factor) })) });
                    }}
                  />
                </label>
              </div>
              {expanded && item.ingredients.length ? (
                <div className="space-y-1.5 border-t border-white/5 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Ingredients (raw grams)</p>
                  {item.ingredients.map((ing, index) => (
                    <div key={`${ing.name}-${index}`} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-slate-200">{ing.name}</span>
                        <span className="flex items-center gap-1 text-[10px] text-slate-500">
                          <SourceBadge source={ing.source} /> {Math.round((ing.per100.kcal * ing.grams) / 100)} kcal{ing.notes ? ` · ${ing.notes}` : ""}
                        </span>
                      </span>
                      <input
                        className={`${numberInput} w-20`}
                        inputMode="decimal"
                        value={ing.grams}
                        aria-label={`${ing.name} grams`}
                        onChange={(event) => {
                          const grams = Number(event.target.value.replace(/[^\d.]/g, "")) || 0;
                          const ingredients = item.ingredients.map((x, i) => (i === index ? { ...x, grams } : x));
                          patch(item.key, { ...item, ingredients, grams: round1(ingredients.reduce((sum, x) => sum + x.grams, 0)) });
                        }}
                      />
                      <button
                        className="p-1 text-slate-500 hover:text-rose-300"
                        aria-label={`Remove ${ing.name}`}
                        onClick={() => {
                          const ingredients = item.ingredients.filter((_, i) => i !== index);
                          patch(item.key, { ...item, ingredients, grams: round1(ingredients.reduce((sum, x) => sum + x.grams, 0)) });
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm">
        <p className="text-white">
          <strong>{Math.round(totals.kcal)} kcal</strong> · {totals.protein_g} g protein · {totals.carbs_g} g carbs · {totals.fat_g} g fat
        </p>
      </div>

      <Segmented value={mealType} onChange={setMealType} options={MEAL_TYPES.map((type) => ({ value: type, label: MEAL_LABELS[type] }))} />
      <AddItem onAdd={(item) => setItems([...items, item])} />

      {save.isError ? <p className="text-sm text-rose-300">{save.error.message}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            if (draft.analysis_id) void discardDraft(draft.analysis_id).catch(() => undefined);
            onCancel();
          }}
        >
          Discard
        </Button>
        <Button disabled={save.isPending || items.length === 0} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save to log"}
        </Button>
      </div>
    </div>
  );
}

// Anything the AI missed: search the food database and append it to the draft.
function AddItem({ onAdd }: { onAdd: (item: DraftItem) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);
  const results = useQuery({ queryKey: ["draft-add", debounced], queryFn: () => searchFoods(debounced), enabled: open && debounced.length >= 2 });

  if (!open) {
    return (
      <button type="button" className="press flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-line text-sm text-fg/80" onClick={() => setOpen(true)}>
        <Plus size={16} strokeWidth={1.5} /> Add item
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-[14px] border border-line p-3">
      <input
        autoFocus
        className={`${numberInput} text-left`}
        placeholder="Search a food to add"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        aria-label="Search a food to add"
      />
      {results.isFetching ? <p className="text-xs text-muted">Searching…</p> : null}
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {(results.data ?? []).slice(0, 8).map((hit) => (
          <button
            key={hit.food_id}
            type="button"
            className="press flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-sm text-fg hover:bg-white/5"
            onClick={() => {
              const portion = defaultPortion(hit);
              onAdd(draftItemFromHit(hit, portion.quantity, portion.unit, `a${Date.now()}`));
              setOpen(false);
              setQ("");
            }}
          >
            <span className="truncate">{hit.name}</span>
            <span className="num shrink-0 text-xs text-muted">{Math.round(Number(hit.kcal ?? 0))} kcal/100g</span>
          </button>
        ))}
        {debounced.length >= 2 && !results.isFetching && !(results.data ?? []).length ? <p className="text-xs text-muted">No match. Use Manual in Add food to create it.</p> : null}
      </div>
      <button type="button" className="press min-h-[44px] w-full text-xs text-muted" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}
