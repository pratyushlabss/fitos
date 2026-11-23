# FitOS Features

Status as of 2026-11-22, before any migration work.

- **Working:** does what the screen implies, end to end.
- **Partial:** the UI exists but shows demo data or keeps changes only in memory, or the backend exists but nothing calls it.
- **Broken:** a button or link that does nothing, errors, or leads to a missing page.

No screen is connected to the backend or to Supabase, and there is no sign-in. Everything resets on reload.

## App shell

| Feature | Status | Files | Notes |
|---|---|---|---|
| Bottom navigation, 7 tabs | Working | `components/shell/BottomNav.tsx`, `components/shell/AppShell.tsx` | Tight on iPhone width |
| Web app manifest | Broken | `app/manifest.ts`, `public/manifest.json`, `app/layout.tsx` | Two manifests. One points to missing PNG icons, the other has only an SVG icon. |
| Sign in / sign up | Not built | none | No auth anywhere in the web app |

## Home (`app/page.tsx`)

| Feature | Status | Files | Notes |
|---|---|---|---|
| Fitness score, readiness, sleep, load | Partial | `app/page.tsx` | Hard-coded numbers |
| Protein and steps cards | Partial | `app/page.tsx`, `components/ui/StatCard.tsx` | Hard-coded |
| "View recovery", "Open workout", "Open nutrition" links | Working | `app/page.tsx`, `components/ui/ActionCard.tsx` | |
| "Workout posted" card, Share button | Broken | `app/page.tsx`, `components/ui/Button.tsx` | Button has no handler |

## Workout (`app/workout/page.tsx`)

| Feature | Status | Files | Notes |
|---|---|---|---|
| Today's workout and target set | Partial | `app/workout/page.tsx` | Hard-coded |
| Adaptive recommendations list | Partial | `app/workout/page.tsx`, `lib/demoData.ts`; backend `domain/services/recommendation_service.py` | Demo data. The backend endpoint also returns a fixed list. |
| Edit recommendation | Broken | `app/workout/page.tsx` | No handler |
| Start session, Add exercise, Replace, Skip | Broken | `app/workout/page.tsx` | No handlers |
| Start workout, log sets, finish, total volume (API) | Partial | `backend/api/routes/workouts.py`, `backend/domain/services/workout_service.py`, `backend/repositories/supabase_workout.py` | Works against Supabase, but no screen calls it |
| Progression suggestion (API) | Partial | `backend/api/routes/recommendations.py`, `backend/domain/services/progression_service.py` | Not called by the UI |

## Nutrition (`app/nutrition/page.tsx`)

| Feature | Status | Files | Notes |
|---|---|---|---|
| Macro balance cards | Partial | `app/nutrition/page.tsx` | Hard-coded |
| Meals list | Partial | `app/nutrition/page.tsx`, `lib/demoData.ts` | Demo data |
| Add food, Scan food, Barcode, Voice, Search, Recipe buttons | Broken | `app/nutrition/page.tsx` | No handlers |
| Meal photo recognition (API) | Broken | `backend/api/routes/nutrition.py`, `backend/adapters/claude/vision.py`, `backend/api/settings.py` | Default model `claude-3-5-sonnet-20241022` is retired |
| Food-scan image upload and EXIF strip (API) | Partial | `backend/api/routes/food_scan.py`, `backend/domain/services/image_service.py` | Queues in memory only, nothing processes the job |
| Barcode lookup via Open Food Facts (API) | Partial | `backend/api/routes/nutrition.py`, `backend/api/routes/barcode.py`, `backend/adapters/open_food_facts/client.py` | Not called by the UI |
| Food search via USDA (API) | Partial | `backend/api/routes/nutrition.py`, `backend/adapters/usda/client.py` | Needs a USDA key. Not called by the UI. |
| Save predictions and user corrections | Partial | `backend/repositories/supabase_food.py` | Repository exists, no route saves corrections |

## Activity (`app/activity/page.tsx`)

| Feature | Status | Files | Notes |
|---|---|---|---|
| Run, Ride, Walk buttons | Broken | `app/activity/page.tsx` | No handlers, no GPS code |
| Route preview | Partial | `app/activity/page.tsx` | Static gradient, no map |
| Activity Share button | Broken | `app/activity/page.tsx` | No handler |
| Weekly stats and recent activity | Partial | `app/activity/page.tsx`, `lib/demoData.ts` | Demo data |
| Record and list activities (API) | Partial | `backend/api/routes/activities.py`, `backend/domain/services/activity_service.py`, `backend/repositories/supabase_activity.py` | Accepts a polyline. Not called by the UI. |

## Social (`app/social/page.tsx`)

| Feature | Status | Files | Notes |
|---|---|---|---|
| Find athletes search | Partial | `app/social/page.tsx` | Filters two hard-coded athletes |
| Follow / Following toggle | Partial | `app/social/page.tsx` | Memory only |
| Like toggle and count | Partial | `app/social/page.tsx` | Memory only |
| Comment button | Broken | `app/social/page.tsx` | No handler |
| Post Share button | Broken | `app/social/page.tsx` | No handler |
| Bookmark (save workout) | Broken | `app/social/page.tsx` | No handler |
| Notifications bell | Broken | `app/social/page.tsx` | No handler |
| "See all" discover link | Broken | `app/social/page.tsx` | Links to `#discover`, which does not exist |
| "View full workout" post link | Broken | `app/social/page.tsx` | Goes to `/social/post/[id]`, which does not exist (404) |
| Feed, discover, search, follow, like, comment (API) | Partial | `backend/api/routes/social.py`, `backend/domain/services/social_service.py`, `backend/repositories/supabase_social.py` | Not called by the UI. Feed ignores post visibility. |

## Athlete profile (`app/social/profile/page.tsx`, opened as `/social/profile?id=`)

| Feature | Status | Files | Notes |
|---|---|---|---|
| Profile header, counts, stats, recent workouts | Partial | `app/social/profile/page.tsx` | Hard-coded. Any unknown ID shows "Jordan Patel". |
| Follow and Message buttons | Broken | `app/social/profile/page.tsx` | No handlers |
| Overview / Workouts / Activity / Compare tabs | Broken | `app/social/profile/page.tsx` | Plain text, not clickable |

## Messages (`app/chat/page.tsx`)

| Feature | Status | Files | Notes |
|---|---|---|---|
| Contact list and switching | Partial | `app/chat/page.tsx` | Hard-coded contacts |
| Add contact by name | Partial | `app/chat/page.tsx` | Creates a fake local contact |
| Send message | Partial | `app/chat/page.tsx` | Memory only. Every contact shares one message list. |
| Conversations and messages (API) | Partial | `backend/api/routes/messaging.py`, `backend/repositories/supabase_messaging.py` | Not called by the UI |

## Recovery (`app/recovery/page.tsx`)

| Feature | Status | Files | Notes |
|---|---|---|---|
| Manual check-in sliders and readiness calculation | Working | `app/recovery/page.tsx` | Calculated in the browser |
| Seven-day readiness chart | Partial | `app/recovery/page.tsx` | Six past days are hard-coded |
| Recovery coach text | Working | `app/recovery/page.tsx` | Two fixed messages by score |
| Save check-in | Broken | `app/recovery/page.tsx` | No handler |
| Recovery pipeline, feature engine, coach (backend) | Partial | `backend/domain/recovery/`, `backend/domain/services/recovery_pipeline.py`, `backend/repositories/supabase_recovery.py` | No API route exposes it |

## Profile (`app/profile/page.tsx`)

| Feature | Status | Files | Notes |
|---|---|---|---|
| Name, handle, follower counts | Partial | `app/profile/page.tsx` | Hard-coded "Alex Morgan" |
| Change profile photo | Partial | `app/profile/page.tsx` | Preview only, not uploaded or saved |
| Share profile and Copy link | Partial | `app/profile/page.tsx` | Work, but share a placeholder `fitos.app` URL |
| QR button | Broken | `app/profile/page.tsx` | No handler |
| Open messages | Working | `app/profile/page.tsx` | Full page reload via `window.location` |
| Goals, privacy and sync display | Partial | `app/profile/page.tsx` | Hard-coded text, including "Apple Health: connected" |
| Goals, Integrations, Body data, Export buttons | Broken | `app/profile/page.tsx` | No handlers |

## Helpers not used by any screen

| Feature | Status | Files |
|---|---|---|
| 9:16 share card canvas and `navigator.share` | Partial | `lib/shareCard.ts` |
| Backend API client | Removed | `lib/api.ts` deleted in Phase 2 because nothing called it |
| Dashboard summary (API) | Partial | `backend/api/routes/dashboard.py`, `backend/domain/services/dashboard_service.py` (returns fixed numbers) |

## In the spec but not built

These come from `AGENTS.md`. Only tables or models exist for them, or nothing at all.

- Exercise catalog and custom exercises (table `exercises` only)
- Routine builder (tables `routines`, `routine_exercises` only)
- PR detection for 1RM, max weight and max reps (table `personal_records` only)
- Muscle recovery map
- Live GPS tracking and route map
- GPX and FIT import (enum values only)
- Apple Health and Health Connect sync
- Leaderboards for distance, volume and streaks
- Body weight, measurements and progress photos (table `body_measurements` only)
- Storage buckets for any images

## Status changes in Phase 3 (data layer and auth)

These rows supersede the tables above until the final rewrite after Phase 5. "Working" here assumes migrations 007 and 008 are applied (Phase 4).

| Feature | Status | Files |
|---|---|---|
| Email code sign-in, verify, onboarding, sign-out | Working | `app/login/page.tsx`, `app/onboarding/page.tsx`, `components/auth/*`, `lib/data/auth.ts`, `app/profile/page.tsx` |
| Home dashboard: recovery, streak, calories, macros, last workout, friend activity | Working | `app/page.tsx` |
| Workout suggestions with Edit, Replace and Skip | Working | `app/workout/page.tsx`, `lib/logic/progression.ts` |
| Start session, empty workout, start from routine | Working | `app/workout/page.tsx`, `lib/data/workouts.ts` |
| Live logger: sets, weight, reps, RPE, warm-ups, rest timer, finish, discard | Working | `app/workout/session/page.tsx` |
| Automatic PR detection on finish | Working | `lib/logic/workout.ts`, `lib/data/workouts.ts` |
| Workout history and detail ("View full workout") | Working | `app/workout/history/page.tsx`, `app/workout/detail/page.tsx` |
| Per-exercise progress chart | Working | `app/workout/exercise/page.tsx` |
| Routines: create, edit, reorder, delete, start | Working | `app/workout/routine/page.tsx`, `lib/data/exercises.ts` |
| Nutrition daily log by meal, macro rings, day navigation | Working | `app/nutrition/page.tsx` |
| Add food, Search, Barcode, Voice, Recent, Scan food | Working | `components/nutrition/*` (Search, Barcode and Scan need the Phase 4 edge functions) |
| Live GPS run, ride, walk with pause, resume, finish | Working | `app/activity/page.tsx`, `components/activity/useGpsTracker.ts` |
| GPX import and activity detail with route | Working | `app/activity/page.tsx`, `app/activity/detail/page.tsx` |
| Share card for workouts and activities | Working | `components/ui/ShareCardButton.tsx`, `lib/shareCard.ts` |
| Recovery check-in, score, seven-day chart, coach | Working | `app/recovery/page.tsx`, `lib/logic/recovery.ts` |
| `lib/demoData.ts` | Removed | Nothing uses it |

## Status changes in Phase 4

| Feature | Status | Files |
|---|---|---|
| Meal photo scan with editable result and saved corrections | Working once deployed | `supabase/functions/food-scan`, `components/nutrition/FoodSheets.tsx` |
| Food search: USDA and Open Food Facts | Working once deployed | `supabase/functions/food-search` |
| Barcode lookup with cache | Working once deployed | `supabase/functions/barcode`, `components/nutrition/BarcodeScanner.tsx` |
| RLS on every table, private storage, Realtime | Working once applied | `database/migrations/007_rls_hardening.sql`, `008_app_features.sql` |

## Final status after Phase 5 (2026-11-23)

This table supersedes every table above. "Working" assumes the manual setup in `DEPLOY.md` is done: env file, migrations 007 and 008, Edge Functions and secrets.

| Area | Feature | Status | Main files |
|---|---|---|---|
| Shell | 5-tab nav: Home, Workout, Nutrition, Social, Profile, with an unread badge | Working | `components/shell/BottomNav.tsx` |
| Shell | Activity, Recovery and Messages reachable from Home cards and Profile › More | Working | `app/page.tsx`, `app/profile/page.tsx` |
| PWA | One manifest, PNG and maskable icons, apple-touch-icon, `viewport-fit=cover`, safe areas, `100dvh` | Working | `app/manifest.ts`, `app/layout.tsx`, `components/shell/AppShell.tsx`, `app/globals.css` |
| PWA | Service worker: cached app shell, cache-first static assets, never touches Supabase | Working, production builds only | `public/sw.js`, `components/shell/PwaSupport.tsx` |
| PWA | iOS "Add to Home Screen" hint, dismissible and remembered | Working | `components/shell/PwaSupport.tsx` |
| PWA | Double-tap zoom off on controls, no input zoom on iOS, no rubber-band bounce | Working | `app/globals.css` |
| Auth | Email 6-digit code sign-in, onboarding, sign-out, session kept in standalone mode | Working | `app/login`, `app/onboarding`, `components/auth/*` |
| Home | Recovery score, streak badge, calories, macros, today's or last workout, friend activity, share card | Working | `app/page.tsx` |
| Workout | Suggestions with Edit, Replace and Skip; start session or empty workout | Working | `app/workout/page.tsx` |
| Workout | Live logger: exercises from the catalog or custom, weight, reps, RPE, warm-ups, rest timer | Working | `app/workout/session/page.tsx`, `components/workout/ExercisePicker.tsx` |
| Workout | Automatic PR detection, history, "View full workout" page, per-exercise chart | Working | `lib/logic/workout.ts`, `app/workout/detail`, `app/workout/history`, `app/workout/exercise` |
| Workout | Routines: create, edit, reorder, delete, start | Working | `app/workout/routine/page.tsx` |
| Workout | Muscle recovery map | Not built | It was in AGENTS.md but not in this round's list |
| Nutrition | Daily log by meal, macro rings against goals, day navigation, edit and delete items | Working | `app/nutrition/page.tsx` |
| Nutrition | Manual add, Search, Barcode camera scan, Voice, Recent, Photo scan with editable result | Working | `components/nutrition/*`, `supabase/functions/*` |
| Nutrition | Voice input | Partial | Needs Safari speech recognition. Some iOS versions block it in installed web apps, and the sheet says so. |
| Activity | Live GPS run, ride and walk: pause, resume, pace, speed, climb, route, crash recovery | Working | `app/activity/page.tsx`, `components/activity/*` |
| Activity | GPS while the app is in the background | Not possible | iOS pauses web GPS in the background. The screen is kept awake with a wake lock while recording. |
| Activity | GPX import; FIT import | GPX Working; FIT not built | `lib/logic/geo.ts` |
| Activity | Apple Health and Health Connect sync | Not possible | Only native apps can read them. The Integrations sheet explains this. |
| Recovery | Daily check-in, ported scoring engine, seven-day chart, coach advice | Working | `app/recovery/page.tsx`, `lib/logic/recovery.ts` |
| Body | Weight and measurement log, trend chart, private progress photos | Working | `app/profile/body/page.tsx` |
| Social | Feed of workout, activity, text and photo posts; likes and saves with optimistic updates; realtime new-post banner | Working | `app/social/page.tsx`, `components/social/*` |
| Social | Post page with realtime comments; delete own posts and comments | Working | `app/social/post/page.tsx` |
| Social | Search, Discover, follow and unfollow, follow requests, block and unblock | Working | `app/social/page.tsx`, `app/social/profile/page.tsx` |
| Social | Profile pages: stats, Overview, Workouts, Activity and Compare tabs | Working | `app/social/profile/page.tsx` |
| Social | Weekly leaderboard: volume, workouts, streak | Working | `weekly_leaderboard()` in 008 |
| Social | Notifications: likes, comments, follows and requests | Working, updates every minute, no push | `get_notifications()` in 008 |
| Messaging | 1:1 conversations, realtime messages, unread counts | Working | `app/chat/page.tsx`, `app/chat/thread/page.tsx` |
| Profile | Avatar upload, share, link, QR, edit profile, goals, targets and privacy, JSON export, sign-out | Working | `app/profile/page.tsx`, `app/profile/edit/page.tsx`, `lib/data/export.ts` |
| Security | RLS on every table, private storage folders, `anon` cannot read tables | Working, 68 checks pass locally | `database/migrations/007`, `database/tests/` |
| Dead buttons | Every button and link from the Phase 1 audit | Fixed | Every `<button>` and `<Button>` in the app has a handler |
