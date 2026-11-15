/** Full rescue lifecycle through the real UI:
 *  donor posts listing -> volunteer claims -> pickup code -> deliver (+confetti). */

import { expect, test, type Page } from "@playwright/test";

import {
  createListingViaApi,
  createVerifiedDonor,
  registerVolunteerViaApi,
  uiLogin,
  uiLogout,
} from "./helpers";

async function postListingViaWizard(page: Page, title: string): Promise<void> {
  await page.goto("/app/post");
  await page.getByLabel("What is it?").fill(title);
  await page.getByRole("button", { name: /next/i }).click();
  await page.getByLabel("How much?").fill("14");
  await page.getByRole("button", { name: "meals", exact: true }).click();
  await page.getByRole("button", { name: /next/i }).click();
  await page.getByLabel("Pickup address").fill("14 Wizard Street, Vaniyambadi");
  // Keep default pin (city centre) and 4h window; post it.
  await page.getByRole("button", { name: /post it/i }).click();
  await expect(page).toHaveURL(/\/app\/my-listings$/, { timeout: 20_000 });
}

test("donor posts, volunteer claims, code verifies, rescue delivers", async ({ page, request }) => {
  test.setTimeout(240_000);
  const title = `E2E Feast ${Date.now()}`;

  // --- setup: verified donor + volunteer via API ----------------------------
  const donor = await createVerifiedDonor(request, "E2E Donor");
  const volunteer = await registerVolunteerViaApi(request, "E2E Volunteer");

  // --- donor posts via the wizard -------------------------------------------
  await uiLogin(page, donor.email, "StrongPass123!");
  await postListingViaWizard(page, title);
  await expect(page.getByText(title).first()).toBeVisible();

  // --- volunteer claims from the live feed ----------------------------------
  await uiLogout(page);
  await uiLogin(page, volunteer.email, "StrongPass123!");
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: /rescue feed/i })).toBeVisible({ timeout: 20_000 });
  const claimButton = page.getByRole("button", { name: `Claim ${title}` });
  await expect(claimButton).toBeVisible({ timeout: 25_000 });
  await claimButton.click();
  await expect(page).toHaveURL(/\/app\/my-claims$/, { timeout: 25_000 });
  await expect(page.getByText(title).first()).toBeVisible();
  await expect(page.getByText(/active/i).first()).toBeVisible();

  // --- donor sees the pickup code ticket ------------------------------------
  await uiLogout(page);
  await uiLogin(page, donor.email, "StrongPass123!");
  await page.goto("/app/my-listings");
  const codeCard = page.getByText(/pickup code — show the volunteer/i);
  await expect(codeCard).toBeVisible({ timeout: 20_000 });
  const digits = await page.locator(".font-display.tracking-\\[0\\.35em\\]").first().innerText();
  const code = digits.replace(/\D/g, "");
  expect(code).toHaveLength(4);

  // --- volunteer enters the code, delivers, confetti ------------------------
  await uiLogout(page);
  await uiLogin(page, volunteer.email, "StrongPass123!");
  await page.goto("/app/my-claims");
  await page.getByRole("button", { name: /verify pickup/i }).click();
  for (let i = 0; i < 4; i += 1) {
    await page.getByLabel(`Digit ${i + 1}`).fill(code[i] ?? "0");
  }
  await expect(page.getByText(/pickup verified/i)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /mark delivered/i }).click();
  await page.getByLabel("Delivery note").fill("E2E delivery: handed to the shelter 🎉");
  await page.getByRole("button", { name: /deliver & celebrate/i }).click();
  await expect(page.getByText(/rescue delivered/i).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("DELIVERED").first()).toBeVisible();
});

test("two volunteers claim at once — the loser sees the 409 toast", async ({ page, request }) => {
  test.setTimeout(240_000);
  const donor = await createVerifiedDonor(request, "Race Donor");
  const volA = await registerVolunteerViaApi(request, "Race Volunteer A");
  const volB = await registerVolunteerViaApi(request, "Race Volunteer B");
  const title = `Race Listing ${Date.now()}`;
  const listingId = await createListingViaApi(request, donor.token, title);

  // Volunteer B loads the feed FIRST — a view that will become stale.
  await uiLogin(page, volB.email, "StrongPass123!");
  await page.goto("/app");
  const staleClaim = page.getByRole("button", { name: `Claim ${title}` });
  await expect(staleClaim).toBeVisible({ timeout: 25_000 });

  // While B stares at the stale feed, volunteer A claims via the API.
  const race = await request.post(`http://127.0.0.1:8010/api/v1/listings/${listingId}/claim/`, {
    headers: { Authorization: `Bearer ${volA.token}` },
  });
  if (!race.ok()) throw new Error(`volunteer A claim failed: ${await race.text()}`);

  // B clicks on the now-stale card -> the server answers 409 with the friendly toast.
  await staleClaim.click();
  await expect(page.getByText(/someone just claimed this/i)).toBeVisible({ timeout: 20_000 });
});
