# FitOS

Privacy-first fitness OS: workouts, nutrition AI, native GPS, social sharing.

## Layout

- `apps/web` — Next.js 5-tab PWA shell
- `backend` — FastAPI, domain services, adapters
- `packages/types` — shared TypeScript models
- `database/migrations` — Postgres + RLS

## Run

```bash
npm install
npm run dev:web
```

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn api.main:app --reload
```

Copy `backend/.env.example` to `backend/.env` and apply `database/migrations/001_phase0_init.sql` in Supabase.
