from domain.models.progression import ProgressionInput
from domain.services.barcode_service import BarcodeError, normalize_barcode
from domain.services.product_service import ProductResolverService
from domain.services.progression_service import ProgressionService
from domain.services.recommendation_service import RecommendationService
from jobs.memory import InMemoryJobQueue


def test_product_resolver_never_fabricates_barcode_matches() -> None:
    outcome = ProductResolverService().resolve(
        barcode="8901234567890",
        images=[],
        ocr_text=None,
        user_description=None,
    )

    assert outcome.status == "unknown"
    assert outcome.brand is None
    assert outcome.confidence == 0


def test_barcode_normalization_validates_checksum() -> None:
    barcode, barcode_type = normalize_barcode(" 4006381333931 ")

    assert barcode == "4006381333931"
    assert barcode_type.value == "ean"


def test_barcode_normalization_rejects_invalid_checksum() -> None:
    try:
        normalize_barcode("4006381333932")
    except BarcodeError as error:
        assert str(error) == "invalid_barcode_checksum"
    else:
        raise AssertionError("invalid barcode was accepted")


def test_recommendation_service_returns_explainable_plan() -> None:
    plan = RecommendationService().recommend_for_today(["Bench Press", "Pull-up"])

    assert len(plan) >= 1
    assert "reason" in plan[0]
    assert isinstance(plan[0]["target"], str)


def test_progression_service_is_deterministic_and_recovery_aware() -> None:
    payload = ProgressionInput(
        exercise="Bench Press",
        previous_weight_kg=70,
        previous_reps=8,
        previous_rpe=7.5,
        recovery_score=42,
    )

    result = ProgressionService().recommend(payload)

    assert result.recommended_weight_kg == 70
    assert result.recommended_sets == 2
    assert "Recovery" in result.reason


async def test_memory_job_queue_is_idempotent() -> None:
    queue = InMemoryJobQueue()

    first = await queue.enqueue("food_inference", {"prediction_id": "one"}, idempotency_key="scan-one")
    second = await queue.enqueue("food_inference", {"prediction_id": "one"}, idempotency_key="scan-one")

    assert first == second
    assert len(queue.jobs) == 1
