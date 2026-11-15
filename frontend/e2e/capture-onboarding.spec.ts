/** Before/after screenshot capture for the onboarding & education work.
 *  Run: npx playwright test e2e/capture-onboarding.spec.ts
 *  SHOT_TAG=before|after selects the output subfolder name.
 *  Tour auto-start is suppressed so pages capture clean (no tooltip overlay).
 */

import { expect, test, type Page } from "@playwright/test";

import { loginWithOtp, uiLogin, uiLogout } from "./helpers";

const TAG = (process.env.SHOT_TAG ?? "before").trim();
const DIR = `docs/screenshots/onboarding/${TAG}`;

async function suppressTour(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "fb.tour.v1",
        JSON.stringify({ volunteer: "completed", donor: "completed", admin: "completed" }),
      );
    } catch {
      /* storage unavailable */
    }
  });
}

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.waitForTimeout(600); // settle fonts/animations
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage });
}

/** Full-page shots need a scroll-through first: whileInView sections only
 *  animate in when scrolled into view (otherwise they capture invisible —
 *  captureBeyondViewport expands the viewport and IO fires at frame 0). */
async function fullPageShot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    const max = document.body.scrollHeight;
    for (let y = 0; y <= max; y += step) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  // wait until every once-animated section actually reached opacity 1
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("#how-it-works li")].every(
          (li) => getComputedStyle(li).opacity === "1",
        ),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
}

test.describe("capture onboarding set", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("public + volunteer + donor + admin screenshots", async ({ page }) => {
    test.setTimeout(600_000);
    await suppressTour(page);

    // --- public pages --------------------------------------------------------
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    await fullPageShot(page, "landing");
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: /join the bridge/i })).toBeVisible({ timeout: 30_000 });
    await shot(page, "register");

    // --- volunteer -----------------------------------------------------------
    await loginWithOtp(page, "priya@demo.fb");
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: /rescue feed/i })).toBeVisible({ timeout: 30_000 });
    await shot(page, "volunteer-feed");
    await page.goto("/app/my-claims");
    await shot(page, "volunteer-my-claims");
    await page.goto("/app/impact");
    await shot(page, "volunteer-impact");
    await page.goto("/app/notifications");
    await shot(page, "volunteer-notifications");
    await page.goto("/app/profile");
    await shot(page, "volunteer-profile");
    await page.goto("/app/onboarding");
    await shot(page, "onboarding-volunteer");
    await uiLogout(page);

    // --- donor ---------------------------------------------------------------
    await uiLogin(page, "rukmini@demo.fb", "DemoPass123!");
    await page.goto("/app/my-listings");
    await shot(page, "donor-my-listings");
    await page.goto("/app/post");
    await shot(page, "donor-post");
    await page.goto("/app/impact");
    await shot(page, "donor-impact");
    await uiLogout(page);

    // --- admin ---------------------------------------------------------------
    await uiLogin(page, "admin@foodbridge.dev", "DemoPass123!");
    await page.goto("/app/admin");
    await shot(page, "admin-console");
    await uiLogout(page);
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("mobile volunteer feed", async ({ page }) => {
      test.setTimeout(300_000);
      await suppressTour(page);
      await loginWithOtp(page, "priya@demo.fb");
      await page.goto("/app");
      await expect(page.getByRole("heading", { name: /rescue feed/i })).toBeVisible({ timeout: 30_000 });
      await shot(page, "mobile-volunteer-feed");
    });
  });
});
