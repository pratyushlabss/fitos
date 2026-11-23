"use client";

import { ArrowLeft, Mail } from "lucide-react";
import { type FormEvent, useState } from "react";

import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { sendSignInCode, verifySignInCode } from "@/lib/data/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendSignInCode(email);
      setStep("code");
      setNotice(`Check ${email.trim()}. Tap the link in the email on this device, or enter the code if it shows one.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("The code is 6 digits.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifySignInCode(email, code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code did not work.");
      setBusy(false);
    }
  }

  return (
    <div className="pt-[8dvh]">
      <ScreenHeader eyebrow="FitOS" title="Sign in" subtitle="Train, eat and recover with your friends." />
      {step === "email" ? (
        <form className="space-y-4" onSubmit={requestCode}>
          <Field label="Email">
            <TextInput
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" className="w-full gap-2" disabled={busy}>
            <Mail size={16} /> {busy ? "Sending…" : "Email me a code"}
          </Button>
          <p className="text-xs leading-5 text-slate-500">
            You will get a 6-digit code to type here. No password, and no link that opens another browser.
          </p>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={verify}>
          {notice ? <p className="rounded-xl border border-emerald-300/15 bg-emerald-300/5 p-3 text-sm text-slate-300">{notice}</p> : null}
          <Field label="6-digit code">
            <TextInput
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="123456"
              className="text-center text-2xl tracking-[0.5em]"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
            />
          </Field>
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : "Sign in"}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-slate-400"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            >
              <ArrowLeft size={14} /> Change email
            </button>
            <button type="button" className="text-emerald-300" disabled={busy} onClick={() => void requestCode()}>
              Resend code
            </button>
          </div>
        </form>
      )}
      {error ? <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/5 p-3 text-sm text-rose-200">{error}</p> : null}
    </div>
  );
}
