# FITOS Backend Status

Updated: 2026-09-23

## Implemented

- FastAPI app with versioned `/api/v1` routes and OpenAPI.
- Request IDs and standard error responses.
- Supabase bearer-token authentication seam; `X-User-Id` is disabled by default.
- Workout, activity, nutrition lookup, product resolution, dashboard, score, and progression services.
- Provider protocols for auth, storage, and jobs.
- Development idempotent job queue.
- Camera-side backend ingestion at `POST /api/v1/food-scan/image` with multipart validation, Pillow decoding, JPEG derivative generation, EXIF removal through re-encoding, and queued inference metadata.
- Protected messaging API with profile search, direct conversation creation, participant-scoped message reads, and participant-scoped sends.
- Capability, liveness, readiness, audit, and smoke-test surfaces.
- PostgreSQL migrations for core data, data-engine tables, and social identity/graph tables with RLS policies.

## Partial

- Supabase persistence exists for workouts, activities, and food predictions but requires configured credentials.
- Food photo inference is provider-backed through Anthropic; it is not a local detector/classifier/segmenter.
- Product lookup has Open Food Facts and USDA adapter seams but no durable product catalog CRUD yet.
- Jobs are idempotent in development memory only; a durable worker/Redis implementation is still required.
- Social schema and RLS exist, but social CRUD/feed APIs are not implemented.
- Messaging requires configured Supabase persistence; the client UI remains usable as a local interaction when it is unavailable.
- Recovery and daily-score services exist in domain code; persisted aggregation APIs are not complete.

## Missing

- Registration, login, refresh, logout, password reset, and email verification routes.
- Durable storage provider and private signed URLs.
- Barcode image decoding, nutrition-label OCR, voice parsing, recipe/meal CRUD.
- HealthKit and Health Connect ingestion endpoints and deduplication pipeline.
- Complete GPS point/pause/resume/finish API.
- Followers/following/feed/messaging/notifications APIs.
- Data export and account deletion workflows.
- Alembic/SQLAlchemy migration execution and database integration tests.
- Model registry, dataset pipeline, local ML inference, and deployment/rollback.

## Verified files and commands

- API contract: `docs/API_CONTRACT.md`
- Architecture: `docs/ARCHITECTURE.md`
- Audit: `scripts/audit_backend.py`
- Smoke test: `scripts/smoke_test.py`
- Tests: `backend/tests/`
- `backend/.venv/bin/python -m pytest -q` currently passes.
- Live system smoke test currently passes when Uvicorn is running.

The backend is not production-complete until the partial and missing sections
have real persistence, authorization, endpoint, error, integration, and test
coverage.
