from datetime import datetime
from uuid import UUID

from domain.models.messaging import Conversation, Message, UserSearchResult
from repositories.messaging_repository import MessagingRepository


class MessagingService:
    def __init__(self, repository: MessagingRepository) -> None:
        self._repository = repository

    async def search_users(self, user_id: UUID, query: str, limit: int = 20) -> list[UserSearchResult]:
        return await self._repository.search_users(user_id, query, limit)

    async def create_conversation(self, user_id: UUID, participant_id: UUID) -> Conversation:
        return await self._repository.create_or_get_direct(user_id, participant_id)

    async def list_conversations(self, user_id: UUID, limit: int = 20) -> list[Conversation]:
        return await self._repository.list_conversations(user_id, limit)

    async def list_messages(
        self, user_id: UUID, conversation_id: UUID, limit: int = 50, before: datetime | None = None
    ) -> list[Message]:
        return await self._repository.list_messages(user_id, conversation_id, limit, before)

    async def send_message(self, user_id: UUID, conversation_id: UUID, body: str) -> Message:
        return await self._repository.send_message(user_id, conversation_id, body)
