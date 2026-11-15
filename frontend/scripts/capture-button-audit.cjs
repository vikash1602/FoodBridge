/** Button-audit evidence: Post Food wizard action row + key pages, light+dark.
 *  Prereqs: backend :8000, `npm run preview -- --port 4173`.
 *  Run: set SHOT_TAG=before|after && node scripts/capture-button-audit.cjs
 */
const { chromium } = require("@playwright/test");

const TAG = (process.env.SHOT_TAG ?? "before").trim();
const BASE = "http://localhost:4173";
const DIR = `../docs/screenshots/button-audit/${TAG}`;
const TOUR_SEEN = JSON.stringify({ volunteer: "completed", donor: "completed" });

async function newPage(browser, theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("fb.tour.v1", JSON.stringify({ volunteer: "completed", donor: "completed" }));
      localStorage.setItem("fb.theme", t);
    } catch {
      /* ignore */
    }
  }, theme);
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill("rukmini@demo.fb");
  await page.getByLabel("Password").fill("DemoPass123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });
  return { ctx, page };
}

async function shot(page, name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/${name}.png` });
  console.log(`saved ${name}.png`);
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });

  for (const theme of ["dark", "light"]) {
    const { ctx, page } = await newPage(browser, theme);

    // Post Food wizard step 0 (food-type selectors + bottom Cancel/Next row)
    await page.goto(`${BASE}/app/post`);
    await page.getByLabel("What is it?").waitFor({ timeout: 20_000 });
    await page.getByLabel("What is it?").fill("Audit shot feast");
    await page.getByRole("button", { name: /cancel|back/i }).scrollIntoViewIfNeeded();
    await shot(page, `post-step0-${theme}`);
    await page.getByRole("button", { name: /next/i }).click();
    await page.getByLabel("How much?").fill("10");
    await page.getByRole("button", { name: /cancel|back/i }).scrollIntoViewIfNeeded();
    await shot(page, `post-step1-${theme}`);
    await page.getByRole("button", { name: /next/i }).click();
    await page.getByLabel("Pickup address").fill("1 Audit Road, Vaniyambadi");
    await page.getByRole("button", { name: /cancel|back/i }).scrollIntoViewIfNeeded();
    await shot(page, `post-step2-${theme}`);

    // donor pages with primary/outline actions
    await page.goto(`${BASE}/app/my-listings`);
    await page.getByRole("heading", { name: /my listings/i }).waitFor({ timeout: 20_000 });
    await shot(page, `my-listings-${theme}`);

    // volunteer empty-state buttons (outline defaults)
    const { ctx: vctx, page: vpage } = await newPage(browser, theme);
    await vpage.goto(`${BASE}/app/my-claims`);
    await vpage.getByRole("heading", { name: /my rescues/i }).waitFor({ timeout: 20_000 });
    await shot(vpage, `my-claims-${theme}`);
    await vctx.close();

    // mobile wizard action row
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mpage = await mctx.newPage();
    await mpage.addInitScript((t) => {
      try {
        localStorage.setItem("fb.tour.v1", JSON.stringify({ volunteer: "completed", donor: "completed" }));
        localStorage.setItem("fb.theme", t);
      } catch {
        /* ignore */
      }
    }, theme);
    await mpage.goto(`${BASE}/login`);
    await mpage.getByLabel("Email").fill("rukmini@demo.fb");
    await mpage.getByLabel("Password").fill("DemoPass123!");
    await mpage.getByRole("button", { name: /sign in/i }).click();
    await mpage.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });
    await mpage.goto(`${BASE}/app/post`);
    await mpage.getByLabel("What is it?").waitFor({ timeout: 20_000 });
    await shot(mpage, `post-mobile-${theme}`);
    await mctx.close();

    await ctx.close();
  }

  await browser.close();
  console.log("done");
})();
