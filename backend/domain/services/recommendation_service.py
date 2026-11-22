from uuid import UUID


class RecommendationService:
    async def list_for_user(self, user_id: UUID) -> list[dict[str, object]]:
        return self.recommend_for_today(["Bench Press", "Pull-up"])

    def recommend_for_today(
        self, recent_exercises: list[str]
    ) -> list[dict[str, object]]:
        exercise_list = [
            "Bench Press",
            "Pull-up",
            "Goblet Squat",
            "Romanian Deadlift",
            "Overhead Press",
        ]
        recommendations: list[dict[str, object]] = []

        for index, exercise in enumerate(exercise_list[:3]):
            rationale = (
                "You completed a strong set last week with a small progression window. "
                "This recommendation keeps the training stimulus high while preserving recovery."
                if exercise in recent_exercises
                else "You have no recent data for this movement, so the recommendation is conservative and volume-aware."
            )
            recommendations.append(
                {
                    "exercise": exercise,
                    "target": f"{72 - index * 4} kg × {8 - index}",
                    "reason": rationale,
                    "sets": [
                        {"reps": 8, "weight_kg": float(72 - index * 4), "rpe": 8.0, "completed": False},
                        {"reps": 8, "weight_kg": float(70 - index * 4), "rpe": 8.5, "completed": False},
                    ],
                }
            )

        return recommendations
