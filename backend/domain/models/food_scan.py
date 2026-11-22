from uuid import UUID

from pydantic import BaseModel


class FoodScanAccepted(BaseModel):
    scan_id: UUID
    image_id: UUID
    job_id: UUID
    status: str = "queued"


class ProcessedImage(BaseModel):
    image_id: UUID
    content_type: str
    width: int
    height: int
    original_bytes: int
    processed_bytes: int
    thumbnail_bytes: int
