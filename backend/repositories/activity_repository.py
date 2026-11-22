from datetime import datetime
from typing import Protocol
from uuid import UUID

from domain.models.activity import Activity, ActivityCreate


class ActivityRepository(Protocol):
    async def get(self, user_id: UUID, activity_id: UUID) -> Activity | None: ...

    async def list_for_user(
        self,
        user_id: UUID,
        *,
        limit: int = 20,
        before: datetime | None = None,
    ) -> list[Activity]: ...

    async def create(self, user_id: UUID, payload: ActivityCreate) -> Activity: ...

    async def complete(self, user_id: UUID, activity_id: UUID, payload: ActivityCreate) -> Activity: ...
