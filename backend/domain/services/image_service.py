from io import BytesIO
from uuid import UUID, uuid4

from PIL import Image, UnidentifiedImageError

from domain.models.food_scan import FoodScanAccepted, ProcessedImage
from jobs.memory import InMemoryJobQueue

MAX_IMAGE_BYTES = 10 * 1024 * 1024
SUPPORTED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}


class ImageProcessingError(ValueError):
    pass


class ImageService:
    def __init__(self, jobs: InMemoryJobQueue) -> None:
        self._jobs = jobs

    def process(self, payload: bytes, *, content_type: str) -> tuple[ProcessedImage, bytes, bytes]:
        if not payload:
            raise ImageProcessingError("empty_image")
        if len(payload) > MAX_IMAGE_BYTES:
            raise ImageProcessingError("image_too_large")
        if content_type not in SUPPORTED_MIME_TYPES:
            raise ImageProcessingError("unsupported_image_mime")

        try:
            with Image.open(BytesIO(payload)) as image:
                image.verify()
            with Image.open(BytesIO(payload)) as image:
                rgb = image.convert("RGB")
                width, height = rgb.size
                processed = BytesIO()
                rgb.save(processed, format="JPEG", quality=88, optimize=True)
                thumbnail = rgb.copy()
                thumbnail.thumbnail((512, 512))
                thumbnail_buffer = BytesIO()
                thumbnail.save(thumbnail_buffer, format="JPEG", quality=82, optimize=True)
        except (OSError, UnidentifiedImageError) as exc:
            raise ImageProcessingError("invalid_image") from exc

        image_id = uuid4()
        metadata = ProcessedImage(
            image_id=image_id,
            content_type="image/jpeg",
            width=width,
            height=height,
            original_bytes=len(payload),
            processed_bytes=len(processed.getvalue()),
            thumbnail_bytes=len(thumbnail_buffer.getvalue()),
        )
        return metadata, processed.getvalue(), thumbnail_buffer.getvalue()

    async def enqueue_scan(
        self,
        user_id: UUID,
        *,
        image: bytes,
        content_type: str,
        idempotency_key: str,
    ) -> FoodScanAccepted:
        metadata, processed, thumbnail = self.process(image, content_type=content_type)
        scan_id = uuid4()
        job_id = await self._jobs.enqueue(
            "food_inference",
            {
                "scan_id": str(scan_id),
                "image_id": str(metadata.image_id),
                "user_id": str(user_id),
                "processed_image_bytes": len(processed),
                "thumbnail_bytes": len(thumbnail),
                "content_type": metadata.content_type,
            },
            idempotency_key=idempotency_key,
        )
        return FoodScanAccepted(scan_id=scan_id, image_id=metadata.image_id, job_id=job_id)
