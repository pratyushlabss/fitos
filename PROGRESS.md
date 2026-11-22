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
