/** UI-repair evidence capture: before/after shots of the affected surfaces.
 *  Prereqs: backend :8000 (demo seed), `npm run preview -- --port 4173`.
 *  Run: set SHOT_TAG=before|after && node scripts/capture-ui-repair.cjs
 *  Output: ../docs/screenshots/ui-repair/<TAG>/*.png  (relative to frontend/)
 */
const { chromium } = require("@playwright/test");

const TAG = (process.env.SHOT_TAG ?? "before").trim();
const BASE = "http://localhost:4173";
const DIR = `../docs/screenshots/ui-repair/${TAG}`;

const TOUR_SEEN = JSON.stringify({ volunteer: "completed", donor: "completed" });

async function login(page, email, { tour = false } = {}) {
  await page.addInitScript((seen) => {
    try {
      if (seen) localStorage.setItem("fb.tour.v1", seen);
      else localStorage.removeItem("fb.tour.v1");
    } catch {
      /* ignore */
    }
  }, tour ? null : TOUR_SEEN);
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPass123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });
}

async function shot(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${DIR}/${name}.png` });
  console.log(`saved ${name}.png`);
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });

  // --- Help page (welcome panel + notches) ---------------------------------
  for (const [name, viewport] of [
    ["help-desktop", { width: 1440, height: 900 }],
    ["help-mobile", { width: 390, height: 844 }],
  ]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await login(page, "priya@demo.fb");
    await page.goto(`${BASE}/app/help`);
    await page.getByRole("heading", { name: /help & how it works/i }).waitFor({ timeout: 20_000 });
    await shot(page, name);
    await ctx.close();
  }

  // --- Tour step over the map (tooltip vs Leaflet) -------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, "priya@demo.fb", { tour: true });
    await page.goto(`${BASE}/app`);
    const card = page.getByTestId("tour-card");
    await card.waitFor({ timeout: 15_000 });
    await shot(page, "tour-step1-feed");
    // advance to step 5 (map) — 4 Nexts
    for (let i = 0; i < 4; i += 1) {
      await card.getByRole("button", { name: "Next" }).click();
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(1200);
    await shot(page, "tour-step5-map");
    await ctx.close();
  }

  // --- Impact empty state ---------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, "karan@demo.fb");
    await page.goto(`${BASE}/app/impact`);
    await page.getByRole("heading", { name: "Impact", exact: true }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    await shot(page, "impact-empty");
    await ctx.close();
  }

  // --- Volunteer feed card (notch decoration) -------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, "priya@demo.fb");
    await page.goto(`${BASE}/app`);
    await page.getByRole("heading", { name: /rescue feed/i }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await shot(page, "feed-cards");
    await ctx.close();
  }

  await browser.close();
  console.log("done");
})();
