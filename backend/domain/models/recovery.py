from datetime import date, datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from domain.models.common import new_id, utcnow

ALGORITHM_V1 = "recovery_v1.0"
FEATURE_VERSION = "features_v1.0"


class DayStatus(StrEnum):
    OPEN = "open"
    FINALIZED = "finalized"


class Availability(StrEnum):
    PRESENT = "present"
    MISSING = "missing"


class DomainStatus(StrEnum):
    COMPLETE = "complete"
    INCOMPLETE = "incomplete"
    MISSING = "missing"
    MANUAL = "manual"


class FitnessEventType(StrEnum):
    MEAL_LOGGED = "meal.logged"
    MEAL_UPDATED = "meal.updated"
    MEAL_DELETED = "meal.deleted"
    WORKOUT_STARTED = "workout.started"
    WORKOUT_SET_COMPLETED = "workout.set.completed"
    WORKOUT_COMPLETED = "workout.completed"
    ACTIVITY_STARTED = "activity.started"
    ACTIVITY_UPDATED = "activity.updated"
    ACTIVITY_COMPLETED = "activity.completed"
    SLEEP_LOGGED = "sleep.logged"
    STRESS_LOGGED = "stress.logged"
    SORENESS_LOGGED = "soreness.logged"
    WEIGHT_LOGGED = "weight.logged"
    HEART_RATE_UPDATED = "heart_rate.updated"
    HRV_UPDATED = "hrv.updated"
    STEPS_UPDATED = "steps.updated"
    HYDRATION_LOGGED = "hydration.logged"


class OptionalMetric(BaseModel):
    """A daily metric. Missing stays None — never coerced to 0."""

    value: float | None = None
    unit: str
    source: str | None = None
    source_priority: int | None = None
    timestamp: datetime | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    availability: Availability = Availability.MISSING
    conflict_rejected: list[dict[str, object]] = Field(default_factory=list)

    @classmethod
    def missing(cls, unit: str) -> "OptionalMetric":
        return cls(unit=unit, availability=Availability.MISSING)

    @classmethod
    def present(
        cls,
        value: float,
        unit: str,
        *,
        source: str,
        source_priority: int,
        timestamp: datetime,
        confidence: float,
        conflict_rejected: list[dict[str, object]] | None = None,
    ) -> "OptionalMetric":
        return cls(
            value=value,
            unit=unit,
            source=source,
            source_priority=source_priority,
            timestamp=timestamp,
            confidence=confidence,
            availability=Availability.PRESENT,
            conflict_rejected=conflict_rejected or [],
        )


class FitnessEvent(BaseModel):
    id: UUID = Field(default_factory=new_id)
    user_id: UUID
    event_type: FitnessEventType
    occurred_at: datetime
    ingested_at: datetime = Field(default_factory=utcnow)
    source: str
    source_version: str = "1.0"
    payload: dict[str, object] = Field(default_factory=dict)
    payload_hash: str = ""
    schema_version: int = 1


class FitnessEventCreate(BaseModel):
    event_type: FitnessEventType
    occurred_at: datetime
    source: str
    source_version: str = "1.0"
    payload: dict[str, object] = Field(default_factory=dict)
    schema_version: int = 1


class DomainCoverage(BaseModel):
    status: DomainStatus
    events: int = 0
    source: str | None = None


class DailyDataStatus(BaseModel):
    user_id: UUID
    date: date
    nutrition: DomainCoverage
    workout: DomainCoverage
    activity: DomainCoverage
    sleep: DomainCoverage
    stress: DomainCoverage
    soreness: DomainCoverage
    cardio: DomainCoverage
    data_completeness: int = Field(ge=0, le=100)


class CanonicalDailyMetric(BaseModel):
    user_id: UUID
    date: date
    metric: str
    observation: OptionalMetric


class DailyFitnessFeatures(BaseModel):
    user_id: UUID
    date: date
    calories: OptionalMetric
    protein_g: OptionalMetric
    carbs_g: OptionalMetric
    fat_g: OptionalMetric
    water_ml: OptionalMetric
    workout_count: OptionalMetric
    workout_duration_s: OptionalMetric
    total_volume_kg: OptionalMetric
    training_load: OptionalMetric
    average_rpe: OptionalMetric
    steps: OptionalMetric
    distance_m: OptionalMetric
    active_calories: OptionalMetric
    activity_duration_s: OptionalMetric
    activity_load: OptionalMetric
    sleep_hours: OptionalMetric
    sleep_score: OptionalMetric
    stress_score: OptionalMetric
    soreness_score: OptionalMetric
    resting_hr: OptionalMetric
    hrv: OptionalMetric
    weight_kg: OptionalMetric
    calculation_version: str = FEATURE_VERSION


class RecoveryComponent(BaseModel):
    key: str
    score: float | None = Field(default=None, ge=0, le=100)
    availability: Availability
    weight: float = Field(ge=0)


class RecoveryDaily(BaseModel):
    user_id: UUID
    date: date
    recovery_score: int | None = Field(default=None, ge=0, le=100)
    readiness_score: int | None = Field(default=None, ge=0, le=100)
    inputs: dict[str, float | None]
    components: list[RecoveryComponent]
    missing_inputs: list[str]
    data_completeness: int = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)
    status: DayStatus = DayStatus.OPEN
    algorithm: str = ALGORITHM_V1
    calculated_at: datetime = Field(default_factory=utcnow)


class DailySnapshot(BaseModel):
    user_id: UUID
    date: date
    status: DayStatus
    event_ids: list[UUID]
    inputs: dict[str, object]
    finalized_at: datetime | None = None


class CoachAdvice(BaseModel):
    headline: str
    body: str
    recommendation: str
    focus: list[str]


class CoachContext(BaseModel):
    date: date
    recovery_score: int | None
    readiness: str
    confidence: float
    data_completeness: int
    algorithm: str
    sleep: dict[str, object]
    stress: dict[str, object]
    training: dict[str, object]
    activity: dict[str, object]
    nutrition: dict[str, object]
    soreness: dict[str, object]
    trend_7d: list[int | None]
    missing_inputs: list[str]
    advice: CoachAdvice


class RecoveryDayView(BaseModel):
    recovery: RecoveryDaily
    features: DailyFitnessFeatures
    data_status: DailyDataStatus
    snapshot: DailySnapshot
    coach: CoachContext
    late_event: bool = False


class SubjectiveCheckIn(BaseModel):
    occurred_at: datetime | None = None
    source: str = "fitos_manual"
    sleep_hours: float | None = Field(default=None, ge=0, le=24)
    sleep_score: float | None = Field(default=None, ge=0, le=100)
    stress_score: float | None = Field(default=None, ge=0, le=100)
    soreness_score: float | None = Field(default=None, ge=0, le=100)
    soreness_legs: float | None = Field(default=None, ge=0, le=10)
    hydration_ml: float | None = Field(default=None, ge=0)
