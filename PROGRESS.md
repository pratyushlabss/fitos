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
