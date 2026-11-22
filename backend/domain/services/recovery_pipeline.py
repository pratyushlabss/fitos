from datetime import date, datetime, timedelta
from uuid import UUID

from domain.models.common import new_id, utcnow
from domain.models.recovery import (
    ALGORITHM_V1,
    DailySnapshot,
    DayStatus,
    FitnessEvent,
    FitnessEventCreate,
    FitnessEventType,
    RecoveryDayView,
    SubjectiveCheckIn,
)
from domain.recovery.coach import build_coach_context
from domain.recovery.feature_engine import build_features, metric_to_row, payload_hash
from domain.recovery.recovery_engine import score_day
from repositories.recovery_store import RecoveryStore


class DayFinalizedError(RuntimeError):
    pass


class RecoveryPipelineService:
    """Ingest raw events, recompute only the affected open day, persist a reproducible snapshot."""

    def __init__(self, store: RecoveryStore) -> None:
        self._store = store

    async def ingest(self, user_id: UUID, payload: FitnessEventCreate) -> RecoveryDayView:
        occurred = _naive(payload.occurred_at)
        digest = payload_hash(payload.payload)
        existing = await self._store.get_event_by_dedupe(
            user_id,
            payload.source,
            payload.event_type.value,
            occurred,
            digest,
        )
        day = occurred.date()
        snapshot = await self._store.get_snapshot(user_id, day)
        if existing is not None:
            return await self.get_day(user_id, day)

        event = FitnessEvent(
            id=new_id(),
            user_id=user_id,
            event_type=payload.event_type,
            occurred_at=occurred,
            ingested_at=utcnow(),
            source=payload.source,
            source_version=payload.source_version,
            payload=payload.payload,
            payload_hash=digest,
            schema_version=payload.schema_version,
        )
        await self._store.append_event(event)

        if snapshot is not None and snapshot.status is DayStatus.FINALIZED:
            view = await self.get_day(user_id, day)
            view.late_event = True
            return view
        return await self.recompute(user_id, day)

    async def ingest_check_in(self, user_id: UUID, check_in: SubjectiveCheckIn) -> RecoveryDayView:
        occurred = _naive(check_in.occurred_at or utcnow())
        last: RecoveryDayView | None = None
        if check_in.sleep_hours is not None or check_in.sleep_score is not None:
            sleep_payload: dict[str, object] = {}
            if check_in.sleep_hours is not None:
                sleep_payload["hours"] = check_in.sleep_hours
            if check_in.sleep_score is not None:
                sleep_payload["score"] = check_in.sleep_score
            last = await self.ingest(
                user_id,
                FitnessEventCreate(
                    event_type=FitnessEventType.SLEEP_LOGGED,
                    occurred_at=occurred,
                    source=check_in.source,
                    payload=sleep_payload,
                ),
            )
        if check_in.stress_score is not None:
            last = await self.ingest(
                user_id,
                FitnessEventCreate(
                    event_type=FitnessEventType.STRESS_LOGGED,
                    occurred_at=occurred,
                    source=check_in.source,
                    payload={"score": check_in.stress_score},
                ),
            )
        if check_in.soreness_score is not None or check_in.soreness_legs is not None:
            soreness_payload: dict[str, object] = {}
            if check_in.soreness_score is not None:
                soreness_payload["score"] = check_in.soreness_score
            if check_in.soreness_legs is not None:
                soreness_payload["legs"] = check_in.soreness_legs
            last = await self.ingest(
                user_id,
                FitnessEventCreate(
                    event_type=FitnessEventType.SORENESS_LOGGED,
                    occurred_at=occurred,
                    source=check_in.source,
                    payload=soreness_payload,
                ),
            )
        if check_in.hydration_ml is not None:
            last = await self.ingest(
                user_id,
                FitnessEventCreate(
                    event_type=FitnessEventType.HYDRATION_LOGGED,
                    occurred_at=occurred,
                    source=check_in.source,
                    payload={"ml": check_in.hydration_ml},
                ),
            )
        if last is None:
            return await self.get_day(user_id, occurred.date())
        return last

    async def recompute(self, user_id: UUID, day: date, *, force: bool = False) -> RecoveryDayView:
        snapshot = await self._store.get_snapshot(user_id, day)
        if snapshot is not None and snapshot.status is DayStatus.FINALIZED and not force:
            raise DayFinalizedError("day_finalized")

        events = await self._store.list_events(user_id, day)
        features, metrics, status = build_features(user_id, day, events)
        recovery = score_day(features, status, day_status=DayStatus.OPEN)
        trend = await self._trend(user_id, day)
        coach = build_coach_context(recovery, features, trend)

        event_ids = [event.id for event in events if event.occurred_at.date() == day]
        snapshot = DailySnapshot(
            user_id=user_id,
            date=day,
            status=DayStatus.OPEN,
            event_ids=event_ids,
            inputs={
                "features_version": features.calculation_version,
                "algorithm": recovery.algorithm,
                "event_count": len(event_ids),
            },
        )
        await self._store.save_snapshot(snapshot)
        await self._store.save_metrics(user_id, day, [metric_to_row(item) for item in metrics])
        await self._store.save_status(status)
        await self._store.save_features(features)
        await self._store.save_recovery(recovery)
        await self._store.save_coach_context(user_id, day, recovery.algorithm, coach)
        return RecoveryDayView(
            recovery=recovery,
            features=features,
            data_status=status,
            snapshot=snapshot,
            coach=coach,
        )

    async def finalize(self, user_id: UUID, day: date) -> RecoveryDayView:
        view = await self.recompute(user_id, day, force=True)
        snapshot = view.snapshot.model_copy(
            update={"status": DayStatus.FINALIZED, "finalized_at": utcnow()}
        )
        recovery = view.recovery.model_copy(update={"status": DayStatus.FINALIZED})
        await self._store.save_snapshot(snapshot)
        await self._store.save_recovery(recovery)
        view.snapshot = snapshot
        view.recovery = recovery
        return view

    async def get_day(self, user_id: UUID, day: date) -> RecoveryDayView:
        recovery = await self._store.get_recovery(user_id, day, ALGORITHM_V1)
        features = await self._store.get_features(user_id, day)
        status = await self._store.get_status(user_id, day)
        snapshot = await self._store.get_snapshot(user_id, day)
        if recovery is None or features is None or status is None or snapshot is None:
            return await self.recompute(user_id, day, force=True)
        coach = await self._store.latest_coach_context(user_id, day)
        if coach is None:
            trend = await self._trend(user_id, day)
            coach = build_coach_context(recovery, features, trend)
        return RecoveryDayView(
            recovery=recovery,
            features=features,
            data_status=status,
            snapshot=snapshot,
            coach=coach,
        )

    async def coach_context(self, user_id: UUID, day: date) -> RecoveryDayView:
        return await self.get_day(user_id, day)

    async def _trend(self, user_id: UUID, day: date) -> list[int | None]:
        start = day - timedelta(days=6)
        rows = await self._store.list_recovery_range(user_id, start, day, ALGORITHM_V1)
        by_day = {item.date: item.recovery_score for item in rows}
        return [by_day.get(start + timedelta(days=offset)) for offset in range(7)]


def _naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.replace(tzinfo=None)
