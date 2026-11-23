# FitOS — Agent Source of Truth

Follow `.cursorrules` for architecture. This file is the functional specification.

## Architecture (non-negotiable)

- FitOS owns domain models and business logic.
- `apps/web` is a static export hosted on Cloudflare Pages. It talks to Supabase directly with the anon key; RLS is the security boundary.
- `apps/web` may import `@supabase/supabase-js`, and only from `apps/web/lib/supabase.ts` and `apps/web/lib/data/`. No other vendor SDK in `apps/web`.
- AI is called only from Supabase Edge Functions through `supabase/functions/_shared/ai.ts`: one provider (Gemini or Anthropic), one key (`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`), plain REST.
- Supabase is the single source of food data. Open Food Facts (no key) is used only for barcode lookup.
- The service_role key never appears in `apps/web`.
- Food/prediction records always include `source`, `source_version`, and `confidence`.
- PostgreSQL tables enable RLS; policies use `auth.uid()`.
- `backend/` is legacy reference code and is not deployed. See `backend/README_LEGACY.md`.
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
- Text and meal photos via the single configured AI provider → dishes, portions (g), raw-ingredient breakdown, macros.
- Nutrients come from the FitOS food database (IFCT raw ingredients, saved dishes, user foods); retrieval (pgvector + trigram) runs before any AI call.
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
