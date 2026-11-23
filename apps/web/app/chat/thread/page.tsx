"use client";

import type { ChatMessage } from "@fitos/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { listConversations, listMessages, markConversationRead, sendMessage, subscribeToMessages } from "@/lib/data/messaging";

export default function ThreadPage() {
  return (
    <Suspense fallback={<SkeletonList rows={5} height="h-12" />}>
      <Thread />
    </Suspense>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Thread() {
  const id = useSearchParams().get("id") ?? "";
  const { userId } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const key = ["messages", id];

  const conversations = useQuery({ queryKey: ["conversations"], queryFn: listConversations });
  const other = conversations.data?.find((conversation) => conversation.conversation_id === id);
  const messages = useQuery({ queryKey: key, queryFn: () => listMessages(id), enabled: Boolean(id) });

  useEffect(() => {
    if (!id) return;
    void markConversationRead(id).then(() => queryClient.invalidateQueries({ queryKey: ["conversations"] }));
    return subscribeToMessages(id, (message) => {
      queryClient.setQueryData<ChatMessage[]>(["messages", id], (current) => {
        const list = current ?? [];
        if (list.some((item) => item.id === message.id)) return list;
        return [...list.filter((item) => !(item.id.startsWith("pending-") && item.body === message.body && message.sender_id === userId)), message];
      });
      if (message.sender_id !== userId) void markConversationRead(id).then(() => queryClient.invalidateQueries({ queryKey: ["conversations"] }));
    });
  }, [id, queryClient, userId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.data?.length]);

  const send = useMutation({
    mutationFn: (text: string) => sendMessage(id, text),
    onMutate: (text) => {
      setBody("");
      const pending: ChatMessage = { id: `pending-${Date.now()}`, conversation_id: id, sender_id: userId ?? "", body: text, created_at: new Date().toISOString() };
      queryClient.setQueryData<ChatMessage[]>(key, (current) => [...(current ?? []), pending]);
      return pending.id;
    },
    onSuccess: (saved, _text, pendingId) => {
      queryClient.setQueryData<ChatMessage[]>(key, (current) => {
        const list = (current ?? []).filter((item) => item.id !== pendingId);
        return list.some((item) => item.id === saved.id) ? list : [...list, saved];
      });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error, text, pendingId) => {
      queryClient.setQueryData<ChatMessage[]>(key, (current) => (current ?? []).filter((item) => item.id !== pendingId));
      setBody(text);
      toast(error.message, "error");
    },
  });

  if (!id) return <ErrorState message="No conversation selected." />;

  return (
    <div className="flex min-h-[calc(100dvh-12rem)] flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/chat" className="rounded-full p-1 text-slate-400" aria-label="Back to messages">
          <ArrowLeft size={18} />
        </Link>
        {other ? (
          <Link href={`/social/profile?id=${other.other_user_id}`} className="flex min-w-0 items-center gap-3">
            <Avatar name={other.display_name} url={other.avatar_url} size="sm" />
            <span className="min-w-0">
              <strong className="block truncate text-white">{other.display_name}</strong>
              <span className="text-xs text-slate-500">@{other.username}</span>
            </span>
          </Link>
        ) : (
          <span className="text-slate-400">Conversation</span>
        )}
      </div>

      <div className="flex-1 space-y-2">
        {messages.isPending ? (
          <SkeletonList rows={5} height="h-12" />
        ) : messages.isError ? (
          <ErrorState message={messages.error.message} onRetry={() => void messages.refetch()} />
        ) : messages.data.length === 0 ? (
          <EmptyState title="No messages yet" body="Say hi, share a PR, or plan your next session." />
        ) : (
          messages.data.map((message) => {
            const mine = message.sender_id === userId;
            return (
              <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${mine ? "bg-emerald-400/20" : "bg-slate-800"} ${message.id.startsWith("pending-") ? "opacity-60" : ""}`}>
                  <p className="selectable whitespace-pre-wrap break-words text-sm leading-6 text-slate-100">{message.body}</p>
                  <p className="mt-0.5 text-right text-[10px] text-slate-500">{message.id.startsWith("pending-") ? "Sending…" : formatTime(message.created_at)}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>

      <form
        className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] mt-4 flex gap-2 rounded-2xl border border-white/10 bg-panel/95 p-2 backdrop-blur"
        onSubmit={(event) => {
          event.preventDefault();
          if (body.trim()) send.mutate(body.trim());
        }}
      >
        <input
          value={body}
          onChange={(event) => setBody(event.target.value.slice(0, 4000))}
          placeholder={`Message ${other?.display_name?.split(" ")[0] ?? ""}`}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-base text-white outline-none placeholder:text-slate-600 focus:border-emerald-300/40"
        />
        <Button type="submit" aria-label="Send message" disabled={!body.trim()}>
          <Send size={16} />
        </Button>
      </form>
    </div>
  );
}
