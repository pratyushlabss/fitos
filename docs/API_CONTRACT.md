# FitOS API Contract

The backend is the product boundary. Any web, iOS, Android, or desktop client
should use the versioned REST API under `/api/v1` and must not depend on database
models or provider SDKs.

## Authentication

Protected endpoints require `Authorization: Bearer <Supabase access token>`.
The server verifies the token and derives the user ID from the verified subject;
clients cannot choose an identity. `X-User-Id` is accepted only when the
server-only `ALLOW_DEVELOPMENT_IDENTITY=true` setting is explicitly enabled for
local tests. It is disabled by default and must never be enabled in production.

## Error envelope

All validation and HTTP errors use:

```json
{
  "error": {
    "code": "MISSING_USER",
    "message": "Missing user.",
    "request_id": "uuid",
    "details": {}
  }
}
```

## Current versioned resources

- `GET /api/v1/health`
- `GET /api/v1/dashboard`
- `GET|POST /api/v1/workouts`
- `GET /api/v1/workouts/{workout_id}`
- `POST /api/v1/workouts/{workout_id}/sets`
- `POST /api/v1/workouts/{workout_id}/complete`
- `GET /api/v1/nutrition/search`
- `GET /api/v1/nutrition/barcode/{barcode}`
- `POST /api/v1/nutrition/meals/photo`
- `GET /api/v1/activities`
- `POST /api/v1/activities`
- `GET /api/v1/recommendations`
- `POST /api/v1/products/resolve`
- `POST /api/v1/products/barcode/lookup` (verified provider lookup; returns `404` when not found)
- `POST /api/v1/barcode/lookup` (verified provider lookup; returns `404` when not found)
- `GET /api/v1/messaging/users/search?query=maya` (authenticated profile discovery)
- `GET /api/v1/messaging/conversations`
- `POST /api/v1/messaging/conversations`
- `GET /api/v1/messaging/conversations/{conversation_id}/messages`
- `POST /api/v1/messaging/conversations/{conversation_id}/messages`
- `GET /api/v1/social/feed?cursor=...&limit=20`
- `GET /api/v1/social/discover`
- `GET /api/v1/social/users/search?query=maya`
- `GET /api/v1/social/users/{user_id}`
- `POST|DELETE /api/v1/social/users/{user_id}/follow`
- `POST /api/v1/social/posts/workout`
- `POST|DELETE /api/v1/social/posts/{post_id}/like`
- `GET|POST /api/v1/social/posts/{post_id}/comments`
- `POST /api/v1/food-scan/image` (multipart upload; returns `202` and a queued job)

The unversioned paths remain compatibility aliases for the existing prototype
client and are not the long-term contract.