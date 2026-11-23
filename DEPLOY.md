# Deploying FitOS

The web app is a static export on Cloudflare Pages. Data, auth, storage and edge functions live in Supabase.

## One-time setup

### 1. Install and log in

```bash
npm install
npx wrangler login
npx supabase login
```

### 2. Environment file for local builds

Create `apps/web/.env.production`. It is gitignored. Next.js bakes these values into the static build.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
```

Find both values in Supabase under **Project Settings → API**. Use the `anon` `public` key. Never put the `service_role` key here.

For `npm run dev:web`, put the same two lines in `apps/web/.env.local`.

### 3. Create the Cloudflare Pages project

The first deploy creates the project if it does not exist. Accept the prompt and choose `main` as the production branch.

## Deploy the web app

```bash
npm run deploy
```

This builds `apps/web/out` and uploads it to the `fitos` Pages project. The site is served at https://fitos.pages.dev.

### Cloudflare dashboard environment variables

You build locally, so the values in `.env.production` are what ship. Cloudflare variables are only needed if you later connect the Git repo for Cloudflare-side builds. In that case, add both `NEXT_PUBLIC_` variables under **Workers & Pages → fitos → Settings → Variables and Secrets**, for Production and Preview.

## Supabase

### Link the project

```bash
npx supabase link --project-ref <project-ref>
```

### Apply migrations

`supabase/migrations` is a symlink to `database/migrations`, so the CLI sees the same files.

Check what the CLI thinks is applied first:

```bash
npx supabase migration list
```

- **Fresh project, nothing applied yet:** run `npx supabase db push`.
- **If the direct database host refuses connections** (it is IPv6-only), push through the session pooler instead:

```bash
npx supabase db push --db-url "postgresql://postgres.lnspwuepxdlhgvcdwrte:<db-password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres"
```
- **You already ran some files by hand in the SQL editor:** mark those as applied first, then push the rest. For example, if 001 to 006 are already in:

```bash
npx supabase migration repair --status applied 001 002 003 004 005 006
npx supabase db push
```

### Deploy edge functions and secrets

FitOS uses exactly one AI provider and these three secrets:

| Secret | Value |
|---|---|
| `AI_PROVIDER` | `gemini` (default) or `anthropic` |
| `AI_API_KEY` | The key for that provider: Google AI Studio (https://aistudio.google.com/apikey) or Anthropic (https://console.anthropic.com) |
| `AI_MODEL` | Optional. Defaults to `gemini-2.5-flash` for Gemini and `claude-opus-5-5` for Anthropic. |

```bash
npx supabase secrets set AI_PROVIDER=gemini AI_API_KEY=<key> AI_MODEL=gemini-2.5-flash
npx supabase functions deploy nutrition-ai
npx supabase functions deploy barcode
npx supabase functions deploy embed-worker --no-verify-jwt
```

- Remove secrets from the old setup if you set them: `npx supabase secrets unset ANTHROPIC_API_KEY USDA_API_KEY`.
- Delete the old functions if they were deployed: `npx supabase functions delete food-scan` and `npx supabase functions delete food-search`.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.
- Embeddings use Supabase's built-in `gte-small` model inside the Edge Runtime, so they need no key.
- Each user gets 30 AI calls a day. Database matches and cache hits don't count.
- With Anthropic, the function sends `fallbacks: "default"` so a declined request is retried on Anthropic's recommended fallback model.

### Schedule the embed-worker (pg_cron + pg_net)

New foods are embedded inline. The worker catches anything missed, such as foods created from the app or edits that clear an embedding.

1. In **Database → Extensions**, enable `pg_cron` and `pg_net`.
2. In the **SQL editor**, store the project URL and the `service_role` key in Vault. Find the key under **Project Settings → API Keys**, in the legacy `service_role` entry. Then schedule the worker for every 5 minutes:

```sql
select vault.create_secret('https://lnspwuepxdlhgvcdwrte.supabase.co', 'fitos_project_url');
select vault.create_secret('<service_role key>', 'fitos_service_role_key');

select cron.schedule(
  'fitos-embed-worker',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'fitos_project_url') || '/functions/v1/embed-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'fitos_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

3. Check it with `select * from cron.job_run_details order by start_time desc limit 5;`. To stop it, run `select cron.unschedule('fitos-embed-worker');`.

### Seed IFCT ingredients (optional, recommended)

Indian dish breakdowns are most accurate when the raw ingredients come from the Indian Food Composition Tables (IFCT 2017). Save the composition table as `data/ifct2017.csv`, then run:

```bash
SUPABASE_URL=https://lnspwuepxdlhgvcdwrte.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
  npx deno run -A scripts/import_ifct.ts
```

It imports each row as a global, verified ingredient (`source = ifct`) and then calls `embed-worker` until every food has an embedding. Without the file it skips with a message. The column names it accepts are listed at the top of the script.

### Retrieval eval

After seeding and some real use, measure retrieval and the cache:

```bash
SUPABASE_URL=https://lnspwuepxdlhgvcdwrte.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
  npx deno run -A scripts/rag_eval.ts
```

It prints recall@5, MRR, score distributions for tuning the thresholds in `supabase/functions/_shared/pipeline.ts`, and the cache-hit rate from logged analyses.

### Auth URL settings

In **Authentication → URL Configuration**:

- **Site URL:** `https://fitos.pages.dev`
- **Redirect URLs:** add `https://fitos.pages.dev/**` and `http://localhost:3000/**`

### Email template for 6-digit codes

FitOS signs in with a one-time code typed into the app, not a magic link. Links open Safari instead of the installed iPhone app.

In **Authentication → Emails → Templates**, edit both **Magic Link** and **Confirm signup**. Replace the body with:

```html
<h2>Your FitOS code</h2>
<p>Enter this code in the app to sign in:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>It expires in 1 hour. If you did not request it, ignore this email.</p>
```

Remove any `{{ .ConfirmationURL }}` link so nobody taps it by mistake.

In **Authentication → Providers → Email**, keep Email enabled. Set the OTP length to 6 if your project shows that option.

The built-in Supabase mailer allows only a few emails per hour. For more than a handful of friends, add custom SMTP under **Authentication → Emails → SMTP Settings**. Resend's free tier works.

## Free-tier limits worth knowing

| Service | Limit |
|---|---|
| Supabase database | 500 MB |
| Supabase storage | 1 GB, which is why uploads are compressed to about 250 KB |
| Supabase edge functions | 500,000 calls per month |
| Supabase projects | Paused after 7 days without activity |
| Cloudflare Pages | 500 deploys per month, unlimited static bandwidth |
