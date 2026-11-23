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

```bash
npx supabase secrets set ANTHROPIC_API_KEY=<key> USDA_API_KEY=<key>
npx supabase functions deploy food-scan
npx supabase functions deploy food-search
npx supabase functions deploy barcode
```

- Get an Anthropic key at https://console.anthropic.com.
- Get a free USDA FoodData Central key at https://fdc.nal.usda.gov/api-key-signup.
- `ANTHROPIC_MODEL` is optional. Set it only to override the default model.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.

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
