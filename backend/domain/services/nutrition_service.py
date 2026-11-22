from uuid import UUID

from domain.models.food import NormalizedFoodPrediction, NutritionLookup
from domain.models.recovery import FitnessEventCreate, FitnessEventType
from domain.models.common import utcnow
from domain.services.recovery_pipeline import RecoveryPipelineService
from providers.nutrition import NutritionProvider
from providers.vision import VisionProvider
from repositories.food_prediction_repository import FoodPredictionRepository


class NutritionService:
    def __init__(
        self,
        vision: VisionProvider,
        barcode_provider: NutritionProvider,
        database_provider: NutritionProvider,
        predictions: FoodPredictionRepository,
        pipeline: RecoveryPipelineService | None = None,
    ) -> None:
        self._vision = vision
        self._barcode = barcode_provider
        self._database = database_provider
        self._predictions = predictions
        self._pipeline = pipeline

    async def identify_meal_photo(
        self,
        *,
        user_id: UUID,
        image_bytes: bytes,
        mime_type: str,
        locale: str | None = None,
        image_storage_path: str | None = None,
    ) -> NormalizedFoodPrediction:
        prediction = await self._vision.identify_meal(
            image_bytes=image_bytes,
            mime_type=mime_type,
            locale=locale,
        )
        await self._predictions.save_prediction(user_id, prediction, image_storage_path)
        if self._pipeline is not None:
            await self._pipeline.ingest(
                user_id,
                FitnessEventCreate(
                    event_type=FitnessEventType.MEAL_LOGGED,
                    occurred_at=utcnow(),
                    source="fitos",
                    payload={
                        "calories": sum(item.macros.calories for item in prediction.items),
                        "protein_g": sum(item.macros.protein_g for item in prediction.items),
                        "carbs_g": sum(item.macros.carbs_g for item in prediction.items),
                        "fat_g": sum(item.macros.fat_g for item in prediction.items),
                    },
                ),
            )
        return prediction

    async def lookup_barcode(self, barcode: str) -> NutritionLookup | None:
        found = await self._barcode.lookup_barcode(barcode)
        if found is not None:
            return found
        return await self._database.lookup_barcode(barcode)

    async def search(self, query: str, limit: int = 20) -> list[NutritionLookup]:
        packaged = await self._barcode.search_foods(query, limit=limit)
        if packaged:
            return packaged
        return await self._database.search_foods(query, limit=limit)
