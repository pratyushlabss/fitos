from pydantic import BaseModel, Field


class ProgressionInput(BaseModel):
    exercise: str = Field(min_length=1, max_length=120)
    previous_weight_kg: float = Field(ge=0)
    previous_reps: int = Field(ge=0)
    previous_rpe: float | None = Field(default=None, ge=1, le=10)
    target_reps: int = Field(default=8, ge=1, le=100)
    recovery_score: int | None = Field(default=None, ge=0, le=100)
    goal: str = Field(default="hypertrophy", min_length=1, max_length=40)


class ProgressionRecommendation(BaseModel):
    exercise: str
    recommended_weight_kg: float
    recommended_reps: int
    recommended_sets: int
    reason: str
    confidence: float = Field(ge=0, le=1)
