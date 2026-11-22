from uuid import UUID

from pydantic import BaseModel, Field

from domain.models.common import Provenance


class Macronutrients(BaseModel):
    calories: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)


class FoodItemPrediction(BaseModel):
    name: str
    portion_grams: float = Field(gt=0)
    macros: Macronutrients
    brand: str | None = None
    barcode: str | None = None
    usda_fdc_id: str | None = None
    provenance: Provenance


class NormalizedFoodPrediction(BaseModel):
    items: list[FoodItemPrediction]
    overall_confidence: float = Field(ge=0.0, le=1.0)
    provenance: Provenance
    notes: str | None = None


class NutritionLookup(BaseModel):
    name: str
    brand: str | None = None
    barcode: str | None = None
    serving_grams: float = Field(gt=0)
    macros_per_serving: Macronutrients
    provenance: Provenance
    external_id: str


class FoodPredictionRecord(BaseModel):
    id: UUID
    user_id: UUID
    image_storage_path: str | None
    prediction: NormalizedFoodPrediction
    provenance: Provenance


class UserCorrection(BaseModel):
    id: UUID
    user_id: UUID
    prediction_id: UUID
    corrected_items: list[FoodItemPrediction]
