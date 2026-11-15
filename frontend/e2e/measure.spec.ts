/** Measures load/interactive time for every sidebar page against `vite preview`
 *  (the production build). Run:  npx playwright test e2e/measure.spec.ts
 *  Requires the preview server on :4173 and the backend on :8000. */

import { expect, test, type Page } from "@playwright/test";

const PAGES: Array<{ name: string; path: string; readyText: RegExp }> = [
  { name: "Rescue feed", path: "/app", readyText: /Rescue feed/i },
  { name: "My rescues", path: "/app/my-claims", readyText: /My rescues/i },
  { name: "Post food", path: "/app/post", readyText: /Post surplus food/i },
  { name: "My listings", path: "/app/my-listings", readyText: /My listings/i },
  { name: "Impact", path: "/app/impact", readyText: /Impact/i },
  { name: "Leaderboard", path: "/app/leaderboard", readyText: /Leaderboard/i },
  { name: "Profile", path: "/app/profile", readyText: /Trust score|Full name|Profile/i },
];

async function loginWithOtp(page: Page, email: string): Promise<void> {
  // Demo accounts share DemoPass123!; password login replaces the old OTP
  // dev-code flow (Resend is configured, so no dev code toast appears).
  // The first-login tour is suppressed so it can't distort measurements.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("fb.tour.v1", JSON.stringify({ volunteer: "completed", donor: "completed" }));
    } catch {
      /* ignore */
    }
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPass123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });
}

test("measure sidebar pages on the production build", async ({ page }) => {
  test.setTimeout(300_000);
  await loginWithOtp(page, "priya@demo.fb");

  const rows: Array<Record<string, string | number>> = [];
  for (const target of PAGES) {
    const timings = await measure(page, target.path, target.readyText);
    rows.push({ page: target.name, path: target.path, ...timings });
  }

  // eslint-disable-next-line no-console
  console.log("\nPERF RESULTS (vite preview, production build)\n");
  for (const row of rows) {
    // eslint-disable-next-line no-console
    console.log(
      `${String(row.page).padEnd(14)} path=${String(row.path).padEnd(18)} TTFB=${row.ttfb}ms  FCP=${row.fcp}ms  networkQuiet=${row.networkQuiet}ms  jsKb=${row.jsKb}`,
    );
  }
  expect(rows.length).toBe(PAGES.length);
});

async function measure(page: Page, path: string, readyText: RegExp) {
  const started = Date.now();
  await page.goto(path);
  await page.getByText(readyText).first().waitFor({ timeout: 30_000 });
  const ready = Date.now() - started;

  const nav = await page.evaluate(() => {
    const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByType("paint");
    return {
      ttfb: Math.round(navEntry?.responseStart ?? 0),
      fcp: Math.round(paint.find((p) => p.name === "first-contentful-paint")?.startTime ?? 0),
      transferKb: Math.round(
        performance
          .getEntriesByType("resource")
          .reduce((total, entry) => total + (entry as PerformanceResourceTiming).transferSize, 0) / 1024,
      ),
    };
  });

  // Wait briefly for network to settle (queries issued on mount).
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const networkQuiet = Date.now() - started;

  const jsKb = await page.evaluate(() =>
    Math.round(
      performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.endsWith(".js") || entry.name.includes(".js?"))
        .reduce((total, entry) => total + (entry as PerformanceResourceTiming).transferSize, 0) / 1024,
    ),
  );

  return { ttfb: nav.ttfb, fcp: nav.fcp, ready, networkQuiet, jsKb, transferKb: nav.transferKb };
}

test("location picker: quick-area chips, fixed pin, one-tap buttons", async ({ page }) => {
  test.setTimeout(180_000);
  await loginWithOtp(page, "rukmini@demo.fb");

  await page.goto("/app/post");
  await page.getByLabel("What is it?").fill("Picker verification trays");
  await page.getByRole("button", { name: /next/i }).click();
  await page.getByLabel("How much?").fill("8");
  await page.getByRole("button", { name: /next/i }).click();

  // Quick-area chips from the config endpoint:
  await expect(page.getByRole("button", { name: /Bus Stand/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Amburpet/i })).toBeVisible();
  // One-tap controls:
  await expect(page.getByRole("button", { name: /use my current location/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /same as/i })).toBeVisible(); // org address
  // Fixed centre pin (decorative ping) + map present:
  await expect(page.locator(".leaflet-container")).toBeVisible();
  // Selecting a quick-area chip updates the coordinates readout:
  await page.getByRole("button", { name: /Amburpet/i }).click();
  await expect(page.getByText(/12\.718/)).toBeVisible({ timeout: 10_000 });
  // Reverse-geocoded address line appears (or editable placeholder):
  await expect(page.getByText(/Drag the map|road|Street|Nagar|Amburpet/i).first()).toBeVisible({ timeout: 15_000 });
});
