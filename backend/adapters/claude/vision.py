from __future__ import annotations

import base64
from typing import Any

import anthropic

from domain.models.common import Provenance
from domain.models.food import FoodItemPrediction, Macronutrients, NormalizedFoodPrediction

MEAL_TOOL_NAME = "submit_meal_identification"

MEAL_TOOL: dict[str, Any] = {
    "name": MEAL_TOOL_NAME,
    "description": (
        "Submit the identified foods, estimated edible portion in grams, and macros "
        "for a meal photograph. Use this tool instead of describing the meal in prose."
    ),
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["overall_confidence", "items"],
        "properties": {
            "overall_confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "Confidence in the full meal parse.",
            },
            "notes": {"type": ["string", "null"]},
            "items": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "name",
                        "portion_grams",
                        "calories",
                        "protein_g",
                        "carbs_g",
                        "fat_g",
                        "confidence",
                    ],
                    "properties": {
                        "name": {"type": "string"},
                        "brand": {"type": ["string", "null"]},
                        "portion_grams": {"type": "number", "exclusiveMinimum": 0},
                        "calories": {"type": "number", "minimum": 0},
                        "protein_g": {"type": "number", "minimum": 0},
                        "carbs_g": {"type": "number", "minimum": 0},
                        "fat_g": {"type": "number", "minimum": 0},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    },
                },
            },
        },
    },
}

SYSTEM_PROMPT = (
    "You are FitOS meal vision. Identify distinct edible foods in the photo, estimate "
    "edible portion mass in grams, and estimate calories and macros for those portions. "
    "Do not invent branded barcodes. Always call submit_meal_identification."
)


class ClaudeVisionAdapter:
    """VisionProvider implementation. Domain code must depend on VisionProvider, not this class."""

    def __init__(self, client: anthropic.AsyncAnthropic, model: str) -> None:
        self._client = client
        self._model = model

    async def identify_meal(
        self,
        *,
        image_bytes: bytes,
        mime_type: str,
        locale: str | None = None,
    ) -> NormalizedFoodPrediction:
        if mime_type not in {"image/jpeg", "image/png", "image/gif", "image/webp"}:
            raise ValueError("unsupported_image_mime")

        locale_hint = f" User locale: {locale}." if locale else ""
        encoded = base64.standard_b64encode(image_bytes).decode("ascii")

        response = await self._client.messages.create(
            model=self._model,
            max_tokens=1024,
            system=SYSTEM_PROMPT + locale_hint,
            tools=[MEAL_TOOL],
            tool_choice={"type": "tool", "name": MEAL_TOOL_NAME},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime_type,
                                "data": encoded,
                            },
                        },
                        {
                            "type": "text",
                            "text": "Identify every distinct food and estimate portions and macros.",
                        },
                    ],
                }
            ],
        )

        tool_payload = _first_tool_input(response.content)
        return _to_prediction(tool_payload, self._model)


def _first_tool_input(content: list[Any]) -> dict[str, Any]:
    for block in content:
        block_type = getattr(block, "type", None)
        name = getattr(block, "name", None)
        if block_type == "tool_use" and name == MEAL_TOOL_NAME:
            payload = getattr(block, "input", {})
            if isinstance(payload, dict):
                return payload
        if isinstance(block, dict) and block.get("type") == "tool_use":
            if block.get("name") == MEAL_TOOL_NAME and isinstance(block.get("input"), dict):
                return block["input"]
    raise ValueError("claude_did_not_call_meal_tool")


def _to_prediction(payload: dict[str, Any], model: str) -> NormalizedFoodPrediction:
    items: list[FoodItemPrediction] = []
    for raw in payload["items"]:
        confidence = float(raw["confidence"])
        items.append(
            FoodItemPrediction(
                name=str(raw["name"]),
                portion_grams=float(raw["portion_grams"]),
                brand=raw.get("brand"),
                macros=Macronutrients(
                    calories=float(raw["calories"]),
                    protein_g=float(raw["protein_g"]),
                    carbs_g=float(raw["carbs_g"]),
                    fat_g=float(raw["fat_g"]),
                ),
                provenance=Provenance(
                    source="claude_vision",
                    source_version=model,
                    confidence=confidence,
                ),
            )
        )
    overall = float(payload["overall_confidence"])
    return NormalizedFoodPrediction(
        items=items,
        overall_confidence=overall,
        notes=payload.get("notes"),
        provenance=Provenance(
            source="claude_vision",
            source_version=model,
            confidence=overall,
        ),
    )
