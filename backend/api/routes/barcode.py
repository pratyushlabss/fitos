from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.deps import get_nutrition
from domain.models.product import ProductResolution
from domain.services.barcode_service import BarcodeError, normalize_barcode
from domain.services.nutrition_service import NutritionService

router = APIRouter(prefix="/barcode", tags=["barcode"])


class BarcodeLookupRequest(BaseModel):
    barcode: str = Field(min_length=1, max_length=32)


@router.post("/lookup", response_model=ProductResolution)
async def lookup_barcode(
    payload: BarcodeLookupRequest,
    nutrition: Annotated[NutritionService, Depends(get_nutrition)],
) -> ProductResolution:
    try:
        barcode, barcode_type = normalize_barcode(payload.barcode)
    except BarcodeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    lookup = await nutrition.lookup_barcode(barcode)
    if lookup is None:
        raise HTTPException(status_code=404, detail="product_not_found")
    return ProductResolution(
        status="exact",
        brand=lookup.brand,
        product=lookup.name,
        confidence=lookup.provenance.confidence,
        source=lookup.provenance.source,
        reason=f"Verified {barcode_type.value.upper()} match from the nutrition provider.",
    )