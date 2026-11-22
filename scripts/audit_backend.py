"""Static and runtime audit for the currently implemented FITOS backend surface."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))


def check(label: str, passed: bool, detail: str) -> bool:
    status = "PASS" if passed else "PARTIAL"
    print(f"{label:<20} {status:<7} {detail}")
    return passed


def main() -> int:
    from api.main import app

    print("FITOS BACKEND AUDIT")
    print("=" * 72)
    checks = [
        check("FOUNDATION", (BACKEND / "api/main.py").exists(), "FastAPI entrypoint exists"),
        check("VERSIONING", "/api/v1/system/capabilities" in app.openapi()["paths"], "Versioned OpenAPI routes"),
        check("OPENAPI", bool(app.openapi().get("paths")), "OpenAPI contains paths"),
        check("CONFIG", (BACKEND / ".env.example").exists(), "Environment template exists"),
        check("DATABASE", (ROOT / "database/migrations/003_data_engine.sql").exists(), "Data-engine migration exists"),
        check("WORKOUT", "/api/v1/workouts" in app.openapi()["paths"], "Workout API route exists"),
        check("NUTRITION", "/api/v1/nutrition/search" in app.openapi()["paths"], "Nutrition API route exists"),
        check("PRODUCT", "/api/v1/products/resolve" in app.openapi()["paths"], "Product resolver route exists"),
        check("ACTIVITY", "/api/v1/activities" in app.openapi()["paths"], "Activity API route exists"),
        check("HEALTH", "/api/v1/health" in app.openapi()["paths"], "Health API route exists"),
        check("JOBS", (BACKEND / "jobs/memory.py").exists(), "Development idempotent queue exists"),
        check("DOCUMENTATION", (ROOT / "docs/API_CONTRACT.md").exists(), "API contract exists"),
        check("TESTING", len(list((BACKEND / "tests").glob("test_*.py"))) >= 4, "Backend tests exist"),
        check("SECURITY", (ROOT / "database/migrations/001_phase0_init.sql").read_text().count("ROW LEVEL SECURITY") > 0, "RLS policies are present"),
    ]
    print("=" * 72)
    print(f"Overall: {sum(checks)} / {len(checks)} checks passed")
    print("Critical blockers: production Supabase credentials, durable jobs, and database migration execution are not verified locally.")
    return 0 if all(checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())