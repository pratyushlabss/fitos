# Supabase Setup Contract

Supabase is the initial platform for Auth, PostgreSQL, and private Storage. The
FITOS domain remains vendor-neutral through adapters and repositories.

## Required server variables

- `SUPABASE_URL`: project URL, server-only.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only and never exposed to a client.
- `ALLOW_DEVELOPMENT_IDENTITY`: must remain `false` outside isolated local tests.

## Database

Apply migrations in order:

1. `database/migrations/001_phase0_init.sql`
2. `database/migrations/002_phase1_fitos_core.sql`
3. `database/migrations/003_data_engine.sql`
4. `database/migrations/004_social_identity.sql`

The service role is used only by backend adapters. Client access must use the
Supabase Auth JWT and database policies must still enforce ownership. Configure
explicit grants in addition to RLS before production exposure.

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
