from domain.models.recovery import (
    ALGORITHM_V1,
    Availability,
    DailyDataStatus,
    DailyFitnessFeatures,
    OptionalMetric,
    RecoveryComponent,
    RecoveryDaily,
)
from domain.models.common import utcnow
from domain.models.recovery import DayStatus


COMPONENT_WEIGHTS: dict[str, float] = {
    "sleep": 0.25,
    "stress": 0.10,
    "training_load": 0.20,
    "activity_load": 0.10,
    "nutrition": 0.15,
    "soreness": 0.10,
    "cardio": 0.10,
}

STRONG_ASSESSMENT_KEYS = ("sleep", "cardio")


def score_day(
    features: DailyFitnessFeatures,
    status: DailyDataStatus,
    *,
    day_status: DayStatus = DayStatus.OPEN,
) -> RecoveryDaily:
    components = [
        _sleep_component(features),
        _optional_inverse(features.stress_score, "stress", COMPONENT_WEIGHTS["stress"]),
        _training_component(features),
        _activity_component(features),
        _nutrition_component(features),
        _optional_inverse(features.soreness_score, "soreness", COMPONENT_WEIGHTS["soreness"]),
        _cardio_component(features),
    ]

    present = [item for item in components if item.availability is Availability.PRESENT]
    missing = [item.key for item in components if item.availability is Availability.MISSING]

    recovery_score: int | None = None
    if present:
        weight_sum = sum(item.weight for item in present)
        weighted = sum((item.score or 0) * item.weight for item in present)
        recovery_score = int(round(weighted / weight_sum))

    readiness_score = recovery_score
    if recovery_score is not None and features.training_load.availability is Availability.PRESENT:
        load = features.training_load.value or 0
        freshness = max(0.0, 100.0 - min(load, 100.0))
        readiness_score = int(round(recovery_score * 0.85 + freshness * 0.15))

    coverage = len(present) / len(components)
    completeness_factor = status.data_completeness / 100.0
    source_confidences = [
        metric.confidence
        for metric in _source_metrics(features)
        if metric.availability is Availability.PRESENT and metric.confidence is not None
    ]
    mean_source = sum(source_confidences) / len(source_confidences) if source_confidences else 0.55
    confidence = completeness_factor * 0.55 + coverage * 0.25 + mean_source * 0.20
    if "sleep" in missing:
        confidence = min(confidence, 0.58)
    if not any(key in missing for key in STRONG_ASSESSMENT_KEYS) and status.data_completeness >= 80:
        confidence = max(confidence, 0.8)
    confidence = max(0.0, min(1.0, round(confidence, 3)))

    inputs = {
        "sleep": _component_score(components, "sleep"),
        "stress": _component_score(components, "stress"),
        "training_load": _component_score(components, "training_load"),
        "activity_load": _component_score(components, "activity_load"),
        "nutrition": _component_score(components, "nutrition"),
        "soreness": _component_score(components, "soreness"),
        "cardio": _component_score(components, "cardio"),
    }

    return RecoveryDaily(
        user_id=features.user_id,
        date=features.date,
        recovery_score=recovery_score,
        readiness_score=readiness_score,
        inputs=inputs,
        components=components,
        missing_inputs=missing,
        data_completeness=status.data_completeness,
        confidence=confidence,
        status=day_status,
        algorithm=ALGORITHM_V1,
        calculated_at=utcnow(),
    )


def _component_score(components: list[RecoveryComponent], key: str) -> float | None:
    for item in components:
        if item.key == key:
            return item.score
    return None


def _present_score(metric: OptionalMetric, score: float, key: str, weight: float) -> RecoveryComponent:
    if metric.availability is Availability.MISSING or metric.value is None:
        return RecoveryComponent(key=key, score=None, availability=Availability.MISSING, weight=weight)
    return RecoveryComponent(key=key, score=max(0.0, min(100.0, score)), availability=Availability.PRESENT, weight=weight)


def _sleep_component(features: DailyFitnessFeatures) -> RecoveryComponent:
    if features.sleep_hours.availability is Availability.MISSING and features.sleep_score.availability is Availability.MISSING:
        return RecoveryComponent(key="sleep", score=None, availability=Availability.MISSING, weight=COMPONENT_WEIGHTS["sleep"])
    parts: list[float] = []
    if features.sleep_hours.value is not None:
        parts.append(min(features.sleep_hours.value / 8.0, 1.15) * 100)
    if features.sleep_score.value is not None:
        parts.append(features.sleep_score.value)
    score = sum(parts) / len(parts)
    metric = features.sleep_hours if features.sleep_hours.availability is Availability.PRESENT else features.sleep_score
    return _present_score(metric, score, "sleep", COMPONENT_WEIGHTS["sleep"])


def _optional_inverse(metric: OptionalMetric, key: str, weight: float) -> RecoveryComponent:
    if metric.availability is Availability.MISSING or metric.value is None:
        return RecoveryComponent(key=key, score=None, availability=Availability.MISSING, weight=weight)
    return RecoveryComponent(
        key=key,
        score=max(0.0, min(100.0, 100.0 - metric.value)),
        availability=Availability.PRESENT,
        weight=weight,
    )


def _training_component(features: DailyFitnessFeatures) -> RecoveryComponent:
    metric = features.training_load
    if metric.availability is Availability.MISSING or metric.value is None:
        if features.workout_count.availability is Availability.MISSING:
            return RecoveryComponent(
                key="training_load",
                score=None,
                availability=Availability.MISSING,
                weight=COMPONENT_WEIGHTS["training_load"],
            )
        return RecoveryComponent(
            key="training_load",
            score=88.0,
            availability=Availability.PRESENT,
            weight=COMPONENT_WEIGHTS["training_load"],
        )
    inverted = max(0.0, 100.0 - min(metric.value, 120.0) * 0.7)
    return _present_score(metric, inverted, "training_load", COMPONENT_WEIGHTS["training_load"])


def _activity_component(features: DailyFitnessFeatures) -> RecoveryComponent:
    metric = features.activity_load
    if metric.availability is Availability.MISSING or metric.value is None:
        return RecoveryComponent(
            key="activity_load",
            score=None,
            availability=Availability.MISSING,
            weight=COMPONENT_WEIGHTS["activity_load"],
        )
    # Moderate daily movement scores well; extreme load reduces recovery slightly.
    value = metric.value
    if value <= 70:
        score = 55 + value * 0.5
    else:
        score = 90 - (value - 70) * 0.4
    return _present_score(metric, score, "activity_load", COMPONENT_WEIGHTS["activity_load"])


def _nutrition_component(features: DailyFitnessFeatures) -> RecoveryComponent:
    if features.calories.availability is Availability.MISSING:
        return RecoveryComponent(
            key="nutrition",
            score=None,
            availability=Availability.MISSING,
            weight=COMPONENT_WEIGHTS["nutrition"],
        )
    protein_score = 70.0
    if features.protein_g.value is not None:
        protein_score = min(100.0, (features.protein_g.value / 160.0) * 100)
    calorie_score = 70.0
    if features.calories.value is not None:
        calorie_score = 100 - min(abs(features.calories.value - 2200) / 22.0, 40)
    score = protein_score * 0.6 + calorie_score * 0.4
    return _present_score(features.calories, score, "nutrition", COMPONENT_WEIGHTS["nutrition"])


def _cardio_component(features: DailyFitnessFeatures) -> RecoveryComponent:
    if features.hrv.availability is Availability.MISSING and features.resting_hr.availability is Availability.MISSING:
        return RecoveryComponent(
            key="cardio",
            score=None,
            availability=Availability.MISSING,
            weight=COMPONENT_WEIGHTS["cardio"],
        )
    parts: list[float] = []
    if features.hrv.value is not None:
        parts.append(min(features.hrv.value / 70.0, 1.2) * 100)
    if features.resting_hr.value is not None:
        parts.append(max(0.0, 100.0 - max(0.0, features.resting_hr.value - 50.0) * 2.0))
    score = sum(parts) / len(parts)
    metric = features.hrv if features.hrv.availability is Availability.PRESENT else features.resting_hr
    return _present_score(metric, score, "cardio", COMPONENT_WEIGHTS["cardio"])


def _source_metrics(features: DailyFitnessFeatures) -> list[OptionalMetric]:
    return [
        features.sleep_hours,
        features.stress_score,
        features.training_load,
        features.activity_load,
        features.calories,
        features.soreness_score,
        features.hrv,
        features.resting_hr,
        features.steps,
    ]
