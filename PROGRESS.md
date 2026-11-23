# Progress Log

## Phase 1 — Analyse (2026-11-22)

**Changed**
- Ran `git init` and created branch `cloudflare-migration`. There are no commits yet, because git has no user name or email configured.
- Added `ANALYSIS.md`: stack, runtime behaviour, Vercel dependencies, Supabase usage, Cloudflare and iOS risks.
- Added `FEATURES.md`: every screen and action, with status and files.
- Added this file.

**Not changed**
- No existing file was edited.
- Ran `npm run build:web` once to record the baseline. It passed. It only rewrote ignored build output.

**Why**
- Phase 1 is read-only analysis. The git branch was a ground rule before touching anything.

**Waiting on**
- Backend hosting decision, profile route change and git baseline. See the end of `ANALYSIS.md`.

## Phase 1 follow-up (2026-11-22)

- The baseline commit the user mentioned was not in the repo, and git had no identity configured. I set a repo-local identity (name `pratyush`, the macOS account name, and the account email) and made the baseline commit `126eaf8`. Change it with `git config user.name` and `git commit --amend --reset-author` if needed.
- Added `.ruff_cache/` to `.git/info/exclude` before the baseline so cache files stayed out of it.

## Phase 2 — Static export + Cloudflare (2026-11-22)

**Changed**
- `apps/web/next.config.js`: `output: "export"`, `trailingSlash: true`, `images.unoptimized: true`.
- `apps/web/app/social/profile/[userId]/page.tsx` moved to `apps/web/app/social/profile/page.tsx`. It is now a client component that reads `?id=` with `useSearchParams` inside `Suspense`. The Next.js 15 style `params: Promise` typing is gone.
- `apps/web/app/social/page.tsx`: the four profile links now use `/social/profile?id=`.
- `apps/web/app/manifest.ts`: `dynamic = "force-static"` so it exports.
- `apps/web/lib/api.ts`: deleted. Nothing imported it.
- `package.json`: `deploy` script, and `wrangler` added as a dev dependency so the script works without a global install.
- `.gitignore`: `.env.production`, `.env*.production`, `.wrangler/`, Supabase CLI temp folders, `.ruff_cache/`.
- `AGENTS.md`: the web app may import `@supabase/supabase-js` from `lib/supabase.ts` and `lib/data/` only. Secret-bearing vendor calls live in Edge Functions. The backend is marked legacy.
- `README.md`: layout and run steps now describe the new setup.

**Added**
- `apps/web/app/not-found.tsx`, `apps/web/public/_headers`, `apps/web/.env.example`, `backend/README_LEGACY.md`, `DEPLOY.md`.

**Why**
- Cloudflare Pages serves static files. Every route now prerenders, so no server is needed.

**Build**
- `npm run build:web` passes. All 11 routes are static and the output is `apps/web/out`.
- `npx wrangler pages deploy --help` runs. The actual deploy needs `wrangler login`, which only you can do.

## Phase 3 — Supabase data layer and auth (2026-11-22)

**Added**
- `apps/web/lib/supabase.ts`: the only Supabase client. It reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` and persists and refreshes the session.
- `apps/web/lib/data/`: typed modules for auth, profile, exercises and routines, workouts, activities, nutrition, body, recovery, social, messaging and storage. Query logic is ported from `backend/repositories/*`.
- `apps/web/lib/logic/`: TypeScript ports of the recovery engine and coach, progression, and dashboard maths. Also workout volume and PR detection, GPS maths and GPX parsing, units and formatting.
- `apps/web/lib/image.ts`: client-side compression to at most 1280 px and about 300 KB. It uses WebP, or JPEG where iOS cannot encode WebP. Re-encoding strips EXIF.
- `@fitos/types`: Profile, Meal, Routine, FeedPost, Conversation and other new types.
- Auth: `components/auth/AuthProvider.tsx` and `AuthGate.tsx`, plus `app/login` (6-digit email code, no magic link) and `app/onboarding`.
- React Query provider and toast in `components/providers/Providers.tsx`.
- UI states: skeleton, empty, error with retry, `QueryView`, bottom sheet, fields, avatar, macro ring, pull-to-refresh, share-card button.
- New pages: workout session, detail, history, exercise progress and routine, plus activity detail.

**Changed**
- Rebuilt by design, because they were demo screens: `app/page.tsx`, `app/workout/page.tsx`, `app/nutrition/page.tsx`, `app/activity/page.tsx`, `app/recovery/page.tsx`.
- Targeted edits: `app/layout.tsx` now wraps the app in Providers. `components/shell/AppShell.tsx` adds AuthGate. `components/shell/BottomNav.tsx` hides when signed out. `components/ui/Button.tsx` gains disabled styling. `app/profile/page.tsx` gains sign-out.
- Deleted `apps/web/lib/demoData.ts`.

**Decisions**
- Routines and suggestions start a workout with planned sets that are not yet ticked. Finishing removes unticked sets.
- The first time you log an exercise, its bests are stored as a baseline, not announced as a PR. A new `is_baseline` column marks these rows.
- Recovery uses your calorie and protein targets instead of the fixed 2200 kcal and 160 g in the Python engine. Training load comes from today's volume divided by 50, as in the Python feature engine.
- Activity calories are an estimate based on distance and type.
- The in-memory job queue is gone. Edge functions answer synchronously.

**Build**
- `npm run build:web` passes. All 21 routes are static.

## Phase 4 — Security, storage and Edge Functions (2026-11-22)

**Added**
- `database/migrations/007_rls_hardening.sql`:
  - Enables RLS on all 12 tables from 002. Reference tables are read-only to signed-in users. User tables allow CRUD on your own rows only, with child rows checked through their parent.
  - Rewrites the visibility policies through one helper. A post, workout or activity is visible to its owner. Otherwise it is visible if public on a public profile, or public or followers-only while you are an accepted follower. Nothing is ever visible across a block.
  - Comments, reactions and saves now require a post you can see.
  - Follows can no longer be self-accepted on private profiles.
  - Fixes two messaging bugs. One unqualified column let any member of any conversation read every message. One self-referencing policy caused an infinite-recursion error.
  - Adds the profile-creation trigger on `auth.users` with a backfill, and the `search_profiles(q)` RPC with an escaped ILIKE parameter, limit 20 and block exclusion.
  - Adds the `avatars`, `post-media` and `progress-photos` buckets with per-folder policies, the Realtime publication for messages, posts, comments and reactions, and revokes all table access from `anon`.
- `database/migrations/008_app_features.sql`:
  - New columns: profile goals and targets, `workouts.routine_id`, `personal_records.is_baseline`, provenance on `meal_items`.
  - New tables: `progress_photos`, `recovery_checkins`, `food_scan_usage`, `post_saves`.
  - RPCs: feed, profile card, weekly leaderboard, streak, notifications, follow and respond, conversations and unread counts, food-scan rate limit.
  - Indexes, and a 58-exercise global catalog.
- `database/tests/`: a stand-in for Supabase's `auth` and `storage` plus 68 RLS checks, run as four users. All pass on local Postgres 15.
- `supabase/`: created with `supabase init`. `supabase/migrations` is a symlink to `database/migrations`. A dry run and a real `db push` against a throwaway local database both applied all 8 migrations.
- `supabase/functions/food-scan`:
  - Verifies the JWT and enforces 20 scans per user per day, with a refund on failure.
  - Calls Claude through the official SDK, using the same prompt and fields as the Python adapter, and saves to `food_predictions` as the user.
  - Uses `claude-opus-5-5`, which you can override with the `ANTHROPIC_MODEL` secret. The retired 3.5 Sonnet ID is gone.
  - Forced tool calls are rejected by current models, so the output schema is enforced with structured outputs.
  - The server-side refusal fallback (`fallbacks: "default"`) is on.
- `supabase/functions/food-search`: USDA plus Open Food Facts. Open Food Facts moved search to `search.openfoodfacts.org`, and the legacy endpoint returned 503, so the legacy one is now a fallback. Both sources were smoke-tested live.
- `supabase/functions/barcode`: Open Food Facts, then USDA, cached into `products` and `product_nutrition`.
- `supabase/functions/_shared`: CORS for `fitos.pages.dev`, its preview subdomains and localhost, plus JWT auth and the nutrition adapters.
- Root dev dependency `supabase`, so `npx supabase` works.

**Changed**
- `docs/SUPABASE_SETUP.md`: migrations 005 to 008 and the test harness.
- `apps/web/lib/data/social.ts`: accepting a follow request goes through the RPC, because clients have no UPDATE on follows.
- `supabase/config.toml`: local auth URLs.

**Verified**
- `deno check` passes for all three functions.
- `npm run build:web` passes.
- Nothing was run against your live database.

**Decisions**
- Custom exercises are user-writable, scoped to the owner, because AGENTS.md requires them. Every other reference table is read-only.
- Leaderboards and other people's streaks count only workouts shared beyond "only me". Stats are hidden on private profiles you do not follow.
- Messaging a private profile needs a follow in either direction.
- Images are stored at `{user_id}/{uuid}.webp`, or `.jpg` where iOS cannot encode WebP. Meal-scan photos are not stored at all.

## Phase 5 — iPhone PWA, UX polish and remaining features (2026-11-23)

**PWA**
- `scripts/generate-icons.mjs` uses sharp to render `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` and `apple-touch-icon.png` from `public/icon.svg`.
- `app/manifest.ts` is now the only manifest, with a maskable icon. `public/manifest.json` and its link in `app/layout.tsx` are gone.
- `app/layout.tsx`: `viewportFit: "cover"`, no `maximumScale`, apple-touch-icon set.
- `app/globals.css`: `touch-action: manipulation`, 16px inputs on iOS so zoom stays enabled for accessibility, no overscroll bounce, `100dvh`.
- `components/shell/AppShell.tsx`: safe-area padding on top, sides and bottom. The page now scrolls the window, which makes tap-the-status-bar-to-top work and enables pull-to-refresh.
- `public/sw.js` is hand-written: precached shell, cache-first `/_next/static`, network-first pages with an offline fallback, and no interception of Supabase or any other origin. `components/shell/PwaSupport.tsx` registers it in production and shows the iOS install hint.

**Navigation**
- `components/shell/BottomNav.tsx` was replaced by design: 5 tabs, Activity and Recovery highlight Home, Chat highlights Social, and an unread-message badge.

**New or rebuilt screens**
- Social feed, saved posts, leaderboard, discover, notifications, composer and post page.
- Athlete profile, chat inbox and thread.
- Profile, profile edit and body data.
- Supporting components are in `components/social/`. Export is in `lib/data/export.ts`.

**Checks**
- `npm run build:web` passes. All 25 routes are static.
- The exported HTML contains the manifest link, apple-touch-icon and `viewport-fit=cover`.
- A JSX scan found no `<button>` or `<Button>` without a handler.
