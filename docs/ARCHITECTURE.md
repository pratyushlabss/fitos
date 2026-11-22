# FITOS Backend Architecture

FITOS is a backend-owned product. Web, iOS, Android, and desktop clients are replaceable consumers of the versioned REST/OpenAPI contract.

```text
Client UI
  -> /api/v1 REST/OpenAPI
  -> FastAPI routes and DTO validation
  -> domain services and deterministic engines
  -> repositories and provider ports
  -> PostgreSQL / object storage / jobs
  -> replaceable adapters (USDA, Open Food Facts, AI, Apple Health, Health Connect)
```

## Ownership boundaries

- `api/` validates requests, applies authentication dependencies, maps domain errors, and returns DTOs.
- `domain/` owns FITOS models and business rules. It must not import vendor SDKs.
- `repositories/` owns persistence interfaces and implementations.
- `providers/` contains replaceable capability protocols.
- `adapters/` contains vendor-specific HTTP or SDK code only.
- `jobs/` owns asynchronous work contracts. The in-memory queue is development-only.
- `domain/services/image_service.py` validates uploads, decodes images, removes EXIF
  by re-encoding JPEG derivatives, and queues food inference without blocking HTTP.
- `database/migrations/` is the canonical PostgreSQL schema history.

## Runtime rules

- AI and ML are optional enhancements. Manual logging, barcode lookup, database search, workout logging, GPS activity, and analytics must remain available when providers fail.
- Long-running inference, OCR, image processing, sync, and analytics belong in jobs rather than request handlers.
- Every prediction and nutrition record carries provenance: source, source version, confidence, and basis where applicable.
- User ownership is checked at the API/service/repository boundary and enforced again with PostgreSQL RLS.
- Recovery and daily scores are estimates. Their inputs and algorithm version are persisted with the output.

## Current implementation status

Implemented foundation: versioned routes, request IDs, standard error envelope, workout/nutrition/activity services, provider protocols, product resolution, progression recommendations, idempotent local job queue, RLS migrations, and contract tests.

Still required for production: real access-token verification, SQLAlchemy/Alembic migration execution, durable queue worker, object storage implementation, complete CRUD APIs, external health adapters, social modules, and load/security/integration test suites.
