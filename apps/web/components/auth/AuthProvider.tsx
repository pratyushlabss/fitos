"use client";

import type { Profile } from "@fitos/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { getSession, onSessionChange, type Session, setAutoRefresh } from "@/lib/data/auth";
import { ensureMyProfile } from "@/lib/data/profile";
import { supabaseConfigured } from "@/lib/supabase";

type AuthStatus = "loading" | "signed_out" | "signed_in";

type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  profileError: Error | null;
  profileLoading: boolean;
  refreshProfile: () => Promise<unknown>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    if (!supabaseConfigured) {
      setStatus("signed_out");
      return;
    }
    let active = true;
    void getSession().then((current) => {
      if (!active) return;
      setSession(current);
      setStatus(current ? "signed_in" : "signed_out");
    });
    const unsubscribe = onSessionChange((next) => {
      setSession(next);
      setStatus(next ? "signed_in" : "signed_out");
      if (!next) queryClient.clear();
    });
    const onVisibility = () => setAutoRefresh(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [queryClient]);

  const userId = session?.user.id ?? null;
  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    queryFn: ensureMyProfile,
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      userId,
      profile: profileQuery.data ?? null,
      profileError: profileQuery.error,
      profileLoading: Boolean(userId) && profileQuery.isPending,
      refreshProfile: () => profileQuery.refetch(),
    }),
    [status, session, userId, profileQuery],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function useProfile(): Profile {
  const { profile } = useAuth();
  if (!profile) throw new Error("Profile not loaded");
  return profile;
}
