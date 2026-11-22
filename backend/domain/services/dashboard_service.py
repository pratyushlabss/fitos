from datetime import datetime
from uuid import UUID

from domain.models.dashboard import DashboardSummary
from domain.models.food import NormalizedFoodPrediction
from domain.models.workout import Workout


class DashboardService:
    async def get_summary(self, user_id: UUID) -> DashboardSummary:
        return self.build_summary(
            workout=None,
            meals=[],
            steps=9620,
            active_calories=428,
            sleep_hours=7.4,
            readiness_score=86,
        )

    def build_summary(
        self,
        *,
        workout: Workout | None,
        meals: list[NormalizedFoodPrediction],
        steps: int,
        active_calories: int,
        sleep_hours: float,
        readiness_score: int,
    ) -> DashboardSummary:
        total_calories = sum(
            sum(item.macros.calories for item in meal.items) for meal in meals
        )
        protein = sum(sum(item.macros.protein_g for item in meal.items) for meal in meals)
        carbs = sum(sum(item.macros.carbs_g for item in meal.items) for meal in meals)
        fat = sum(sum(item.macros.fat_g for item in meal.items) for meal in meals)

        workout_title = workout.title if workout else "No workout planned"
        workout_volume = workout.total_volume_kg if workout else 0.0

        daily_score = max(0, min(100, readiness_score))
        recovery_label = (
            "Recovered"
            if readiness_score >= 80
            else "Balanced"
            if readiness_score >= 60
            else "Needs recovery"
        )

        recent_meals = [
            {
                "name": item.name,
                "calories": round(item.macros.calories),
                "protein_g": round(item.macros.protein_g),
            }
            for meal in meals
            for item in meal.items
        ]

        recent_workouts = []
        if workout is not None:
            recent_workouts.append(
                {
                    "name": workout_title,
                    "volume_kg": round(workout_volume, 1),
                    "status": "completed" if workout.completed_at else "planned",
                }
            )

        recent_activity = [
            {
                "type": "Steps",
                "value": f"{steps:,}",
                "status": "on track",
            },
            {
                "type": "Active calories",
                "value": f"{active_calories} kcal",
                "status": "steady",
            },
        ]

        return DashboardSummary(
            date=datetime.utcnow().strftime("%a, %b %d"),
            greeting="Good morning",
            daily_score=daily_score,
            readiness_score=readiness_score,
            workout_title=workout_title,
            workout_volume_kg=round(workout_volume, 1),
            total_calories=round(total_calories, 1),
            protein_g=round(protein, 1),
            carbs_g=round(carbs, 1),
            fat_g=round(fat, 1),
            today_steps=steps,
            active_calories=active_calories,
            sleep_hours=round(sleep_hours, 1),
            training_load=workout_volume / 2 if workout else 0.0,
            recovery_label=recovery_label,
            recent_meals=recent_meals,
            recent_workouts=recent_workouts,
            recent_activity=recent_activity,
        )
