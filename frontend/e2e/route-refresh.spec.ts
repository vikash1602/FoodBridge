/** Phase 9 E2E: direct routes and hard refreshes while authenticated.
 *  Every deep link must render on a cold load (JWT from localStorage,
 *  /auth/me/ refetch) — no blank screens, no redirect loops. */

import { expect, test } from "@playwright/test";

import { loginWithOtp } from "./helpers";

test.describe("Direct routes & refresh", () => {
  test("deep links render on cold load: help, my-claims, impact, notifications, onboarding", async ({ page }) => {
    test.setTimeout(240_000);
    await loginWithOtp(page, "priya@demo.fb");

    const checks: Array<{ path: string; expect: RegExp }> = [
      { path: "/app/help", expect: /help & how it works/i },
      { path: "/app/my-claims", expect: /my rescues/i },
      { path: "/app/impact", expect: /impact/i },
      { path: "/app/notifications", expect: /notifications/i },
      { path: "/app/onboarding", expect: /where do you usually cook|personal details|notification radius|how nearby food discovery|rescue feed & map/i },
    ];

    for (const check of checks) {
      // Cold navigation (full page load, not client-side routing).
      await page.goto(check.path, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: check.expect }).first()).toBeVisible({
        timeout: 30_000,
      });
      // Hard refresh on the same route.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: check.expect }).first()).toBeVisible({
        timeout: 30_000,
      });
    }
  });

  test("donor deep links: my-listings and post wizard render cold", async ({ page }) => {
    test.setTimeout(240_000);
    await loginWithOtp(page, "rukmini@demo.fb");

    await page.goto("/app/my-listings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /my listings/i })).toBeVisible({ timeout: 30_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /my listings/i })).toBeVisible({ timeout: 30_000 });

    await page.goto("/app/post", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /post surplus food/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("What is it?")).toBeVisible({ timeout: 20_000 });
  });

  test("unknown sub-route falls back to the public landing without a blank screen", async ({ page }) => {
    test.setTimeout(120_000);
    await loginWithOtp(page, "priya@demo.fb");
    await page.goto("/app/does-not-exist", { waitUntil: "domcontentloaded" });
    // The catch-all route navigates to "/" — the landing must render.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  });
});
