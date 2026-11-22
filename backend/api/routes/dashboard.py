from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from api.deps import get_dashboard, get_user_id
from domain.models.dashboard import DashboardSummary
from domain.services.dashboard_service import DashboardService

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardSummary)
async def get_dashboard_summary(
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[DashboardService, Depends(get_dashboard)],
) -> DashboardSummary:
    return await service.get_summary(user_id)
