/** Phase 1 — LocationPicker browser verification.
 *  Covers: geolocation auto-detect, city fallback, fixed centre pin, drag +
 *  reverse geocoding, Nominatim autocomplete, recent places, organization
 *  address, and mobile confirmation — against the production preview build. */

import { expect, test, type Page } from "@playwright/test";

import { loginWithOtp } from "./helpers";

/** Vaniyambadi-area point used to simulate the browser's GPS. */
const GPS_POINT = { latitude: 12.7295, longitude: 78.641 }; // near Amburpet
const CITY_CENTER_TEXT = "12.68190, 78.62000";

async function toLocationStep(page: Page, title: string): Promise<void> {
  await page.goto("/app/post");
  await page.getByLabel("What is it?").fill(title);
  await page.getByRole("button", { name: /next/i }).click();
  await page.getByLabel("How much?").fill("6");
  await page.getByRole("button", { name: /next/i }).click();
  await page.getByLabel("Pickup address").waitFor({ timeout: 20_000 });
}

test.describe("LocationPicker — geolocation granted", () => {
  test.use({
    permissions: ["geolocation"],
    geolocation: GPS_POINT,
  });

  test("auto-detects browser geolocation at the picker", async ({ page }) => {
    test.setTimeout(180_000);
    await loginWithOtp(page, "rukmini@demo.fb");
    await toLocationStep(page, `Geo detect ${Date.now()}`);

    // The readout must move from the city centre to the simulated GPS fix.
    await expect(page.getByText(/12\.7295/)).toBeVisible({ timeout: 20_000 });
    // Reverse geocode autofills the editable address (Nominatim).
    await expect(page.getByText(/Amburpet|road|Street|Nagar|Vaniyambadi/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("fixed centre pin: dragging the map moves the pickup point, not a tap", async ({ page }) => {
    test.setTimeout(180_000);
    await loginWithOtp(page, "rukmini@demo.fb");
    await toLocationStep(page, `Fixed pin ${Date.now()}`);

    const readout = page.getByText(/12\.\d{5}, 78\.\d{5}/);
    await expect(readout).toBeVisible({ timeout: 20_000 });
    const before = (await readout.textContent()) ?? "";

    // Drag the map under the fixed pin (mouse down → move → up on the map).
    const map = page.locator(".leaflet-container").first();
    const box = await map.boundingBox();
    if (!box) throw new Error("map not visible");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 140, cy - 90, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1200); // moveend + debounced reverse geocode

    const after = (await readout.textContent()) ?? "";
    expect(after).not.toBe(before);
  });

  test("Nominatim autocomplete jumps the map", async ({ page }) => {
    test.setTimeout(180_000);
    await loginWithOtp(page, "rukmini@demo.fb");
    await toLocationStep(page, `Autocomplete ${Date.now()}`);

    await page.getByLabel("Search for a place").fill("Ambur bus");
    const option = page.getByRole("option").first();
    await option.waitFor({ timeout: 20_000 });
    await option.click();
    // Address input gets the selected/reverse-geocoded value.
    await expect(page.getByLabel("Pickup address")).toHaveValue(/.{4,}/, { timeout: 20_000 });
  });

  test("one-tap options: current location, org address, recent places", async ({ page }) => {
    test.setTimeout(180_000);
    await loginWithOtp(page, "rukmini@demo.fb");
    await toLocationStep(page, `One-tap ${Date.now()}`);

    // Quick-area chips from the config endpoint.
    await expect(page.getByRole("button", { name: /Bus Stand/i })).toBeVisible({ timeout: 20_000 });
    // Organization address one-tap (rukmini owns Rukmini Biryani House).
    const orgButton = page.getByRole("button", { name: /same as/i });
    await expect(orgButton).toBeVisible();
    await orgButton.click();
    await expect(page.getByText(/12\.783/)).toBeVisible({ timeout: 20_000 }); // Ambur org coords
    // Recent places chips from previous listings.
    await expect(page.getByText(/Recent places/i)).toBeVisible();
  });
});

test.describe("LocationPicker — geolocation denied", () => {
  test("falls back silently to the Vaniyambadi city centre", async ({ page }) => {
    test.setTimeout(180_000);
    await loginWithOtp(page, "rukmini@demo.fb");
    await toLocationStep(page, `Fallback ${Date.now()}`);

    // Denied/absent geolocation → picker settles on the default centre.
    await expect(page.getByText(CITY_CENTER_TEXT)).toBeVisible({ timeout: 20_000 });
    // And the flow is never blocked by geocoding: fill the address and the
    // wizard stays completable (the address rule is a wizard requirement,
    // independent of geolocation).
    await page.getByLabel("Pickup address").fill("1 City Centre Road, Vaniyambadi");
    await expect(page.getByRole("button", { name: /post it/i })).toBeEnabled({ timeout: 10_000 });
  });
});

test.describe("LocationPicker — volunteer onboarding + mobile confirm", () => {
  test.use({
    viewport: { width: 390, height: 780 },
    permissions: ["geolocation"],
    geolocation: GPS_POINT,
  });

  test("mobile: picker on onboarding with visible confirm, save works", async ({ page }) => {
    test.setTimeout(180_000);
    // Mobile viewport: password login (the OTP path can't be asserted in E2E
    // now that Resend is configured — no dev code toast). The first-login
    // product tour is suppressed so it can't cover the picker on mobile.
    await page.addInitScript(() => {
      try {
        localStorage.setItem("fb.tour.v1", JSON.stringify({ volunteer: "completed", donor: "completed" }));
      } catch {
        /* ignore */
      }
    });
    await page.goto("/login");
    await page.getByLabel("Email").fill("karan@demo.fb");
    await page.getByLabel("Password").fill("DemoPass123!");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });

    await page.goto("/app/onboarding");
    await expect(page.getByText(/Where do you usually cook/i)).toBeVisible({ timeout: 20_000 });

    // Confirm button is visible on mobile and stays in view.
    const confirm = page.getByRole("button", { name: /save & start/i });
    await expect(confirm).toBeVisible();

    // Geolocation auto-detect fills the base location; save persists it.
    await confirm.click();
    await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
  });
});
