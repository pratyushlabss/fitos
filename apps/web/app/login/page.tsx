"use client";

import { type FormEvent, useState } from "react";

import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { signInOrRegister } from "@/lib/data/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    setBusy(true);
    setError(null);
    try {
      await signInOrRegister(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      setBusy(false);
    }
  }

  return (
    <div className="pt-[8dvh]">
      <ScreenHeader eyebrow="FitOS" title="Sign in" subtitle="New here? The same form creates your account." />
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Email">
          <TextInput type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </Field>
        <Field label="Password" hint="At least 6 characters.">
          <TextInput type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Continue"}
        </Button>
      </form>
      {error ? (
        <p className="mt-4 rounded-[14px] border border-fg p-3 text-sm font-semibold text-fg" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
