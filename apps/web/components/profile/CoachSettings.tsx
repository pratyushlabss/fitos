"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";

import { useAuth, useProfile } from "@/components/auth/AuthProvider";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState, QueryView } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { deleteMemory, listMemories } from "@/lib/data/insights";
import { updateMyProfile } from "@/lib/data/profile";

// Settings › Coach: daily nudges on or off, and what the coach remembers about you.
export function CoachSettings() {
  const profile = useProfile();
  const { refreshProfile } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const memories = useQuery({ queryKey: ["coach-memories"], queryFn: listMemories });
  const nudges = useMutation({
    mutationFn: (on: boolean) => updateMyProfile({ nudges_enabled: on }),
    onSuccess: () => void refreshProfile(),
    onError: (error) => toast(error.message, "error"),
  });
  const remove = useMutation({
    mutationFn: deleteMemory,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["coach-memories"] }),
    onError: (error) => toast(error.message, "error"),
  });
  const on = profile.nudges_enabled !== false;
  return (
    <SectionCard title="Coach">
      <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-fg">
        <span>
          Daily nudge
          <span className="block text-xs text-muted">At most one a day, around 7 pm.</span>
        </span>
        <input type="checkbox" role="switch" className="h-6 w-10 accent-[rgb(var(--max))]" checked={on} disabled={nudges.isPending} onChange={(event) => nudges.mutate(event.target.checked)} />
      </label>
      <p className="eyebrow mb-2 mt-4">What the coach remembers</p>
      <QueryView query={memories} isEmpty={(list) => list.length === 0} empty={<EmptyState title="Nothing yet" body="Tell the coach things like “vegetarian on Tuesdays” or “I cook with coconut oil”." />}>
        {(list) => (
          <ul className="divide-y divide-line">
            {list.map((memory) => (
              <li key={memory.id} className="flex items-center justify-between gap-2 py-2 text-sm text-fg">
                <span className="min-w-0 flex-1">{memory.note}</span>
                <button className="press flex h-11 w-11 items-center justify-center text-muted" aria-label={`Forget “${memory.note}”`} disabled={remove.isPending} onClick={() => remove.mutate(memory.id)}>
                  <Trash2 size={15} strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </SectionCard>
  );
}
