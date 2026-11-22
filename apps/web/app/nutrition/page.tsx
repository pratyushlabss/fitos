"use client";

import type { MealItem, MealType, NewMealItem } from "@fitos/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Utensils } from "lucide-react";
import { useState } from "react";

import { useProfile } from "@/components/auth/AuthProvider";
import {
  BarcodeSheet,
  ManualSheet,
  RecentSheet,
  ScanSheet,
  SearchSheet,
  type SheetKind,
  VoiceSheet,
} from "@/components/nutrition/FoodSheets";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { MacroRing } from "@/components/ui/MacroRing";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SectionCard } from "@/components/ui/SectionCard";
import { Sheet } from "@/components/ui/Sheet";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, QueryView, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { localDayKey } from "@/lib/data/base";
import { addMealItems, deleteMealItem, getMealsForDay, updateMealItem } from "@/lib/data/nutrition";
import { defaultMealType, MEAL_LABELS, MEAL_TYPES, targetsFor, totalsFor } from "@/lib/logic/dashboard";

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return localDayKey(new Date(y, m - 1, d + delta));
}

function dayLabel(day: string): string {
  const today = localDayKey();
  if (day === today) return "Today";
  if (day === shiftDay(today, -1)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function NutritionPage() {
  const profile = useProfile();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [day, setDay] = useState(() => localDayKey());
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [mealType, setMealType] = useState<MealType>(() => defaultMealType());
  const [voiceQuery, setVoiceQuery] = useState("");
  const [editing, setEditing] = useState<MealItem | null>(null);

  const meals = useQuery({ queryKey: ["meals", day], queryFn: () => getMealsForDay(day) });
  const totals = totalsFor(meals.data ?? []);
  const targets = targetsFor(profile);
  const isToday = day === localDayKey();

  async function add(type: MealType, items: NewMealItem[]) {
    await addMealItems(day, type, items);
    await queryClient.invalidateQueries({ queryKey: ["meals", day] });
    void queryClient.invalidateQueries({ queryKey: ["recent-foods"] });
    toast(items.length === 1 ? `Added ${items[0].name}` : `Added ${items.length} items`, "success");
  }

  function open(kind: SheetKind, type?: MealType) {
    setMealType(type ?? (isToday ? defaultMealType() : "lunch"));
    setSheet(kind);
  }

  const remove = useMutation({
    mutationFn: deleteMealItem,
    onMutate: (id) =>
      queryClient.setQueryData(["meals", day], (current: typeof meals.data) =>
        current?.map((meal) => ({ ...meal, meal_items: meal.meal_items.filter((item) => item.id !== id) })),
      ),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["meals", day] }),
    onError: (error) => toast(error.message, "error"),
  });

  const actions: Array<{ kind: SheetKind; label: string; primary?: boolean }> = [
    { kind: "manual", label: "+ Add food", primary: true },
    { kind: "scan", label: "📷 Scan food" },
    { kind: "barcode", label: "▣ Barcode" },
    { kind: "voice", label: "🎙 Voice" },
    { kind: "search", label: "🔎 Search" },
    { kind: "recent", label: "🍳 Recent" },
  ];

  return (
    <PullToRefresh onRefresh={() => meals.refetch()}>
      <ScreenHeader eyebrow="Nutrition" title="Daily nutrition" subtitle="Calories, macros, barcode, photo and meal logging in one place" />

      <div className="space-y-5">
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/80 px-2 py-1.5">
          <button className="rounded-lg p-2 text-slate-300" onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day">
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-medium text-white">{dayLabel(day)}</span>
          <button className="rounded-lg p-2 text-slate-300 disabled:opacity-30" disabled={isToday} onClick={() => setDay(shiftDay(day, 1))} aria-label="Next day">
            <ChevronRight size={18} />
          </button>
        </div>

        <SectionCard title="Macro balance">
          {meals.isPending ? (
            <div className="grid grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="mx-auto h-[76px] w-[76px] rounded-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-1">
                <MacroRing label="Kcal" unit="" value={totals.calories} target={targets.calories} />
                <MacroRing label="Protein" unit="g" value={totals.protein_g} target={targets.protein_g} color="#60a5fa" />
                <MacroRing label="Carbs" unit="g" value={totals.carbs_g} target={targets.carbs_g} color="#f59e0b" />
                <MacroRing label="Fat" unit="g" value={totals.fat_g} target={targets.fat_g} color="#f472b6" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <StatCard
                  label="Calories"
                  value={totals.calories.toLocaleString()}
                  hint={totals.calories <= targets.calories ? `Remaining ${(targets.calories - totals.calories).toLocaleString()}` : `Over by ${(totals.calories - targets.calories).toLocaleString()}`}
                  accent
                />
                <StatCard label="Protein" value={`${totals.protein_g}g`} hint={`Target ${targets.protein_g}g`} />
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard title="Actions">
          <div className="grid grid-cols-2 gap-2">
            {actions.map((action) => (
              <Button key={action.kind} variant={action.primary ? "primary" : "secondary"} className="w-full" onClick={() => open(action.kind)}>
                {action.label}
              </Button>
            ))}
          </div>
        </SectionCard>

        <QueryView
          query={meals}
          skeleton={<Skeleton className="h-48 w-full" />}
          isEmpty={(data) => data.every((meal) => meal.meal_items.length === 0)}
          empty={
            <EmptyState
              icon={<Utensils size={20} />}
              title={isToday ? "Nothing logged today" : "Nothing logged this day"}
              body="Scan a photo, scan a barcode or search for a food."
              action={
                <Button className="w-full" onClick={() => open("scan")}>
                  📷 Scan your first meal
                </Button>
              }
            />
          }
        >
          {(data) => (
            <div className="space-y-4">
              {MEAL_TYPES.map((type) => {
                const items = data.filter((meal) => meal.meal_type === type).flatMap((meal) => meal.meal_items);
                const kcal = Math.round(items.reduce((sum, item) => sum + item.calories, 0));
                return (
                  <SectionCard
                    key={type}
                    title={MEAL_LABELS[type]}
                    action={
                      <button className="text-xs text-emerald-300" onClick={() => open("search", type)}>
                        {items.length ? `${kcal} kcal · Add` : "Add"}
                      </button>
                    }
                  >
                    {items.length === 0 ? (
                      <p className="text-sm text-slate-500">Nothing yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {items.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => setEditing(item)}
                            className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 p-3 text-left"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium text-white">{item.name}</p>
                              <p className="text-xs text-slate-400">
                                {Math.round(item.protein_g)}P • {Math.round(item.carbs_g)}C • {Math.round(item.fat_g)}F
                                {item.source === "claude_vision" ? " · AI estimate" : ""}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="font-medium text-white">{Math.round(item.calories)} kcal</p>
                              <p className="text-xs text-slate-400">{Math.round(item.amount_grams)} g</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </SectionCard>
                );
              })}
              {data.some((meal) => meal.meal_type === "other" && meal.meal_items.length) ? (
                <p className="text-xs text-slate-500">Some items are filed under Other.</p>
              ) : null}
            </div>
          )}
        </QueryView>
      </div>

      <ManualSheet open={sheet === "manual"} onClose={() => setSheet(null)} onAdd={add} initialMeal={mealType} />
      <SearchSheet open={sheet === "search"} onClose={() => setSheet(null)} onAdd={add} initialMeal={mealType} initialQuery={voiceQuery} />
      <BarcodeSheet open={sheet === "barcode"} onClose={() => setSheet(null)} onAdd={add} initialMeal={mealType} />
      <ScanSheet open={sheet === "scan"} onClose={() => setSheet(null)} onAdd={add} initialMeal={mealType} />
      <RecentSheet open={sheet === "recent"} onClose={() => setSheet(null)} onAdd={add} initialMeal={mealType} />
      <VoiceSheet
        open={sheet === "voice"}
        onClose={() => setSheet(null)}
        onTranscript={(text) => {
          setVoiceQuery(text);
          setSheet("search");
        }}
      />
      <EditItemSheet
        item={editing}
        onClose={() => setEditing(null)}
        onDelete={(item) => {
          setEditing(null);
          remove.mutate(item.id);
        }}
        onSave={async (item, patch) => {
          await updateMealItem(item.id, patch);
          setEditing(null);
          await queryClient.invalidateQueries({ queryKey: ["meals", day] });
        }}
      />
    </PullToRefresh>
  );
}

function EditItemSheet({
  item,
  onClose,
  onSave,
  onDelete,
}: {
  item: MealItem | null;
  onClose: () => void;
  onSave: (item: MealItem, patch: Partial<NewMealItem>) => Promise<void>;
  onDelete: (item: MealItem) => void;
}) {
  const [grams, setGrams] = useState("");
  const [key, setKey] = useState<string | null>(null);
  if (item && key !== item.id) {
    setKey(item.id);
    setGrams(String(Math.round(item.amount_grams)));
  }
  const save = useMutation({
    mutationFn: () => {
      const next = Number(grams) || 0;
      const factor = item!.amount_grams > 0 ? next / item!.amount_grams : 1;
      const r = (v: number) => Math.round(v * factor * 10) / 10;
      return onSave(item!, {
        amount_grams: next,
        calories: r(item!.calories),
        protein_g: r(item!.protein_g),
        carbs_g: r(item!.carbs_g),
        fat_g: r(item!.fat_g),
      });
    },
  });
  return (
    <Sheet open={item !== null} onClose={onClose} title={item?.name ?? "Food"}>
      {item ? (
        <div className="space-y-3 pb-2">
          <p className="text-sm text-slate-400">
            {Math.round(item.calories)} kcal · {item.protein_g}P · {item.carbs_g}C · {item.fat_g}F · source {item.source.replace(/_/g, " ")}
          </p>
          <Field label="Amount (g)" hint="Macros scale with the amount.">
            <TextInput inputMode="decimal" value={grams} onChange={(event) => setGrams(event.target.value.replace(/[^\d.]/g, ""))} />
          </Field>
          {save.isError ? <p className="text-sm text-rose-300">{save.error.message}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" className="text-rose-300" onClick={() => onDelete(item)}>
              Delete
            </Button>
            <Button disabled={save.isPending || !(Number(grams) > 0)} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
