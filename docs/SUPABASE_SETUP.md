# Supabase Setup Contract

Supabase is the initial platform for Auth, PostgreSQL, and private Storage. The
FITOS domain remains vendor-neutral through adapters and repositories.

## Required server variables

- `SUPABASE_URL`: project URL, server-only.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only and never exposed to a client.
- `ALLOW_DEVELOPMENT_IDENTITY`: must remain `false` outside isolated local tests.

## Database

Apply migrations in order. `supabase/migrations` is a symlink to this folder, so
`npx supabase db push` applies them for you (see `DEPLOY.md`):

1. `database/migrations/001_phase0_init.sql`
2. `database/migrations/002_phase1_fitos_core.sql`
3. `database/migrations/003_data_engine.sql`
4. `database/migrations/004_social_identity.sql`
5. `database/migrations/005_messaging.sql`
6. `database/migrations/006_recovery_intelligence.sql`
7. `database/migrations/007_rls_hardening.sql`: RLS on the 002 tables, fixed social and messaging policies, profile trigger, `search_profiles`, storage buckets and policies, Realtime publication, no table access for `anon`
8. `database/migrations/008_app_features.sql`: profile goals, progress photos, recovery check-ins, food-scan limits, saved posts, feed, leaderboard, notification and messaging RPCs, exercise catalog

The web app uses the anon key and the user's JWT, so RLS is the security boundary.
The service role is used only inside Edge Functions, for the food-scan rate limit
and the shared barcode cache. Security helpers live in the `private` schema, which
PostgREST does not expose.

`database/tests/run.sh` applies every migration to a throwaway local Postgres
(port 55432) with stand-ins for Supabase's `auth` and `storage` schemas, then runs
68 RLS checks as four test users.

## Auth

Supabase Auth issues the access token. FITOS protected routes require:

```http
Authorization: Bearer <access-token>
```

The backend verifies the token through the Supabase auth adapter and derives the
user ID from the verified user record. A client cannot select another identity.

## Storage

Create private buckets for food images, progress photos, post media, and product
images. Storage policies must scope `storage.objects.owner_id` or an equivalent
path ownership rule to `auth.uid()`. Public buckets are not acceptable for
private health or food imagery. The durable StorageProvider implementation is
still pending.

## Realtime

Realtime may be used later for messaging and notifications through a provider
interface. It is not a domain dependency and is not required for workout,
meal, activity, health, or analytics correctness.

Never commit project keys or service-role credentials. Verify RLS, grants,
storage policies, indexes, and migration order in a connected project before
production deployment.
