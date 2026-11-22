from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class UserSearchResult(BaseModel):
    id: UUID
    username: str | None
    display_name: str
    avatar_url: str | None = None
    is_private: bool = False


class Conversation(BaseModel):
    id: UUID
    kind: str = "direct"
    member_ids: list[UUID]
    created_at: datetime
    updated_at: datetime


class Message(BaseModel):
    id: UUID
    conversation_id: UUID
    sender_id: UUID
    body: str = Field(min_length=1, max_length=4000)
    created_at: datetime


class CreateConversationRequest(BaseModel):
    participant_id: UUID


class SendMessageRequest(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
