import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured = Boolean(url && anonKey);
export const supabaseUrl = url;

export const supabase = createClient(url || "http://localhost:54321", anonKey || "missing-anon-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "fitos-auth",
  },
});

export function functionsUrl(name: string): string {
  return `${url}/functions/v1/${name}`;
}
