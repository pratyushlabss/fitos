// Live smoke test against the deployed site (see playwright.config.ts). Creates a throwaway eval user through
// Supabase Auth, onboards it through the REST API, then drives the UI. Only that user's own logs are written,
// and they're deleted at the end. Screenshots land in tests/live-smoke/screens/.
import { expect, test, type Page } from "@playwright/test";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const PASSWORD = process.env.EVAL_PASSWORD ?? "evalpass123";
const email = `fitos.test.smoke.${Date.now()}@example.com`;
let token = "";
let uid = "";

const shot = (page: Page, name: string) => page.screenshot({ path: `tests/live-smoke/screens/${name}.png`, fullPage: true });
const rest = async (path: string, method: string, body?: unknown, prefer = "return=minimal") => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: prefer }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
};

test.describe.serial("live smoke (iPhone 14)", () => {
  let page: Page;
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    expect(SUPABASE_URL && ANON, "SUPABASE_URL and SUPABASE_ANON_KEY").toBeTruthy();
    const signup = await (await fetch(`${SUPABASE_URL}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) })).json();
    token = signup.access_token;
    uid = signup.user?.id;
    expect(token, `signup: ${JSON.stringify(signup).slice(0, 200)}`).toBeTruthy();
    await rest("profiles", "POST", { id: uid }, "resolution=ignore-duplicates");
    await rest(`profiles?id=eq.${uid}`, "PATCH", { username: `smoke${Date.now() % 1e8}`, display_name: "Smoke Test", calorie_target: 2200, protein_target_g: 140, carbs_target_g: 250, fat_target_g: 70, goal: "lose_fat", sex: "male", birth_year: 1994, height_cm: 178, timezone: "Asia/Kolkata", onboarded_at: new Date().toISOString() });
    const context = await browser.newContext();
    page = await context.newPage();
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(`${page.url()} :: ${m.text()}`));
    page.on("pageerror", (e) => consoleErrors.push(`${page.url()} :: pageerror ${e.message}`));
  });

  test.afterAll(async () => {
    if (token && uid) await rest(`meals?user_id=eq.${uid}`, "DELETE").catch(() => undefined);
    if (consoleErrors.length) console.log(`console errors:\n${consoleErrors.join("\n")}`);
  });

  test("loads with manifest, service worker and apple-touch-icon", async () => {
    const res = await page.goto("/");
    expect(res?.status()).toBeLessThan(400);
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref).toBeTruthy();
    expect((await page.request.get(manifestHref!)).status()).toBe(200);
    const icon = await page.locator('link[rel="apple-touch-icon"]').first().getAttribute("href");
    expect((await page.request.get(icon ?? "/apple-touch-icon.png")).status()).toBe(200);
    expect((await page.request.get("/sw.js")).status()).toBe(200);
    await expect.poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker?.getRegistration())), { timeout: 20_000 }).toBe(true);
    await shot(page, "01-home");
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("login screen and sign in", async () => {
    await page.goto("/login");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await shot(page, "02-login");
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
    await shot(page, "03-signed-in");
  });

  test("search idli: ~39 kcal per 40 g piece from the food DB", async () => {
    await page.goto("/nutrition");
    await page.getByRole("button", { name: /^Add$/ }).first().click();
    await page.getByPlaceholder("Search dosa, paneer, Vegemite…").fill("idli");
    const first = page.locator("ul li button").filter({ hasText: "kcal / 100 g" }).first();
    await expect(first).toContainText("Idli");
    await expect(first).toContainText("97 kcal / 100 g");
    await first.click();
    await expect(page.getByText(/40 g · 39 kcal/)).toBeVisible();
    await shot(page, "04-search-idli");
  });

  test("log idli, see it in the day totals, delete it", async () => {
    await page.getByRole("button", { name: "Add to log" }).click();
    await expect(page.getByText("Added Idli")).toBeVisible();
    await page.goto("/nutrition");
    await expect(page.locator("p.text-4xl")).toHaveText("39");
    await shot(page, "05-logged");
    await page.getByText("Idli", { exact: false }).first().click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.locator("p.text-4xl")).toHaveText("0");
    await shot(page, "06-deleted");
  });

  const describe = async (text: string) => {
    await page.goto("/nutrition");
    await page.getByRole("button", { name: /^Add$/ }).first().click();
    await page.getByRole("button", { name: "Describe" }).click();
    await page.getByPlaceholder(/2 masala dosa with sambar/).fill(text);
    await page.getByRole("button", { name: "Work out calories" }).click();
  };

  test('describe "2 dosa and sambar": draft with source badges', async () => {
    await describe("2 dosa and sambar");
    await expect(page.getByRole("heading", { name: "Review before saving" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/dosa/i).first()).toBeVisible();
    await expect(page.getByText(/sambar/i).first()).toBeVisible();
    await shot(page, "07-describe-draft");
  });

  test('"zorblax": don\'t know', async () => {
    await describe("zorblax");
    await expect(page.getByText(/I don't know this one yet/)).toBeVisible({ timeout: 45_000 });
    await shot(page, "08-zorblax");
  });

  test('"moonberry biryani": clarify', async () => {
    await describe("moonberry biryani");
    await expect(page.getByText(/Which food did you mean/)).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("button", { name: "Something else" })).toBeVisible();
    await shot(page, "09-clarify");
  });

  test("camera logger: photo and barcode open, fallback shows without camera", async () => {
    await page.goto("/nutrition");
    await page.getByRole("button", { name: /Log food/ }).click();
    await expect(page.getByText(/Camera access is off for FitOS|The live camera isn't available here/)).toBeVisible();
    await shot(page, "10-photo");
    await page.getByRole("button", { name: "Barcode mode" }).click();
    await expect(page.getByPlaceholder("Or type the barcode digits")).toBeVisible();
    await shot(page, "11-barcode");
    await page.getByRole("button", { name: "Close camera" }).click();
  });

  for (const [name, path] of [["12-coach", "/coach"], ["13-social", "/social"], ["14-profile", "/profile"], ["15-settings", "/profile/edit"]] as const) {
    test(`${path} loads`, async () => {
      const res = await page.goto(path);
      expect(res?.status()).toBeLessThan(400);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main, body").first()).not.toContainText(/Something went wrong|Application error/);
      await shot(page, name);
    });
  }
});
