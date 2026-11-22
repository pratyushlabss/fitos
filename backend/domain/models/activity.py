from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field

from domain.models.common import Visibility, new_id, utcnow


class ActivitySport(StrEnum):
    RUN = "run"
    RIDE = "ride"
    WALK = "walk"
    HIKE = "hike"
    OTHER = "other"


class ActivitySource(StrEnum):
    NATIVE_GPS = "native_gps"
    APPLE_HEALTH = "apple_health"
    HEALTH_CONNECT = "health_connect"
    GPX = "gpx"
    FIT = "fit"


class GeoPoint(BaseModel):
    lat: float
    lng: float
    elevation_m: float | None = None
    recorded_at: datetime | None = None


class Activity(BaseModel):
    id: UUID = Field(default_factory=new_id)
    user_id: UUID
    sport: ActivitySport
    source: ActivitySource
    started_at: datetime = Field(default_factory=utcnow)
    ended_at: datetime | None = None
    duration_s: int = Field(default=0, ge=0)
    distance_m: float = Field(default=0, ge=0)
    elevation_gain_m: float = Field(default=0, ge=0)
    avg_pace_s_per_km: float | None = None
    polyline: list[GeoPoint] = Field(default_factory=list)
    visibility: Visibility = Visibility.PRIVATE
    title: str | None = None


class ActivityCreate(BaseModel):
    sport: ActivitySport
    source: ActivitySource
    started_at: datetime
    ended_at: datetime | None = None
    duration_s: int = Field(ge=0)
    distance_m: float = Field(ge=0)
    elevation_gain_m: float = Field(default=0, ge=0)
    polyline: list[GeoPoint] = Field(default_factory=list)
    visibility: Visibility = Visibility.PRIVATE
    title: str | None = None
