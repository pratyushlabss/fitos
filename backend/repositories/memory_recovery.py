from datetime import date, timedelta
from uuid import UUID

from domain.models.recovery import (
    ALGORITHM_V1,
    CoachContext,
    DailyDataStatus,
    DailyFitnessFeatures,
    DailySnapshot,
    DayStatus,
    DomainCoverage,
    DomainStatus,
    FitnessEvent,
    RecoveryDaily,
)


def _empty_coverage() -> DomainCoverage:
    return DomainCoverage(status=DomainStatus.MISSING, events=0)


class InMemoryRecoveryStore:
    def __init__(self) -> None:
        self.events: list[FitnessEvent] = []
        self.snapshots: dict[tuple[UUID, date], DailySnapshot] = {}
        self.metrics: dict[tuple[UUID, date], list[dict]] = {}
        self.status: dict[tuple[UUID, date], DailyDataStatus] = {}
        self.features: dict[tuple[UUID, date], DailyFitnessFeatures] = {}
        self.recovery: dict[tuple[UUID, date, str], RecoveryDaily] = {}
        self.coach: dict[tuple[UUID, date], CoachContext] = {}

    async def get_event_by_dedupe(
        self,
        user_id: UUID,
        source: str,
        event_type: str,
        occurred_at,
        payload_hash: str,
    ) -> FitnessEvent | None:
        for event in self.events:
            if (
                event.user_id == user_id
                and event.source == source
                and event.event_type.value == event_type
                and event.occurred_at == occurred_at
                and event.payload_hash == payload_hash
            ):
                return event
        return None

    async def append_event(self, event: FitnessEvent) -> FitnessEvent:
        self.events.append(event)
        return event

    async def list_events(self, user_id: UUID, day: date) -> list[FitnessEvent]:
        window_start = day - timedelta(days=1)
        window_end = day + timedelta(days=1)
        return [
            event
            for event in self.events
            if event.user_id == user_id and window_start <= event.occurred_at.date() <= window_end
        ]

    async def get_snapshot(self, user_id: UUID, day: date) -> DailySnapshot | None:
        return self.snapshots.get((user_id, day))

    async def save_snapshot(self, snapshot: DailySnapshot) -> DailySnapshot:
        self.snapshots[(snapshot.user_id, snapshot.date)] = snapshot
        return snapshot

    async def save_metrics(self, user_id: UUID, day: date, rows: list[dict]) -> None:
        self.metrics[(user_id, day)] = rows

    async def save_status(self, status: DailyDataStatus) -> None:
        self.status[(status.user_id, status.date)] = status

    async def save_features(self, features: DailyFitnessFeatures) -> None:
        self.features[(features.user_id, features.date)] = features

    async def save_recovery(self, recovery: RecoveryDaily) -> None:
        self.recovery[(recovery.user_id, recovery.date, recovery.algorithm)] = recovery

    async def get_recovery(self, user_id: UUID, day: date, algorithm: str) -> RecoveryDaily | None:
        return self.recovery.get((user_id, day, algorithm))

    async def get_features(self, user_id: UUID, day: date) -> DailyFitnessFeatures | None:
        return self.features.get((user_id, day))

    async def get_status(self, user_id: UUID, day: date) -> DailyDataStatus | None:
        return self.status.get((user_id, day))

    async def list_recovery_range(
        self, user_id: UUID, start: date, end: date, algorithm: str
    ) -> list[RecoveryDaily]:
        rows = [
            item
            for (uid, day, algo), item in self.recovery.items()
            if uid == user_id and algo == algorithm and start <= day <= end
        ]
        return sorted(rows, key=lambda item: item.date)

    async def save_coach_context(
        self, user_id: UUID, day: date, algorithm: str, context: CoachContext
    ) -> None:
        self.coach[(user_id, day)] = context

    async def latest_coach_context(self, user_id: UUID, day: date) -> CoachContext | None:
        return self.coach.get((user_id, day))
