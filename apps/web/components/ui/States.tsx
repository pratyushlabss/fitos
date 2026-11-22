"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/Button";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-800/70 ${className}`} />;
}

export function SkeletonList({ rows = 3, height = "h-16" }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className={`${height} w-full`} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/10 bg-slate-950/40 px-4 py-6 text-center">
      {icon ? <div className="mb-2 text-emerald-300">{icon}</div> : null}
      <p className="text-sm font-semibold text-white">{title}</p>
      {body ? <p className="mt-1 text-sm leading-5 text-slate-400">{body}</p> : null}
      {action ? <div className="mt-4 w-full">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-rose-400/20 bg-rose-500/5 px-4 py-5 text-center">
      <AlertTriangle size={20} className="text-rose-300" />
      <p className="mt-2 text-sm font-semibold text-white">Something went wrong</p>
      <p className="mt-1 text-xs leading-5 text-slate-400">{message ?? "Check your connection and try again."}</p>
      {onRetry ? (
        <Button variant="secondary" className="mt-3 gap-2" onClick={onRetry}>
          <RotateCw size={14} /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function QueryView<T>({
  query,
  skeleton,
  isEmpty,
  empty,
  children,
}: {
  query: UseQueryResult<T>;
  skeleton?: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <SkeletonList />}</>;
  if (query.isError) return <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />;
  if (isEmpty?.(query.data) && empty) return <>{empty}</>;
  return <>{children(query.data)}</>;
}
