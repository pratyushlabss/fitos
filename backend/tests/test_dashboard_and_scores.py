from datetime import datetime
from uuid import uuid4

from domain.models.common import Provenance
from domain.models.food import Macronutrients, NormalizedFoodPrediction
from domain.models.workout import Workout, WorkoutExercise, WorkoutSet
from domain.services.dashboard_service import DashboardService
from domain.services.score_service import ReadinessInputs, ScoreService


def test_score_service_produces_explainable_readiness() -> None:
    score = ScoreService().score(ReadinessInputs(
        sleep_hours=7.5,
        active_calories=320,
        resting_heart_rate=52,
        training_load=280,
    ))

    assert 0 <= score.score <= 100
    assert score.sleep_component > 0
    assert score.recovery_component > 0
    assert score.strain_component >= 0


def test_dashboard_service_builds_summary_from_workout_and_meal_inputs() -> None:
    workout = Workout(
        id=uuid4(),
        user_id=uuid4(),
        title="Upper body",
        started_at=datetime.utcnow(),
        total_volume_kg=210.0,
        exercises=[
            WorkoutExercise(
                id=uuid4(),
                exercise_name="Bench Press",
                muscle_group="Chest",
                equipment="Barbell",
                order_index=0,
                notes=None,
                sets=[
                    WorkoutSet(id=uuid4(), set_index=1, reps=8, weight_kg=75, rpe=8, is_warmup=False, completed=True),
                    WorkoutSet(id=uuid4(), set_index=2, reps=6, weight_kg=80, rpe=8.5, is_warmup=False, completed=True),
                ],
            )
        ],
    )

    meal = NormalizedFoodPrediction(
        items=[
            {
                "name": "Chicken bowl",
                "portion_grams": 320,
                "macros": Macronutrients(calories=540, protein_g=42, carbs_g=30, fat_g=18),
                "brand": None,
                "barcode": None,
                "usda_fdc_id": None,
                "provenance": Provenance(source="demo", source_version="1.0", confidence=0.92),
            }
        ],
        overall_confidence=0.92,
        provenance=Provenance(source="demo", source_version="1.0", confidence=0.92),
        notes="demo meal",
    )

    summary = DashboardService().build_summary(
        workout=workout,
        meals=[meal],
        steps=9800,
        active_calories=420,
        sleep_hours=7.2,
        readiness_score=84,
    )

    assert summary.daily_score >= 0
    assert summary.workout_volume_kg == 210.0
    assert summary.total_calories > 0
    assert summary.today_steps == 9800
    assert summary.recovery_label
