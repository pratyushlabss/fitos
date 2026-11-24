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

FitOS uses one AI provider, **Groq**, with one key and two models: a vision model reads photos, and a text model resolves foods and runs the coach. Model ids come only from secrets.

| Secret | Value |
|---|---|
| `AI_API_KEY` | Your Groq key (`gsk_…`) from https://console.groq.com/keys |
| `AI_VISION_MODEL` | A Groq model that accepts images. On this key only `qwen/qwen3.8-27b` does. Check with `curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $AI_API_KEY"`. |
| `AI_TEXT_MODEL` | The text model for logging and the coach. Use a Llama "versatile" model if your key lists one; this key has none, so it uses `openai/gpt-oss-120b`. |
| `AI_DAILY_CALL_CAP` | Hard cap on AI calls per UTC day across all users. Default 300. Each user is also limited to 30 a day. A photo uses 2 calls, or 3 when it gets a second look. |
| `ADMIN_USER_ID` | Your user id. Only this user sees the AI usage card on Profile. |
| `AI_MAX_OUTPUT_TOKENS` / `AI_TEXT_MAX_OUTPUT_TOKENS` | Optional. Defaults 950 for vision and 2400 for text. |

`AI_MODEL` is still read as a fallback when a role-specific secret is missing.

```bash
npx supabase secrets set AI_API_KEY=<groq key> AI_VISION_MODEL=qwen/qwen3.8-27b AI_TEXT_MODEL=openai/gpt-oss-120b AI_DAILY_CALL_CAP=300 ADMIN_USER_ID=<your user id>
npx supabase functions deploy nutrition-ai
npx supabase functions deploy barcode
npx supabase functions deploy embed-worker --no-verify-jwt
```

- Remove secrets from earlier setups if you set any: `npx supabase secrets unset AI_PROVIDER AI_PRICE_IN_PER_M AI_PRICE_OUT_PER_M AI_MONTHLY_BUDGET_USD ANTHROPIC_API_KEY USDA_API_KEY`.
- Delete the old functions if they were deployed: `npx supabase functions delete food-scan` and `npx supabase functions delete food-search`.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.
- Embeddings use Supabase's built-in `gte-small` model inside the Edge Runtime, so they need no key.
- **Logging requests run with thinking off** (`reasoning_effort: "none"`), which is about 5× faster. **The coach may think** (`reasoning_format: "hidden"`), and its reasoning never appears in replies.
- **JSON** uses `response_format: {type: "json_object"}` with the schema in the system prompt. Answers are validated and retried once.
- **Images** go as base64 data URLs: at most 3 per request, compressed to 1024 px WebP first.
- **Call guard:** before every AI request, one locked SQL call checks today's total calls against `AI_DAILY_CALL_CAP` and the user's calls today against 30. If either fails, no AI call is made and the app says "AI paused, use search or manual log". Search, barcode and manual logging keep working. Database matches and cache hits never count.
- **429, 5xx or a timeout from Groq** shows "AI busy, try again or log manually", with no retry loop. The slot is given back.
- Token counts are logged per request in `ai_usage`. Groq free has no billing, so there is no cost tracking.
- **Free-tier throughput:** Groq allows about 1,000 output tokens per minute for this model across the whole app. A text meal analysis uses about 750 output tokens, a photo about 100 to 500, and a coach turn about 50. So expect roughly one or two AI meal analyses per minute for everyone combined. Database matches and the semantic cache don't use any of that budget.
- **Finding your user id:** sign in to the app once, then copy your UID from **Authentication → Users** in Supabase and set it as `ADMIN_USER_ID`.

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
