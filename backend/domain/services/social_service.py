from datetime import datetime
from uuid import UUID

from domain.models.social import (
    AthleteProfile,
    CreateCommentRequest,
    CreateWorkoutPostRequest,
    SocialComment,
    SocialFeed,
    SocialPost,
)
from repositories.social_repository import SocialRepository


class SocialService:
    def __init__(self, repository: SocialRepository) -> None:
        self._repository = repository

    async def feed(self, user_id: UUID, limit: int, cursor: datetime | None) -> SocialFeed:
        return await self._repository.feed(user_id, min(limit, 50), cursor)

    async def discover(self, user_id: UUID, limit: int) -> list[AthleteProfile]:
        return await self._repository.discover(user_id, min(limit, 50))

    async def search_users(self, user_id: UUID, query: str, limit: int) -> list[AthleteProfile]:
        return await self._repository.search_users(user_id, query, min(limit, 50))

    async def profile(self, viewer_id: UUID, user_id: UUID) -> AthleteProfile | None:
        return await self._repository.profile(viewer_id, user_id)

    async def follow(self, follower_id: UUID, following_id: UUID) -> str:
        if follower_id == following_id:
            raise ValueError("cannot_follow_self")
        return await self._repository.follow(follower_id, following_id)

    async def unfollow(self, follower_id: UUID, following_id: UUID) -> None:
        await self._repository.unfollow(follower_id, following_id)

    async def create_workout_post(self, user_id: UUID, payload: CreateWorkoutPostRequest) -> SocialPost:
        return await self._repository.create_workout_post(
            user_id, payload.workout_id, payload.caption, payload.visibility
        )

    async def like(self, user_id: UUID, post_id: UUID) -> None:
        await self._repository.like(user_id, post_id)

    async def unlike(self, user_id: UUID, post_id: UUID) -> None:
        await self._repository.unlike(user_id, post_id)

    async def comments(self, user_id: UUID, post_id: UUID, limit: int) -> list[SocialComment]:
        return await self._repository.comments(user_id, post_id, min(limit, 100))

    async def add_comment(self, user_id: UUID, post_id: UUID, payload: CreateCommentRequest) -> SocialComment:
        return await self._repository.add_comment(user_id, post_id, payload.body)
