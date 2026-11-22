from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_progression, get_recommendations, get_user_id
from domain.models.progression import ProgressionInput, ProgressionRecommendation
from domain.services.progression_service import ProgressionService
from domain.services.recommendation_service import RecommendationService

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.get("", response_model=list[dict[str, object]])
async def list_recommendations(
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[RecommendationService, Depends(get_recommendations)],
) -> list[dict[str, object]]:
    try:
        return await service.list_for_user(user_id)
    except Exception as exc:  # pragma: no cover - defensive boundary
        raise HTTPException(status_code=500, detail="recommendation_unavailable") from exc


@router.post("/progression", response_model=ProgressionRecommendation)
async def recommend_progression(
    payload: ProgressionInput,
    _: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[ProgressionService, Depends(get_progression)],
) -> ProgressionRecommendation:
    return service.recommend(payload)
