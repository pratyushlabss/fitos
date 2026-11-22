from datetime import date
from typing import Protocol
from uuid import UUID

from domain.models.recovery import (
    CoachContext,
    DailyDataStatus,
    DailyFitnessFeatures,
    DailySnapshot,
    FitnessEvent,
    RecoveryDaily,
)


class RecoveryStore(Protocol):
    async def get_event_by_dedupe(
        self,
        user_id: UUID,
        source: str,
        event_type: str,
        occurred_at,
        payload_hash: str,
    ) -> FitnessEvent | None: ...

    async def append_event(self, event: FitnessEvent) -> FitnessEvent: ...

    async def list_events(self, user_id: UUID, day: date) -> list[FitnessEvent]: ...

    async def get_snapshot(self, user_id: UUID, day: date) -> DailySnapshot | None: ...

    async def save_snapshot(self, snapshot: DailySnapshot) -> DailySnapshot: ...

    async def save_metrics(self, user_id: UUID, day: date, rows: list[dict]) -> None: ...

    async def save_status(self, status: DailyDataStatus) -> None: ...

    async def save_features(self, features: DailyFitnessFeatures) -> None: ...

    async def save_recovery(self, recovery: RecoveryDaily) -> None: ...

    async def get_recovery(self, user_id: UUID, day: date, algorithm: str) -> RecoveryDaily | None: ...

    async def get_features(self, user_id: UUID, day: date) -> DailyFitnessFeatures | None: ...

    async def get_status(self, user_id: UUID, day: date) -> DailyDataStatus | None: ...

    async def list_recovery_range(
        self, user_id: UUID, start: date, end: date, algorithm: str
    ) -> list[RecoveryDaily]: ...

    async def save_coach_context(self, user_id: UUID, day: date, algorithm: str, context: CoachContext) -> None: ...

    async def latest_coach_context(self, user_id: UUID, day: date) -> CoachContext | None: ...
