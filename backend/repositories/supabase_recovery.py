from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from supabase import Client

from domain.models.recovery import (
    ALGORITHM_V1,
    Availability,
    CoachAdvice,
    CoachContext,
    DailyDataStatus,
    DailyFitnessFeatures,
    DailySnapshot,
    DayStatus,
    DomainCoverage,
    DomainStatus,
    FitnessEvent,
    FitnessEventType,
    OptionalMetric,
    RecoveryComponent,
    RecoveryDaily,
)


def _metric(raw: dict[str, Any] | None, fallback_unit: str) -> OptionalMetric:
    if not raw:
        return OptionalMetric.missing(fallback_unit)
    return OptionalMetric.model_validate(raw)


class SupabaseRecoveryStore:
    def __init__(self, client: Client) -> None:
        self._client = client

    async def get_event_by_dedupe(
        self,
        user_id: UUID,
        source: str,
        event_type: str,
        occurred_at: datetime,
        payload_hash: str,
    ) -> FitnessEvent | None:
        result = (
            self._client.table("fitness_events")
            .select("*")
            .eq("user_id", str(user_id))
            .eq("source", source)
            .eq("event_type", event_type)
            .eq("occurred_at", occurred_at.isoformat())
            .eq("payload_hash", payload_hash)
            .maybe_single()
            .execute()
        )
        if result.data is None:
            return None
        return _event(result.data)

    async def append_event(self, event: FitnessEvent) -> FitnessEvent:
        self._client.table("fitness_events").insert(_event_row(event)).execute()
        return event

    async def list_events(self, user_id: UUID, day: date) -> list[FitnessEvent]:
        start = datetime.combine(day - timedelta(days=1), datetime.min.time())
        end = datetime.combine(day + timedelta(days=1), datetime.max.time())
        result = (
            self._client.table("fitness_events")
            .select("*")
            .eq("user_id", str(user_id))
            .gte("occurred_at", start.isoformat())
            .lte("occurred_at", end.isoformat())
            .order("occurred_at")
            .execute()
        )
        return [_event(row) for row in result.data or []]

    async def get_snapshot(self, user_id: UUID, day: date) -> DailySnapshot | None:
        result = (
            self._client.table("daily_snapshots")
            .select("*")
            .eq("user_id", str(user_id))
            .eq("day", day.isoformat())
            .maybe_single()
            .execute()
        )
        if result.data is None:
            return None
        row = result.data
        return DailySnapshot(
            user_id=user_id,
            date=day,
            status=DayStatus(row["status"]),
            event_ids=[UUID(item) for item in row.get("event_ids") or []],
            inputs=row.get("inputs") or {},
            finalized_at=_parse_dt(row.get("finalized_at")),
        )

    async def save_snapshot(self, snapshot: DailySnapshot) -> DailySnapshot:
        self._client.table("daily_snapshots").upsert(
            {
                "user_id": str(snapshot.user_id),
                "day": snapshot.date.isoformat(),
                "status": snapshot.status.value,
                "event_ids": [str(item) for item in snapshot.event_ids],
                "inputs": snapshot.inputs,
                "finalized_at": snapshot.finalized_at.isoformat() if snapshot.finalized_at else None,
            }
        ).execute()
        return snapshot

    async def save_metrics(self, user_id: UUID, day: date, rows: list[dict]) -> None:
        if not rows:
            return
        self._client.table("canonical_daily_metrics").upsert(rows).execute()

    async def save_status(self, status: DailyDataStatus) -> None:
        self._client.table("daily_data_status").upsert(
            {
                "user_id": str(status.user_id),
                "day": status.date.isoformat(),
                "nutrition_status": status.nutrition.status.value,
                "nutrition_events": status.nutrition.events,
                "workout_status": status.workout.status.value,
                "workout_events": status.workout.events,
                "activity_status": status.activity.status.value,
                "activity_source": status.activity.source,
                "sleep_status": status.sleep.status.value,
                "stress_status": status.stress.status.value,
                "soreness_status": status.soreness.status.value,
                "cardio_status": status.cardio.status.value,
                "data_completeness": status.data_completeness,
            }
        ).execute()

    async def save_features(self, features: DailyFitnessFeatures) -> None:
        self._client.table("daily_fitness_features").upsert(
            {
                "user_id": str(features.user_id),
                "day": features.date.isoformat(),
                "features": features.model_dump(mode="json"),
                "calculation_version": features.calculation_version,
            }
        ).execute()

    async def save_recovery(self, recovery: RecoveryDaily) -> None:
        self._client.table("recovery_daily").upsert(
            {
                "user_id": str(recovery.user_id),
                "day": recovery.date.isoformat(),
                "recovery_score": recovery.recovery_score,
                "readiness_score": recovery.readiness_score,
                "inputs": recovery.inputs,
                "components": [item.model_dump(mode="json") for item in recovery.components],
                "missing_inputs": recovery.missing_inputs,
                "data_completeness": recovery.data_completeness,
                "confidence": recovery.confidence,
                "status": recovery.status.value,
                "algorithm": recovery.algorithm,
                "calculated_at": recovery.calculated_at.isoformat(),
            }
        ).execute()

    async def get_recovery(self, user_id: UUID, day: date, algorithm: str) -> RecoveryDaily | None:
        result = (
            self._client.table("recovery_daily")
            .select("*")
            .eq("user_id", str(user_id))
            .eq("day", day.isoformat())
            .eq("algorithm", algorithm)
            .maybe_single()
            .execute()
        )
        if result.data is None:
            return None
        return _recovery(result.data)

    async def get_features(self, user_id: UUID, day: date) -> DailyFitnessFeatures | None:
        result = (
            self._client.table("daily_fitness_features")
            .select("*")
            .eq("user_id", str(user_id))
            .eq("day", day.isoformat())
            .maybe_single()
            .execute()
        )
        if result.data is None:
            return None
        payload = result.data.get("features") or {}
        payload.setdefault("user_id", str(user_id))
        payload.setdefault("date", day.isoformat())
        return DailyFitnessFeatures.model_validate(payload)

    async def get_status(self, user_id: UUID, day: date) -> DailyDataStatus | None:
        result = (
            self._client.table("daily_data_status")
            .select("*")
            .eq("user_id", str(user_id))
            .eq("day", day.isoformat())
            .maybe_single()
            .execute()
        )
        if result.data is None:
            return None
        row = result.data
        return DailyDataStatus(
            user_id=user_id,
            date=day,
            nutrition=DomainCoverage(status=DomainStatus(row["nutrition_status"]), events=row["nutrition_events"]),
            workout=DomainCoverage(status=DomainStatus(row["workout_status"]), events=row["workout_events"]),
            activity=DomainCoverage(
                status=DomainStatus(row["activity_status"]),
                events=0,
                source=row.get("activity_source"),
            ),
            sleep=DomainCoverage(status=DomainStatus(row["sleep_status"])),
            stress=DomainCoverage(status=DomainStatus(row["stress_status"])),
            soreness=DomainCoverage(status=DomainStatus(row["soreness_status"])),
            cardio=DomainCoverage(status=DomainStatus(row["cardio_status"])),
            data_completeness=row["data_completeness"],
        )

    async def list_recovery_range(
        self, user_id: UUID, start: date, end: date, algorithm: str
    ) -> list[RecoveryDaily]:
        result = (
            self._client.table("recovery_daily")
            .select("*")
            .eq("user_id", str(user_id))
            .eq("algorithm", algorithm)
            .gte("day", start.isoformat())
            .lte("day", end.isoformat())
            .order("day")
            .execute()
        )
        return [_recovery(row) for row in result.data or []]

    async def save_coach_context(
        self, user_id: UUID, day: date, algorithm: str, context: CoachContext
    ) -> None:
        self._client.table("coach_context_snapshots").insert(
            {
                "user_id": str(user_id),
                "day": day.isoformat(),
                "recovery_algorithm": algorithm,
                "context": context.model_dump(mode="json"),
            }
        ).execute()

    async def latest_coach_context(self, user_id: UUID, day: date) -> CoachContext | None:
        result = (
            self._client.table("coach_context_snapshots")
            .select("*")
            .eq("user_id", str(user_id))
            .eq("day", day.isoformat())
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return None
        return CoachContext.model_validate(rows[0]["context"])


def _event_row(event: FitnessEvent) -> dict[str, Any]:
    return {
        "id": str(event.id),
        "user_id": str(event.user_id),
        "event_type": event.event_type.value,
        "occurred_at": event.occurred_at.isoformat(),
        "ingested_at": event.ingested_at.isoformat(),
        "source": event.source,
        "source_version": event.source_version,
        "payload": event.payload,
        "payload_hash": event.payload_hash,
        "schema_version": event.schema_version,
    }


def _event(row: dict[str, Any]) -> FitnessEvent:
    return FitnessEvent(
        id=UUID(row["id"]),
        user_id=UUID(row["user_id"]),
        event_type=FitnessEventType(row["event_type"]),
        occurred_at=_parse_dt(row["occurred_at"]) or datetime.utcnow(),
        ingested_at=_parse_dt(row["ingested_at"]) or datetime.utcnow(),
        source=row["source"],
        source_version=row.get("source_version") or "1.0",
        payload=row.get("payload") or {},
        payload_hash=row.get("payload_hash") or "",
        schema_version=row.get("schema_version") or 1,
    )


def _recovery(row: dict[str, Any]) -> RecoveryDaily:
    return RecoveryDaily(
        user_id=UUID(row["user_id"]),
        date=date.fromisoformat(str(row["day"])),
        recovery_score=row.get("recovery_score"),
        readiness_score=row.get("readiness_score"),
        inputs=row.get("inputs") or {},
        components=[RecoveryComponent.model_validate(item) for item in row.get("components") or []],
        missing_inputs=list(row.get("missing_inputs") or []),
        data_completeness=row.get("data_completeness") or 0,
        confidence=float(row.get("confidence") or 0),
        status=DayStatus(row.get("status") or "open"),
        algorithm=row.get("algorithm") or ALGORITHM_V1,
        calculated_at=_parse_dt(row.get("calculated_at")) or datetime.utcnow(),
    )


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
