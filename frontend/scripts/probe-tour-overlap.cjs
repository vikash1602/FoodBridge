/* Probe the tour-over-map overlap case: empty feed → missing target →
 * centered card whose right edge sits over the Leaflet map. */
const { chromium } = require("@playwright/test");

const TAG = (process.env.SHOT_TAG ?? "before").trim();
const BASE = "http://localhost:4173";
const DIR = `../docs/screenshots/ui-repair/${TAG}`;

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("fb.tour.v1");
    } catch {
      /* ignore */
    }
  });
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill("priya@demo.fb");
  await page.getByLabel("Password").fill("DemoPass123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });

  const card = page.getByTestId("tour-card");
  await card.waitFor({ timeout: 15_000 });
  await card.getByRole("button", { name: "Next" }).click(); // step 2: badges (no listing → centered card)
  await page.waitForTimeout(1400);

  const overlap = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="tour-card"]');
    const map = document.querySelector(".leaflet-container");
    if (!card || !map) return { card: Boolean(card), map: Boolean(map) };
    const c = card.getBoundingClientRect();
    const m = map.getBoundingClientRect();
    const horizontal = c.right > m.left && c.left < m.right;
    const vertical = c.bottom > m.top && c.top < m.bottom;
    // hit-test the card's right edge at its vertical middle
    const probeX = Math.min(c.right - 4, window.innerWidth - 1);
    const probeY = c.top + c.height / 2;
    const hit = document.elementFromPoint(probeX, probeY);
    return {
      cardRect: { left: Math.round(c.left), right: Math.round(c.right), top: Math.round(c.top), bottom: Math.round(c.bottom) },
      mapLeft: Math.round(m.left),
      overlapsMap: Boolean(horizontal && vertical),
      hitTestAtCardRightEdge: hit ? hit.closest('[data-testid="tour-card"]') ? "tour-card" : (hit.className || hit.tagName).toString().slice(0, 40) : "none",
      cardZ: getComputedStyle(card).zIndex, layerZ: (() => { const layer = card.closest('.fixed'); return layer ? getComputedStyle(layer).zIndex : null; })(),
      inViewport: c.top >= 0 && c.left >= 0 && c.right <= window.innerWidth && c.bottom <= window.innerHeight,
    };
  });
  console.log(JSON.stringify(overlap, null, 2));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/tour-centered-over-map.png` });
  console.log("saved tour-centered-over-map.png");
  await browser.close();
})();
