// Macro fills by pattern, never colour: protein solid, carbs 45° hatch, fat dots, fibre horizontal lines.
export type MacroKind = "protein" | "carbs" | "fat" | "fibre" | "kcal";

export const MACRO_LABEL: Record<MacroKind, string> = { protein: "Protein", carbs: "Carbs", fat: "Fat", fibre: "Fibre", kcal: "Calories" };

export function PatternDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={`${id}-carbs`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="4" height="4" fill="rgb(var(--max) / 0.12)" />
        <rect width="1.6" height="4" fill="rgb(var(--max))" />
      </pattern>
      <pattern id={`${id}-fat`} width="4" height="4" patternUnits="userSpaceOnUse">
        <rect width="4" height="4" fill="rgb(var(--max) / 0.12)" />
        <circle cx="2" cy="2" r="1.1" fill="rgb(var(--max))" />
      </pattern>
      <pattern id={`${id}-fibre`} width="4" height="4" patternUnits="userSpaceOnUse">
        <rect width="4" height="4" fill="rgb(var(--max) / 0.12)" />
        <rect width="4" height="1.5" fill="rgb(var(--max))" />
      </pattern>
    </defs>
  );
}

export function patternFill(id: string, kind: MacroKind): string {
  if (kind === "carbs") return `url(#${id}-carbs)`;
  if (kind === "fat") return `url(#${id}-fat)`;
  if (kind === "fibre") return `url(#${id}-fibre)`;
  return "rgb(var(--max))";
}

// Small legend swatch.
export function MacroSwatch({ kind, size = 10 }: { kind: MacroKind; size?: number }) {
  const id = `sw-${kind}`;
  return (
    <svg width={size} height={size} aria-hidden="true" className="shrink-0 rounded-[2px]">
      <PatternDefs id={id} />
      <rect width={size} height={size} rx="2" fill={patternFill(id, kind)} stroke="rgb(var(--max) / 0.5)" strokeWidth="0.5" />
    </svg>
  );
}
