from typing import Any

from fastapi import APIRouter

from api.deps import container
from api.settings import settings

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/capabilities")
async def capabilities() -> dict[str, Any]:
    """Return runtime capability flags without exposing secrets or provider credentials."""
    return {
        "backend": {
            "status": "healthy" if container.nutrition is not None else "starting",
            "version": "0.1.0",
        },
        "features": {
            "workouts": container.workouts is not None,
            "nutrition": container.nutrition is not None,
            "camera_ingestion": True,
            "food_scan": bool(settings.anthropic_api_key),
            "barcode": container.nutrition is not None,
            "product_recognition": True,
            "nutrition_label_ocr": False,
            "voice_food_logging": False,
            "gps_activity": container.activities is not None,
            "social": False,
            "followers": False,
            "apple_health": False,
            "health_connect": False,
            "strava": False,
            "hevy": False,
        },
        "ml": {
            "food_classifier": False,
            "food_detector": False,
            "food_segmentation": False,
            "portion_estimation": False,
            "product_recognition": True,
            "ocr": False,
        },
        "providers": {
            "gemini": False,
            "usda": bool(settings.usda_fdc_api_key),
            "open_food_facts": True,
            "ifct": False,
        },
    }


@router.get("/live")
async def liveness() -> dict[str, str]:
    return {"status": "ok", "service": "fitos"}


@router.get("/ready")
async def readiness() -> dict[str, Any]:
    configured = bool(settings.supabase_url and settings.supabase_service_role_key)
    return {
        "status": "ok" if configured else "degraded",
        "checks": {
            "application": "ok",
            "database": "configured" if configured else "not_configured",
        },
    }