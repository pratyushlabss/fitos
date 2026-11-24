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
import { type CoachCard, coachHistory, coachStream, confirmDraft } from "@/lib/data/nutrition";
import { defaultMealType } from "@/lib/logic/dashboard";
import { macrosFor, sumMacros } from "@/lib/logic/nutrition";

const QUICK_PROMPTS = ["What's left today?", "Log my breakfast", "What did I eat yesterday?", "How much protein is in my usual breakfast?"];

type Local = CoachMessage & { drafts?: FoodDraft[]; cards?: CoachCard[]; chips?: string[]; pending?: boolean };

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
    mutationFn: (text: string) =>
      coachStream(text, (event) =>
        setLocal((current) =>
          current.map((m) =>
            m.pending ? (event.type === "tool" ? { ...m, chips: [...(m.chips ?? []), event.label] } : { ...m, content: m.content + event.text }) : m,
          ),
        ),
      ),
    onMutate: (text) => {
      setInput("");
      setLocal((current) => [
        ...current,
        { id: `u-${Date.now()}`, role: "user", content: text, created_at: new Date().toISOString() },
        { id: `p-${Date.now()}`, role: "assistant", content: "", chips: [], created_at: new Date().toISOString(), pending: true },
      ]);
    },
    onSuccess: (result) => {
      setLocal((current) => {
        const chips = current.find((m) => m.pending)?.chips ?? [];
        return [
          ...current.filter((m) => !m.pending),
          { id: `a-${Date.now()}`, role: "assistant", content: result.reply, created_at: new Date().toISOString(), drafts: result.logged ? [] : result.drafts, cards: result.cards ?? [], chips },
        ];
      });
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
                <div className={`max-w-[88%] rounded-[18px] px-3.5 py-2.5 ${mine ? "bg-max text-bg" : "border border-line bg-surface-1 text-fg"}`}>
                  {message.chips?.length ? (
                    <div className="mb-1.5 flex flex-wrap gap-1">
                      {message.chips.map((chip, i) => (
                        <span key={`${chip}${i}`} className="num rounded-full border border-line px-2 py-0.5 text-[10px] text-muted">
                          {chip}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {message.pending && !message.content ? (
                    <span className="inline-flex gap-1 py-1" aria-label="Coach is typing">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-fg" style={{ animationDelay: `${i * 0.2}s` }} />
                      ))}
                    </span>
                  ) : (
                    <p className="selectable whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                  )}
                  {(message.cards ?? []).map((card, i) => (
                    <CoachCardView key={i} card={card} onLogged={(text) => {
                      toast(text, "success");
                      void queryClient.invalidateQueries({ queryKey: ["meals"] });
                      void queryClient.invalidateQueries({ queryKey: ["nutrition-history"] });
                    }} />
                  ))}
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

// Meal options, day plans and weekly reviews from the coach. Macros are exact; "Log this" saves the items as shown.
function CoachCardView({ card, onLogged }: { card: CoachCard; onLogged: (message: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function log(key: string, items: FoodDraft["items"], meal = defaultMealType()) {
    setBusy(key);
    try {
      const result = await confirmDraft({ analysis_id: null, meal_type: meal, date: localDayKey(), source: "chat", items });
      onLogged(`Logged ${result.logged} item${result.logged === 1 ? "" : "s"} to ${meal}`);
    } catch (error) {
      onLogged(error instanceof Error ? error.message : "Could not log that.");
    } finally {
      setBusy(null);
    }
  }
  if (card.kind === "review") {
    return (
      <div className="mt-2 rounded-[14px] border border-line p-3 text-xs leading-5 text-fg/90">
        <p className="eyebrow mb-1">{card.title}</p>
        {card.body}
      </div>
    );
  }
  const rows =
    card.kind === "options"
      ? (card.options ?? []).map((o, i) => ({ key: `o${i}`, title: o.title, sub: o.why, items: o.items, totals: o.totals, meal: undefined }))
      : (card.plan?.meals ?? []).map((m) => ({ key: m.meal, title: m.meal, sub: m.items.map((i) => `${i.name} ${i.grams} g`).join(" · "), items: m.items, totals: m.totals, meal: m.meal }));
  return (
    <div className="mt-2 space-y-2">
      {card.kind === "plan" && card.plan ? (
        <p className="num text-[11px] text-muted">
          Day: {card.plan.totals.kcal} kcal · P{card.plan.totals.protein_g} C{card.plan.totals.carbs_g} F{card.plan.totals.fat_g}
        </p>
      ) : null}
      {rows.map((row) => (
        <div key={row.key} className="rounded-[14px] border border-line bg-bg p-3">
          <p className="text-sm font-semibold capitalize tracking-tight">{row.title}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted">{row.sub}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="num text-[11px] text-fg/80">
              {row.totals.kcal} kcal · P{row.totals.protein_g} C{row.totals.carbs_g} F{row.totals.fat_g}
            </span>
            <button className="press min-h-[36px] rounded-full bg-max px-3 text-xs font-semibold text-bg disabled:opacity-40" disabled={busy !== null || !row.items.length} onClick={() => void log(row.key, row.items, row.meal)}>
              {busy === row.key ? "Logging…" : "Log this"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
