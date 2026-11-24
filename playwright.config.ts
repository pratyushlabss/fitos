// Live smoke test of the deployed web app on an iPhone 14 (WebKit, 390x844, mobile Safari UA).
// Run: BASE_URL=https://<project>.pages.dev npx playwright test   (env from .env.local: SUPABASE_URL, SUPABASE_ANON_KEY)
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/live-smoke",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["iPhone 14"],
    browserName: "webkit",
    baseURL: process.env.BASE_URL ?? "https://fitos.pages.dev",
    trace: "retain-on-failure",
  },
});
