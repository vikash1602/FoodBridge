/** Verify the Support & report issues section renders the owner email
 *  with the exact mailto, in both themes.
 *  Prereqs: backend :8000, `npm run preview -- --port 4173`.
 *  Run: node scripts/verify-support-email.cjs
 */
const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  for (const theme of ["light", "dark"]) {
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
    await page.goto("http://localhost:4173/login");
    await page.getByLabel("Email").fill("priya@demo.fb");
    await page.getByLabel("Password").fill("DemoPass123!");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/app(\/|$)/, { timeout: 30000 });
    await page.goto("http://localhost:4173/app/help");
    const section = page.locator("#support");
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const audit = await section.evaluate((el) => {
      const link = el.querySelector('a[href^="mailto:"]');
      return {
        href: link ? link.getAttribute("href") : null,
        label: link ? link.textContent.trim() : null,
        ownerVisible: el.textContent.includes("vikashvnb2005@gmail.com"),
        placeholderGone: !el.textContent.includes("support@foodbridge.app"),
        replaceNoteGone: !el.textContent.includes("replace with your production"),
      };
    });
    console.log(theme, JSON.stringify(audit));
    await page.screenshot({ path: `../docs/screenshots/support-email-${theme}.png` });
    await ctx.close();
  }
  await browser.close();
  console.log("done");
})();
