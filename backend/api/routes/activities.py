from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_activities, get_user_id
from domain.models.activity import Activity, ActivityCreate
from domain.services.activity_service import ActivityService

router = APIRouter(prefix="/activities", tags=["activities"])


@router.post("", response_model=Activity)
async def record_activity(
    payload: ActivityCreate,
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[ActivityService, Depends(get_activities)],
) -> Activity:
    return await service.record(user_id, payload)


@router.get("", response_model=list[Activity])
async def list_activities(
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[ActivityService, Depends(get_activities)],
    limit: int = 20,
) -> list[Activity]:
    return await service.list_recent(user_id, limit=limit)


@router.get("/{activity_id}", response_model=Activity)
async def get_activity(
    activity_id: UUID,
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[ActivityService, Depends(get_activities)],
) -> Activity:
    activity = await service.get(user_id, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="activity_not_found")
    return activity
