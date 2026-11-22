from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID, uuid4


@dataclass
class Job:
    id: UUID
    name: str
    payload: dict[str, object]
    idempotency_key: str
    status: str = "queued"
    attempts: int = 0
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


class InMemoryJobQueue:
    """Local development queue; production can replace it with Redis or a worker service."""

    def __init__(self) -> None:
        self.jobs: dict[UUID, Job] = {}
        self._by_key: dict[str, UUID] = {}

    async def enqueue(
        self, name: str, payload: dict[str, object], *, idempotency_key: str
    ) -> UUID:
        existing = self._by_key.get(idempotency_key)
        if existing is not None:
            return existing
        job = Job(uuid4(), name, payload, idempotency_key)
        self.jobs[job.id] = job
        self._by_key[idempotency_key] = job.id
        return job.id
