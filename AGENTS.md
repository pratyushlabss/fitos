# FitOS — Agent Source of Truth

Follow `.cursorrules` for architecture. This file is the functional specification.

## Architecture (non-negotiable)

- FitOS owns domain models and business logic.
- Vendor SDKs (Anthropic, Open Food Facts HTTP, USDA, HealthKit, Health Connect) live only in `backend/adapters/`.
- `apps/web` and `backend/domain` never import vendor SDKs.
- Food/prediction records always include `source`, `source_version`, and `confidence`.
- FastAPI routes validate with Pydantic and call domain services only.
- PostgreSQL tables enable RLS; policies use `auth.uid()`.
- No Strava API. GPS is native (`navigator.geolocation`), Apple Health, Health Connect, or GPX/FIT import.

## Feature specification

### 1. Strength & Workout Engine
- Live logger: exercises, sets, reps, weight, RPE.
- Exercise catalog by muscle group and equipment; custom exercises.
- Routine builder: create, save, reuse.
- Volume & PR engine: total volume (kg/lbs); flag PRs (1RM, max weight, max reps).
- Muscle recovery map from recent training load.

### 2. Smart Nutrition & Food AI
- Photo, barcode, or text search.
- Barcode via Open Food Facts (no LLM).
- Meal photos via Claude 3.5 Sonnet → foods, portions (g), calories, macros.
- USDA FoodData Central fallback for verified nutrients.
- Persist predictions and `user_corrections` for future local models.

### 3. Native Cardio & GPS Engine
- Live run/ride/walk: timer, pace, speed, elevation, distance.
- Native GPS only (no Strava).
- Route polyline on a map.
- HealthKit / Health Connect sync (steps, active energy, HR).
- Import `.gpx` and `.fit` into normalized activities.

### 4. Social & Sharing
- Friends/public feed of workouts and activities.
- Kudos (reactions) and comments.
- Leaderboards: weekly distance, volume, streaks.
- 1-tap 9:16 Canvas/SVG share card via `navigator.share()`.

### 5. Health Intelligence
- Daily readiness from sleep, active calories, RHR, training load.
- Body weight, measurements, progress photos (strip EXIF).
- Visibility: `private` | `friends` | `public`, enforced in RLS.

## Phases in this repo

- **Phase 0**: monorepo, interfaces, RLS schema, web shell.
- **Phase 1**: Claude vision adapter, nutrition providers, workout/activity repositories.
