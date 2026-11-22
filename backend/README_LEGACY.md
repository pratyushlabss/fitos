# Legacy backend

This FastAPI backend is no longer deployed. It is kept as reference only.

As of 2026-11-22 the app runs as:

- `apps/web`: a static Next.js export on Cloudflare Pages that reads and writes Supabase directly, protected by RLS.
- `supabase/functions/`: Edge Functions for food photo scan, food search and barcode lookup.
- `database/migrations/`: the schema, applied through the Supabase CLI.

Logic that was ported from here:

| Python source | New home |
|---|---|
| `adapters/claude/vision.py` | `supabase/functions/food-scan/` |
| `adapters/usda/client.py`, `adapters/open_food_facts/client.py` | `supabase/functions/food-search/`, `supabase/functions/barcode/` |
| `repositories/supabase_*.py` | `apps/web/lib/data/` |
| `domain/recovery/recovery_engine.py`, `domain/recovery/coach.py` | `apps/web/lib/logic/recovery.ts` |
| `domain/services/progression_service.py`, `recommendation_service.py` | `apps/web/lib/logic/progression.ts` |
| `domain/services/dashboard_service.py`, `score_service.py` | `apps/web/lib/logic/dashboard.ts` |

Do not add new features here.
