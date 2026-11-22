from typing import Any

import httpx

from domain.models.common import Provenance
from domain.models.food import Macronutrients, NutritionLookup

OFF_SOURCE = "open_food_facts"
OFF_VERSION = "v2"


class OpenFoodFactsAdapter:
    source_name = OFF_SOURCE
    source_version = OFF_VERSION

    def __init__(self, http: httpx.AsyncClient, user_agent: str) -> None:
        self._http = http
        self._user_agent = user_agent

    async def lookup_barcode(self, barcode: str) -> NutritionLookup | None:
        url = f"https://world.openfoodfacts.org/api/v2/product/{barcode}.json"
        response = await self._http.get(
            url,
            headers={"User-Agent": self._user_agent},
            timeout=15.0,
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        body: dict[str, Any] = response.json()
        if body.get("status") != 1 or not isinstance(body.get("product"), dict):
            return None
        return _from_product(body["product"], barcode)

    async def search_foods(self, query: str, limit: int = 20) -> list[NutritionLookup]:
        response = await self._http.get(
            "https://world.openfoodfacts.org/cgi/search.pl",
            params={
                "search_terms": query,
                "search_simple": 1,
                "action": "process",
                "json": 1,
                "page_size": min(limit, 50),
            },
            headers={"User-Agent": self._user_agent},
            timeout=15.0,
        )
        response.raise_for_status()
        body: dict[str, Any] = response.json()
        products: list[dict[str, Any]] = body.get("products") or []
        results: list[NutritionLookup] = []
        for product in products:
            code = str(product.get("code") or "")
            parsed = _from_product(product, code or "unknown")
            if parsed is not None:
                results.append(parsed)
        return results

    async def get_by_external_id(self, external_id: str) -> NutritionLookup | None:
        return await self.lookup_barcode(external_id)


def _from_product(product: dict[str, Any], barcode: str) -> NutritionLookup | None:
    nutriments = product.get("nutriments") or {}
    serving = _serving_grams(product)
    if serving is None:
        return None
    macros = Macronutrients(
        calories=_kcal(nutriments, serving),
        protein_g=_scaled(nutriments, "proteins", serving),
        carbs_g=_scaled(nutriments, "carbohydrates", serving),
        fat_g=_scaled(nutriments, "fat", serving),
    )
    name = str(product.get("product_name") or product.get("generic_name") or "Unknown food")
    brand = product.get("brands")
    return NutritionLookup(
        name=name,
        brand=str(brand) if brand else None,
        barcode=barcode if barcode != "unknown" else None,
        serving_grams=serving,
        macros_per_serving=macros,
        external_id=barcode,
        provenance=Provenance(
            source=OFF_SOURCE,
            source_version=OFF_VERSION,
            confidence=0.9 if nutriments else 0.4,
        ),
    )


def _serving_grams(product: dict[str, Any]) -> float | None:
    quantity = product.get("serving_quantity")
    unit = str(product.get("serving_quantity_unit") or "g").lower()
    if quantity is not None:
        try:
            grams = float(quantity)
        except (TypeError, ValueError):
            grams = None
        else:
            if unit in {"g", "gram", "grams"} and grams > 0:
                return grams
            if unit in {"ml"} and grams > 0:
                return grams
    return 100.0


def _scaled(nutriments: dict[str, Any], key: str, serving_grams: float) -> float:
    per_100 = nutriments.get(f"{key}_100g")
    if per_100 is None:
        return 0.0
    return float(per_100) * (serving_grams / 100.0)


def _kcal(nutriments: dict[str, Any], serving_grams: float) -> float:
    per_100 = nutriments.get("energy-kcal_100g")
    if per_100 is None:
        kj = nutriments.get("energy-kj_100g")
        if kj is None:
            return 0.0
        per_100 = float(kj) / 4.184
    return float(per_100) * (serving_grams / 100.0)
