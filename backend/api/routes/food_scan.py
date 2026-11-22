from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile

from api.deps import get_images, get_user_id
from domain.models.food_scan import FoodScanAccepted
from domain.services.image_service import ImageProcessingError, ImageService

router = APIRouter(prefix="/food-scan", tags=["food-scan"])


@router.post("/image", response_model=FoodScanAccepted, status_code=202)
async def upload_food_image(
    user_id: Annotated[UUID, Depends(get_user_id)],
    service: Annotated[ImageService, Depends(get_images)],
    image: UploadFile = File(...),  # noqa: B008 - FastAPI multipart dependency declaration
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> FoodScanAccepted:
    payload = await image.read()
    try:
        return await service.enqueue_scan(
            user_id,
            image=payload,
            content_type=image.content_type or "",
            idempotency_key=idempotency_key or f"food-scan:{user_id}:{image.filename}:{len(payload)}",
        )
    except ImageProcessingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc