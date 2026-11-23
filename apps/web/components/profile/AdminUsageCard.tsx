"use client";

import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";

import { SectionCard } from "@/components/ui/SectionCard";
import { aiAdminUsage } from "@/lib/data/nutrition";

export function AdminUsageCard() {
  const usage = useQuery({ queryKey: ["ai-admin-usage"], queryFn: aiAdminUsage, retry: false, staleTime: 60_000 });
  const u = usage.data;
  if (!u) return null;
  const spendPct = Math.min(100, (u.month_spend_usd / Math.max(u.monthly_budget_usd, 0.01)) * 100);
  const callPct = Math.min(100, (u.today_calls / Math.max(u.daily_call_cap, 1)) * 100);
  return (
    <SectionCard title="AI usage (admin)" action={<Gauge size={16} className="text-amber-300" />}>
      <div className="space-y-3 text-sm">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-slate-300">This month</span>
            <strong className="text-white">
              ${u.month_spend_usd.toFixed(2)} / ${u.monthly_budget_usd.toFixed(2)}
            </strong>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800">
            <div className={`h-full rounded-full ${spendPct >= 90 ? "bg-rose-400" : spendPct >= 70 ? "bg-amber-300" : "bg-emerald-400"}`} style={{ width: `${spendPct}%` }} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Calls today</span>
            <strong className="text-white">
              {u.today_calls} / {u.daily_call_cap}
            </strong>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800">
            <div className={`h-full rounded-full ${callPct >= 90 ? "bg-rose-400" : "bg-sky-400"}`} style={{ width: `${callPct}%` }} />
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {u.today_users} user{u.today_users === 1 ? "" : "s"} today · {Math.round(u.today_tokens_in / 1000)}k in / {Math.round(u.today_tokens_out / 1000)}k out tokens · {u.month_calls} calls this month · {u.provider} {u.model} · {u.user_daily_limit} per user/day
        </p>
      </div>
    </SectionCard>
  );
}
