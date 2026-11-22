from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from api.deps import get_nutrition, get_user_id
from domain.models.food import NormalizedFoodPrediction, NutritionLookup
from domain.services.nutrition_service import NutritionService

router = APIRouter(prefix="/nutrition", tags=["nutrition"])


@router.post("/meals/photo", response_model=NormalizedFoodPrediction)
async def identify_meal_photo(
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[NutritionService, Depends(get_nutrition)],
    image: UploadFile = File(...),
    locale: str | None = Form(default=None),
) -> NormalizedFoodPrediction:
    mime = image.content_type or "image/jpeg"
    payload = await image.read()
    if not payload:
        raise HTTPException(status_code=400, detail="empty_image")
    return await service.identify_meal_photo(
        user_id=user_id,
        image_bytes=payload,
        mime_type=mime,
        locale=locale,
    )


@router.get("/barcode/{barcode}", response_model=NutritionLookup | None)
async def barcode(
    barcode: str,
    service: Annotated[NutritionService, Depends(get_nutrition)],
) -> NutritionLookup | None:
    return await service.lookup_barcode(barcode)


@router.get("/search", response_model=list[NutritionLookup])
async def search(
    q: str,
    service: Annotated[NutritionService, Depends(get_nutrition)],
    limit: int = 20,
) -> list[NutritionLookup]:
    return await service.search(q, limit=limit)
