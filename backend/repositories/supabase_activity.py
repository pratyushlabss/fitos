from datetime import datetime
from typing import Any
from uuid import UUID

from supabase import Client

from domain.models.activity import Activity, ActivityCreate, ActivitySource, ActivitySport, GeoPoint
from domain.models.common import Visibility


class SupabaseActivityRepository:
    def __init__(self, client: Client) -> None:
        self._client = client

    async def get(self, user_id: UUID, activity_id: UUID) -> Activity | None:
        result = (
            self._client.table("activities")
            .select("*")
            .eq("id", str(activity_id))
            .eq("user_id", str(user_id))
            .maybe_single()
            .execute()
        )
        if result.data is None:
            return None
        return self._to_activity(result.data)

    async def list_for_user(
        self,
        user_id: UUID,
        *,
        limit: int = 20,
        before: datetime | None = None,
    ) -> list[Activity]:
        query = (
            self._client.table("activities")
            .select("*")
            .eq("user_id", str(user_id))
            .order("started_at", desc=True)
            .limit(limit)
        )
        if before is not None:
            query = query.lt("started_at", before.isoformat())
        result = query.execute()
        rows: list[dict[str, Any]] = result.data or []
        return [self._to_activity(row) for row in rows]

    async def create(self, user_id: UUID, payload: ActivityCreate) -> Activity:
        activity = Activity(user_id=user_id, **payload.model_dump())
        if activity.distance_m > 0 and activity.duration_s > 0:
            activity.avg_pace_s_per_km = activity.duration_s / (activity.distance_m / 1000.0)
        self._client.table("activities").insert(self._row(activity)).execute()
        return activity

    async def complete(
        self, user_id: UUID, activity_id: UUID, payload: ActivityCreate
    ) -> Activity:
        existing = await self.get(user_id, activity_id)
        if existing is None:
            return await self.create(user_id, payload)
        updated = Activity(id=existing.id, user_id=user_id, **payload.model_dump())
        if updated.distance_m > 0 and updated.duration_s > 0:
            updated.avg_pace_s_per_km = updated.duration_s / (updated.distance_m / 1000.0)
        self._client.table("activities").update(self._row(updated)).eq("id", str(activity_id)).eq(
            "user_id", str(user_id)
        ).execute()
        return updated

    def _row(self, activity: Activity) -> dict[str, Any]:
        return {
            "id": str(activity.id),
            "user_id": str(activity.user_id),
            "sport": activity.sport.value,
            "source": activity.source.value,
            "started_at": activity.started_at.isoformat(),
            "ended_at": activity.ended_at.isoformat() if activity.ended_at else None,
            "duration_s": activity.duration_s,
            "distance_m": activity.distance_m,
            "elevation_gain_m": activity.elevation_gain_m,
            "avg_pace_s_per_km": activity.avg_pace_s_per_km,
            "polyline": [point.model_dump(mode="json") for point in activity.polyline],
            "visibility": activity.visibility.value,
            "title": activity.title,
        }

    def _to_activity(self, row: dict[str, Any]) -> Activity:
        raw_points: list[dict[str, Any]] = row.get("polyline") or []
        return Activity(
            id=UUID(row["id"]),
            user_id=UUID(row["user_id"]),
            sport=ActivitySport(row["sport"]),
            source=ActivitySource(row["source"]),
            started_at=datetime.fromisoformat(row["started_at"].replace("Z", "+00:00")),
            ended_at=datetime.fromisoformat(row["ended_at"].replace("Z", "+00:00"))
            if row.get("ended_at")
            else None,
            duration_s=row["duration_s"],
            distance_m=float(row["distance_m"]),
            elevation_gain_m=float(row.get("elevation_gain_m") or 0),
            avg_pace_s_per_km=row.get("avg_pace_s_per_km"),
            polyline=[GeoPoint.model_validate(point) for point in raw_points],
            visibility=Visibility(row.get("visibility") or "private"),
            title=row.get("title"),
        )
