# FITOS Integration & Architecture Requirements

This file is the working checklist for completing the FitOS app according to the architecture in [AGENTS.md](AGENTS.md).

## 1. Product architecture

FitOS is a backend-first fitness intelligence system. The UI is replaceable, but the canonical logic and persistence belong to the backend.

Core constraints from the architecture:

- FitOS owns domain models and business logic.
- Vendor SDKs live only under `backend/adapters/`.
- `apps/web` and `backend/domain` must not import vendor SDKs directly.
- Food/prediction records always include `source`, `source_version`, and `confidence`.
- FastAPI routes validate with Pydantic and call domain services only.
- PostgreSQL tables must enable RLS and policies must use `auth.uid()`.
- No Strava API; GPS is native (`navigator.geolocation`) or Apple Health / Health Connect / GPX / FIT import.

## 2. Required product domains

### 2.1 Strength & Workout Engine
Required features:

- live workout logging: exercises, sets, reps, weight, RPE
- exercise catalog by muscle group and equipment
- custom exercises
- routine builder: create, save, reuse
- volume and PR engine
- total volume tracking in kg or lb
- PR detection for 1RM, max weight, max reps
- muscle recovery map based on recent training load

Required backend pieces:

- `backend/domain/models/workout.py`
- `backend/domain/services/workout_service.py`
- `backend/repositories/workout_repository.py`
- `backend/repositories/supabase_workout.py`
- `database/migrations/*workout*` schema

Required API endpoints:

- workout create/update/delete
- routine create/save/list
- volume analytics
- PR history

### 2.2 Smart Nutrition & Food AI
Required features:

- photo, barcode, or text-based search
- barcode via Open Food Facts (no LLM)
- meal photo analysis via Claude 3.5 Sonnet
- portion estimation in grams
- calorie and macro extraction
- USDA FoodData Central fallback for verified nutrients
- persistence of predictions and `user_corrections`

Required backend pieces:

- `backend/adapters/claude/vision.py`
- `backend/adapters/open_food_facts/client.py`
- `backend/adapters/usda/client.py`
- `backend/domain/services/nutrition_service.py`
- `backend/domain/models/food.py`
- `backend/repositories/food_prediction_repository.py`
- `backend/repositories/supabase_food.py`

Required API endpoints:

- food scan
- barcode lookup
- nutrition prediction
- correction persistence

### 2.3 Native Cardio & GPS Engine
Required features:

- live run/ride/walk timer
- pace, speed, elevation, distance
- route polyline on a map
- HealthKit / Health Connect sync for steps, active energy, HR
- `.gpx` and `.fit` import into normalized activities
- native GPS only

Required backend pieces:

- `backend/domain/models/activity.py`
- `backend/domain/services/activity_service.py`
- `backend/repositories/activity_repository.py`
- `backend/repositories/supabase_activity.py`
- `database/migrations/*activity*` schema

Required frontend pieces:

- `apps/web/app/activity/page.tsx`
- browser `navigator.geolocation` flow
- map route rendering
- .gpx/.fit import handling

### 2.4 Social & Sharing
Required features:

- friends/public feed of workouts and activities
- reactions and comments
- leaderboards: weekly distance, volume, streaks
- 1-tap 9:16 share card via `navigator.share()`

Required backend pieces:

- `backend/domain/models/social.py`
- `backend/domain/services/social_service.py`
- `backend/repositories/social_repository.py`
- `backend/repositories/supabase_social.py`
- `database/migrations/004_social_identity.sql`

Required API routes:

- `/social/feed`
- followers/following ops
- likes/comments
- profile view

### 2.5 Health Intelligence & Recovery
Required features:

- daily readiness from sleep, active calories, RHR, training load
- body weight and measurements tracking
- progress photos with EXIF stripping
- privacy visibility (`private` | `friends` | `public`)
- deterministic recovery score and explanations

Required backend pieces:

- `backend/domain/models/recovery.py`
- `backend/domain/recovery/feature_engine.py`
- `backend/domain/recovery/recovery_engine.py`
- `backend/domain/recovery/coach.py`
- `backend/domain/services/recovery_pipeline.py`
- `backend/repositories/recovery_store.py`
- `backend/repositories/supabase_recovery.py`
- `database/migrations/006_recovery_intelligence.sql`

Required tables:

- `fitness_events`
- `canonical_daily_metrics`
- `daily_data_status`
- `daily_snapshots`
- `daily_fitness_features`
- `recovery_daily`
- `coach_context_snapshots`
- `coach_sessions`
- `coach_messages`
- `recommendation_feedback`
- `ml_feature_snapshots`

## 3. Required integrations

### 3.1 Supabase
You need a Supabase project with:

- Postgres database
- Row level security (RLS)
- auth tables
- storage bucket(s)
- Realtime for live dashboard updates
- database functions or queue support where needed
- service role key for backend access
- public anon key for frontend access if used

Required environment variables:

```env
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
ALLOW_DEVELOPMENT_IDENTITY=false
```

Required migrations to apply in order:

- `database/migrations/001_phase0_init.sql`
- `database/migrations/002_*` if present
- `database/migrations/003_data_engine.sql`
- `database/migrations/004_social_identity.sql`
- `database/migrations/005_messaging.sql`
- `database/migrations/006_recovery_intelligence.sql`

Required security requirements:

- use `auth.uid()` in all policies
- explicit owner-scoped access for user data
- never expose raw service-role credentials to the frontend
- keep private/friends/public visibility enforcement in the database layer

### 3.2 Anthropic Claude
Required for photo meal analysis.

Required environment variables:

```env
ANTHROPIC_API_KEY=
ANTHROPIC_VISION_MODEL=claude-3-5-sonnet-20241022
```

Required adapter boundary:

- `backend/adapters/claude/vision.py`
- not imported directly in app UI or domain logic

### 3.3 USDA FoodData Central
Required for trusted nutrient verification.

Required environment variables:

```env
USDA_FDC_API_KEY=
```

Required adapter boundary:

- `backend/adapters/usda/client.py`

### 3.4 Open Food Facts
Required for barcode lookup.

Required environment variables:

```env
OPEN_FOOD_FACTS_USER_AGENT=FitOS/0.1 (https://github.com/fitos)
```

Required adapter boundary:

- `backend/adapters/open_food_facts/client.py`

### 3.5 Health data sources
Required connectivity depending on target platform:

- Apple Health / HealthKit
- Android Health Connect
- native browser GPS
- .gpx / .fit import processing

Important restriction:

- No Strava API integration.

### 3.6 Frontend API config
Required frontend env for backend URL:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

The existing web app expects this in `apps/web/lib/api.ts`.

## 4. Required environment files

Backend example file:

- [backend/.env.example](backend/.env.example)

Create a real file:

- `backend/.env`

Frontend example file if needed:

- `apps/web/.env.local`

## 5. Required app wiring checklist

### Backend

- FastAPI app entry in `backend/api/main.py`
- dependency injection in `backend/api/deps.py`
- settings in `backend/api/settings.py`
- routes under `backend/api/routes/`
- domain services under `backend/domain/services/`
- adapters under `backend/adapters/`
- repositories under `backend/repositories/`
- schema migrations under `database/migrations/`

### Frontend

- app shell in `apps/web/app`
- navigation in `apps/web/components/shell/BottomNav.tsx`
- social screens in `apps/web/app/social/`
- recovery screen in `apps/web/app/recovery/page.tsx`
- activity screens in `apps/web/app/activity/page.tsx`
- workout, nutrition, profile screens in the corresponding app routes

## 6. Required API and route expectations

The backend should expose versioned routes under `/api/v1` and follow the architecture described in the app.

Examples already present:

- `backend/api/routes/social.py`
- `backend/api/routes/health.py`
- `backend/api/routes/workouts.py`
- `backend/api/routes/activities.py`
- `backend/api/routes/nutrition.py`
- `backend/api/routes/system.py`

Each route should:

- validate request models with Pydantic
- fetch user identity via auth middleware or developer fallback
- call domain services only
- return consistent error envelopes

## 7. Required data quality rules

- raw event persistence is mandatory
- feature aggregation must be derived from raw events
- recovery calculations must be reproducible
- `calculation_version` must be stored
- historical scores should be auditable
- missing values must remain `NULL` instead of silently becoming `0`
- confidence and completeness must be tracked

## 8. Required implementation order

1. Set up Supabase project and apply migrations.
2. Configure backend environment variables.
3. Fix the backend import graph and ensure service startup works.
4. Verify FastAPI health, readiness, and capability routes.
5. Complete workout domain and repository integration.
6. Complete nutrition provider and food model flow.
7. Complete activity and GPS ingestion flow.
8. Complete recovery pipeline and coach context generation.
9. Complete social feed, reactions, comments, and followers.
10. Wire frontend screens to real API data.
11. Add privacy, RLS, and moderation checks.
12. Add realtime dashboard updates.
13. Add production-grade job/queue processing.
14. Validate the end-to-end system with tests and smoke checks.

## 9. Required non-negotiable checks before launch

- backend tests pass
- web lint and TypeScript checks pass
- Supabase RLS policies exist and are correct
- provider keys are configured
- no direct vendor imports in frontend or domain
- `source`, `source_version`, and `confidence` are always present on persisted prediction records
- all privacy controls are enforced at database layer
- no Strava integration is used
- recovery and social features are backed by data, not hardcoded UI only

## 10. Required files to review

Core project files:

- [AGENTS.md](AGENTS.md)
- [README.md](README.md)
- [backend/README.md](backend/README.md)
- [backend/api/settings.py](backend/api/settings.py)
- [backend/api/deps.py](backend/api/deps.py)
- [backend/api/main.py](backend/api/main.py)
- [backend/domain/services/recovery_pipeline.py](backend/domain/services/recovery_pipeline.py)
- [database/migrations/006_recovery_intelligence.sql](database/migrations/006_recovery_intelligence.sql)
- [backend/.env.example](backend/.env.example)

## 11. Completion summary

To complete the app according to the FitOS architecture, you need the following final set of integrations and configs:

- Supabase project and migrations
- Anthropic key
- USDA key
- Open Food Facts configuration
- frontend API base URL
- auth + RLS policy enforcement
- recovery pipeline + scoring engine
- social system + feed + profile visibility
- nutrition AI + barcode + fallback data flow
- activity + GPS + import pipeline
- test and build validation

This document is the master checklist for reaching a complete FitOS integration.
