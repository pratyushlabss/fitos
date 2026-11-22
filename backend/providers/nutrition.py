from typing import Protocol

from domain.models.food import NutritionLookup


class NutritionProvider(Protocol):
    """Barcode and database nutrient lookup. No LLM calls."""

    source_name: str
    source_version: str

    async def lookup_barcode(self, barcode: str) -> NutritionLookup | None: ...

    async def search_foods(self, query: str, limit: int = 20) -> list[NutritionLookup]: ...

    async def get_by_external_id(self, external_id: str) -> NutritionLookup | None: ...
