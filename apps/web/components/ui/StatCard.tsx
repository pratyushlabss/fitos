type StatCardProps = { label: string; value: string; hint?: string; accent?: boolean };

export function StatCard({ label, value, hint, accent = false }: StatCardProps) {
  return (
    <div className={`rounded-card border p-4 ${accent ? "texture-dots border-fg/40 bg-surface-1" : "border-line bg-surface-1"}`}>
      <p className="eyebrow">{label}</p>
      <div className={`num mt-2 text-2xl text-fg ${accent ? "font-semibold" : "font-medium"}`}>{value}</div>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
