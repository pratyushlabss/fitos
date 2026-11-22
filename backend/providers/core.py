from typing import Protocol
from uuid import UUID


class AuthProvider(Protocol):
    async def verify_access_token(self, token: str) -> UUID: ...


class StorageProvider(Protocol):
    async def create_upload_url(self, *, user_id: UUID, path: str, content_type: str) -> str: ...

    async def create_download_url(self, *, user_id: UUID, path: str) -> str: ...


class JobQueueProvider(Protocol):
    async def enqueue(self, name: str, payload: dict[str, object], *, idempotency_key: str) -> UUID: ...
