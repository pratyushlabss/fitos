# Frontend Build Contract

The UI is a replaceable client of `/api/v1`. It must not implement FITOS business
calculations or infer provider availability from hard-coded assumptions.

## Home

- `GET /api/v1/dashboard`
- `GET /api/v1/system/capabilities`
- Send `Authorization: Bearer <token>`.
- Loading: render a neutral loading state.
- Errors: use the standard `error` envelope and preserve `request_id` for support.

## Workout

- `GET /api/v1/workouts`
- `POST /api/v1/workouts`
- `POST /api/v1/workouts/{id}/sets`
- `POST /api/v1/workouts/{id}/complete`
- `POST /api/v1/recommendations/progression`
- Recommendations are editable client proposals; the backend response includes a
  reason and confidence and is never an instruction to hide an override.

## Nutrition

- `GET /api/v1/nutrition/search`
- `GET /api/v1/nutrition/barcode/{barcode}`
- `POST /api/v1/food-scan/image` for multipart image ingestion.
- Food scan returns `202` with `scan_id`, `image_id`, `job_id`, and `status`.
- The client owns camera permissions and hardware; the backend owns validation,
  processing, inference jobs, provenance, and persistence.

## Activity

- `GET|POST /api/v1/activities`
- GPS points are supplied by the client and must be validated server-side.
- Native FITOS activity does not require Strava.

## Profile

Profile CRUD, goals, social graph, and health-sync endpoints are not yet part of
the implemented public contract. Clients must use the capability endpoint and
must not represent those features as available until their routes are added.
