from datetime import datetime
from uuid import UUID

from domain.models.activity import Activity, ActivityCreate
from domain.models.recovery import FitnessEventCreate, FitnessEventType
from domain.services.recovery_pipeline import RecoveryPipelineService
from repositories.activity_repository import ActivityRepository


class ActivityService:
    def __init__(
        self,
        activities: ActivityRepository,
        pipeline: RecoveryPipelineService | None = None,
    ) -> None:
        self._activities = activities
        self._pipeline = pipeline

    async def record(self, user_id: UUID, payload: ActivityCreate) -> Activity:
        activity = await self._activities.create(user_id, payload)
        if self._pipeline is not None:
            await self._pipeline.ingest(
                user_id,
                FitnessEventCreate(
                    event_type=FitnessEventType.ACTIVITY_COMPLETED,
                    occurred_at=activity.ended_at or activity.started_at,
                    source=activity.source.value,
                    payload={
                        "activity_id": str(activity.id),
                        "sport": activity.sport.value,
                        "distance_m": activity.distance_m,
                        "duration_seconds": activity.duration_s,
                        "elevation_gain_m": activity.elevation_gain_m,
                    },
                ),
            )
        return activity

    async def get(self, user_id: UUID, activity_id: UUID) -> Activity | None:
        return await self._activities.get(user_id, activity_id)

    async def list_recent(
        self,
        user_id: UUID,
        *,
        limit: int = 20,
        before: datetime | None = None,
    ) -> list[Activity]:
        return await self._activities.list_for_user(user_id, limit=limit, before=before)

    async def finish(self, user_id: UUID, activity_id: UUID, payload: ActivityCreate) -> Activity:
        return await self._activities.complete(user_id, activity_id, payload)
