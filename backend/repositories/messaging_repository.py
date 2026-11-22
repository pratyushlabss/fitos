from datetime import datetime
from typing import Protocol
from uuid import UUID

from domain.models.messaging import Conversation, Message, UserSearchResult


class MessagingRepository(Protocol):
    async def search_users(self, user_id: UUID, query: str, limit: int) -> list[UserSearchResult]: ...

    async def create_or_get_direct(self, user_id: UUID, participant_id: UUID) -> Conversation: ...

    async def list_conversations(self, user_id: UUID, limit: int) -> list[Conversation]: ...

    async def list_messages(
        self, user_id: UUID, conversation_id: UUID, limit: int, before: datetime | None = None
    ) -> list[Message]: ...

    async def send_message(self, user_id: UUID, conversation_id: UUID, body: str) -> Message: ...
