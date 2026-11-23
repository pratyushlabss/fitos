import type { Session } from "@supabase/supabase-js";

import { supabase } from "./base";

export type { Session };

// Email + password, no confirmation email (autoconfirm is on). Signs in, or registers on first use.
export async function signInOrRegister(email: string, password: string): Promise<"signed_in" | "registered"> {
  const address = email.trim().toLowerCase();
  const login = await supabase.auth.signInWithPassword({ email: address, password });
  if (!login.error) return "signed_in";
  const signup = await supabase.auth.signUp({ email: address, password });
  if (signup.error) {
    if (/registered|exists/i.test(signup.error.message)) throw new Error("Wrong password for this email.");
    throw new Error(signup.error.message);
  }
  if (!signup.data.session) throw new Error("Account created but not signed in. Try again.");
  return "registered";
}

export async function sendSignInCode(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/` },
  });
  if (error) throw new Error(error.message);
}

export async function verifySignInCode(email: string, token: string): Promise<Session> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: "email",
  });
  if (error) throw new Error(error.message);
  if (!data.session) throw new Error("No session returned. Request a new code.");
  return data.session;
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onSessionChange(callback: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export function setAutoRefresh(active: boolean): void {
  if (active) void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}
