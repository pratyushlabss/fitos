# FITOS Dependency Inventory

| Dependency | Purpose | Required | Failure behavior | Replacement |
|---|---|---:|---|---|
| FastAPI | REST API and OpenAPI | Yes | API cannot start | Starlette-compatible framework |
| Pydantic | Request/domain validation | Yes | Invalid payload rejected | Pydantic-compatible validation |
| httpx | Async provider HTTP | Yes | Provider error is isolated | Any async HTTP client behind adapters |
| Supabase Python client | Initial PostgreSQL/auth/storage integration | Optional | Native fallback or 503 for persistence-dependent operations | SQLAlchemy/PostgreSQL, R2/S3, another auth provider |
| AI provider REST API (Gemini or Anthropic) | Meal text/photo analysis and coach | Optional | Search, barcode and manual logging remain available | Switch `AI_PROVIDER` |
| Open Food Facts API | Barcode lookup | Optional | Product lookup returns not found | Manual food entry |
| Supabase gte-small (Edge Runtime) | Food embeddings for retrieval | Yes for semantic search | Trigram search still works | Any 384-dim embedding model |
| PostgreSQL | Canonical database | Yes in production | API cannot persist data | PostgreSQL-compatible managed service |
| Redis or equivalent | Future durable job queue/cache | Future | In-memory development queue only | Redis, managed queue, worker platform |
| Object storage | Food images, media, ML artifacts | Future | Upload/inference job fails safely | Supabase Storage, R2, S3 |

Versions are constrained in `backend/pyproject.toml`. Provider URLs, credentials,
rate limits, and data retention rules belong in `docs/INTEGRATIONS.md` and must be
verified against official documentation before enabling production adapters.
