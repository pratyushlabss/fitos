from pydantic import BaseModel, Field


class ProductResolution(BaseModel):
    status: str = Field(default="unknown")
    brand: str | None = None
    product: str | None = None
    variant: str | None = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    source: str = "barcode"
    reason: str | None = None
