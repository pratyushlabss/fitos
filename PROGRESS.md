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

## Live database setup (2026-11-23)

- `apps/web/.env.production` and `.env.local` now hold the project URL and publishable key. Both are gitignored. The URL is the base `https://lnspwuepxdlhgvcdwrte.supabase.co`, without `/rest/v1/`.
- The direct database host is IPv6-only and refused connections from this Mac, so migrations go through the session pooler at `aws-1-ap-southeast-2.pooler.supabase.com:5432` (Sydney), user `postgres.lnspwuepxdlhgvcdwrte`.
- `supabase db push` applied all 8 migrations to the live project.
- All 68 RLS checks ran on the live database inside one transaction that was rolled back, and all passed. No test users or rows remain.
- Live state: 52 public tables, all with RLS. 58 global exercises. Buckets: `avatars` is public, `post-media` and `progress-photos` are private. Realtime is on for posts, comments, post_reactions and messages.
- Through the public API, signed out: tables and RPCs return permission denied, and the `private` helpers are not exposed.
- Edge Functions are not deployed yet. That needs `npx supabase login`.

## Nutrition rebuild and RAG (2026-11-23)

**Why**
- One AI provider key, and Supabase as the only food database. USDA and the second provider path are gone.
- Retrieval runs before any AI call, so repeated foods cost nothing.

**Database** (new files, because 001 to 008 are already applied to the live project)
- `database/migrations/009_nutrition_pipeline.sql` extends existing tables instead of duplicating them:
  - `foods` gets `owner_id` (renamed from `user_id`), `cuisine`, `is_dish`, `verified`, `aliases`, trigram and full-text search, and the `ifct|ai|user|barcode|verified` source check.
  - `food_nutrition` is per 100 g, adds `sat_fat_g`, and holds one row per food.
  - `meals` gets `log_date`, snacks, and one meal per slot.
  - `meal_items` gets quantity, unit, fibre and a snapshot, with `analysis_id` (renamed from `prediction_id`).
  - `food_predictions` is renamed to `food_analyses` with input, provider, status and draft. `user_corrections` gets `analysis_id`, `food_id` and the original payload.
  - `food_scan_usage` is renamed to `ai_usage`, with `consume_ai_call` at 30 a day.
  - `coach_messages` from 006 is reused: `content`, `tool_calls`, and an optional session.
  - The `nutrition_goals` view reads the targets already on `profiles`, which onboarding sets.
- New tables only where nothing fit: `food_servings` (seeded with roti 40 g, katori 150 g, idli 40 g, dosa 100 g, ladle 120 g, cup rice 160 g and others), `dish_ingredients` (dish nutrition is recomputed as the sum of its ingredients), `nutrition_daily` (trigger-maintained), `favourite_meals` and `favourite_meal_items`. Plus the private `food-photos` bucket.
- `database/migrations/010_rag.sql`:
  - pgvector embeddings on `foods` and `food_analyses`, with HNSW indexes.
  - `match_foods`: hybrid retrieval, security invoker, cuisine filter, and boosts for own, verified and recently logged foods.
  - `match_analysis_cache` for the semantic cache.
  - `coach_memory` and `match_coach_memory`.
  - Embedding-reset triggers, and `foods_to_embed` for the worker.
- Tests: `database/tests` now has 87 checks covering dish sums, the daily-total triggers, food ownership, goals scoping, `food-photos` and `match_foods` scoping. All pass. A simulated live database with 001 to 008 already applied took 009 and 010 cleanly through `supabase db push`.

**Edge Functions**
- `_shared/ai.ts`: one interface, `generateJSON(prompt, schema, image?)` and `chat(messages, tools)`, plain REST for Gemini (default) or Anthropic.
  - Gemini uses its JSON response schema. Anthropic uses structured outputs and `fallbacks: "default"`.
  - Output is checked by a local schema validator, with one retry that includes the errors, then a friendly error.
  - The usage meter runs before each provider call.
- `_shared/pipeline.ts`:
  - analyze_text: semantic cache, then a database match per segment, then AI with at most 25 retrieved candidates. The AI must pick candidate ids or null. The server rejects matches below the accept score.
  - Unknown ingredients become `source=ai` foods, and new dishes are saved with their recipes. Everything new is embedded inline.
  - analyze_photo: one identify call, retrieval per item, then one batched breakdown call for unmatched dishes only. Visible fat becomes its own line.
  - confirm: writes the snapshot, records corrections, and creates a personal dish copy after 2 or more corrections.
  - search: no AI quota.
- `_shared/coach.ts`: the tools above plus `remember_note`. The RAG context includes matching foods, favourites, recent corrections, the last 7 days and the top 5 memories. Drafts need a separate "yes" before `confirm_log`.
- `nutrition-ai` handles the actions; `barcode` is Open Food Facts only and saves to `foods`; `embed-worker` fills up to 100 missing embeddings per run.
- Every analysis logs `cache_hit`, `candidates_count`, `ai_calls` and `latency_ms` in `food_analyses`.
- Deleted: `food-scan`, `food-search` and the USDA adapter. Secrets are now only `AI_PROVIDER`, `AI_API_KEY` and `AI_MODEL`.

**Web**
- Rebuilt by design:
  - `app/nutrition/page.tsx`
  - `lib/data/nutrition.ts`
  - new `components/nutrition/AddFoodSheet.tsx` and `DraftReview.tsx`
  - new `app/nutrition/history/page.tsx` and `app/coach/page.tsx`
  - new `lib/logic/nutrition.ts`
- Deleted `components/nutrition/FoodSheets.tsx`.
- Targeted edits: types, snacks meal type, 1024 px photo uploads, export tables, a Coach link on Home, and the nav highlight.
- `npm run build:web` passes with 27 static routes.

**Thresholds** (`supabase/functions/_shared/pipeline.ts`), tuned on a local eval
- Setup: the real `match_foods` SQL on Postgres 15 with pgvector, and real `Supabase/gte-small` embeddings computed with transformers.js (the same model as the Edge Runtime).
- Catalog: 67 foods, made up of 25 IFCT-style ingredients and 42 dishes, drinks and packaged foods, with recipes for 15 dishes.
- First run: recall@5 1.00, MRR 0.98. But the raw cosine of unrelated foods is 0.81 to 0.87, overlapping true matches at 0.87 to 0.95, and `word_similarity` gives 1.0 to partial words. So "pizza" matched rice at 0.867.
- Fix: the score is now max(name match, 0.6 × vector rescaled from 0.80–0.95 + 0.4 × name match) plus boosts. Name match is trigram similarity against the full name, the head before the first comma (IFCT style), or an alias. Results are ordered by score, with RRF as the tie-break.
- Final: recall@5 **1.00**, MRR **1.00** (text-only 0.93). Unrelated probes score 0.15 to 0.24 (pizza, sushi, hamburger, oats). Exact, alias and head-name matches score 1.0. Ambiguous single words score 0.53 to 0.73 (dal, vada, "paneer curry").

| Threshold | Value | Effect |
|---|---|---|
| `accept` | **0.55** | Below this, a proposed match is treated as a new food |
| `strong` | **0.80** | Every segment at or above this skips the AI. "plain dosai" scored 0.79 and correctly still went to the AI. |
| `photoStrong` | **0.75** | A photo item at or above this uses database values with no breakdown |
| `cacheSimilarity` | **0.95**, plus a quantity guard | See below |

- Why the cache needs the guard: paraphrases score 0.966 to 0.995 and different dishes 0.889 to 0.935, but "2 roti and dal" against "3 roti and dal" scores 0.982, and "2 idli" against "4 idli" 0.989. A hit therefore also requires the same numbers in both texts.
- The cache-hit rate needs real usage. `scripts/rag_eval.ts` reports it from `food_analyses` once the functions are deployed.

**Not run**
- No Docker on this Mac, so the Edge Functions were type-checked and their logic unit-tested (14 checks) but not executed end to end.
- No AI key was available, so no live AI calls were made.
- `data/ifct2017.csv` is not in the repo, so the importer was only run in its skip path.
- Nothing was pushed to the live database.

## AI spend guard (2026-11-23)

**Added**
- `database/migrations/011_ai_spend_guard.sql`:
  - `ai_usage` becomes one row per provider request, with `tokens_in`, `tokens_out`, `est_cost_usd`, `provider`, `model`, `action`, `status` and `created_at`. The `day` and `calls` columns are kept, so earlier counters still add up.
  - `ai_guard_reserve` checks month spend (UTC calendar month) against the budget, today's global calls against the cap, and the user's calls against 30. It reserves a row only if all three pass, under a transaction advisory lock, so parallel requests can't overshoot.
  - `ai_guard_record` stores tokens and cost. `ai_guard_release` returns the slot of a request that failed. `ai_spend_summary` serves the admin card.
  - All four functions are service-role only.
- `supabase/functions/_shared/ai.ts`: every provider request runs inside `guarded()`: reserve, call, read usage, record; release on failure.
  - Gemini usage comes from `usageMetadata`: prompt tokens in; candidates plus thoughts tokens out.
  - Anthropic usage comes from `usage`: input plus cache tokens in; output tokens out.
  - Cost is tokens × `AI_PRICE_*_PER_M` ÷ 1M.
  - Blocked checks and provider billing errors (402, 403) throw "AI logging paused for today, use search or manual log".
  - The JSON retry is a real provider request, so it is logged and counted too.
- `nutrition-ai` `admin_usage` action returns 403 unless the caller is `ADMIN_USER_ID`. Profile shows `AdminUsageCard` only when that call succeeds.
- Cache hits and database matches never reach `ai.ts`, so they are never counted.

**Verified**
- `database/tests`: 93 checks pass, including 10 new guard checks: user limit, global cap, budget, record, release, summary, and no access for signed-in users.
- `deno check` passes for all functions. `npm run build:web` passes.
- The Gemini key is valid (the models list returned). A real `generateJSON` call reached Google and got **402 "prepayment credits are depleted"**. The guard released the reserved slot as designed. The key was only passed on the command line and is not stored in the repo.

## Switch to Groq as the only AI provider (2026-11-23)

**Changed**
- `supabase/functions/_shared/ai.ts` was rewritten by design: Groq only, using `POST https://api.groq.com/openai/v1/chat/completions` with Bearer `AI_API_KEY`. Gemini and Anthropic code is removed, and so is the cost math.
  - JSON: `response_format: {type:"json_object"}`, schema in the system prompt, minified output, validated and retried once.
  - Images: `image_url` data URLs, at most 3 per request.
  - Coach: OpenAI-style `tools` and `tool_calls`. The assistant message with its tool calls is echoed back within the turn.
  - Thinking: logging uses `reasoning_effort: "none"`; the coach uses `reasoning_format: "hidden"`. gpt-oss models get low or medium effort with no reasoning returned.
  - Errors: 429, 402 and 403 give "AI paused, use search or manual log." with no retry, and the reserved slot is released. Requests send a `User-Agent`, because Groq's Cloudflare front blocks some default clients with error 1010.
  - Output is capped at 950 completion tokens for logging (`AI_MAX_OUTPUT_TOKENS`) and 700 for the coach.
- Default model: **`qwen/qwen3.8-27b`**. The requested `qwen/qwen3.6-27b` is not offered on this account; `GET /models` lists only qwen3.8-27b, gpt-oss-20b, gpt-oss-120b and non-chat models. qwen3.8 is the only one that accepted images.
- `database/migrations/011_ai_spend_guard.sql` was renamed to `011_ai_call_guard.sql` and edited in place, since it had never been applied to the live project:
  - no cost column and no monthly budget
  - `ai_guard_reserve(user, action, provider, model, user_limit, global_cap)`
  - `ai_guard_record(id, tokens_in, tokens_out)`
  - `ai_spend_summary` returns calls and tokens
- `_shared/pipeline.ts`: per-100 g macros in AI output are now an array `[kcal, P, C, F, fibre]`, and each dish has at most 6 main ingredients, skipping salt and spices under 5 g. The pipeline turns arrays back into objects.
- Secrets: `AI_API_KEY`, `AI_MODEL`, `AI_DAILY_CALL_CAP`, `ADMIN_USER_ID`, plus optional `AI_MAX_OUTPUT_TOKENS`. `AI_PROVIDER`, the price secrets and the budget secret are gone.
- The admin card shows calls today against the cap, calls this month, users and tokens.

**Verified live against Groq** (free tier; the key was passed only on the command line, never stored)

| Call | Time | Tokens in | Tokens out | Result |
|---|---|---|---|---|
| Text, "2 masala dosa with sambar and chutney" | 1.8 s | 548 | 756 (1,656 before the compact schema) | south_indian, 3 dishes with ingredient breakdowns |
| Photo, a Wikimedia masala dosa image at 1024 px WebP | 0.9 s | 2,081 | 107 | Dosa × 2, about 200 g; coconut chutney; visible oil 5 g |
| Coach turn 1 | 0.4 s | 792 | 49 | Called `get_day_summary` and `get_goals` |
| Coach turn 2 | n/a | 926 | 52 | "750 kcal left, 58 g protein left" |

- With `reasoning_effort: "none"`, JSON came back in 0.22 s, against 1.04 s with thinking on.
- Rate limits: 1,000 requests a day, 8,000 total tokens a minute, and 1,000 output tokens a minute for qwen3.8-27b. A second analysis within the same minute got a 429; the app showed the paused message and released the slot.

**Tests**
- `database/tests`: 92 checks pass.
- `deno check` passes for all functions.
- `npm run build:web` passes.

## UI redesign: monochrome, 3D, motion

Visual layer only. No data logic, Supabase calls, edge functions or routes changed. Added dependencies: `three`, `@react-three/fiber`, `@react-three/drei`, `framer-motion`, `geist` (plus `@types/three` for types).

### Step 1: design system
- `DESIGN.md` documents tokens, states without colour, macro patterns, type, texture, 3D and motion rules.
- `tailwind.config.js`: every colour is an RGB CSS variable. Legacy hues (emerald, rose, amber, sky, violet, slate, and the app tokens) map onto the grey scale, so all screens turn monochrome at once.
- `globals.css`: dark tokens by default, an exact light inversion under `prefers-color-scheme: light` or `data-theme="light"`. Adds `.num`, `.eyebrow`, `.texture-dots`, `.texture-lines`, `.glow`, `.shimmer`, `.dither`, press scale 0.97, and reduced-motion overrides.
- Geist Sans and Geist Mono replace Inter.
- `lib/theme.ts`: per-device theme, dither and 3D preferences, applied before paint by an inline script.
- Static SVG grain overlay at 5% with overlay blend; a shared 1-bit dither filter.
- Primitives: Button (pill, 44px), shimmer skeletons, Sheet (spring in, drag down to dismiss), MacroRing and MacroBar with pattern fills (protein solid, carbs hatch, fat dots), AnimatedNumber count-up, 200ms page transition, global haptic on press, monochrome nav, header, toast, fields and segmented control.

## Food AI fix: Phase 1, diagnosis (2026-11-24)

- `DIAGNOSIS.md` lists 11 findings with root causes and files. The main ones are a CORS allowlist that blocks every AI call outside two exact origins, an embedding-heavy pipeline that hits the Edge Function CPU limit, unchecked AI calorie values that are saved globally, and visible fat counted twice in photos.
- Groq models on the key: `qwen/qwen3.8-27b` (the only vision model), `openai/gpt-oss-120b`, `openai/gpt-oss-20b`. **There is no Llama chat model**, so the text role will use `openai/gpt-oss-120b`.
- Local `functions serve` needs Docker, which is not installed, and the Management API logs endpoint changed. Deployed functions were probed directly instead.
- Playwright walked the main flows against the live backend as a throwaway user. Every non-AI flow passed.

## Food AI fix: Phase 2, two-model pipeline (2026-11-24)

- **Models from secrets only:** `AI_VISION_MODEL` (photos) and `AI_TEXT_MODEL` (text logging, photo resolution, coach), with `AI_MODEL` as a legacy fallback. No model id is hardcoded.
  - Live: vision `qwen/qwen3.8-27b`, text `openai/gpt-oss-120b`. The key has no Llama chat model.
  - Each model has its own 1,000-requests-a-day and 8,000-tokens-a-minute budget, so the split doubles throughput.
- **Photo:**
  1. Vision detects items with cuisine, quantity and unit, grams, portion cues, cooking-fat cues, position and confidence.
  2. Below 0.6 confidence, a second detection runs. Items seen both times win, and items seen once are kept at 60% confidence.
  3. `match_foods` runs per item.
  4. Unless every item has a strong database match, the text model resolves all items against the candidates. It matches, or gives a recipe with the fat inside the dish, plus one question below 0.6.
  - Visible fat is no longer a separate line, so it isn't counted twice.
- **Text:** cache, then direct database match, then the text model with candidates. The flow is unchanged otherwise.
- **Sanity checks on every draft:**
  - Per-100 g caps: kcal ≤ 900, protein ≤ 90, macro mass ≤ 100 g.
  - kcal recomputed from 4P + 4C + 9F when it is off by more than 15%, for AI-sourced values.
  - Portions clamped to `portion_ranges` (new table, migration 012, 45 rows) with confidence × 0.7.
  - Items under 0.3 confidence dropped. `notes` explain every change and show on the review screen.
- **Dish weight:** the cooked weight the model reports. Absorbed water fills the gap at 0 kcal, and a recipe heavier than the dish is scaled down to it. Names like "2 rotis" are saved as "Roti".
- **CPU limit fixed:**
  - Each text is embedded once per request, one at a time, with at most 12 embeddings.
  - Ingredient lookups use trigram matching.
  - New foods beyond the budget are left to `embed-worker`.
- **Errors:** a 429, 5xx or timeout says "AI busy, try again or log manually". Reaching our daily caps says "AI paused for today". Neither retries in a loop.
- **CORS:** localhost and private LAN addresses on any port are allowed, so a phone on the same Wi-Fi works. JWT auth is unchanged.
- **Client:**
  - Network failures read "Can't reach FitOS AI right now…".
  - A failed coach message no longer leaves a duplicate bubble.
- **Live data:** deleted 28 unreferenced AI foods created by test probes, including "Dal" at 238 kcal per 100 g and "2 rotis" at 353. Pending test analyses were discarded.

**Verified live:** "2 rotis with dal and a katori of rice" now gives Roti 80 g 224 kcal, Dal 150 g 193 kcal (was 357) and Rice 150 g 181 kcal. A meat pie no longer crashes the function. The photo uses two models with no duplicate fat lines. Tests: 19 unit checks pass, and the database tests show 95 PASS.

## Food AI fix: Phase 3, camera-first logging (2026-11-24)

- `components/nutrition/CameraLogger.tsx`: a floating "Log food" button on Nutrition opens a full-screen camera (`getUserMedia`, environment camera).
  - Shutter, gallery, photo or barcode mode, torch where the track supports it.
  - "Type it instead" and "Search" open the existing Describe and Search tabs.
  - The meal is preselected from the time of day and can be changed.
- **Barcode:** live `BarcodeDetector` where available, otherwise the html5-qrcode scanner.
- **Camera blocked:** when permission is denied or `getUserMedia` fails, it falls back to `<input capture="environment">`, which opens the phone's camera.
- **Stream stops:** on close, when the tab is hidden, and on `pagehide`.
- **Analysing:** the captured photo with a scan line, then a full-screen review. Items can be edited and removed, and the new "Add item" searches the food database.
- **Verified with Playwright** against the live backend, using Chromium's fake camera:
  - The video goes live with the meal preselected. The shutter leads to analysing and then the "No food found" error state, and "Try again" returns to the camera.
  - Closing removes the stream, and permission-denied shows the native camera fallback.
  - Going over the Groq per-minute token limit showed "AI busy, try again or log manually".
