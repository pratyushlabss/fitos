"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/Button";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded-[14px] ${className}`} />;
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

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="texture-dots flex flex-col items-center rounded-card border border-dashed border-line px-5 py-8 text-center">
      {icon ? <div className="mb-3 text-fg/70 [&_svg]:stroke-[1.5]">{icon}</div> : null}
      <p className="text-sm font-semibold tracking-tight text-fg">{title}</p>
      {body ? <p className="mt-1 max-w-[30ch] text-sm leading-5 text-muted">{body}</p> : null}
      {action ? <div className="mt-5 w-full">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-fg px-5 py-6 text-center" role="alert">
      <p className="eyebrow !text-fg">Error</p>
      <p className="mt-2 text-sm font-bold text-fg">Something went wrong</p>
      <p className="mt-1 text-xs leading-5 text-muted">{message ?? "Check your connection and try again."}</p>
      {onRetry ? (
        <Button variant="outline" className="mt-4 gap-2" onClick={onRetry}>
          <RotateCw size={14} strokeWidth={1.5} /> Retry
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
