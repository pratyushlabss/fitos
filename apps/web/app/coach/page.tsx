"use client";

import type { CoachMessage, FoodDraft } from "@fitos/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { DraftReview } from "@/components/nutrition/DraftReview";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { localDayKey } from "@/lib/data/base";
import { coachHistory, coachSend } from "@/lib/data/nutrition";
import { defaultMealType } from "@/lib/logic/dashboard";
import { macrosFor, sumMacros } from "@/lib/logic/nutrition";

const QUICK_PROMPTS = ["What's left today?", "Log my breakfast", "What did I eat yesterday?", "How much protein is in my usual breakfast?"];

type Local = CoachMessage & { drafts?: FoodDraft[]; pending?: boolean };

export default function CoachPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [local, setLocal] = useState<Local[]>([]);
  const [reviewing, setReviewing] = useState<FoodDraft | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const history = useQuery({ queryKey: ["coach-history"], queryFn: () => coachHistory() });
  const messages: Local[] = [...(history.data ?? []), ...local];

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = useMutation({
    mutationFn: (text: string) => coachSend(text),
    onMutate: (text) => {
      setInput("");
      setLocal((current) => [
        ...current,
        { id: `u-${Date.now()}`, role: "user", content: text, created_at: new Date().toISOString() },
        { id: `p-${Date.now()}`, role: "assistant", content: "…", created_at: new Date().toISOString(), pending: true },
      ]);
    },
    onSuccess: (result) => {
      setLocal((current) => [
        ...current.filter((m) => !m.pending),
        { id: `a-${Date.now()}`, role: "assistant", content: result.reply, created_at: new Date().toISOString(), drafts: result.logged ? [] : result.drafts },
      ]);
      if (result.logged) {
        void queryClient.invalidateQueries({ queryKey: ["meals"] });
        void queryClient.invalidateQueries({ queryKey: ["nutrition-history"] });
      }
      void queryClient.invalidateQueries({ queryKey: ["nutrition-history"] });
    },
    onError: (error, text) => {
      // Drop the unsent bubble; the text goes back into the input to retry.
      setLocal((current) => current.filter((m) => !m.pending).filter((m, i, list) => !(i === list.length - 1 && m.role === "user" && m.content === text)));
      setInput(text);
      toast(error.message, "error");
    },
  });

  function submit(text: string) {
    const value = text.trim();
    if (value && !send.isPending) send.mutate(value);
  }

  return (
    <div className="flex min-h-[calc(100dvh-12rem)] flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/nutrition" className="rounded-full p-1 text-slate-400" aria-label="Back to nutrition">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-accent">Coach</p>
          <h1 className="text-xl font-semibold text-white">Nutrition coach</h1>
        </div>
      </div>

      <div className="flex-1 space-y-2">
        {history.isPending ? (
          <SkeletonList rows={4} height="h-12" />
        ) : history.isError ? (
          <ErrorState message={history.error.message} onRetry={() => void history.refetch()} />
        ) : messages.length === 0 ? (
          <EmptyState icon={<Sparkles size={20} />} title="Ask about your food" body="Calories left, what you ate on Monday, or log a meal by describing it. Nothing is saved until you say yes." />
        ) : (
          messages.map((message) => {
            const mine = message.role === "user";
            return (
              <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${mine ? "bg-emerald-400/20" : "bg-slate-800"}`}>
                  <p className={`selectable whitespace-pre-wrap text-sm leading-6 text-slate-100 ${message.pending ? "animate-pulse" : ""}`}>{message.content}</p>
                  {(message.drafts ?? [])
                    .filter((draft) => draft.items.length)
                    .map((draft) => {
                      const totals = sumMacros(draft.items.map(macrosFor));
                      return (
                        <div key={draft.analysis_id ?? draft.input_text} className="mt-2 rounded-xl border border-emerald-300/20 bg-slate-950/60 p-2 text-xs text-slate-300">
                          <p className="font-medium text-white">{draft.items.map((i) => i.name).join(", ")}</p>
                          <p>
                            {Math.round(totals.kcal)} kcal · {totals.protein_g} g protein{draft.meal_type ? ` · ${draft.meal_type}` : ""}
                          </p>
                          <Button variant="secondary" className="mt-2 w-full px-2 py-1.5 text-xs" onClick={() => setReviewing(draft)}>
                            Review and edit
                          </Button>
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>

      <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] mt-4 space-y-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {QUICK_PROMPTS.map((prompt) => (
            <button key={prompt} className="shrink-0 rounded-full border border-white/10 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-300" disabled={send.isPending} onClick={() => submit(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2 rounded-2xl border border-white/10 bg-panel/95 p-2 backdrop-blur"
          onSubmit={(event) => {
            event.preventDefault();
            submit(input);
          }}
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value.slice(0, 1000))}
            placeholder="Ask, or describe what you ate"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-base text-white outline-none placeholder:text-slate-600 focus:border-emerald-300/40"
          />
          <Button type="submit" aria-label="Send" disabled={!input.trim() || send.isPending}>
            <Send size={16} />
          </Button>
        </form>
      </div>

      <Sheet open={reviewing !== null} onClose={() => setReviewing(null)} title="Review before saving">
        {reviewing ? (
          <DraftReview
            draft={reviewing}
            mealType={reviewing.meal_type ?? defaultMealType()}
            date={reviewing.date ?? localDayKey()}
            source="chat"
            onCancel={() => setReviewing(null)}
            onDone={(message) => {
              setReviewing(null);
              toast(message, "success");
              void queryClient.invalidateQueries({ queryKey: ["meals"] });
              void queryClient.invalidateQueries({ queryKey: ["nutrition-history"] });
            }}
          />
        ) : null}
      </Sheet>
    </div>
  );
}
