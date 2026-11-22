from io import BytesIO

import pytest
from PIL import Image

from domain.services.image_service import ImageProcessingError, ImageService
from jobs.memory import InMemoryJobQueue


def _jpeg_bytes() -> bytes:
    image = Image.new("RGB", (32, 24), color="white")
    output = BytesIO()
    image.save(output, format="JPEG")
    return output.getvalue()


def test_image_service_processes_safe_derivatives_and_strips_metadata() -> None:
    service = ImageService(InMemoryJobQueue())

    metadata, processed, thumbnail = service.process(_jpeg_bytes(), content_type="image/jpeg")

    assert metadata.width == 32
    assert metadata.height == 24
    assert metadata.content_type == "image/jpeg"
    assert processed.startswith(b"\xff\xd8")
    assert thumbnail.startswith(b"\xff\xd8")


def test_image_service_rejects_corrupt_images() -> None:
    service = ImageService(InMemoryJobQueue())

    with pytest.raises(ImageProcessingError, match="invalid_image"):
        service.process(b"not-an-image", content_type="image/jpeg")