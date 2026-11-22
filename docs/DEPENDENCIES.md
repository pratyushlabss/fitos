# FITOS Dependency Inventory

| Dependency | Purpose | Required | Failure behavior | Replacement |
|---|---|---:|---|---|
| FastAPI | REST API and OpenAPI | Yes | API cannot start | Starlette-compatible framework |
| Pydantic | Request/domain validation | Yes | Invalid payload rejected | Pydantic-compatible validation |
| httpx | Async provider HTTP | Yes | Provider error is isolated | Any async HTTP client behind adapters |
| Supabase Python client | Initial PostgreSQL/auth/storage integration | Optional | Native fallback or 503 for persistence-dependent operations | SQLAlchemy/PostgreSQL, R2/S3, another auth provider |
| Anthropic SDK | Optional meal photo vision | Optional | Manual/barcode/search flows remain available | Local model or another AIProvider |
| Open Food Facts API | Packaged product/nutrition fallback | Optional | Product lookup returns not found | USDA, curated FITOS data, manual entry |
| USDA FoodData Central | Nutrition lookup fallback | Optional | Provider failure is isolated | IFCT, curated FITOS data |
| PostgreSQL | Canonical database | Yes in production | API cannot persist data | PostgreSQL-compatible managed service |
| Redis or equivalent | Future durable job queue/cache | Future | In-memory development queue only | Redis, managed queue, worker platform |
| Object storage | Food images, media, ML artifacts | Future | Upload/inference job fails safely | Supabase Storage, R2, S3 |

Versions are constrained in `backend/pyproject.toml`. Provider URLs, credentials,
rate limits, and data retention rules belong in `docs/INTEGRATIONS.md` and must be
verified against official documentation before enabling production adapters.
