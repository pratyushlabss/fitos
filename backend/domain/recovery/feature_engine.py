from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from typing import Any
from uuid import UUID

from domain.models.recovery import (
    Availability,
    CanonicalDailyMetric,
    DailyDataStatus,
    DailyFitnessFeatures,
    DomainCoverage,
    DomainStatus,
    FitnessEvent,
    FitnessEventType,
    OptionalMetric,
)
from domain.recovery.source_policy import source_priority

COMPLETENESS_WEIGHTS: dict[str, int] = {
    "sleep": 20,
    "cardio": 15,
    "workout": 15,
    "nutrition": 15,
    "activity": 10,
    "stress": 10,
    "soreness": 10,
    "hydration": 5,
}


def payload_hash(payload: dict[str, object]) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def events_for_day(events: list[FitnessEvent], day: date) -> list[FitnessEvent]:
    return [event for event in events if event.occurred_at.date() == day]


def reconcile_gauge(
    events: list[FitnessEvent],
    *,
    event_type: FitnessEventType,
    payload_key: str,
    unit: str,
    user_id: UUID,
    day: date,
    metric: str,
) -> CanonicalDailyMetric:
    candidates: list[tuple[int, datetime, FitnessEvent, float]] = []
    for event in events:
        if event.event_type != event_type:
            continue
        raw = event.payload.get(payload_key)
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        candidates.append((source_priority(event.source), event.occurred_at, event, value))

    if not candidates:
        return CanonicalDailyMetric(
            user_id=user_id,
            date=day,
            metric=metric,
            observation=OptionalMetric.missing(unit),
        )

    best_priority = min(item[0] for item in candidates)
    same_source = [item for item in candidates if item[0] == best_priority]
    same_source.sort(key=lambda item: item[1])
    _priority, occurred_at, winner, value = same_source[-1]

    rejected: list[dict[str, object]] = []
    for priority, when, event, other in candidates:
        if event.id == winner.id:
            continue
        if abs(other - value) > _conflict_threshold(metric, value) and priority != best_priority:
            rejected.append(
                {
                    "source": event.source,
                    "value": other,
                    "occurred_at": when.isoformat(),
                    "reason": "lower_priority_source",
                }
            )

    confidence = 0.95 if winner.source in {"apple_health", "health_connect"} else 0.8
    return CanonicalDailyMetric(
        user_id=user_id,
        date=day,
        metric=metric,
        observation=OptionalMetric.present(
            value,
            unit,
            source=winner.source,
            source_priority=best_priority,
            timestamp=occurred_at,
            confidence=confidence,
            conflict_rejected=rejected,
        ),
    )


def sum_payload(
    events: list[FitnessEvent],
    *,
    event_types: set[FitnessEventType],
    payload_key: str,
    unit: str,
    preferred_sources: set[str] | None = None,
) -> OptionalMetric:
    matched = [
        event
        for event in events
        if event.event_type in event_types and event.payload.get(payload_key) is not None
    ]
    if preferred_sources is not None:
        preferred = [event for event in matched if event.source in preferred_sources]
        if preferred:
            matched = preferred
    if not matched:
        return OptionalMetric.missing(unit)

    total = 0.0
    latest = matched[0]
    for event in matched:
        total += float(event.payload[payload_key])
        if event.occurred_at >= latest.occurred_at:
            latest = event
    return OptionalMetric.present(
        total,
        unit,
        source=latest.source,
        source_priority=source_priority(latest.source),
        timestamp=latest.occurred_at,
        confidence=0.9,
    )


def mean_payload(
    events: list[FitnessEvent],
    *,
    event_type: FitnessEventType,
    payload_key: str,
    unit: str,
) -> OptionalMetric:
    values: list[tuple[FitnessEvent, float]] = []
    for event in events:
        if event.event_type != event_type:
            continue
        raw = event.payload.get(payload_key)
        if raw is None:
            continue
        values.append((event, float(raw)))
    if not values:
        return OptionalMetric.missing(unit)
    average = sum(item[1] for item in values) / len(values)
    latest = max(values, key=lambda item: item[0].occurred_at)[0]
    return OptionalMetric.present(
        average,
        unit,
        source=latest.source,
        source_priority=source_priority(latest.source),
        timestamp=latest.occurred_at,
        confidence=0.85,
    )


def latest_payload(
    events: list[FitnessEvent],
    *,
    event_type: FitnessEventType,
    payload_key: str,
    unit: str,
) -> OptionalMetric:
    matched = [
        event
        for event in events
        if event.event_type == event_type and event.payload.get(payload_key) is not None
    ]
    if not matched:
        return OptionalMetric.missing(unit)
    latest = max(matched, key=lambda event: event.occurred_at)
    return OptionalMetric.present(
        float(latest.payload[payload_key]),
        unit,
        source=latest.source,
        source_priority=source_priority(latest.source),
        timestamp=latest.occurred_at,
        confidence=0.85 if latest.source == "fitos_manual" else 0.9,
    )


def build_features(
    user_id: UUID, day: date, events: list[FitnessEvent]
) -> tuple[DailyFitnessFeatures, list[CanonicalDailyMetric], DailyDataStatus]:
    day_events = events_for_day(events, day)

    steps = reconcile_gauge(
        day_events,
        event_type=FitnessEventType.STEPS_UPDATED,
        payload_key="steps",
        unit="steps",
        user_id=user_id,
        day=day,
        metric="steps",
    )
    hrv = reconcile_gauge(
        day_events,
        event_type=FitnessEventType.HRV_UPDATED,
        payload_key="hrv_ms",
        unit="ms",
        user_id=user_id,
        day=day,
        metric="hrv",
    )
    rhr = reconcile_gauge(
        day_events,
        event_type=FitnessEventType.HEART_RATE_UPDATED,
        payload_key="resting_hr",
        unit="bpm",
        user_id=user_id,
        day=day,
        metric="resting_hr",
    )

    calories = sum_payload(
        day_events,
        event_types={FitnessEventType.MEAL_LOGGED},
        payload_key="calories",
        unit="kcal",
        preferred_sources={"fitos", "fitos_manual"},
    )
    protein = sum_payload(
        day_events,
        event_types={FitnessEventType.MEAL_LOGGED},
        payload_key="protein_g",
        unit="g",
        preferred_sources={"fitos", "fitos_manual"},
    )
    carbs = sum_payload(
        day_events,
        event_types={FitnessEventType.MEAL_LOGGED},
        payload_key="carbs_g",
        unit="g",
        preferred_sources={"fitos", "fitos_manual"},
    )
    fat = sum_payload(
        day_events,
        event_types={FitnessEventType.MEAL_LOGGED},
        payload_key="fat_g",
        unit="g",
        preferred_sources={"fitos", "fitos_manual"},
    )
    water = sum_payload(
        day_events,
        event_types={FitnessEventType.HYDRATION_LOGGED},
        payload_key="ml",
        unit="ml",
    )

    completed_workouts = [
        event for event in day_events if event.event_type == FitnessEventType.WORKOUT_COMPLETED
    ]
    volume_types = (
        {FitnessEventType.WORKOUT_COMPLETED}
        if completed_workouts
        else {FitnessEventType.WORKOUT_SET_COMPLETED}
    )
    volume = sum_payload(
        day_events,
        event_types=volume_types,
        payload_key="volume_kg",
        unit="kg",
        preferred_sources={"fitos"},
    )
    duration = sum_payload(
        day_events,
        event_types={FitnessEventType.WORKOUT_COMPLETED},
        payload_key="duration_seconds",
        unit="s",
        preferred_sources={"fitos"},
    )
    load = sum_payload(
        day_events,
        event_types={FitnessEventType.WORKOUT_COMPLETED},
        payload_key="training_load",
        unit="load",
        preferred_sources={"fitos"},
    )
    if load.availability is Availability.MISSING and volume.availability is Availability.PRESENT:
        inferred = (volume.value or 0) / 50.0
        load = OptionalMetric.present(
            inferred,
            "load",
            source=volume.source or "fitos",
            source_priority=volume.source_priority or 4,
            timestamp=volume.timestamp or datetime.combine(day, datetime.min.time()),
            confidence=0.7,
        )
    rpe = mean_payload(
        day_events,
        event_type=FitnessEventType.WORKOUT_COMPLETED,
        payload_key="rpe",
        unit="rpe",
    )
    workout_count_events = [
        event for event in day_events if event.event_type == FitnessEventType.WORKOUT_COMPLETED
    ]
    workout_count = (
        OptionalMetric.present(
            float(len(workout_count_events)),
            "count",
            source="fitos",
            source_priority=4,
            timestamp=workout_count_events[-1].occurred_at,
            confidence=1.0,
        )
        if workout_count_events
        else OptionalMetric.missing("count")
    )

    distance = sum_payload(
        day_events,
        event_types={FitnessEventType.ACTIVITY_COMPLETED},
        payload_key="distance_m",
        unit="m",
    )
    activity_duration = sum_payload(
        day_events,
        event_types={FitnessEventType.ACTIVITY_COMPLETED},
        payload_key="duration_seconds",
        unit="s",
    )
    active_calories = sum_payload(
        day_events,
        event_types={FitnessEventType.ACTIVITY_COMPLETED},
        payload_key="active_calories",
        unit="kcal",
    )
    activity_load = OptionalMetric.missing("load")
    if steps.observation.availability is Availability.PRESENT:
        activity_load = OptionalMetric.present(
            min(100.0, (steps.observation.value or 0) / 120.0),
            "load",
            source=steps.observation.source or "unknown",
            source_priority=steps.observation.source_priority or 99,
            timestamp=steps.observation.timestamp or datetime.combine(day, datetime.min.time()),
            confidence=steps.observation.confidence or 0.7,
        )

    sleep_hours = latest_payload(
        day_events, event_type=FitnessEventType.SLEEP_LOGGED, payload_key="hours", unit="h"
    )
    sleep_score = latest_payload(
        day_events, event_type=FitnessEventType.SLEEP_LOGGED, payload_key="score", unit="score"
    )
    stress = latest_payload(
        day_events, event_type=FitnessEventType.STRESS_LOGGED, payload_key="score", unit="score"
    )
    soreness = latest_payload(
        day_events, event_type=FitnessEventType.SORENESS_LOGGED, payload_key="score", unit="score"
    )
    weight = latest_payload(
        day_events, event_type=FitnessEventType.WEIGHT_LOGGED, payload_key="kg", unit="kg"
    )

    features = DailyFitnessFeatures(
        user_id=user_id,
        date=day,
        calories=calories,
        protein_g=protein,
        carbs_g=carbs,
        fat_g=fat,
        water_ml=water,
        workout_count=workout_count,
        workout_duration_s=duration,
        total_volume_kg=volume,
        training_load=load,
        average_rpe=rpe,
        steps=steps.observation,
        distance_m=distance,
        active_calories=active_calories,
        activity_duration_s=activity_duration,
        activity_load=activity_load,
        sleep_hours=sleep_hours,
        sleep_score=sleep_score,
        stress_score=stress,
        soreness_score=soreness,
        resting_hr=rhr.observation,
        hrv=hrv.observation,
        weight_kg=weight,
    )

    metrics = [steps, hrv, rhr]
    status = _data_status(user_id, day, day_events, features)
    return features, metrics, status


def _conflict_threshold(metric: str, value: float) -> float:
    if metric == "steps":
        return 400
    if metric == "hrv":
        return 5
    if metric == "resting_hr":
        return 3
    return max(1.0, abs(value) * 0.08)


def _coverage(events: int, *, manual: bool, complete_at: int) -> DomainCoverage:
    if events == 0:
        return DomainCoverage(status=DomainStatus.MISSING, events=0)
    if manual:
        status = DomainStatus.MANUAL if events > 0 else DomainStatus.MISSING
        return DomainCoverage(status=status, events=events)
    status = DomainStatus.COMPLETE if events >= complete_at else DomainStatus.INCOMPLETE
    return DomainCoverage(status=status, events=events)


def _data_status(
    user_id: UUID, day: date, events: list[FitnessEvent], features: DailyFitnessFeatures
) -> DailyDataStatus:
    meals = _count(events, FitnessEventType.MEAL_LOGGED)
    workouts = _count(events, FitnessEventType.WORKOUT_COMPLETED)
    activities = [
        event for event in events if event.event_type == FitnessEventType.ACTIVITY_COMPLETED
    ]
    sleep_events = _count(events, FitnessEventType.SLEEP_LOGGED)
    stress_events = _count(events, FitnessEventType.STRESS_LOGGED)
    soreness_events = _count(events, FitnessEventType.SORENESS_LOGGED)
    cardio_present = features.hrv.availability is Availability.PRESENT or (
        features.resting_hr.availability is Availability.PRESENT
    )

    activity_source = None
    if features.steps.availability is Availability.PRESENT:
        activity_source = features.steps.source
    elif activities:
        activity_source = activities[-1].source

    nutrition = _coverage(meals, manual=False, complete_at=3)
    workout = _coverage(workouts, manual=False, complete_at=1)
    if features.steps.availability is Availability.PRESENT or activities:
        activity = DomainCoverage(
            status=DomainStatus.COMPLETE,
            events=len(activities) + (1 if features.steps.availability is Availability.PRESENT else 0),
            source=activity_source,
        )
    else:
        activity = DomainCoverage(status=DomainStatus.MISSING, events=0)

    sleep = _coverage(sleep_events, manual=_manual(events, FitnessEventType.SLEEP_LOGGED), complete_at=1)
    stress = _coverage(stress_events, manual=True, complete_at=1)
    soreness = _coverage(soreness_events, manual=True, complete_at=1)
    cardio = DomainCoverage(
        status=DomainStatus.COMPLETE if cardio_present else DomainStatus.MISSING,
        events=1 if cardio_present else 0,
        source=features.hrv.source or features.resting_hr.source,
    )

    hydration_present = features.water_ml.availability is Availability.PRESENT
    present_weights = 0
    total_weights = sum(COMPLETENESS_WEIGHTS.values())
    mapping: dict[str, bool] = {
        "sleep": sleep.status != DomainStatus.MISSING,
        "cardio": cardio.status != DomainStatus.MISSING,
        "workout": workout.status != DomainStatus.MISSING,
        "nutrition": nutrition.status != DomainStatus.MISSING,
        "activity": activity.status != DomainStatus.MISSING,
        "stress": stress.status != DomainStatus.MISSING,
        "soreness": soreness.status != DomainStatus.MISSING,
        "hydration": hydration_present,
    }
    for key, present in mapping.items():
        if present:
            present_weights += COMPLETENESS_WEIGHTS[key]

    completeness = round(100 * present_weights / total_weights)
    return DailyDataStatus(
        user_id=user_id,
        date=day,
        nutrition=nutrition,
        workout=workout,
        activity=activity,
        sleep=sleep,
        stress=stress,
        soreness=soreness,
        cardio=cardio,
        data_completeness=completeness,
    )


def _count(events: list[FitnessEvent], event_type: FitnessEventType) -> int:
    return sum(1 for event in events if event.event_type == event_type)


def _manual(events: list[FitnessEvent], event_type: FitnessEventType) -> bool:
    return any(event.event_type == event_type and event.source.endswith("manual") for event in events)


def metric_to_row(metric: CanonicalDailyMetric) -> dict[str, Any]:
    obs = metric.observation
    return {
        "user_id": str(metric.user_id),
        "day": metric.date.isoformat(),
        "metric": metric.metric,
        "value": obs.value,
        "unit": obs.unit,
        "source": obs.source,
        "source_priority": obs.source_priority,
        "observed_at": obs.timestamp.isoformat() if obs.timestamp else None,
        "confidence": obs.confidence,
        "availability": obs.availability.value,
        "conflict_rejected": obs.conflict_rejected,
    }
