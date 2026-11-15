/** Phase 6 — UI regression suite (runs against the PRODUCTION build via
 *  playwright.ui.config.ts: vite preview :4173 + dev backend :8000).
 *
 *  Covers: Help welcome-panel containment, card-decoration removal, tour
 *  stacking above Leaflet, viewport containment, step navigation, resize,
 *  mobile, map controls, and the Impact empty state. */

import { expect, test, type Page } from "@playwright/test";

// This suite asserts against the production preview + dev-DB data. Under the
// default e2e config (vite dev :5175 + foodbridge_e2e) its data assumptions
// don't hold — skip there; it runs via playwright.ui.config.ts.
test.skip(process.env.UI_REGRESSION !== "1", "runs only via playwright.ui.config.ts (production preview)");

const TOUR_SEEN = JSON.stringify({ volunteer: "completed", donor: "completed" });

async function uiLogin(page: Page, email: string, { tour = false } = {}): Promise<void> {
  await page.addInitScript((seen) => {
    try {
      if (seen) localStorage.setItem("fb.tour.v1", seen);
      else localStorage.removeItem("fb.tour.v1");
    } catch {
      /* ignore */
    }
  }, tour ? null : TOUR_SEEN);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPass123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });
}

function cardBox(page: Page) {
  return page.getByTestId("tour-card").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  });
}

test.describe("Phase 1 — Help welcome panel containment", () => {
  test("controls stay inside their container at desktop, tablet and mobile widths", async ({ page }) => {
    await uiLogin(page, "priya@demo.fb");
    await page.goto("/app/help");
    await expect(page.getByRole("heading", { name: /help & how it works/i })).toBeVisible();

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(300);

      // The quick-actions ticket is the first .ticket on the page.
      const audit = await page.evaluate(() => {
        const card = document.querySelector(".ticket") as HTMLElement | null;
        const restart = [...document.querySelectorAll("button")].find((b) => /restart the volunteer tour/i.test(b.textContent));
        const create = [...document.querySelectorAll("a")].find((a) => /create an account/i.test(a.textContent));
        if (!card || !restart || !create) return { found: false };
        const c = card.getBoundingClientRect();
        const r = restart.getBoundingClientRect();
        const k = create.getBoundingClientRect();
        const inside = (b: DOMRect) =>
          b.top >= c.top - 1 && b.bottom <= c.bottom + 1 && b.left >= c.left - 1 && b.right <= c.right + 1;
        return {
          found: true,
          restartInside: inside(r),
          createInside: inside(k),
          createVisible: k.width > 0 && k.height > 0,
          noDocOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        };
      });

      expect(audit.found, "welcome card + buttons present").toBe(true);
      expect(audit.restartInside, `restart inside card at ${viewport.width}px`).toBe(true);
      expect(audit.createInside, `create account inside card at ${viewport.width}px`).toBe(true);
      expect(audit.createVisible, "create account visible").toBe(true);
      expect(audit.noDocOverflow, `no horizontal overflow at ${viewport.width}px`).toBe(true);
    }
  });

  test("help section navigation wraps without horizontal overflow", async ({ page }) => {
    await uiLogin(page, "priya@demo.fb");
    await page.goto("/app/help");
    await expect(page.getByRole("heading", { name: /help & how it works/i })).toBeVisible();
    for (const width of [1440, 768, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      const navOk = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Help sections"]');
        if (!nav) return false;
        return nav.scrollWidth <= nav.clientWidth + 1;
      });
      expect(navOk, `help nav wraps at ${width}px`).toBe(true);
    }
  });
});

test.describe("Phase 2 — card decorations removed", () => {
  test("no ticket-notch circles remain on any page", async ({ page }) => {
    await uiLogin(page, "priya@demo.fb");
    for (const path of ["/app/help", "/app", "/app/my-claims", "/app/impact"]) {
      await page.goto(path);
      await page.waitForTimeout(700);
      const notches = await page.evaluate(() => document.querySelectorAll(".ticket-notch").length);
      expect(notches, `no .ticket-notch on ${path}`).toBe(0);
    }
  });
});

test.describe("Phase 3 — guided tour vs Leaflet map", () => {
  // meena@demo.fb sits ~15 km out: her feed is empty, so the step-2 card is
  // centered and its right edge overlaps the Leaflet map — the exact case
  // that used to paint map tiles over the tooltip.
  async function tourToStep2(page: Page): Promise<void> {
    await uiLogin(page, "meena@demo.fb", { tour: true });
    await page.goto("/app");
    const card = page.getByTestId("tour-card");
    await card.waitFor({ timeout: 15_000 });
    await card.getByRole("button", { name: "Next" }).click();
    await expect(card.getByText(/Step 2 of 9/)).toBeVisible();
    await page.waitForTimeout(800);
  }

  test("tooltip renders above the Leaflet map when they overlap", async ({ page }) => {
    await tourToStep2(page);
    const result = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="tour-card"]') as HTMLElement;
      const map = document.querySelector(".leaflet-container") as HTMLElement;
      const layer = card.closest(".fixed") as HTMLElement;
      const c = card.getBoundingClientRect();
      const m = map.getBoundingClientRect();
      const overlaps = c.right > m.left && c.left < m.right && c.bottom > m.top && c.top < m.bottom;
      const probeX = Math.min(c.right - 6, window.innerWidth - 1);
      const probeY = c.top + c.height / 2;
      const hit = document.elementFromPoint(probeX, probeY);
      return {
        overlaps,
        layerZ: getComputedStyle(layer).zIndex,
        hitIsCard: Boolean(hit && hit.closest('[data-testid="tour-card"]')),
        mapContained: getComputedStyle(map).zIndex === "0",
      };
    });
    expect(result.overlaps, "test setup: card actually overlaps the map").toBe(true);
    expect(result.layerZ, "tour layer sits at the documented 9100 layer").toBe("9100");
    expect(result.hitIsCard, "hit-test at the overlap point lands on the tour card, not map tiles").toBe(true);
    expect(result.mapContained, "leaflet container is its own stacking context").toBe(true);
  });

  test("tooltip stays fully within the viewport on every volunteer step", async ({ page }) => {
    // 1024x768 is the tightest desktop layout.
    await page.setViewportSize({ width: 1024, height: 768 });
    await uiLogin(page, "priya@demo.fb", { tour: true });
    await page.goto("/app");
    const card = page.getByTestId("tour-card");
    await card.waitFor({ timeout: 15_000 });

    for (let step = 1; step <= 9; step += 1) {
      const box = await cardBox(page);
      expect(box.left, `step ${step}: left edge in viewport`).toBeGreaterThanOrEqual(0);
      expect(box.top, `step ${step}: top edge in viewport`).toBeGreaterThanOrEqual(0);
      expect(box.right, `step ${step}: right edge in viewport`).toBeLessThanOrEqual(1024);
      expect(box.bottom, `step ${step}: bottom edge in viewport`).toBeLessThanOrEqual(768);

      if (step < 9) {
        const travel = card.getByRole("button", { name: /take me there/i });
        if (await travel.isVisible().catch(() => false)) {
          // travelling does NOT advance the step — arrive, then loop re-reads
          await travel.dispatchEvent("click");
          await expect(card).toBeVisible({ timeout: 20_000 });
        } else {
          await card.getByRole("button", { name: "Next" }).click();
          await expect(card.getByText(new RegExp(`Step ${step + 1} of 9`))).toBeVisible({ timeout: 20_000 });
        }
      }
    }
  });

  test("step 6 (filters) highlights the filter control without covering it", async ({ page }) => {
    await uiLogin(page, "priya@demo.fb", { tour: true });
    await page.goto("/app");
    const card = page.getByTestId("tour-card");
    await card.waitFor({ timeout: 15_000 });
    for (let i = 0; i < 5; i += 1) {
      await card.getByRole("button", { name: "Next" }).click();
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.getByText(new RegExp(`Step ${i + 2} of 9`))).toBeVisible({ timeout: 20_000 });
    }
    await expect(card.getByText(/Distance & filters/)).toBeVisible();

    // the Filters button is spotlighted (an overlay rect exists near it) and
    // remains clickable through the click-through overlay
    const filters = page.getByRole("button", { name: /filters/i });
    await expect(filters).toBeVisible();
    const spotlightNearTarget = await page.evaluate(() => {
      const filters = [...document.querySelectorAll("button")].find((b) => /filters/i.test(b.textContent));
      const spot = document.querySelector('[aria-hidden].pointer-events-none.fixed') as HTMLElement | null;
      if (!filters || !spot) return false;
      const f = filters.getBoundingClientRect();
      const s = spot.getBoundingClientRect();
      return Math.abs(s.left - (f.left - 6)) < 4 && Math.abs(s.top - (f.top - 6)) < 4;
    });
    expect(spotlightNearTarget, "spotlight rect aligns with the filters button").toBe(true);
    await filters.click({ trial: true }); // actionability: not covered by the card
  });

  test("Next, Back and Skip work and persist", async ({ page }) => {
    await uiLogin(page, "priya@demo.fb", { tour: true });
    await page.goto("/app");
    const card = page.getByTestId("tour-card");
    await card.waitFor({ timeout: 15_000 });
    await card.getByRole("button", { name: "Next" }).click();
    await expect(card.getByText(/Step 2 of 9/)).toBeVisible();
    await card.getByRole("button", { name: "Back" }).click();
    await expect(card.getByText(/Step 1 of 9/)).toBeVisible();
    await card.getByRole("button", { name: "Skip tour" }).click();
    await expect(card).toBeHidden();
    const stored = await page.evaluate(() => localStorage.getItem("fb.tour.v1"));
    expect(JSON.parse(stored ?? "{}")).toMatchObject({ volunteer: "skipped" });
    await page.reload();
    await expect(page.getByTestId("tour-card")).toBeHidden({ timeout: 10_000 });
  });

  test("tour remains usable after a browser resize mid-step", async ({ page }) => {
    await uiLogin(page, "priya@demo.fb", { tour: true });
    await page.goto("/app");
    const card = page.getByTestId("tour-card");
    await card.waitFor({ timeout: 15_000 });
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(600);
    const box = await cardBox(page);
    expect(box.right).toBeLessThanOrEqual(900);
    expect(box.bottom).toBeLessThanOrEqual(600);
    await card.getByRole("button", { name: "Next" }).click();
    await expect(card.getByText(/Step 2 of 9/)).toBeVisible({ timeout: 10_000 });
  });

  test("mobile: bottom-sheet tour within the viewport, controls usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await uiLogin(page, "priya@demo.fb", { tour: true });
    await page.goto("/app");
    const card = page.getByTestId("tour-card");
    await card.waitFor({ timeout: 15_000 });
    const box = await cardBox(page);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(390);
    expect(box.bottom).toBeLessThanOrEqual(844);
    expect(box.top, "mobile card anchors to the lower half").toBeGreaterThan(844 / 2);
    await card.getByRole("button", { name: "Next" }).click();
    await expect(card.getByText(/Step 2 of 9/)).toBeVisible();
    await card.getByRole("button", { name: "Skip tour" }).click();
    await expect(card).toBeHidden();
  });

  test("leaflet map controls remain functional during the tour", async ({ page }) => {
    await uiLogin(page, "priya@demo.fb", { tour: true });
    await page.goto("/app");
    const card = page.getByTestId("tour-card");
    await card.waitFor({ timeout: 15_000 });
    // walk to step 5 (map)
    for (let i = 0; i < 4; i += 1) {
      await card.getByRole("button", { name: "Next" }).click();
      await page.waitForTimeout(500);
    }
    await expect(card.getByText(/Map markers/)).toBeVisible();

    const zoomIn = page.locator(".leaflet-control-zoom-in");
    await expect(zoomIn).toBeVisible();
    const tileZoom = () =>
      page.evaluate(() => {
        const tiles = [...document.querySelectorAll("img.leaflet-tile")];
        const src = tiles.map((t) => (t as HTMLImageElement).src).find((s) => s.includes("/"));
        // OSM tile URLs look like .../{z}/{x}/{y}.png — z is the 3rd-from-last segment
        const match = src?.match(/\/(\d+)\/\d+\/\d+\./);
        return match ? Number(match[1]) : null;
      });
    const beforeZoom = await tileZoom();
    await zoomIn.click();
    await page.waitForTimeout(900);
    await zoomIn.click();
    await page.waitForTimeout(900);
    const afterZoom = await tileZoom();
    expect(afterZoom, "map zoomed in during the tour").toBeGreaterThan(beforeZoom ?? 0);
    // attribution intact
    await expect(page.locator(".leaflet-control-attribution")).toContainText("OpenStreetMap contributors");
  });
});

test.describe("Button design tokens (button-audit round)", () => {
  /** Padding/box metrics for an element. */
  function metrics(page: Page, locator: ReturnType<Page["getByRole"]>) {
    return locator.evaluate((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        pl: parseFloat(s.paddingLeft),
        pr: parseFloat(s.paddingRight),
        h: r.height,
        w: r.width,
        // no vertical clipping: content box must fit inside the border box
        notClipped: el.scrollHeight <= el.clientHeight + 1,
        color: s.color,
        bg: s.backgroundColor,
      };
    });
  }

  test("Post Food wizard Cancel/Next are comfortably padded, aligned, unclipped", async ({ page }) => {
    await uiLogin(page, "rukmini@demo.fb");
    await page.goto("/app/post");
    await page.getByLabel("What is it?").waitFor();
    await page.getByLabel("What is it?").fill("Token audit feast");

    for (let step = 0; step < 2; step += 1) {
      const cancel = page.getByRole("button", { name: step === 0 ? /cancel/i : /back/i });
      const next = page.getByRole("button", { name: "Next" });
      const c = await metrics(page, cancel);
      const n = await metrics(page, next);
      expect(c.pl, `cancel h-padding step ${step}`).toBeGreaterThanOrEqual(14);
      expect(c.pr, `cancel h-padding step ${step}`).toBeGreaterThanOrEqual(14);
      expect(c.h, `cancel height step ${step}`).toBeGreaterThanOrEqual(40);
      expect(c.notClipped, `cancel not clipped step ${step}`).toBe(true);
      expect(n.pl, "next h-padding").toBeGreaterThanOrEqual(14);
      expect(n.h, "next height").toBeGreaterThanOrEqual(40);
      expect(n.notClipped, "next not clipped").toBe(true);
      // left/right alignment within the content container
      const row = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll("main button")].filter((b) =>
          /cancel|back|next/i.test(b.textContent ?? ""),
        );
        const main = document.querySelector("main")?.getBoundingClientRect();
        const rects = buttons.map((b) => b.getBoundingClientRect());
        return { mainLeft: main?.left ?? 0, firstLeft: Math.min(...rects.map((r) => r.left)), lastRight: Math.max(...rects.map((r) => r.right)) };
      });
      expect(row.firstLeft).toBeGreaterThanOrEqual(row.mainLeft - 1);
      // advance: fill the step's required field so Next enables
      if (step === 0) {
        await page.getByLabel("What is it?").fill("Token audit feast");
      } else {
        await page.getByLabel("How much?").fill("10");
      }
      await next.click();
      await page.waitForTimeout(400);
    }
  });

  test("primary and secondary tokens hold across key pages (light theme)", async ({ page }) => {
    await uiLogin(page, "priya@demo.fb");

    // feed Filters button (compact outline) — was zero-padding before the fix
    await page.goto("/app");
    const filters = page.getByRole("button", { name: /filters/i });
    await expect(filters).toBeVisible();
    const f = await metrics(page, filters);
    expect(f.pl).toBeGreaterThanOrEqual(10);
    expect(f.pr).toBeGreaterThanOrEqual(10);
    expect(f.notClipped).toBe(true);

    // help page: primary (btn-primary) + secondary (btn-outline)
    await page.goto("/app/help");
    const restart = page.getByRole("button", { name: /restart the volunteer tour/i });
    await expect(restart).toBeVisible();
    const r = await metrics(page, restart);
    expect(r.pl).toBeGreaterThanOrEqual(14);
    expect(r.h).toBeGreaterThanOrEqual(40);
    expect(r.notClipped).toBe(true);
    const create = page.getByRole("link", { name: /create an account/i });
    const k = await metrics(page, create);
    expect(k.pl).toBeGreaterThanOrEqual(14);
    expect(k.notClipped).toBe(true);
  });

  test("icon-only buttons remain square with centered icons", async ({ page }) => {
    await uiLogin(page, "priya@demo.fb");
    await page.goto("/app");
    const toggle = page.getByRole("button", { name: /switch to (dark|light) mode/i });
    await expect(toggle).toBeVisible();
    const box = await toggle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const icon = el.querySelector("svg")?.getBoundingClientRect();
      return { w: r.width, h: r.height, iconW: icon?.width ?? 0, iconCentered: icon ? Math.abs(icon.left + icon.width / 2 - (r.left + r.width / 2)) < 2 : false };
    });
    expect(box.w).toBe(box.h); // square
    expect(box.w).toBeGreaterThanOrEqual(40); // touch target
    expect(box.iconCentered, "icon centered in the square").toBe(true);
  });

  test("mobile wizard action group stays inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await uiLogin(page, "rukmini@demo.fb");
    await page.goto("/app/post");
    await page.getByLabel("What is it?").waitFor();
    const audit = await page.evaluate(() => {
      const cancel = [...document.querySelectorAll("main button")].find((b) => /cancel/i.test(b.textContent ?? ""));
      const next = [...document.querySelectorAll("main button")].find((b) => b.textContent?.trim() === "Next");
      const vw = window.innerWidth;
      const ok = (el?: HTMLElement) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= vw && r.width > 0;
      };
      return {
        cancelOk: ok(cancel),
        nextOk: ok(next),
        noDocOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      };
    });
    expect(audit.cancelOk, "cancel within viewport at 390px").toBe(true);
    expect(audit.nextOk, "next within viewport at 390px").toBe(true);
    expect(audit.noDocOverflow, "no horizontal page overflow").toBe(true);
  });

  test("primary button text contrast holds in dark and light themes", async ({ page }) => {
    // light: paper text on forest-700
    await uiLogin(page, "priya@demo.fb");
    await page.goto("/app/help");
    const restart = page.getByRole("button", { name: /restart the volunteer tour/i });
    await expect(restart).toBeVisible();
    const light = await metrics(page, restart);
    expect(light.color).toBe("rgb(250, 246, 236)");

    // dark: pantry-950 text on forest-400 (contrast repair)
    await page.evaluate(() => {
      localStorage.setItem("fb.theme", "dark");
      document.documentElement.classList.add("dark");
    });
    await page.reload();
    const restart2 = page.getByRole("button", { name: /restart the volunteer tour/i });
    await expect(restart2).toBeVisible();
    const dark = await metrics(page, restart2);
    expect(dark.bg).toBe("rgb(93, 166, 125)");
    expect(dark.color).toBe("rgb(21, 16, 9)");
  });
});

test.describe("Phase 4 — Impact empty state", () => {
  test("zero state keeps the truthful message and the established button", async ({ page }) => {
    await uiLogin(page, "karan@demo.fb");
    await page.goto("/app/impact");
    await expect(page.getByText(/No impact data yet/i)).toBeVisible();
    await expect(page.getByText(/Impact numbers appear here once real rescues happen/i)).toBeVisible();

    const cta = page.getByRole("link", { name: /open the rescue feed/i });
    await expect(cta).toBeVisible();
    const styles = await cta.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color, cls: el.className };
    });
    expect(styles.cls).toContain("btn-primary");
    // forest-700 bg with paper text — the established primary button
    expect(styles.bg).toBe("rgb(35, 88, 63)");
    expect(styles.color).toBe("rgb(250, 246, 236)");

    // no fabricated counters on the zero state
    await expect(page.getByText(/meals rescued/i)).toHaveCount(0);
  });

  test("dark-mode primary buttons keep readable text (contrast repair)", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("fb.theme", "dark");
      } catch {
        /* ignore */
      }
    });
    await uiLogin(page, "priya@demo.fb");
    await page.goto("/app/help");
    await expect(page.getByRole("heading", { name: /help & how it works/i })).toBeVisible();
    const restart = page.getByRole("button", { name: /restart the volunteer tour/i });
    await expect(restart).toBeVisible();
    const styles = await restart.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color };
    });
    // dark mode: forest-400 bg with pantry-950 text (was forest-500 — 3.7:1)
    expect(styles.bg).toBe("rgb(93, 166, 125)");
    expect(styles.color).toBe("rgb(21, 16, 9)");
  });
});
