from typing import Any
from uuid import UUID

from supabase import Client

from domain.models.common import Provenance, new_id
from domain.models.food import (
    FoodItemPrediction,
    FoodPredictionRecord,
    NormalizedFoodPrediction,
    UserCorrection,
)


class SupabaseFoodPredictionRepository:
    def __init__(self, client: Client) -> None:
        self._client = client

    async def save_prediction(
        self,
        user_id: UUID,
        prediction: NormalizedFoodPrediction,
        image_storage_path: str | None,
    ) -> FoodPredictionRecord:
        record_id = new_id()
        self._client.table("food_predictions").insert(
            {
                "id": str(record_id),
                "user_id": str(user_id),
                "source": prediction.provenance.source,
                "source_version": prediction.provenance.source_version,
                "confidence": prediction.overall_confidence,
                "image_storage_path": image_storage_path,
                "prediction": prediction.model_dump(mode="json"),
            }
        ).execute()
        return FoodPredictionRecord(
            id=record_id,
            user_id=user_id,
            image_storage_path=image_storage_path,
            prediction=prediction,
            provenance=prediction.provenance,
        )

    async def save_correction(
        self,
        user_id: UUID,
        prediction_id: UUID,
        corrected: UserCorrection,
    ) -> UserCorrection:
        self._client.table("user_corrections").insert(
            {
                "id": str(corrected.id),
                "user_id": str(user_id),
                "prediction_id": str(prediction_id),
                "corrected_payload": {
                    "items": [item.model_dump(mode="json") for item in corrected.corrected_items]
                },
            }
        ).execute()
        return corrected


def provenance_from_row(row: dict[str, Any]) -> Provenance:
    return Provenance(
        source=row["source"],
        source_version=row["source_version"],
        confidence=float(row["confidence"]),
    )


def items_from_payload(payload: dict[str, Any]) -> list[FoodItemPrediction]:
    return [FoodItemPrediction.model_validate(item) for item in payload.get("items") or []]
