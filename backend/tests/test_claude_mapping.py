from adapters.claude.vision import _to_prediction


def test_tool_payload_maps_to_normalized_prediction() -> None:
    prediction = _to_prediction(
        {
            "overall_confidence": 0.81,
            "notes": "bowl",
            "items": [
                {
                    "name": "rice",
                    "portion_grams": 180,
                    "calories": 234,
                    "protein_g": 4.8,
                    "carbs_g": 52,
                    "fat_g": 0.4,
                    "confidence": 0.9,
                }
            ],
        },
        "claude-3-5-sonnet-20241022",
    )
    assert prediction.provenance.source == "claude_vision"
    assert prediction.provenance.source_version == "claude-3-5-sonnet-20241022"
    assert prediction.items[0].macros.calories == 234
    assert prediction.overall_confidence == 0.81
