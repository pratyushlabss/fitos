from domain.models.progression import ProgressionInput, ProgressionRecommendation


class ProgressionService:
    """Deterministic training progression with an explicit rationale."""

    def recommend(self, payload: ProgressionInput) -> ProgressionRecommendation:
        recovery = payload.recovery_score
        if recovery is not None and recovery < 50:
            increment = 0.0
            sets = 2
            reason = (
                f"Recovery is estimated at {recovery}/100, so load is held at "
                "the previous performance while volume is reduced."
            )
            confidence = 0.78
        elif payload.previous_rpe is not None and payload.previous_rpe >= 9:
            increment = 0.0
            sets = 3
            reason = (
                f"Previous session was {payload.previous_weight_kg:g} kg x "
                f"{payload.previous_reps} at RPE {payload.previous_rpe:g}; repeat it "
                "until the effort decreases."
            )
            confidence = 0.8
        elif payload.previous_reps >= payload.target_reps and (
            payload.previous_rpe is None or payload.previous_rpe <= 8
        ):
            increment = 2.5 if payload.previous_weight_kg >= 40 else 1.25
            sets = 3
            reason = (
                f"Previous session: {payload.previous_weight_kg:g} kg x "
                f"{payload.previous_reps}; target reps were met without excessive effort."
            )
            confidence = 0.82
        else:
            increment = 0.0
            sets = 3
            reason = (
                f"Previous session: {payload.previous_weight_kg:g} kg x "
                f"{payload.previous_reps}; build repetitions before adding load."
            )
            confidence = 0.74

        return ProgressionRecommendation(
            exercise=payload.exercise,
            recommended_weight_kg=round(payload.previous_weight_kg + increment, 2),
            recommended_reps=payload.target_reps,
            recommended_sets=sets,
            reason=reason,
            confidence=confidence,
        )
