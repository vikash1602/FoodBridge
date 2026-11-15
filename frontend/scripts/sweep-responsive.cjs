/** Phase 5 responsive sweep: every app page × every required viewport.
 *  Programmatically flags (a) document-level horizontal scroll and (b) visible
 *  elements poking beyond the right/left viewport edge; saves a screenshot of
 *  every combination for review.
 *
 *  Loop order is role → viewport → page so each role logs in exactly ONCE
 *  (rapid repeated logins trip the dev backend's per-IP login throttle).
 *
 *  Prereqs: backend :8000 (demo seed), `npm run preview -- --port 4173`.
 *  Run: node scripts/sweep-responsive.cjs
 *  Output: ../docs/screenshots/ui-repair/sweep/*.png + sweep-report.json
 */
const { chromium } = require("@playwright/test");
const fs = require("fs");

const BASE = "http://localhost:4173";
const DIR = "../docs/screenshots/ui-repair/sweep";

const VIEWPORTS = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1495x723", width: 1495, height: 723 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "390x844", width: 390, height: 844 },
  { name: "360x800", width: 360, height: 800 },
];

const PAGES = {
  volunteer: [
    { name: "landing", path: "/", ready: "h1" },
    { name: "login", path: "/login", ready: "text=Welcome back" },
    { name: "register", path: "/register", ready: "text=Choose your role" },
    { name: "volunteer-feed", path: "/app", ready: "text=Rescue feed" },
    { name: "my-rescues", path: "/app/my-claims", ready: "text=My rescues" },
    { name: "impact", path: "/app/impact", ready: "h1:has-text('Impact')" },
    { name: "leaderboard", path: "/app/leaderboard", ready: "h1" },
    { name: "profile", path: "/app/profile", ready: "text=Trust score" },
    { name: "help", path: "/app/help", ready: "text=Help & how it works" },
    { name: "notifications", path: "/app/notifications", ready: "h1" },
  ],
  donor: [
    { name: "donor-my-listings", path: "/app/my-listings", ready: "text=My listings" },
    { name: "donor-post", path: "/app/post", ready: "text=Post surplus food" },
    { name: "donor-impact", path: "/app/impact", ready: "h1:has-text('Impact')" },
  ],
  admin: [{ name: "admin-console", path: "/app/admin", ready: "text=Admin console" }],
};

const EMAILS = { volunteer: "priya@demo.fb", donor: "rukmini@demo.fb", admin: "admin@foodbridge.dev" };
const TOUR_SEEN = JSON.stringify({ volunteer: "completed", donor: "completed" });

const report = [];

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });

  for (const [role, pages] of Object.entries(PAGES)) {
    // one context per role → exactly one login per role for the whole sweep
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let page = await ctx.newPage();
    await page.addInitScript((seen) => {
      try {
        localStorage.setItem("fb.tour.v1", seen);
      } catch {
        /* ignore */
      }
    }, TOUR_SEEN);

    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email").fill(EMAILS[role]);
    await page.getByLabel("Password").fill("DemoPass123!");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });

    for (const viewport of VIEWPORTS) {
      // fresh page per viewport: frees accumulated tab memory without a
      // re-login (localStorage — including the JWT — lives on the context)
      if (page) await page.close().catch(() => undefined);
      page = await ctx.newPage();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const target of pages) {
        try {
          await page.goto(`${BASE}${target.path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await page.locator(target.ready).first().waitFor({ timeout: 20_000 });
          await page.waitForTimeout(900); // fonts, maps, animations settle

          const audit = await page.evaluate(() => {
            const vw = window.innerWidth;
            const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
            const escapees = [];
            for (const el of document.querySelectorAll("body *")) {
              const box = el.getBoundingClientRect();
              if (box.width === 0 || box.height === 0) continue;
              const s = getComputedStyle(el);
              if (s.position === "fixed" || s.position === "absolute") continue; // overlays/portals audited separately
              if (el.closest(".leaflet-container")) continue; // map internals are clipped by the map
              if (el.closest('[aria-hidden="true"]')) continue; // decorative clipped content (marquee)
              if (box.right > vw + 2 || box.left < -2) {
                escapees.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}`);
                if (escapees.length >= 5) break;
              }
            }
            return { docOverflow, escapees };
          });

          const shot = `${target.name}-${viewport.name}.png`;
          await page.screenshot({ path: `${DIR}/${shot}` });
          report.push({ viewport: viewport.name, page: target.name, role, ...audit, screenshot: shot });
          if (audit.docOverflow || audit.escapees.length) {
            console.log(`FLAG ${viewport.name} ${target.name}: overflow=${audit.docOverflow} escapees=${JSON.stringify(audit.escapees)}`);
          }
        } catch (error) {
          report.push({ viewport: viewport.name, page: target.name, role, error: String(error).slice(0, 160) });
          console.log(`ERROR ${viewport.name} ${target.name}: ${String(error).slice(0, 120)}`);
          // a wedged page breaks every navigation after it — recover once
          try {
            await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 20_000 });
          } catch {
            /* context is beyond recovery; keep going and let the report show it */
          }
        }
      }
    }
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync("sweep-report.json", JSON.stringify(report, null, 2));
  const flagged = report.filter((r) => r.docOverflow || (r.escapees && r.escapees.length) || r.error);
  console.log(`\nsweep done: ${report.length} combos, ${flagged.length} flagged`);
})();
