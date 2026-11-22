from datetime import datetime
from typing import Any
from uuid import UUID

from supabase import Client

from domain.models.common import Visibility, utcnow
from domain.models.workout import Workout, WorkoutCreate, WorkoutExercise, WorkoutSet


def _volume_kg(exercises: list[WorkoutExercise]) -> float:
    total = 0.0
    for exercise in exercises:
        for workout_set in exercise.sets:
            if workout_set.completed and not workout_set.is_warmup:
                total += workout_set.reps * workout_set.weight_kg
    return total


class SupabaseWorkoutRepository:
    def __init__(self, client: Client) -> None:
        self._client = client

    async def get(self, user_id: UUID, workout_id: UUID) -> Workout | None:
        result = (
            self._client.table("workouts")
            .select("*, workout_exercises(*, workout_sets(*))")
            .eq("id", str(workout_id))
            .eq("user_id", str(user_id))
            .maybe_single()
            .execute()
        )
        if result.data is None:
            return None
        return self._to_workout(result.data)

    async def list_for_user(
        self,
        user_id: UUID,
        *,
        limit: int = 20,
        before: datetime | None = None,
    ) -> list[Workout]:
        query = (
            self._client.table("workouts")
            .select("*, workout_exercises(*, workout_sets(*))")
            .eq("user_id", str(user_id))
            .order("started_at", desc=True)
            .limit(limit)
        )
        if before is not None:
            query = query.lt("started_at", before.isoformat())
        result = query.execute()
        rows: list[dict[str, Any]] = result.data or []
        return [self._to_workout(row) for row in rows]

    async def create(self, user_id: UUID, payload: WorkoutCreate) -> Workout:
        workout = Workout(
            user_id=user_id,
            title=payload.title,
            notes=payload.notes,
            visibility=payload.visibility,
            exercises=payload.exercises,
            total_volume_kg=_volume_kg(payload.exercises),
        )
        self._client.table("workouts").insert(self._workout_row(workout)).execute()
        self._persist_tree(workout)
        return workout

    async def replace_exercises(
        self,
        user_id: UUID,
        workout_id: UUID,
        exercises: list[WorkoutExercise],
    ) -> Workout:
        existing = await self.get(user_id, workout_id)
        if existing is None:
            raise KeyError("workout_not_found")
        self._client.table("workout_exercises").delete().eq("workout_id", str(workout_id)).execute()
        existing.exercises = exercises
        existing.total_volume_kg = _volume_kg(exercises)
        self._client.table("workouts").update(
            {"total_volume_kg": existing.total_volume_kg}
        ).eq("id", str(workout_id)).eq("user_id", str(user_id)).execute()
        self._persist_tree(existing)
        return existing

    async def add_set(
        self,
        user_id: UUID,
        workout_id: UUID,
        exercise_id: UUID,
        workout_set: WorkoutSet,
    ) -> Workout:
        existing = await self.get(user_id, workout_id)
        if existing is None:
            raise KeyError("workout_not_found")
        matched = next((item for item in existing.exercises if item.id == exercise_id), None)
        if matched is None:
            raise KeyError("exercise_not_found")
        matched.sets.append(workout_set)
        self._client.table("workout_sets").insert(
            {
                "id": str(workout_set.id),
                "workout_exercise_id": str(exercise_id),
                "set_index": workout_set.set_index,
                "reps": workout_set.reps,
                "weight_kg": workout_set.weight_kg,
                "rpe": workout_set.rpe,
                "is_warmup": workout_set.is_warmup,
                "completed": workout_set.completed,
            }
        ).execute()
        existing.total_volume_kg = _volume_kg(existing.exercises)
        self._client.table("workouts").update(
            {"total_volume_kg": existing.total_volume_kg}
        ).eq("id", str(workout_id)).eq("user_id", str(user_id)).execute()
        return existing

    async def complete(self, user_id: UUID, workout_id: UUID) -> Workout:
        existing = await self.get(user_id, workout_id)
        if existing is None:
            raise KeyError("workout_not_found")
        existing.completed_at = utcnow()
        existing.total_volume_kg = _volume_kg(existing.exercises)
        self._client.table("workouts").update(
            {
                "completed_at": existing.completed_at.isoformat(),
                "total_volume_kg": existing.total_volume_kg,
            }
        ).eq("id", str(workout_id)).eq("user_id", str(user_id)).execute()
        return existing

    def _persist_tree(self, workout: Workout) -> None:
        for exercise in workout.exercises:
            self._client.table("workout_exercises").insert(
                {
                    "id": str(exercise.id),
                    "workout_id": str(workout.id),
                    "exercise_id": str(exercise.exercise_id) if exercise.exercise_id else None,
                    "exercise_name": exercise.exercise_name,
                    "muscle_group": exercise.muscle_group,
                    "equipment": exercise.equipment,
                    "order_index": exercise.order_index,
                    "notes": exercise.notes,
                }
            ).execute()
            if not exercise.sets:
                continue
            self._client.table("workout_sets").insert(
                [
                    {
                        "id": str(workout_set.id),
                        "workout_exercise_id": str(exercise.id),
                        "set_index": workout_set.set_index,
                        "reps": workout_set.reps,
                        "weight_kg": workout_set.weight_kg,
                        "rpe": workout_set.rpe,
                        "is_warmup": workout_set.is_warmup,
                        "completed": workout_set.completed,
                    }
                    for workout_set in exercise.sets
                ]
            ).execute()

    def _workout_row(self, workout: Workout) -> dict[str, Any]:
        return {
            "id": str(workout.id),
            "user_id": str(workout.user_id),
            "title": workout.title,
            "started_at": workout.started_at.isoformat(),
            "completed_at": workout.completed_at.isoformat() if workout.completed_at else None,
            "notes": workout.notes,
            "visibility": workout.visibility.value,
            "total_volume_kg": workout.total_volume_kg,
        }

    def _to_workout(self, row: dict[str, Any]) -> Workout:
        exercises: list[WorkoutExercise] = []
        for exercise_row in sorted(
            row.get("workout_exercises") or [], key=lambda item: item["order_index"]
        ):
            sets = [
                WorkoutSet(
                    id=UUID(set_row["id"]),
                    set_index=set_row["set_index"],
                    reps=set_row["reps"],
                    weight_kg=float(set_row["weight_kg"]),
                    rpe=set_row.get("rpe"),
                    is_warmup=set_row["is_warmup"],
                    completed=set_row["completed"],
                )
                for set_row in sorted(
                    exercise_row.get("workout_sets") or [], key=lambda item: item["set_index"]
                )
            ]
            exercises.append(
                WorkoutExercise(
                    id=UUID(exercise_row["id"]),
                    exercise_id=UUID(exercise_row["exercise_id"])
                    if exercise_row.get("exercise_id")
                    else None,
                    exercise_name=exercise_row["exercise_name"],
                    muscle_group=exercise_row.get("muscle_group"),
                    equipment=exercise_row.get("equipment"),
                    order_index=exercise_row["order_index"],
                    notes=exercise_row.get("notes"),
                    sets=sets,
                )
            )
        return Workout(
            id=UUID(row["id"]),
            user_id=UUID(row["user_id"]),
            title=row["title"],
            started_at=datetime.fromisoformat(row["started_at"].replace("Z", "+00:00")),
            completed_at=datetime.fromisoformat(row["completed_at"].replace("Z", "+00:00"))
            if row.get("completed_at")
            else None,
            notes=row.get("notes"),
            visibility=Visibility(row.get("visibility") or "private"),
            total_volume_kg=float(row.get("total_volume_kg") or 0),
            exercises=exercises,
        )
