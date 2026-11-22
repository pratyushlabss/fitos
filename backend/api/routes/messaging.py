from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from api.deps import get_messaging, get_user_id
from domain.models.messaging import (
    Conversation,
    CreateConversationRequest,
    Message,
    SendMessageRequest,
    UserSearchResult,
)
from domain.services.messaging_service import MessagingService

router = APIRouter(prefix="/messaging", tags=["messaging"])


@router.get("/users/search", response_model=list[UserSearchResult])
async def search_users(
    query: Annotated[str, Query(min_length=2, max_length=80)],
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[MessagingService, Depends(get_messaging)],
) -> list[UserSearchResult]:
    return await service.search_users(user_id, query)


@router.get("/conversations", response_model=list[Conversation])
async def list_conversations(
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[MessagingService, Depends(get_messaging)],
) -> list[Conversation]:
    return await service.list_conversations(user_id)


@router.post("/conversations", response_model=Conversation, status_code=201)
async def create_conversation(
    payload: CreateConversationRequest,
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[MessagingService, Depends(get_messaging)],
) -> Conversation:
    try:
        return await service.create_conversation(user_id, payload.participant_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/conversations/{conversation_id}/messages", response_model=list[Message])
async def list_messages(
    conversation_id: UUID,
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[MessagingService, Depends(get_messaging)],
    before: datetime | None = None,
) -> list[Message]:
    try:
        return await service.list_messages(user_id, conversation_id, before=before)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/conversations/{conversation_id}/messages", response_model=Message, status_code=201)
async def send_message(
    conversation_id: UUID,
    payload: SendMessageRequest,
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[MessagingService, Depends(get_messaging)],
) -> Message:
    try:
        return await service.send_message(user_id, conversation_id, payload.body)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
