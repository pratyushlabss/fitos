from pydantic import BaseModel, Field


class DashboardSummary(BaseModel):
    date: str
    greeting: str
    daily_score: int = Field(ge=0, le=100)
    readiness_score: int = Field(ge=0, le=100)
    workout_title: str
    workout_volume_kg: float = Field(ge=0)
    total_calories: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
    today_steps: int = Field(ge=0)
    active_calories: int = Field(ge=0)
    sleep_hours: float = Field(ge=0)
    training_load: float = Field(ge=0)
    recovery_label: str
    recent_meals: list[dict[str, object]] = Field(default_factory=list)
    recent_workouts: list[dict[str, object]] = Field(default_factory=list)
    recent_activity: list[dict[str, object]] = Field(default_factory=list)
