from datetime import datetime
from uuid import UUID

from domain.models.recovery import FitnessEventCreate, FitnessEventType
from domain.models.workout import Workout, WorkoutCreate, WorkoutExercise, WorkoutSet
from domain.services.recovery_pipeline import RecoveryPipelineService
from repositories.workout_repository import WorkoutRepository


class WorkoutService:
    def __init__(
        self,
        workouts: WorkoutRepository,
        pipeline: RecoveryPipelineService | None = None,
    ) -> None:
        self._workouts = workouts
        self._pipeline = pipeline

    async def start(self, user_id: UUID, payload: WorkoutCreate) -> Workout:
        return await self._workouts.create(user_id, payload)

    async def get(self, user_id: UUID, workout_id: UUID) -> Workout | None:
        return await self._workouts.get(user_id, workout_id)

    async def list_recent(
        self,
        user_id: UUID,
        *,
        limit: int = 20,
        before: datetime | None = None,
    ) -> list[Workout]:
        return await self._workouts.list_for_user(user_id, limit=limit, before=before)

    async def log_set(
        self,
        user_id: UUID,
        workout_id: UUID,
        exercise_id: UUID,
        workout_set: WorkoutSet,
    ) -> Workout:
        workout = await self._workouts.add_set(user_id, workout_id, exercise_id, workout_set)
        if self._pipeline is not None and workout_set.completed and not workout_set.is_warmup:
            await self._pipeline.ingest(
                user_id,
                FitnessEventCreate(
                    event_type=FitnessEventType.WORKOUT_SET_COMPLETED,
                    occurred_at=workout.completed_at or workout.started_at,
                    source="fitos",
                    payload={
                        "workout_id": str(workout_id),
                        "exercise_id": str(exercise_id),
                        "volume_kg": workout_set.reps * workout_set.weight_kg,
                        "reps": workout_set.reps,
                        "weight_kg": workout_set.weight_kg,
                        "rpe": workout_set.rpe,
                    },
                ),
            )
        return workout

    async def save_exercises(
        self,
        user_id: UUID,
        workout_id: UUID,
        exercises: list[WorkoutExercise],
    ) -> Workout:
        return await self._workouts.replace_exercises(user_id, workout_id, exercises)

    async def finish(self, user_id: UUID, workout_id: UUID) -> Workout:
        workout = await self._workouts.complete(user_id, workout_id)
        if self._pipeline is not None and workout.completed_at is not None:
            duration = max(0, int((workout.completed_at - workout.started_at).total_seconds()))
            rpes = [
                workout_set.rpe
                for exercise in workout.exercises
                for workout_set in exercise.sets
                if workout_set.rpe is not None and not workout_set.is_warmup
            ]
            await self._pipeline.ingest(
                user_id,
                FitnessEventCreate(
                    event_type=FitnessEventType.WORKOUT_COMPLETED,
                    occurred_at=workout.completed_at,
                    source="fitos",
                    payload={
                        "workout_id": str(workout.id),
                        "duration_seconds": duration,
                        "volume_kg": workout.total_volume_kg,
                        "training_load": workout.total_volume_kg / 50.0,
                        "rpe": sum(rpes) / len(rpes) if rpes else None,
                    },
                ),
            )
        return workout
