from pydantic import BaseModel, Field


class ReadinessInputs(BaseModel):
    sleep_hours: float = Field(ge=0)
    active_calories: float = Field(ge=0)
    resting_heart_rate: float = Field(gt=0)
    training_load: float = Field(ge=0)


class ReadinessScore(BaseModel):
    score: int = Field(ge=0, le=100)
    sleep_component: float
    strain_component: float
    recovery_component: float


class ScoreService:
    """Deterministic daily readiness from sleep, strain, RHR proxy, and training load."""

    def score(self, inputs: ReadinessInputs) -> ReadinessScore:
        sleep_component = min(inputs.sleep_hours / 8.0, 1.2) * 40.0
        strain_component = max(0.0, 30.0 - (inputs.training_load / 500.0) * 15.0)
        rhr_component = max(0.0, 30.0 - max(0.0, inputs.resting_heart_rate - 50.0) * 0.6)
        total = sleep_component + strain_component + rhr_component
        bounded = max(0, min(100, round(total)))
        return ReadinessScore(
            score=bounded,
            sleep_component=sleep_component,
            strain_component=strain_component,
            recovery_component=rhr_component,
        )
