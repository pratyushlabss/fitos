import type { ReactNode } from "react";

type SectionCardProps = {
  title: string;
  action?: ReactNode;
  children: ReactNode;
};

export function SectionCard({ title, action, children }: SectionCardProps) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.35)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-300">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
