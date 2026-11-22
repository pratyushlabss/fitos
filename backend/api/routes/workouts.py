from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_user_id, get_workouts
from domain.models.workout import Workout, WorkoutCreate, WorkoutSet
from domain.services.workout_service import WorkoutService

router = APIRouter(prefix="/workouts", tags=["workouts"])


@router.post("", response_model=Workout)
async def start_workout(
    payload: WorkoutCreate,
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[WorkoutService, Depends(get_workouts)],
) -> Workout:
    return await service.start(user_id, payload)


@router.get("", response_model=list[Workout])
async def list_workouts(
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[WorkoutService, Depends(get_workouts)],
    limit: int = 20,
) -> list[Workout]:
    return await service.list_recent(user_id, limit=limit)


@router.get("/{workout_id}", response_model=Workout)
async def get_workout(
    workout_id: UUID,
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[WorkoutService, Depends(get_workouts)],
) -> Workout:
    workout = await service.get(user_id, workout_id)
    if workout is None:
        raise HTTPException(status_code=404, detail="workout_not_found")
    return workout


@router.post("/{workout_id}/sets", response_model=Workout)
async def log_set(
    workout_id: UUID,
    exercise_id: UUID,
    payload: WorkoutSet,
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[WorkoutService, Depends(get_workouts)],
) -> Workout:
    try:
        return await service.log_set(user_id, workout_id, exercise_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{workout_id}/complete", response_model=Workout)
async def complete_workout(
    workout_id: UUID,
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[WorkoutService, Depends(get_workouts)],
) -> Workout:
    try:
        return await service.finish(user_id, workout_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
