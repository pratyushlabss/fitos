from fastapi import APIRouter
from pydantic import BaseModel, Field

from domain.models.product import ProductResolution
from domain.services.product_service import ProductResolverService

router = APIRouter(prefix="/products", tags=["products"])


class ProductResolutionRequest(BaseModel):
    barcode: str | None = Field(default=None, min_length=1, max_length=32)
    images: list[str] = Field(default_factory=list)
    ocr_text: str | None = None
    user_description: str | None = None


@router.post("/resolve", response_model=ProductResolution)
async def resolve_product(
    payload: ProductResolutionRequest,
) -> ProductResolution:
    return ProductResolverService().resolve(
        barcode=payload.barcode,
        images=payload.images,
        ocr_text=payload.ocr_text,
        user_description=payload.user_description,
    )

