from typing import Protocol
from uuid import UUID

from domain.models.food import FoodPredictionRecord, NormalizedFoodPrediction, UserCorrection


class FoodPredictionRepository(Protocol):
    async def save_prediction(
        self,
        user_id: UUID,
        prediction: NormalizedFoodPrediction,
        image_storage_path: str | None,
    ) -> FoodPredictionRecord: ...

    async def save_correction(
        self,
        user_id: UUID,
        prediction_id: UUID,
        corrected: UserCorrection,
    ) -> UserCorrection: ...
