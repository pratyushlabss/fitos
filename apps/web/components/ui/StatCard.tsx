type StatCardProps = {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
};

export function StatCard({ label, value, hint, accent = false }: StatCardProps) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        accent
          ? "border-emerald-400/30 bg-emerald-500/10"
          : "border-white/10 bg-slate-900/80"
      }`}
    >
      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}
