from datetime import datetime
from typing import Any
from uuid import UUID

from supabase import Client

from domain.models.messaging import Conversation, Message, UserSearchResult


class SupabaseMessagingRepository:
    def __init__(self, client: Client) -> None:
        self._client = client

    async def search_users(self, user_id: UUID, query: str, limit: int) -> list[UserSearchResult]:
        safe_query = query.strip()
        if not safe_query:
            return []
        result = (
            self._client.table("profiles")
            .select("id, username, display_name, avatar_url, is_private")
            .neq("id", str(user_id))
            .or_(f"username.ilike.%{safe_query}%,display_name.ilike.%{safe_query}%")
            .limit(min(limit, 50))
            .execute()
        )
        return [UserSearchResult(**row) for row in (result.data or [])]

    async def create_or_get_direct(self, user_id: UUID, participant_id: UUID) -> Conversation:
        if user_id == participant_id:
            raise ValueError("cannot_message_self")
        existing = (
            self._client.table("conversations")
            .select("id, kind, created_at, updated_at, conversation_members(user_id)")
            .eq("kind", "direct")
            .execute()
        )
        for row in existing.data or []:
            member_ids = [item["user_id"] for item in row.get("conversation_members") or []]
            if {str(user_id), str(participant_id)} == set(member_ids):
                return _conversation(row)
        created = self._client.table("conversations").insert({"kind": "direct"}).execute()
        row = (created.data or [{}])[0]
        conversation_id = row["id"]
        self._client.table("conversation_members").insert(
            [{"conversation_id": conversation_id, "user_id": str(user_id)},
             {"conversation_id": conversation_id, "user_id": str(participant_id)}]
        ).execute()
        return Conversation(
            id=conversation_id,
            kind="direct",
            member_ids=[user_id, participant_id],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    async def list_conversations(self, user_id: UUID, limit: int) -> list[Conversation]:
        result = (
            self._client.table("conversation_members")
            .select("conversation_id, conversations(id, kind, created_at, updated_at, conversation_members(user_id))")
            .eq("user_id", str(user_id))
            .limit(min(limit, 50))
            .execute()
        )
        return [_conversation(row["conversations"]) for row in (result.data or []) if row.get("conversations")]

    async def list_messages(
        self, user_id: UUID, conversation_id: UUID, limit: int, before: datetime | None = None
    ) -> list[Message]:
        self._assert_member(user_id, conversation_id)
        query = (
            self._client.table("messages")
            .select("id, conversation_id, sender_id, body, created_at")
            .eq("conversation_id", str(conversation_id))
            .is_("deleted_at", "null")
            .order("created_at", desc=True)
            .limit(min(limit, 100))
        )
        if before is not None:
            query = query.lt("created_at", before.isoformat())
        result = query.execute()
        return [Message(**row) for row in (result.data or [])]

    async def send_message(self, user_id: UUID, conversation_id: UUID, body: str) -> Message:
        self._assert_member(user_id, conversation_id)
        result = self._client.table("messages").insert(
            {"conversation_id": str(conversation_id), "sender_id": str(user_id), "body": body.strip()}
        ).execute()
        return Message(**(result.data or [{}])[0])

    def _assert_member(self, user_id: UUID, conversation_id: UUID) -> None:
        result = (
            self._client.table("conversation_members")
            .select("id")
            .eq("conversation_id", str(conversation_id))
            .eq("user_id", str(user_id))
            .maybe_single()
            .execute()
        )
        if result.data is None:
            raise PermissionError("conversation_forbidden")


def _conversation(row: dict[str, Any]) -> Conversation:
    members = row.get("conversation_members") or []
    return Conversation(
        id=row["id"],
        kind=row.get("kind", "direct"),
        member_ids=[item["user_id"] for item in members],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )
