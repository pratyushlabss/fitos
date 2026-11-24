# FitOS diagnosis: food AI, functions and flows

Date: 2026-11-24. Everything below was measured on the live project (`lnspwuepxdlhgvcdwrte`) with throwaway users that were deleted afterwards.

## How it was tested

- **Local `supabase functions serve`:** not possible. It needs Docker, which is not installed. The deployed functions were called directly instead, with the same inputs.
- **Deployed function logs:** not available. The Management API removed `logs.all`, and the new logs endpoint rejects both `function_edge_logs` and `function_logs` as table names. Failures were read from HTTP responses and from the `ai_usage` and `food_analyses` tables.
- **Groq models:** `GET /openai/v1/models` with the project key.
- **Flows:** Playwright at 390×844 against the production static export, signing up a real user on the live backend (`scratchpad/shots/e2e.mjs`).

## Groq models on this key (2026-11-24)

| Model | Kind | Notes |
|---|---|---|
| `qwen/qwen3.8-27b` | Text and vision | The only model that accepts images. Current `AI_MODEL`. JSON mode works. |
| `openai/gpt-oss-120b` | Text | Largest text model. JSON mode and tools work. |
| `openai/gpt-oss-20b` | Text | Smaller text model |
| `allam-2-7b` | Text | Arabic-focused, 4k context |
| `whisper-large-v3`, `whisper-large-v3-turbo` | Speech | Not useful here |
| `meta-llama/llama-prompt-guard-2-*` | Classifier | Not a chat model |

- **No Llama chat model is available on this key.** There is no `llama-3.3-70b-versatile` or any other Llama "versatile" model. The text role therefore uses `openai/gpt-oss-120b`, the largest text model listed.
- Each model has its own free-tier budget: 1,000 requests per day and 8,000 tokens per minute. Splitting vision and text across two models doubles the throughput.

## Live call results (before fixes)

| Call | Result |
|---|---|
| Text: "2 rotis with dal and a katori of rice" | 200 in 11.6 s. Roti 80 g 283 kcal, rice 150 g 195 kcal, **dal 150 g 357 kcal (real: about 150–180)** |
| Text: "flat white and a ham cheese croissant" | 200 in 5.6 s. Plausible |
| Text: "meat pie with tomato sauce" | **546 WORKER_RESOURCE_LIMIT** after 9.4 s |
| Photo: two masala dosa with chutney | 200 in 6.3 s. Dosa, chutney, plus two separate "Cooking oil (visible on …)" lines |
| Coach chat | 200. Works with curl |
| Barcode 3017620422003 (Nutella) | 200 in 0.9 s. Correct |
| CORS preflight from `http://localhost:3000` | 200 with the right headers |
| Call without a JWT | 401 "Sign in again." Correct |
| RLS | On for all 14 tables the functions read or write, each with policies |

## Playwright flows (before fixes)

Passing: sign up, onboarding, Home, start empty workout, add exercise, log a set, finish, history, routines, Nutrition day view, food search (only through the text-only fallback), nutrition history, recovery check-in, body weight entry, leaderboard, Messages, Activity, Profile, Profile edit.

Failing: every AI call from the browser (Describe, Photo, Coach, hybrid search) when the app is not on `localhost:3000` or `fitos.pages.dev`. Two other failures were selector mistakes in the test script, not app bugs.

## Failures and root causes

| # | Failure | Root cause | File |
|---|---|---|---|
| 1 | AI calls fail with a CORS error from `127.0.0.1:4173`, any other local port, or a phone on the LAN (`http://192.168.x.x:3000`). Search silently falls back to text-only. | The CORS allowlist has three exact origins and returns `https://fitos.pages.dev` for everything else, so the browser blocks the response. Auth is enforced by the JWT, so the strict allowlist adds no security. | `supabase/functions/_shared/cors.ts` |
| 2 | Text analysis crashes with 546 `WORKER_RESOURCE_LIMIT` | One request ran up to about 27 gte-small embeddings in-process. Segments and the full text were embedded concurrently, every AI ingredient was embedded again for retrieval, and every newly created food was embedded inline. This exceeds the Edge Function CPU budget. | `_shared/pipeline.ts` (`analyzeText`, `resolveDishes`, `embedFoods`) |
| 3 | Calories wrong (dal 357 kcal per 150 g) | AI per-100 g values and raw ingredient grams were trusted as-is. There was no check that kcal matches the macros, no plausible portion ranges, no physical caps, and nothing dropped weak items. | `_shared/pipeline.ts` |
| 4 | Bad values spread to every user | Every AI guess is saved as a global food (28 of the 29 foods are unverified AI rows) and then matched as a candidate for everyone. | `_shared/pipeline.ts` (`getOrCreateGlobalFood`) |
| 5 | Retrieval has almost nothing to ground on | No IFCT seed: 0 rows with `source = ifct`. `data/ifct2017.csv` has not been supplied. | `scripts/import_ifct.ts` (data missing) |
| 6 | Some foods never get embeddings | `pg_cron` and `pg_net` are not enabled, so `embed-worker` never runs (2 foods unembedded). | Supabase project setup |
| 7 | Photo fat counted twice | Visible fat is added as its own line per dish, while the dish breakdown already includes cooking fat. | `_shared/pipeline.ts` (`analyzePhoto`) |
| 8 | One model for everything, low throughput | Vision, text and coach all use `AI_MODEL` and share one 1,000-request and 8,000-token budget. | `_shared/ai.ts` |
| 9 | Unfriendly failure text | A 429 says "AI paused, use search or manual log". A timeout surfaces "AI request failed: signal timed out". | `_shared/ai.ts` |
| 10 | Coach after a failed send | The user's bubble stays in the list while the same text is put back in the input, so a resend shows it twice. Network failures show "Failed to send a request to the Edge Function". | `app/coach/page.tsx`, `lib/data/nutrition.ts` |
| 11 | Sign-up logs a 400 in the console | The form tries sign-in first and falls back to sign-up. Expected and harmless, so left as is. | `lib/data/auth.ts` |

## Not a bug

- Photo upload: path ownership is checked, files over 1.5 MB are rejected, and images go as base64 data URLs. Safari, which can't encode WebP, falls back to JPEG.
- JWT verification, RLS and the call guard (30 per user per day plus the global cap) all behave correctly.
