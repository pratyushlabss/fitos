"use client";

import { Dumbbell } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { ErrorState } from "@/components/ui/States";
import { supabaseConfigured } from "@/lib/supabase";

const PUBLIC_ROUTES = ["/login"];

export function normalizePath(pathname: string | null): string {
  if (!pathname) return "/";
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function Splash() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-emerald-300" aria-busy="true">
      <Dumbbell size={28} className="animate-pulse" />
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">FitOS</p>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { status, profile, profileLoading, profileError, refreshProfile } = useAuth();
  const router = useRouter();
  const path = normalizePath(usePathname());
  const isPublic = PUBLIC_ROUTES.includes(path);
  const needsOnboarding = status === "signed_in" && profile !== null && !profile.onboarded_at;

  useEffect(() => {
    if (status === "signed_out" && !isPublic) router.replace("/login");
    if (status === "signed_in" && isPublic) router.replace("/");
    if (needsOnboarding && path !== "/onboarding") router.replace("/onboarding");
  }, [status, isPublic, needsOnboarding, path, router]);

  if (!supabaseConfigured) {
    return (
      <div className="pt-10">
        <ErrorState message="Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then rebuild." />
      </div>
    );
  }
  if (status === "loading") return <Splash />;
  if (status === "signed_out") return isPublic ? <>{children}</> : <Splash />;
  if (isPublic) return <Splash />;
  if (profileError) return <ErrorState message={profileError.message} onRetry={() => void refreshProfile()} />;
  if (profileLoading || !profile) return <Splash />;
  if (needsOnboarding && path !== "/onboarding") return <Splash />;
  return <>{children}</>;
}
