from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class SocialPost(BaseModel):
    id: UUID
    user_id: UUID
    username: str | None = None
    display_name: str = ""
    avatar_url: str | None = None
    post_type: str
    body: str | None = None
    workout_id: UUID | None = None
    workout_title: str | None = None
    workout_volume_kg: float | None = None
    workout_duration_seconds: int | None = None
    visibility: str
    like_count: int = 0
    comment_count: int = 0
    liked_by_viewer: bool = False
    created_at: datetime


class SocialFeed(BaseModel):
    posts: list[SocialPost]
    next_cursor: str | None = None
    has_more: bool = False


class AthleteProfile(BaseModel):
    id: UUID
    username: str | None = None
    display_name: str
    bio: str | None = None
    avatar_url: str | None = None
    is_private: bool = False
    followers_count: int = 0
    following_count: int = 0
    workout_count: int = 0
    is_following: bool = False
    follow_status: str | None = None


class SocialComment(BaseModel):
    id: UUID
    post_id: UUID
    user_id: UUID
    username: str | None = None
    display_name: str = ""
    body: str
    created_at: datetime


class CreateWorkoutPostRequest(BaseModel):
    workout_id: UUID
    caption: str | None = Field(default=None, max_length=1000)
    visibility: str = Field(default="friends", pattern="^(public|friends|private)$")


class CreateCommentRequest(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
