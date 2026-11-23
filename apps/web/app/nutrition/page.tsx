"use client";

import type { Meal, MealItem, MealType, ServingUnit } from "@fitos/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, History, MessageCircle, MoreHorizontal, Plus, Utensils } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useProfile } from "@/components/auth/AuthProvider";
import { AddFoodSheet } from "@/components/nutrition/AddFoodSheet";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Field, Segmented, SelectInput, TextInput } from "@/components/ui/Field";
import { MacroRing } from "@/components/ui/MacroRing";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SectionCard } from "@/components/ui/SectionCard";
import { Sheet } from "@/components/ui/Sheet";
import { ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { localDayKey } from "@/lib/data/base";
import { copyMeal, deleteMealItem, getMealsForDay, moveMealItem, saveFavourite, updateMealItemAmount } from "@/lib/data/nutrition";
import { defaultMealType, MEAL_LABELS, MEAL_TYPES, targetsFor, totalsFor } from "@/lib/logic/dashboard";
import { UNIT_LABEL } from "@/lib/logic/nutrition";

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return localDayKey(new Date(y, m - 1, d + delta));
}

function dayParts(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return { weekday: date.toLocaleDateString(undefined, { weekday: "narrow" }), date: d, long: date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) };
}

export default function NutritionPage() {
  const profile = useProfile();
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = localDayKey();
  const [day, setDay] = useState(today);
  const [adding, setAdding] = useState<MealType | null>(null);
  const [itemMenu, setItemMenu] = useState<MealItem | null>(null);
  const [mealMenu, setMealMenu] = useState<Meal | null>(null);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("d");
    if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= today) setDay(requested);
  }, [today]);

  const meals = useQuery({ queryKey: ["meals", day], queryFn: () => getMealsForDay(day) });
  const totals = totalsFor(meals.data ?? []);
  const targets = targetsFor(profile);
  const strip = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDay(day === today ? today : day, i - (day === today ? 6 : 3))).filter((d) => d <= today), [day, today]);

  function refreshDay(target = day) {
    void queryClient.invalidateQueries({ queryKey: ["meals", target] });
    void queryClient.invalidateQueries({ queryKey: ["nutrition-history"] });
    void queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
  }

  return (
    <PullToRefresh onRefresh={() => meals.refetch()}>
      <ScreenHeader eyebrow="Nutrition" title="Daily nutrition" subtitle={dayParts(day).long} />

      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <div className="grid flex-1 grid-cols-7 gap-1">
            {strip.map((d) => {
              const parts = dayParts(d);
              const active = d === day;
              return (
                <button
                  key={d}
                  onClick={() => setDay(d)}
                  className={`flex flex-col items-center rounded-xl py-1.5 text-xs ${active ? "bg-accent text-ink" : "bg-slate-900/80 text-slate-300"}`}
                  aria-label={parts.long}
                  aria-pressed={active}
                >
                  <span className={active ? "text-ink/70" : "text-slate-500"}>{parts.weekday}</span>
                  <strong>{parts.date}</strong>
                </button>
              );
            })}
          </div>
          <label className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-slate-200" aria-label="Pick a date">
            <CalendarDays size={18} />
            <input type="date" max={today} value={day} onChange={(event) => event.target.value && setDay(event.target.value)} className="absolute inset-0 opacity-0" />
          </label>
        </div>

        <SectionCard
          title={day === today ? "Today" : "This day"}
          action={
            <div className="flex items-center gap-3 text-xs">
              <Link href="/nutrition/history" className="inline-flex items-center gap-1 text-emerald-300">
                <History size={13} /> History
              </Link>
              <Link href="/coach" className="inline-flex items-center gap-1 text-emerald-300">
                <MessageCircle size={13} /> Coach
              </Link>
            </div>
          }
        >
          {meals.isPending ? (
            <div className="grid grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="mx-auto h-[76px] w-[76px] rounded-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-4xl font-semibold text-white">{totals.calories.toLocaleString()}</p>
                  <p className="text-xs text-slate-400">of {targets.calories.toLocaleString()} kcal</p>
                </div>
                <p className={`text-sm ${totals.calories > targets.calories ? "text-amber-300" : "text-emerald-300"}`}>
                  {totals.calories <= targets.calories ? `${(targets.calories - totals.calories).toLocaleString()} left` : `${(totals.calories - targets.calories).toLocaleString()} over`}
                </p>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-1">
                <MacroRing kind="kcal" label="Kcal" unit="" size={76} value={totals.calories} target={targets.calories} />
                <MacroRing label="Protein" unit="g" value={totals.protein_g} target={targets.protein_g} kind="protein" size={76} />
                <MacroRing label="Carbs" unit="g" value={totals.carbs_g} target={targets.carbs_g} kind="carbs" size={76} />
                <MacroRing label="Fat" unit="g" value={totals.fat_g} target={targets.fat_g} kind="fat" size={76} />
              </div>
            </>
          )}
        </SectionCard>

        {meals.isError ? <ErrorState message={meals.error.message} onRetry={() => void meals.refetch()} /> : null}

        {MEAL_TYPES.map((type) => {
          const meal = meals.data?.find((m) => m.meal_type === type);
          const items = meal?.meal_items ?? [];
          const kcal = Math.round(items.reduce((sum, item) => sum + item.calories, 0));
          return (
            <SectionCard
              key={type}
              title={MEAL_LABELS[type]}
              action={
                <div className="flex items-center gap-1">
                  {items.length ? <span className="mr-1 text-xs text-slate-400">{kcal} kcal</span> : null}
                  {meal && items.length ? (
                    <button className="rounded-full p-1.5 text-slate-400 hover:bg-white/5" aria-label={`${MEAL_LABELS[type]} options`} onClick={() => setMealMenu(meal)}>
                      <MoreHorizontal size={16} />
                    </button>
                  ) : null}
                  <Button variant="secondary" className="gap-1 px-3 py-1.5 text-xs" onClick={() => setAdding(type)}>
                    <Plus size={13} /> Add
                  </Button>
                </div>
              }
            >
              {meals.isPending ? (
                <Skeleton className="h-12 w-full" />
              ) : items.length === 0 ? (
                <button className="flex w-full items-center gap-2 rounded-xl border border-dashed border-white/10 p-3 text-left text-sm text-slate-500" onClick={() => setAdding(type)}>
                  <Utensils size={15} /> Nothing yet. Tap to add.
                </button>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <button key={item.id} onClick={() => setItemMenu(item)} className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 p-3 text-left">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{item.name}</p>
                        <p className="text-xs text-slate-400">
                          {item.unit === "g" ? `${Math.round(item.amount_grams)} g` : `${item.quantity} ${UNIT_LABEL[item.unit]} · ${Math.round(item.amount_grams)} g`} · {Math.round(item.protein_g)}P {Math.round(item.carbs_g)}C {Math.round(item.fat_g)}F
                        </p>
                      </div>
                      <p className="shrink-0 font-medium text-white">{Math.round(item.calories)} kcal</p>
                    </button>
                  ))}
                </div>
              )}
            </SectionCard>
          );
        })}
      </div>

      <AddFoodSheet
        open={adding !== null}
        onClose={() => setAdding(null)}
        day={day}
        mealType={adding ?? defaultMealType()}
        onLogged={(message) => {
          toast(message, "success");
          refreshDay();
        }}
      />
      <ItemSheet
        item={itemMenu}
        day={day}
        onClose={() => setItemMenu(null)}
        onChanged={(message, otherDay) => {
          toast(message, "success");
          refreshDay();
          if (otherDay && otherDay !== day) refreshDay(otherDay);
        }}
      />
      <MealSheet
        meal={mealMenu}
        today={today}
        onClose={() => setMealMenu(null)}
        onChanged={(message) => {
          toast(message, "success");
          refreshDay();
          refreshDay(today);
        }}
      />
    </PullToRefresh>
  );
}

function ItemSheet({ item, day, onClose, onChanged }: { item: MealItem | null; day: string; onClose: () => void; onChanged: (message: string, otherDay?: string) => void }) {
  const toast = useToast();
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<ServingUnit>("g");
  const [moveTo, setMoveTo] = useState<MealType>("breakfast");
  const [key, setKey] = useState<string | null>(null);
  if (item && key !== item.id) {
    setKey(item.id);
    setQuantity(String(item.unit === "g" ? Math.round(item.amount_grams) : item.quantity));
    setUnit(item.unit);
  }
  const perUnit = item && item.unit !== "g" && item.quantity > 0 ? item.amount_grams / item.quantity : 1;
  const grams = unit === "g" ? Number(quantity) || 0 : (Number(quantity) || 0) * perUnit;
  const factor = item && item.amount_grams > 0 ? grams / item.amount_grams : 1;

  const run = useMutation({
    mutationFn: async (action: "save" | "delete" | "move" | "favourite") => {
      if (!item) return "";
      if (action === "save") {
        await updateMealItemAmount(item, Number(quantity) || 0, unit, Math.round(grams * 10) / 10);
        return "Updated";
      }
      if (action === "delete") {
        await deleteMealItem(item.id);
        return "Removed";
      }
      if (action === "move") {
        await moveMealItem(item.id, day, moveTo);
        return `Moved to ${MEAL_LABELS[moveTo]}`;
      }
      await saveFavourite(item.name, null, [item]);
      return "Saved as favourite";
    },
    onSuccess: (message) => {
      onClose();
      onChanged(message);
    },
    onError: (error) => toast(error.message, "error"),
  });

  return (
    <Sheet open={item !== null} onClose={onClose} title={item?.name ?? "Food"}>
      {item ? (
        <div className="space-y-4 pb-2">
          <p className="text-sm text-slate-400">
            {Math.round(item.calories * factor)} kcal · {Math.round(item.protein_g * factor)}P {Math.round(item.carbs_g * factor)}C {Math.round(item.fat_g * factor)}F
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Amount">
              <TextInput inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value.replace(/[^\d.]/g, ""))} />
            </Field>
            <Field label="Unit">
              <SelectInput
                value={unit}
                onChange={(event) => {
                  const next = event.target.value as ServingUnit;
                  setQuantity(next === "g" ? String(Math.round(grams)) : String(Math.round((grams / perUnit) * 10) / 10));
                  setUnit(next);
                }}
              >
                {Array.from(new Set<ServingUnit>([item.unit, "g"])).map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABEL[u]}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
          <Button className="w-full" disabled={run.isPending || grams <= 0} onClick={() => run.mutate("save")}>
            Save amount
          </Button>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <SelectInput value={moveTo} onChange={(event) => setMoveTo(event.target.value as MealType)} aria-label="Move to meal">
              {MEAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {MEAL_LABELS[type]}
                </option>
              ))}
            </SelectInput>
            <Button variant="secondary" disabled={run.isPending} onClick={() => run.mutate("move")}>
              Move
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={run.isPending} onClick={() => run.mutate("favourite")}>
              Save as favourite
            </Button>
            <Button variant="ghost" className="text-rose-300" disabled={run.isPending} onClick={() => run.mutate("delete")}>
              Delete
            </Button>
          </div>
          <p className="text-xs text-slate-500">Logged values are a snapshot. Editing the food later won&apos;t change this entry.</p>
        </div>
      ) : null}
    </Sheet>
  );
}

function MealSheet({ meal, today, onClose, onChanged }: { meal: Meal | null; today: string; onClose: () => void; onChanged: (message: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [target, setTarget] = useState<MealType>("breakfast");
  const [key, setKey] = useState<string | null>(null);
  if (meal && key !== meal.id) {
    setKey(meal.id);
    setName(`My usual ${MEAL_LABELS[meal.meal_type].toLowerCase()}`);
    setTarget(meal.meal_type);
  }
  const run = useMutation({
    mutationFn: async (action: "copy" | "favourite") => {
      if (!meal) return "";
      if (action === "copy") {
        await copyMeal(meal, today, target);
        return `Copied to today's ${MEAL_LABELS[target].toLowerCase()}`;
      }
      await saveFavourite(name || MEAL_LABELS[meal.meal_type], meal.meal_type, meal.meal_items);
      return "Saved as favourite meal";
    },
    onSuccess: (message) => {
      onClose();
      onChanged(message);
    },
    onError: (error) => toast(error.message, "error"),
  });
  return (
    <Sheet open={meal !== null} onClose={onClose} title={meal ? MEAL_LABELS[meal.meal_type] : "Meal"}>
      {meal ? (
        <div className="space-y-4 pb-2">
          <Field label="Copy to today as">
            <Segmented value={target} onChange={setTarget} options={MEAL_TYPES.map((type) => ({ value: type, label: MEAL_LABELS[type] }))} />
          </Field>
          <Button className="w-full" disabled={run.isPending} onClick={() => run.mutate("copy")}>
            Copy {meal.meal_items.length} item{meal.meal_items.length === 1 ? "" : "s"} to today
          </Button>
          <Field label="Favourite name">
            <TextInput value={name} onChange={(event) => setName(event.target.value.slice(0, 60))} />
          </Field>
          <Button variant="secondary" className="w-full" disabled={run.isPending || !name.trim()} onClick={() => run.mutate("favourite")}>
            Save as favourite meal
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}
