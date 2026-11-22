from domain.models.recovery import CoachAdvice, CoachContext, DailyFitnessFeatures, RecoveryDaily


def readiness_label(score: int | None) -> str:
    if score is None:
        return "unknown"
    if score >= 80:
        return "high"
    if score >= 65:
        return "moderate"
    return "low"


def build_coach_context(
    recovery: RecoveryDaily,
    features: DailyFitnessFeatures,
    trend_7d: list[int | None],
) -> CoachContext:
    advice = explain(recovery, features)
    return CoachContext(
        date=recovery.date,
        recovery_score=recovery.recovery_score,
        readiness=readiness_label(recovery.readiness_score),
        confidence=recovery.confidence,
        data_completeness=recovery.data_completeness,
        algorithm=recovery.algorithm,
        sleep=_metric_view(features.sleep_hours, extra={"score": features.sleep_score.value}),
        stress=_metric_view(features.stress_score),
        training={
            "load": features.training_load.value,
            "volume_kg": features.total_volume_kg.value,
            "available": features.training_load.availability.value,
        },
        activity={
            "steps": features.steps.value,
            "load": features.activity_load.value,
            "source": features.steps.source,
            "available": features.steps.availability.value,
        },
        nutrition={
            "calories": features.calories.value,
            "protein_g": features.protein_g.value,
            "target_protein_g": 160,
            "available": features.calories.availability.value,
        },
        soreness=_metric_view(features.soreness_score),
        trend_7d=trend_7d,
        missing_inputs=recovery.missing_inputs,
        advice=advice,
    )


def explain(recovery: RecoveryDaily, features: DailyFitnessFeatures) -> CoachAdvice:
    if recovery.recovery_score is None:
        return CoachAdvice(
            headline="Recovery unavailable",
            body=(
                "FitOS does not have enough validated inputs to publish a recovery score. "
                f"Missing: {', '.join(recovery.missing_inputs) or 'core signals'}."
            ),
            recommendation="Log sleep and at least one of training, activity, or a check-in before treating today as a scored day.",
            focus=["complete today's data"],
        )

    helpers: list[str] = []
    drags: list[str] = []
    if (recovery.inputs.get("sleep") or 0) >= 75:
        helpers.append("sleep")
    elif recovery.inputs.get("sleep") is not None:
        drags.append("sleep")
    if (recovery.inputs.get("nutrition") or 0) >= 75:
        helpers.append("nutrition")
    if recovery.inputs.get("training_load") is not None and (recovery.inputs["training_load"] or 100) < 70:
        drags.append("training load")
    if recovery.inputs.get("soreness") is not None and (recovery.inputs["soreness"] or 100) < 70:
        drags.append("soreness")
    if recovery.inputs.get("stress") is None:
        pass

    helper_text = " and ".join(helpers) if helpers else "the signals we do have"
    drag_text = " and ".join(drags) if drags else "no major reducers in the present data"

    if recovery.recovery_score >= 75:
        rec = "Moderate to full training is reasonable. Keep 1–3 reps in reserve on last sets."
        headline = f"Recovery: {recovery.recovery_score} — Good"
    elif recovery.recovery_score >= 60:
        rec = "Keep training moderate. Avoid taking lower-body sets to failure."
        headline = f"Recovery: {recovery.recovery_score} — Moderate"
    else:
        rec = "Prioritize easy movement, protein, and sleep. Skip failure sets."
        headline = f"Recovery: {recovery.recovery_score} — Low"

    confidence_note = (
        f"Confidence {round(recovery.confidence * 100)}% from {recovery.data_completeness}% data completeness."
    )
    if recovery.missing_inputs:
        confidence_note += f" Missing treated as unknown: {', '.join(recovery.missing_inputs)}."

    body = (
        f"Your {helper_text} {'is' if len(helpers) == 1 else 'are'} supporting recovery, "
        f"while {drag_text} {'is' if len(drags) == 1 else 'are'} the main constraint. {confidence_note}"
    )
    focus = ["hydration", "protein target", "earlier bedtime"]
    if features.soreness_score.value is not None and features.soreness_score.value >= 60:
        focus.insert(0, "light mobility")
    return CoachAdvice(headline=headline, body=body, recommendation=rec, focus=focus)


def _metric_view(metric, extra: dict | None = None) -> dict[str, object]:
    payload: dict[str, object] = {
        "value": metric.value,
        "source": metric.source,
        "available": metric.availability.value,
    }
    if extra:
        payload.update(extra)
    return payload
