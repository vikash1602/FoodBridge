/** Captures dashboard screenshots for PROJECT_REPORT.md at all required viewports.
 *  Run: npx playwright test --config=playwright.measure.config.ts e2e/screenshots.spec.ts */

import { expect, test } from "@playwright/test";

import { loginWithOtp } from "./helpers";

const VIEWPORTS = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "390x844", width: 390, height: 844 },
];

test("capture dashboard screenshots at all viewports, light + dark", async ({ page }) => {
  test.setTimeout(600_000);
  await loginWithOtp(page, "priya@demo.fb");
  await page.goto("/app");
  await page.getByRole("heading", { name: /Rescue feed/i }).waitFor({ timeout: 30_000 });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(900); // map invalidateSize
    await page.screenshot({ path: `docs/screenshots/dashboard-${viewport.name}-light.png`, fullPage: false });

    await page.getByRole("button", { name: /switch to dark mode|switch to light mode/i }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `docs/screenshots/dashboard-${viewport.name}-dark.png`, fullPage: false });
    await page.getByRole("button", { name: /switch to dark mode|switch to light mode/i }).click();
    await page.waitForTimeout(400);
  }
  expect(true).toBe(true);
});
