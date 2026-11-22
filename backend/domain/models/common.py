from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class Visibility(StrEnum):
    PRIVATE = "private"
    FRIENDS = "friends"
    PUBLIC = "public"


class Provenance(BaseModel):
    source: str
    source_version: str
    confidence: float = Field(ge=0.0, le=1.0)


def new_id() -> UUID:
    return uuid4()


def utcnow() -> datetime:
    return datetime.utcnow()
