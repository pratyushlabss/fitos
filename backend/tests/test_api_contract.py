from fastapi.testclient import TestClient

from api.main import app


def test_versioned_health_contract_returns_request_id() -> None:
    client = TestClient(app)

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "fitos"}
    assert response.headers["x-request-id"]


def test_versioned_authenticated_route_has_standard_error_contract() -> None:
    client = TestClient(app)

    response = client.get("/api/v1/workouts")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "MISSING_USER"
    assert response.json()["error"]["request_id"]


def test_client_supplied_identity_header_is_rejected_by_default() -> None:
    client = TestClient(app)

    response = client.get(
        "/api/v1/workouts",
        headers={"X-User-Id": "00000000-0000-0000-0000-000000000001"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "MISSING_USER"


def test_capabilities_report_truthful_optional_provider_flags() -> None:
    client = TestClient(app)

    response = client.get("/api/v1/system/capabilities")

    assert response.status_code == 200
    body = response.json()
    assert body["features"]["product_recognition"] is True
    assert body["features"]["nutrition_label_ocr"] is False
    assert body["features"]["strava"] is False
    assert body["ml"]["food_segmentation"] is False


def test_food_scan_requires_authentication() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/v1/food-scan/image",
        files={"image": ("food.jpg", b"not-an-image", "image/jpeg")},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "MISSING_USER"


def test_barcode_lookup_rejects_invalid_checksum_before_provider_call() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/barcode/lookup", json={"barcode": "4006381333932"}
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_BARCODE_CHECKSUM"


def test_messaging_user_search_requires_authentication() -> None:
    client = TestClient(app)

    response = client.get("/api/v1/messaging/users/search?query=maya")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "MISSING_USER"


def test_social_feed_requires_authentication() -> None:
    client = TestClient(app)

    response = client.get("/api/v1/social/feed")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "MISSING_USER"