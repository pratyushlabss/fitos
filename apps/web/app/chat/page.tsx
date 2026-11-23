"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessageCircle, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState, QueryView, SkeletonList } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { listConversations, openConversation, subscribeToMessages } from "@/lib/data/messaging";
import { searchProfiles } from "@/lib/data/profile";
import { timeAgo } from "@/lib/logic/format";

export default function ChatPage() {
  const { userId } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const term = search.trim();

  const conversations = useQuery({ queryKey: ["conversations"], queryFn: listConversations });
  const people = useQuery({ queryKey: ["people", "search", term], queryFn: () => searchProfiles(term), enabled: term.length >= 2 });

  useEffect(() => subscribeToMessages(null, () => void queryClient.invalidateQueries({ queryKey: ["conversations"] })), [queryClient]);

  const start = useMutation({
    mutationFn: openConversation,
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      router.push(`/chat/thread?id=${id}`);
    },
    onError: (error) => toast(error.message.includes("follow_required") ? "Follow each other before messaging a private account." : error.message, "error"),
  });

  return (
    <PullToRefresh onRefresh={() => conversations.refetch()}>
      <div className="mb-4">
        <Link href="/social" className="inline-flex items-center gap-2 text-sm text-slate-400">
          <ArrowLeft size={16} /> Social
        </Link>
      </div>
      <ScreenHeader eyebrow="Messages" title="Friends who train" subtitle="Private one-to-one conversations." />
      <div className="space-y-4">
        <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/80 px-3 py-2.5">
          <Search className="text-slate-500" size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search username or name to start a chat"
            autoCapitalize="none"
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
          />
        </label>

        {term.length >= 2 ? (
          <SectionCard title="Start a conversation">
            <QueryView
              query={people}
              skeleton={<SkeletonList rows={2} height="h-14" />}
              isEmpty={(data) => data.length === 0}
              empty={<EmptyState title={`No one matches “${term}”`} />}
            >
              {(data) => (
                <div className="space-y-2">
                  {data.map((person) => (
                    <div key={person.id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-950/50 p-3">
                      <Avatar name={person.display_name} url={person.avatar_url} />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-sm text-white">{person.display_name}</strong>
                        <span className="text-xs text-slate-500">@{person.username}</span>
                      </span>
                      <Button variant="secondary" className="px-3 py-2 text-xs" disabled={start.isPending} onClick={() => start.mutate(person.id)}>
                        Message
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </QueryView>
          </SectionCard>
        ) : null}

        <QueryView
          query={conversations}
          skeleton={<SkeletonList rows={4} height="h-16" />}
          isEmpty={(data) => data.length === 0}
          empty={
            <EmptyState
              icon={<MessageCircle size={20} />}
              title="No conversations yet"
              body="Search for a friend above, or tap Message on their profile."
            />
          }
        >
          {(data) => (
            <div className="grid gap-2">
              {data.map((conversation) => (
                <Link
                  key={conversation.conversation_id}
                  href={`/chat/thread?id=${conversation.conversation_id}`}
                  className={`flex items-center gap-3 rounded-2xl border p-3 transition ${conversation.unread ? "border-emerald-300/30 bg-emerald-300/10" : "border-white/10 bg-slate-900/70"}`}
                >
                  <Avatar name={conversation.display_name} url={conversation.avatar_url} />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm text-white">{conversation.display_name || conversation.username}</strong>
                    <span className={`block truncate text-xs ${conversation.unread ? "text-slate-200" : "text-slate-500"}`}>
                      {conversation.last_body
                        ? `${conversation.last_sender_id === userId ? "You: " : ""}${conversation.last_body}`
                        : "Say hi"}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    {conversation.last_at ? <span className="text-[11px] text-slate-500">{timeAgo(conversation.last_at)}</span> : null}
                    {conversation.unread ? (
                      <span className="min-w-[20px] rounded-full bg-accent px-1.5 text-center text-[11px] font-semibold leading-5 text-ink">{conversation.unread}</span>
                    ) : null}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </QueryView>
      </div>
    </PullToRefresh>
  );
}
