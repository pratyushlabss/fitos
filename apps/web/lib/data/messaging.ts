import type { ChatMessage, ConversationSummary } from "@fitos/types";

import { currentUserId, num, supabase, unwrap, type Row } from "./base";

export async function listConversations(): Promise<ConversationSummary[]> {
  const rows = unwrap(await supabase.rpc("list_conversations")) as Record<string, unknown>[] | null;
  return (rows ?? []).map((row: Row) => ({
    conversation_id: String(row.conversation_id),
    other_user_id: String(row.other_user_id),
    username: (row.username as string | null) ?? null,
    display_name: String(row.display_name ?? ""),
    avatar_url: (row.avatar_url as string | null) ?? null,
    last_body: (row.last_body as string | null) ?? null,
    last_at: (row.last_at as string | null) ?? null,
    last_sender_id: (row.last_sender_id as string | null) ?? null,
    unread: num(row.unread),
  }));
}

export async function openConversation(otherUserId: string): Promise<string> {
  return String(unwrap(await supabase.rpc("get_or_create_direct_conversation", { p_other: otherUserId })));
}

export async function listMessages(conversationId: string, limit = 100): Promise<ChatMessage[]> {
  const rows = unwrap(
    await supabase
      .from("messages")
      .select("id, conversation_id, sender_id, body, created_at")
      .eq("conversation_id", conversationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  return ((rows ?? []) as ChatMessage[]).reverse();
}

export async function sendMessage(conversationId: string, body: string): Promise<ChatMessage> {
  const userId = await currentUserId();
  const row = unwrap(
    await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, sender_id: userId, body: body.trim() })
      .select("id, conversation_id, sender_id, body, created_at")
      .single(),
  );
  return row as ChatMessage;
}

export async function markConversationRead(conversationId: string): Promise<void> {
  unwrap(await supabase.rpc("mark_conversation_read", { p_conversation: conversationId }));
}

export function subscribeToMessages(conversationId: string | null, onMessage: (message: ChatMessage) => void): () => void {
  const channel = supabase
    .channel(`messages-${conversationId ?? "all"}-${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        ...(conversationId ? { filter: `conversation_id=eq.${conversationId}` } : {}),
      },
      (payload) => onMessage(payload.new as ChatMessage),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
