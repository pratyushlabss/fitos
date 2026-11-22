from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import UUID

import anthropic
import httpx
from fastapi import Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client, create_client

from adapters.claude.vision import ClaudeVisionAdapter
from adapters.open_food_facts.client import OpenFoodFactsAdapter
from adapters.supabase.auth import SupabaseAuthProvider
from adapters.usda.client import UsdaFoodDataAdapter
from api.settings import settings
from domain.services.activity_service import ActivityService
from domain.services.dashboard_service import DashboardService
from domain.services.image_service import ImageService
from domain.services.messaging_service import MessagingService
from domain.services.nutrition_service import NutritionService
from domain.services.progression_service import ProgressionService
from domain.services.recommendation_service import RecommendationService
from domain.services.score_service import ScoreService
from domain.services.social_service import SocialService
from domain.services.workout_service import WorkoutService
from jobs.memory import InMemoryJobQueue
from repositories.supabase_activity import SupabaseActivityRepository
from repositories.supabase_food import SupabaseFoodPredictionRepository
from repositories.supabase_messaging import SupabaseMessagingRepository
from repositories.supabase_social import SupabaseSocialRepository
from repositories.supabase_workout import SupabaseWorkoutRepository


class AppContainer:
    def __init__(self) -> None:
        self.http = httpx.AsyncClient()
        self.anthropic: anthropic.AsyncAnthropic | None = None
        self.supabase: Client | None = None
        self.auth: SupabaseAuthProvider | None = None
        self.nutrition: NutritionService | None = None
        self.workouts: WorkoutService | None = None
        self.activities: ActivityService | None = None
        self.dashboard: DashboardService | None = None
        self.recommendations: RecommendationService | None = None
        self.progression = ProgressionService()
        self.scores = ScoreService()
        self.images = ImageService(InMemoryJobQueue())
        self.messaging: MessagingService | None = None
        self.social: SocialService | None = None

    def wire(self) -> None:
        if settings.anthropic_api_key:
            self.anthropic = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        if settings.supabase_url and settings.supabase_service_role_key:
            self.supabase = create_client(
                settings.supabase_url, settings.supabase_service_role_key
            )
            self.auth = SupabaseAuthProvider(self.supabase)

        vision = ClaudeVisionAdapter(
            self.anthropic or anthropic.AsyncAnthropic(api_key="missing"),
            settings.anthropic_vision_model,
        )
        barcode = OpenFoodFactsAdapter(self.http, settings.open_food_facts_user_agent)
        usda = UsdaFoodDataAdapter(self.http, settings.usda_fdc_api_key)

        if self.supabase is not None:
            foods = SupabaseFoodPredictionRepository(self.supabase)
            self.workouts = WorkoutService(SupabaseWorkoutRepository(self.supabase))
            self.activities = ActivityService(SupabaseActivityRepository(self.supabase))
            self.messaging = MessagingService(SupabaseMessagingRepository(self.supabase))
            self.social = SocialService(SupabaseSocialRepository(self.supabase))
        else:
            foods = _UnavailableFoodRepo()
            self.workouts = None
            self.activities = None

        self.nutrition = NutritionService(vision, barcode, usda, foods)
        self.dashboard = DashboardService()
        self.recommendations = RecommendationService()


class _UnavailableFoodRepo:
    async def save_prediction(self, user_id: UUID, prediction, image_storage_path: str | None):
        raise HTTPException(status_code=503, detail="supabase_not_configured")

    async def save_correction(self, user_id: UUID, prediction_id: UUID, corrected):
        raise HTTPException(status_code=503, detail="supabase_not_configured")


container = AppContainer()


@asynccontextmanager
async def lifespan(_app) -> AsyncIterator[None]:
    container.wire()
    yield
    await container.http.aclose()


def get_nutrition() -> NutritionService:
    if container.nutrition is None:
        raise HTTPException(status_code=503, detail="nutrition_unavailable")
    return container.nutrition


def get_workouts() -> WorkoutService:
    if container.workouts is None:
        raise HTTPException(status_code=503, detail="supabase_not_configured")
    return container.workouts


def get_activities() -> ActivityService:
    if container.activities is None:
        raise HTTPException(status_code=503, detail="supabase_not_configured")
    return container.activities


def get_scores() -> ScoreService:
    return container.scores


def get_dashboard() -> DashboardService:
    if container.dashboard is None:
        raise HTTPException(status_code=503, detail="dashboard_unavailable")
    return container.dashboard


def get_recommendations() -> RecommendationService:
    if container.recommendations is None:
        raise HTTPException(status_code=503, detail="recommendations_unavailable")
    return container.recommendations


def get_progression() -> ProgressionService:
    return container.progression


def get_images() -> ImageService:
    return container.images


def get_messaging() -> MessagingService:
    if container.messaging is None:
        raise HTTPException(status_code=503, detail="messaging_not_configured")
    return container.messaging


def get_social() -> SocialService:
    if container.social is None:
        raise HTTPException(status_code=503, detail="social_not_configured")
    return container.social


bearer_scheme = HTTPBearer(auto_error=False)


async def get_user_id(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    x_user_id: Annotated[str | None, Header()] = None,
) -> UUID:
    """Resolve identity from a verified Supabase JWT.

    The header fallback is explicitly opt-in for local development only.
    """
    if credentials is not None:
        if credentials.scheme.lower() != "bearer" or container.auth is None:
            raise HTTPException(status_code=401, detail="invalid_access_token")
        try:
            return await container.auth.verify_access_token(credentials.credentials)
        except ValueError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc

    if not settings.allow_development_identity or x_user_id is None:
        raise HTTPException(status_code=401, detail="missing_user")
    try:
        return UUID(x_user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid_user_id") from exc
