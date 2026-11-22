from typing import Protocol

from domain.models.food import NormalizedFoodPrediction


class VisionProvider(Protocol):
    """Identify foods and portions from a meal photo. Implemented by adapters only."""

    async def identify_meal(
        self,
        *,
        image_bytes: bytes,
        mime_type: str,
        locale: str | None = None,
    ) -> NormalizedFoodPrediction: ...
