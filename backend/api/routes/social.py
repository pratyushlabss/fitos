from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from api.deps import get_social, get_user_id
from domain.models.social import (
    AthleteProfile,
    CreateCommentRequest,
    CreateWorkoutPostRequest,
    SocialComment,
    SocialFeed,
    SocialPost,
)
from domain.services.social_service import SocialService

router = APIRouter(prefix="/social", tags=["social"])


@router.get("/feed", response_model=SocialFeed)
async def feed(
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[SocialService, Depends(get_social)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: datetime | None = None,
) -> SocialFeed:
    return await service.feed(user_id, limit, cursor)


@router.get("/discover", response_model=list[AthleteProfile])
async def discover(
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[SocialService, Depends(get_social)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[AthleteProfile]:
    return await service.discover(user_id, limit)


@router.get("/users/search", response_model=list[AthleteProfile])
async def search_users(
    query: Annotated[str, Query(min_length=2, max_length=80)],
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[SocialService, Depends(get_social)],
) -> list[AthleteProfile]:
    return await service.search_users(user_id, query, 20)


@router.get("/users/{user_id}", response_model=AthleteProfile)
async def get_profile(
    user_id: UUID,
    viewer_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[SocialService, Depends(get_social)],
) -> AthleteProfile:
    profile = await service.profile(viewer_id, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="profile_unavailable")
    return profile


@router.post("/users/{user_id}/follow")
async def follow(
    user_id: UUID,
    viewer_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[SocialService, Depends(get_social)],
) -> dict[str, str]:
    try:
        return {"status": await service.follow(viewer_id, user_id)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/users/{user_id}/follow", status_code=204)
async def unfollow(
    user_id: UUID,
    viewer_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[SocialService, Depends(get_social)],
) -> None:
    await service.unfollow(viewer_id, user_id)


@router.post("/posts/workout", response_model=SocialPost, status_code=201)
async def create_workout_post(
    payload: CreateWorkoutPostRequest,
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[SocialService, Depends(get_social)],
) -> SocialPost:
    try:
        return await service.create_workout_post(user_id, payload)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/posts/{post_id}/like", status_code=204)
async def like_post(
    post_id: UUID,
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[SocialService, Depends(get_social)],
) -> None:
    await service.like(user_id, post_id)


@router.delete("/posts/{post_id}/like", status_code=204)
async def unlike_post(
    post_id: UUID,
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[SocialService, Depends(get_social)],
) -> None:
    await service.unlike(user_id, post_id)


@router.get("/posts/{post_id}/comments", response_model=list[SocialComment])
async def comments(
    post_id: UUID,
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[SocialService, Depends(get_social)],
) -> list[SocialComment]:
    return await service.comments(user_id, post_id, 50)


@router.post("/posts/{post_id}/comments", response_model=SocialComment, status_code=201)
async def add_comment(
    post_id: UUID,
    payload: CreateCommentRequest,
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[SocialService, Depends(get_social)],
) -> SocialComment:
    return await service.add_comment(user_id, post_id, payload)
