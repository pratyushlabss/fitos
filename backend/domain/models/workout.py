from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from domain.models.common import Visibility, new_id, utcnow


class WorkoutSet(BaseModel):
    id: UUID = Field(default_factory=new_id)
    set_index: int = Field(ge=1)
    reps: int = Field(ge=0)
    weight_kg: float = Field(ge=0)
    rpe: float | None = Field(default=None, ge=1, le=10)
    is_warmup: bool = False
    completed: bool = True


class WorkoutExercise(BaseModel):
    id: UUID = Field(default_factory=new_id)
    exercise_id: UUID | None = None
    exercise_name: str
    muscle_group: str | None = None
    equipment: str | None = None
    order_index: int = Field(ge=0)
    notes: str | None = None
    sets: list[WorkoutSet] = Field(default_factory=list)


class Workout(BaseModel):
    id: UUID = Field(default_factory=new_id)
    user_id: UUID
    title: str
    started_at: datetime = Field(default_factory=utcnow)
    completed_at: datetime | None = None
    notes: str | None = None
    visibility: Visibility = Visibility.PRIVATE
    total_volume_kg: float = 0
    exercises: list[WorkoutExercise] = Field(default_factory=list)


class WorkoutCreate(BaseModel):
    title: str
    notes: str | None = None
    visibility: Visibility = Visibility.PRIVATE
    exercises: list[WorkoutExercise] = Field(default_factory=list)
