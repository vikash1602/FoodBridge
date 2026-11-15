/** Phase 4 E2E: the first-login dashboard product tour.
 *  Auto-start once per role, Next/Back navigation, cross-page "Take me there"
 *  steps, completion persistence, outside-click dismissal, restart from the
 *  Help centre, and the mobile bottom-sheet layout. */

import { expect, test } from "@playwright/test";

import { API, createVerifiedDonor, registerVolunteerViaApi, uiLoginWithTour } from "./helpers";

async function setVolunteerBase(request: Parameters<typeof createVerifiedDonor>[0], token: string): Promise<void> {
  const patch = await request.patch(`${API}/auth/me/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { base_lat: 12.682, base_lng: 78.62, notify_radius_km: 8 },
  });
  if (!patch.ok()) throw new Error(`base patch failed: ${await patch.text()}`);
}

test.describe("Volunteer tour", () => {
  test("auto-starts once, navigates steps, persists completion, restartable from Help", async ({ page, request }) => {
    test.setTimeout(300_000);
    const volunteer = await registerVolunteerViaApi(request, "Tour Volunteer");
    await setVolunteerBase(request, volunteer.token);

    await uiLoginWithTour(page, volunteer.email, "StrongPass123!");
    await page.goto("/app");

    // Auto-start (after ~0.9 s) on the feed, step 1 of 9.
    const card = page.getByTestId("tour-card");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText(/Step 1 of 9/)).toBeVisible();
    await expect(card.getByText(/The rescue feed/)).toBeVisible();

    // Next → step 2, Back → step 1.
    await card.getByRole("button", { name: "Next" }).click();
    await expect(card.getByText(/Step 2 of 9/)).toBeVisible({ timeout: 10_000 });
    await card.getByRole("button", { name: "Back" }).click();
    await expect(card.getByText(/Step 1 of 9/)).toBeVisible({ timeout: 10_000 });

    // Walk the whole tour. Cross-page steps show a "Take me there" card —
    // travelling does NOT advance the step, so loop until Finish.
    // dispatchEvent is used for travel clicks: the click navigates, the card
    // re-anchors and the button detaches — a normal click() would retry
    // forever on the detached locator.
    for (let guard = 0; guard < 24; guard += 1) {
      const travel = card.getByRole("button", { name: /take me there/i });
      if (await travel.isVisible().catch(() => false)) {
        await travel.dispatchEvent("click");
        await expect(card).toBeVisible({ timeout: 20_000 });
        continue; // arrived at the step's page — now Next will advance
      }
      const label = await card.getByText(/Step \d+ of 9/).textContent();
      const num = Number(label?.match(/\d+/)?.[0] ?? 0);
      if (num >= 9) {
        await card.getByRole("button", { name: /finish/i }).click();
        break;
      }
      await card.getByRole("button", { name: "Next" }).click();
      await expect(card.getByText(new RegExp(`Step ${num + 1} of 9`))).toBeVisible({ timeout: 20_000 });
    }

    // Tour finished and persisted.
    await expect(card).toBeHidden();
    const stored = await page.evaluate(() => localStorage.getItem("fb.tour.v1"));
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored ?? "{}")).toMatchObject({ volunteer: "completed" });

    // Reload → no auto-restart.
    await page.reload();
    await expect(page.getByTestId("tour-card")).toBeHidden({ timeout: 15_000 });

    // Restart from the Help centre.
    await page.goto("/app/help");
    await expect(page.getByRole("heading", { name: /help & how it works/i })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /restart the volunteer tour/i }).click();
    await expect(page.getByTestId("tour-card")).toBeVisible({ timeout: 15_000 });
    // Starting the tour from Help shows step 1; navigate to the feed for its target.
    const travel2 = page.getByTestId("tour-card").getByRole("button", { name: /take me there/i });
    if (await travel2.isVisible().catch(() => false)) await travel2.dispatchEvent("click");
    await expect(page.getByTestId("tour-card")).toBeVisible();
  });

  test("outside click dismisses the tour (never blocks the app)", async ({ page, request }) => {
    test.setTimeout(180_000);
    const volunteer = await registerVolunteerViaApi(request, "Clickaway Volunteer");
    await setVolunteerBase(request, volunteer.token);
    await uiLoginWithTour(page, volunteer.email, "StrongPass123!");
    await page.goto("/app");
    const card = page.getByTestId("tour-card");
    await expect(card).toBeVisible({ timeout: 15_000 });

    // The overlay is click-through: clicking the page ends the tour and the
    // click lands on the app (here: the Filters button stays clickable).
    await page.getByRole("button", { name: /filters/i }).click({ position: { x: 4, y: 4 } }).catch(async () => {
      await page.mouse.click(640, 300);
    });
    await expect(card).toBeHidden({ timeout: 10_000 });
  });
});

test.describe("Donor tour", () => {
  test("auto-starts with 7 steps and travels across pages", async ({ page, request }) => {
    test.setTimeout(240_000);
    const donor = await createVerifiedDonor(request, "Tour Donor");
    await uiLoginWithTour(page, donor.email, "StrongPass123!");
    await page.goto("/app");

    const card = page.getByTestId("tour-card");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText(/Step 1 of 7/)).toBeVisible();
    await expect(card.getByText(/Your dashboard/)).toBeVisible();

    // Step 2 lives on /app/post — the travel card appears and navigates.
    await card.getByRole("button", { name: "Next" }).click();
    const travel = card.getByRole("button", { name: /take me there/i });
    await expect(travel).toBeVisible({ timeout: 10_000 });
    await travel.dispatchEvent("click");
    await expect(page).toHaveURL(/\/app\/post$/, { timeout: 20_000 });
    await expect(card.getByText(/Step 2 of 7/)).toBeVisible({ timeout: 20_000 });

    // Skip mid-tour → marked skipped, stays away after reload.
    await card.getByRole("button", { name: "Skip tour" }).click();
    await expect(card).toBeHidden({ timeout: 10_000 });
    const stored = await page.evaluate(() => localStorage.getItem("fb.tour.v1"));
    expect(JSON.parse(stored ?? "{}")).toMatchObject({ donor: "skipped" });
    await page.reload();
    await expect(page.getByTestId("tour-card")).toBeHidden({ timeout: 15_000 });
  });
});

test.describe("Mobile tour", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("tour renders as a bottom sheet with working Next/Skip", async ({ page, request }) => {
    test.setTimeout(180_000);
    const donor = await createVerifiedDonor(request, "Mobile Tour Donor");
    await uiLoginWithTour(page, donor.email, "StrongPass123!");
    await page.goto("/app");

    const card = page.getByTestId("tour-card");
    await expect(card).toBeVisible({ timeout: 15_000 });
    const box = await card.boundingBox();
    expect(box).toBeTruthy();
    // Bottom sheet: anchored to the lower half of the viewport.
    expect((box?.y ?? 0)).toBeGreaterThan(844 / 2);

    await card.getByRole("button", { name: "Next" }).click();
    await expect(card.getByText(/Step 2 of 7/)).toBeVisible({ timeout: 10_000 });
    await card.getByRole("button", { name: "Skip tour" }).click();
    await expect(card).toBeHidden({ timeout: 10_000 });
  });
});
