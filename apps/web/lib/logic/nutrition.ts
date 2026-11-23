import type { DraftItem, FoodHit, FoodSource, Per100, Serving, ServingUnit } from "@fitos/types";

export const round1 = (value: number) => Math.round(value * 10) / 10;

export function macrosFor(item: Pick<DraftItem, "grams" | "per100" | "ingredients">): Per100 {
  const parts = item.ingredients.length ? item.ingredients : [{ grams: item.grams, per100: item.per100 }];
  const total = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 };
  for (const part of parts) {
    const f = Math.max(0, part.grams) / 100;
    total.kcal += (part.per100.kcal || 0) * f;
    total.protein_g += (part.per100.protein_g || 0) * f;
    total.carbs_g += (part.per100.carbs_g || 0) * f;
    total.fat_g += (part.per100.fat_g || 0) * f;
    total.fibre_g += (part.per100.fibre_g || 0) * f;
  }
  return { kcal: round1(total.kcal), protein_g: round1(total.protein_g), carbs_g: round1(total.carbs_g), fat_g: round1(total.fat_g), fibre_g: round1(total.fibre_g) };
}

export function sumMacros(list: Per100[]): Per100 {
  return list.reduce(
    (acc, m) => ({
      kcal: round1(acc.kcal + m.kcal),
      protein_g: round1(acc.protein_g + m.protein_g),
      carbs_g: round1(acc.carbs_g + m.carbs_g),
      fat_g: round1(acc.fat_g + m.fat_g),
      fibre_g: round1(acc.fibre_g + m.fibre_g),
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 },
  );
}

export function gramsFor(quantity: number, unit: ServingUnit, servings: Serving[], servingGrams: number | null): number {
  if (unit === "g") return round1(quantity);
  const pick = servings.find((s) => s.unit === unit && s.specific) ?? servings.find((s) => s.unit === unit);
  if (pick) return round1(quantity * pick.grams);
  return round1(quantity * (servingGrams || 100));
}

// Changing an item's amount scales its ingredients by the same factor.
export function withAmount(item: DraftItem, quantity: number, unit: ServingUnit): DraftItem {
  const grams = gramsFor(quantity, unit, item.servings, item.grams / Math.max(item.quantity, 0.01));
  const factor = item.grams > 0 ? grams / item.grams : 1;
  return { ...item, quantity, unit, grams, ingredients: item.ingredients.map((ing) => ({ ...ing, grams: round1(ing.grams * factor) })) };
}

export function per100FromHit(hit: FoodHit): Per100 {
  return { kcal: hit.kcal ?? 0, protein_g: hit.protein_g ?? 0, carbs_g: hit.carbs_g ?? 0, fat_g: hit.fat_g ?? 0, fibre_g: hit.fibre_g ?? 0 };
}

export function defaultPortion(hit: FoodHit): { quantity: number; unit: ServingUnit } {
  const specific = hit.servings.find((s) => s.specific && s.unit !== "g");
  if (specific) return { quantity: 1, unit: specific.unit };
  if (hit.serving_grams) return { quantity: 1, unit: "serving" };
  return { quantity: 100, unit: "g" };
}

export function draftItemFromHit(hit: FoodHit, quantity: number, unit: ServingUnit, key = "s0"): DraftItem {
  return {
    key,
    food_id: hit.food_id,
    name: hit.name,
    is_dish: hit.is_dish,
    cuisine: hit.cuisine,
    quantity,
    unit,
    grams: gramsFor(quantity, unit, hit.servings, hit.serving_grams),
    per100: per100FromHit(hit),
    source: hit.is_own ? "user" : hit.source,
    own: hit.is_own,
    confidence: 1,
    match_score: hit.score ?? null,
    ingredients: [],
    servings: hit.servings,
  };
}

export const SOURCE_BADGE: Record<FoodSource, { label: string; className: string }> = {
  ifct: { label: "IFCT", className: "border-emerald-300/30 text-emerald-200" },
  verified: { label: "Verified", className: "border-emerald-300/30 text-emerald-200" },
  ai: { label: "AI estimate", className: "border-amber-300/30 text-amber-200" },
  user: { label: "Mine", className: "border-sky-300/30 text-sky-200" },
  barcode: { label: "Barcode", className: "border-violet-300/30 text-violet-200" },
};

export const UNIT_LABEL: Record<ServingUnit, string> = {
  roti: "roti",
  katori: "katori",
  ladle: "ladle",
  piece: "piece",
  plate: "plate",
  cup: "cup",
  tbsp: "tbsp",
  g: "g",
  serving: "serving",
};
