# FitOS

Privacy-first fitness OS: workouts, nutrition AI, native GPS, social sharing.

## Layout

- `apps/web` — Next.js static-export PWA, hosted on Cloudflare Pages
- `supabase/functions` — Edge Functions for food scan, food search and barcode
- `packages/types` — shared TypeScript models
- `database/migrations` — Postgres + RLS
- `backend` — legacy FastAPI reference, not deployed

## Run

```bash
npm install
cp apps/web/.env.example apps/web/.env.local
npm run dev:web
```

Deployment, migrations and secrets are in `DEPLOY.md`.
