from datetime import datetime
from typing import Protocol
from uuid import UUID

from domain.models.workout import Workout, WorkoutCreate, WorkoutExercise, WorkoutSet


class WorkoutRepository(Protocol):
    async def get(self, user_id: UUID, workout_id: UUID) -> Workout | None: ...

    async def list_for_user(
        self,
        user_id: UUID,
        *,
        limit: int = 20,
        before: datetime | None = None,
    ) -> list[Workout]: ...

    async def create(self, user_id: UUID, payload: WorkoutCreate) -> Workout: ...

    async def replace_exercises(
        self,
        user_id: UUID,
        workout_id: UUID,
        exercises: list[WorkoutExercise],
    ) -> Workout: ...

    async def add_set(
        self,
        user_id: UUID,
        workout_id: UUID,
        exercise_id: UUID,
        workout_set: WorkoutSet,
    ) -> Workout: ...

    async def complete(self, user_id: UUID, workout_id: UUID) -> Workout: ...
