from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from supabase import Client

from domain.models.social import AthleteProfile, SocialComment, SocialFeed, SocialPost


class SupabaseSocialRepository:
    def __init__(self, client: Client) -> None:
        self._client = client

    async def feed(self, user_id: UUID, limit: int, cursor: datetime | None) -> SocialFeed:
        followed = self._client.table("follows").select("following_id").eq("follower_id", str(user_id)).eq("status", "accepted").execute()
        authors = [str(user_id), *[row["following_id"] for row in (followed.data or [])]]
        query = (
            self._client.table("posts")
            .select("*, profiles(username, display_name, avatar_url), workouts(title, total_volume_kg, started_at, completed_at)")
            .in_("user_id", authors)
            .is_("deleted_at", "null")
            .order("created_at", desc=True)
            .limit(limit + 1)
        )
        if cursor is not None:
            query = query.lt("created_at", cursor.isoformat())
        rows = query.execute().data or []
        has_more = len(rows) > limit
        rows = rows[:limit]
        posts = [self._post(row, user_id) for row in rows]
        next_cursor = posts[-1].created_at.isoformat() if has_more and posts else None
        return SocialFeed(posts=posts, next_cursor=next_cursor, has_more=has_more)

    async def discover(self, user_id: UUID, limit: int) -> list[AthleteProfile]:
        followed = self._client.table("follows").select("following_id").eq("follower_id", str(user_id)).execute()
        excluded = [str(user_id), *[row["following_id"] for row in (followed.data or [])]]
        rows = self._client.table("profiles").select("*").not_.in_("id", excluded).eq("is_private", False).limit(limit).execute().data or []
        return [self._profile(row, user_id) for row in rows]

    async def search_users(self, user_id: UUID, query: str, limit: int) -> list[AthleteProfile]:
        term = query.strip()
        if not term:
            return []
        rows = self._client.table("profiles").select("*").neq("id", str(user_id)).or_(f"username.ilike.%{term}%,display_name.ilike.%{term}%").limit(limit).execute().data or []
        return [self._profile(row, user_id) for row in rows]

    async def profile(self, viewer_id: UUID, user_id: UUID) -> AthleteProfile | None:
        row = self._client.table("profiles").select("*").eq("id", str(user_id)).maybe_single().execute().data
        if row is None:
            return None
        blocked = self._client.table("blocks").select("id").or_(f"blocker_id.eq.{viewer_id},blocked_id.eq.{viewer_id}").or_(f"blocker_id.eq.{user_id},blocked_id.eq.{user_id}").execute().data or []
        if blocked:
            return None
        return self._profile(row, viewer_id)

    async def follow(self, follower_id: UUID, following_id: UUID) -> str:
        target = self._client.table("profiles").select("is_private").eq("id", str(following_id)).maybe_single().execute().data
        if target is None:
            raise ValueError("user_not_found")
        status = "pending" if target.get("is_private") else "accepted"
        self._client.table("follows").upsert({"follower_id": str(follower_id), "following_id": str(following_id), "status": status}, on_conflict="follower_id,following_id").execute()
        return status

    async def unfollow(self, follower_id: UUID, following_id: UUID) -> None:
        self._client.table("follows").delete().eq("follower_id", str(follower_id)).eq("following_id", str(following_id)).execute()

    async def create_workout_post(self, user_id: UUID, workout_id: UUID, caption: str | None, visibility: str) -> SocialPost:
        workout = self._client.table("workouts").select("id, title, total_volume_kg, started_at, completed_at, user_id").eq("id", str(workout_id)).eq("user_id", str(user_id)).maybe_single().execute().data
        if workout is None:
            raise PermissionError("workout_forbidden")
        row = self._client.table("posts").insert({"user_id": str(user_id), "post_type": "workout", "body": caption, "workout_id": str(workout_id), "visibility": visibility}).execute().data[0]
        row["workouts"] = workout
        profile = self._client.table("profiles").select("username, display_name, avatar_url").eq("id", str(user_id)).maybe_single().execute().data or {}
        row["profiles"] = profile
        return self._post(row, user_id)

    async def like(self, user_id: UUID, post_id: UUID) -> None:
        self._client.table("post_reactions").upsert({"post_id": str(post_id), "user_id": str(user_id), "kind": "like"}, on_conflict="post_id,user_id,kind").execute()

    async def unlike(self, user_id: UUID, post_id: UUID) -> None:
        self._client.table("post_reactions").delete().eq("post_id", str(post_id)).eq("user_id", str(user_id)).eq("kind", "like").execute()

    async def comments(self, user_id: UUID, post_id: UUID, limit: int) -> list[SocialComment]:
        rows = self._client.table("comments").select("*, profiles(username, display_name)").eq("post_id", str(post_id)).order("created_at", desc=True).limit(limit).execute().data or []
        return [SocialComment(id=row["id"], post_id=row["post_id"], user_id=row["user_id"], username=(row.get("profiles") or {}).get("username"), display_name=(row.get("profiles") or {}).get("display_name", ""), body=row["body"], created_at=row["created_at"]) for row in rows]

    async def add_comment(self, user_id: UUID, post_id: UUID, body: str) -> SocialComment:
        row = self._client.table("comments").insert({"post_id": str(post_id), "user_id": str(user_id), "body": body.strip()}).execute().data[0]
        return SocialComment(id=row["id"], post_id=row["post_id"], user_id=row["user_id"], body=row["body"], created_at=row["created_at"])

    def _profile(self, row: dict[str, Any], viewer_id: UUID) -> AthleteProfile:
        user_id = row["id"]
        followers = self._client.table("follows").select("id", count="exact").eq("following_id", user_id).eq("status", "accepted").execute()
        following = self._client.table("follows").select("id", count="exact").eq("follower_id", user_id).eq("status", "accepted").execute()
        relation = self._client.table("follows").select("status").eq("follower_id", str(viewer_id)).eq("following_id", user_id).maybe_single().execute().data
        workouts = self._client.table("workouts").select("id", count="exact").eq("user_id", user_id).execute()
        return AthleteProfile(id=user_id, username=row.get("username"), display_name=row.get("display_name", ""), bio=row.get("bio"), avatar_url=row.get("avatar_url"), is_private=row.get("is_private", False), followers_count=followers.count or 0, following_count=following.count or 0, workout_count=workouts.count or 0, is_following=relation is not None and relation.get("status") == "accepted", follow_status=relation.get("status") if relation else None)

    def _post(self, row: dict[str, Any], viewer_id: UUID) -> SocialPost:
        profile = row.get("profiles") or {}
        workout = row.get("workouts") or {}
        liked = self._client.table("post_reactions").select("id").eq("post_id", row["id"]).eq("user_id", str(viewer_id)).eq("kind", "like").maybe_single().execute().data
        likes = self._client.table("post_reactions").select("id", count="exact").eq("post_id", row["id"]).eq("kind", "like").execute()
        comments = self._client.table("comments").select("id", count="exact").eq("post_id", row["id"]).execute()
        duration = None
        if workout.get("started_at") and workout.get("completed_at"):
            completed_at = _parse_timestamp(workout["completed_at"])
            started_at = _parse_timestamp(workout["started_at"])
            duration = int((completed_at - started_at).total_seconds())
        return SocialPost(id=row["id"], user_id=row["user_id"], username=profile.get("username"), display_name=profile.get("display_name", ""), avatar_url=profile.get("avatar_url"), post_type=row["post_type"], body=row.get("body"), workout_id=row.get("workout_id"), workout_title=workout.get("title"), workout_volume_kg=workout.get("total_volume_kg"), workout_duration_seconds=duration, visibility=row["visibility"], like_count=likes.count or 0, comment_count=comments.count or 0, liked_by_viewer=liked is not None, created_at=row["created_at"])


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)
