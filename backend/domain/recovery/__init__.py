from domain.recovery.coach import build_coach_context, explain
from domain.recovery.feature_engine import build_features
from domain.recovery.recovery_engine import score_day
from domain.recovery.source_policy import source_priority

__all__ = [
    "build_features",
    "score_day",
    "build_coach_context",
    "explain",
    "source_priority",
]


def __getattr__(name: str):
    if name in {"RecoveryPipelineService", "DayFinalizedError"}:
        from domain.services.recovery_pipeline import DayFinalizedError, RecoveryPipelineService

        if name == "RecoveryPipelineService":
            return RecoveryPipelineService
        return DayFinalizedError
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
