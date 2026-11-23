"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useProfile } from "@/components/auth/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState, QueryView, Skeleton, SkeletonList } from "@/components/ui/States";
import { nutritionHistory } from "@/lib/data/nutrition";
import { targetsFor } from "@/lib/logic/dashboard";

function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function label(day: string, options: Intl.DateTimeFormatOptions) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, options);
}

export default function NutritionHistoryPage() {
  const targets = targetsFor(useProfile());
  const history = useQuery({ queryKey: ["nutrition-history"], queryFn: () => nutritionHistory(120) });

  const weeks = useMemo(() => {
    const groups = new Map<string, { kcal: number; protein: number; days: number }>();
    for (const day of history.data ?? []) {
      const key = weekStart(day.log_date);
      const g = groups.get(key) ?? { kcal: 0, protein: 0, days: 0 };
      groups.set(key, { kcal: g.kcal + day.kcal, protein: g.protein + day.protein_g, days: g.days + 1 });
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([week, g]) => ({ week: label(week, { month: "short", day: "numeric" }), kcal: Math.round(g.kcal / g.days), protein: Math.round(g.protein / g.days), days: g.days }));
  }, [history.data]);

  const firstDay = history.data?.at(-1)?.log_date;
  const dayNumber = (day: string) => (firstDay ? Math.round((Date.parse(`${day}T12:00:00`) - Date.parse(`${firstDay}T12:00:00`)) / 86400000) + 1 : 1);

  return (
    <PullToRefresh onRefresh={() => history.refetch()}>
      <Link href="/nutrition" className="mb-5 inline-flex items-center gap-2 text-sm text-slate-400">
        <ArrowLeft size={16} /> Nutrition
      </Link>
      <ScreenHeader eyebrow="Nutrition" title="History" subtitle={`Goal ${targets.calories.toLocaleString()} kcal · ${targets.protein_g} g protein`} />
      <div className="space-y-5">
        <SectionCard title="Weekly average (kcal per logged day)">
          {history.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : weeks.length === 0 ? (
            <EmptyState title="No weeks yet" body="Log meals and your weekly averages appear here." />
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeks} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,.12)" vertical={false} />
                  <XAxis dataKey="week" tick={{ fill: "#8B98B3", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#8B98B3", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,.04)" }}
                    contentStyle={{ background: "#121A2B", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, color: "#fff" }}
                    formatter={(value, name) => [value, name === "kcal" ? "kcal/day" : "protein g/day"]}
                  />
                  <ReferenceLine y={targets.calories} stroke="#F5C451" strokeDasharray="4 4" />
                  <Bar dataKey="kcal" fill="#3DDC97" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Days">
          <QueryView
            query={history}
            skeleton={<SkeletonList rows={6} height="h-14" />}
            isEmpty={(data) => data.length === 0}
            empty={
              <EmptyState
                title="Nothing logged yet"
                body="Every day you log shows up here with totals against your goal."
                action={
                  <Link href="/nutrition" className="flex w-full items-center justify-center rounded-xl bg-accent py-2.5 text-sm font-semibold text-ink">
                    Log a meal
                  </Link>
                }
              />
            }
          >
            {(data) => (
              <div className="space-y-2">
                {data.map((day) => {
                  const pct = Math.min(100, Math.round((day.kcal / targets.calories) * 100));
                  const over = day.kcal > targets.calories * 1.05;
                  return (
                    <Link key={day.log_date} href={`/nutrition?d=${day.log_date}`} className="block rounded-xl border border-white/5 bg-slate-950/60 p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-white">
                          Day {dayNumber(day.log_date)} · {label(day.log_date, { weekday: "short", month: "short", day: "numeric" })}
                        </span>
                        <strong className={over ? "text-amber-300" : "text-white"}>{Math.round(day.kcal).toLocaleString()} kcal</strong>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <div className={`h-full rounded-full ${over ? "bg-amber-300" : "bg-emerald-400"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1.5 text-xs text-slate-500">
                        {Math.round(day.protein_g)}/{targets.protein_g} g protein · {Math.round(day.carbs_g)} g carbs · {Math.round(day.fat_g)} g fat · {day.items} items
                      </p>
                    </Link>
                  );
                })}
              </div>
            )}
          </QueryView>
        </SectionCard>
      </div>
    </PullToRefresh>
  );
}
