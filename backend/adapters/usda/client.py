from typing import Any

import httpx

from domain.models.common import Provenance
from domain.models.food import Macronutrients, NutritionLookup

USDA_SOURCE = "usda_fdc"
USDA_VERSION = "v1"


class UsdaFoodDataAdapter:
    source_name = USDA_SOURCE
    source_version = USDA_VERSION

    def __init__(self, http: httpx.AsyncClient, api_key: str) -> None:
        self._http = http
        self._api_key = api_key

    async def lookup_barcode(self, barcode: str) -> NutritionLookup | None:
        matches = await self.search_foods(barcode, limit=5)
        for item in matches:
            if item.barcode == barcode:
                return item
        return None

    async def search_foods(self, query: str, limit: int = 20) -> list[NutritionLookup]:
        if not self._api_key:
            return []
        response = await self._http.get(
            "https://api.nal.usda.gov/fdc/v1/foods/search",
            params={
                "api_key": self._api_key,
                "query": query,
                "pageSize": min(limit, 50),
            },
            timeout=15.0,
        )
        response.raise_for_status()
        body: dict[str, Any] = response.json()
        foods: list[dict[str, Any]] = body.get("foods") or []
        return [item for item in (_from_fdc(food) for food in foods) if item is not None]

    async def get_by_external_id(self, external_id: str) -> NutritionLookup | None:
        if not self._api_key:
            return None
        response = await self._http.get(
            f"https://api.nal.usda.gov/fdc/v1/food/{external_id}",
            params={"api_key": self._api_key},
            timeout=15.0,
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return _from_fdc(response.json())


def _from_fdc(food: dict[str, Any]) -> NutritionLookup | None:
    fdc_id = food.get("fdcId")
    if fdc_id is None:
        return None
    nutrients = {item.get("nutrientName"): item for item in food.get("foodNutrients") or []}
    serving = 100.0
    macros = Macronutrients(
        calories=_nutrient_amount(nutrients, "Energy"),
        protein_g=_nutrient_amount(nutrients, "Protein"),
        carbs_g=_nutrient_amount(nutrients, "Carbohydrate, by difference"),
        fat_g=_nutrient_amount(nutrients, "Total lipid (fat)"),
    )
    return NutritionLookup(
        name=str(food.get("description") or "USDA food"),
        brand=food.get("brandOwner"),
        barcode=food.get("gtinUpc"),
        serving_grams=serving,
        macros_per_serving=macros,
        external_id=str(fdc_id),
        provenance=Provenance(source=USDA_SOURCE, source_version=USDA_VERSION, confidence=0.95),
    )


def _nutrient_amount(nutrients: dict[str, Any], name: str) -> float:
    item = nutrients.get(name)
    if not item:
        return 0.0
    value = item.get("value")
    return float(value) if value is not None else 0.0
