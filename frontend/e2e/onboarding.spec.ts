/** Phase 3 + 2 E2E: registration role selection, role-specific onboarding
 *  wizards (donor org verification flow, volunteer location/radius flow),
 *  and the pending-verification gate on Post food. */

import { expect, test } from "@playwright/test";

import { createVerifiedDonor, registerVolunteerViaApi, uiLogin } from "./helpers";

const STRONG = "StrongPass123!";

test.describe("Registration role selection", () => {
  test("role choice explains both roles before the form; ?role= preselects", async ({ page }) => {
    test.setTimeout(120_000);

    // Landing CTAs carry ?role= — should land straight on the form.
    await page.goto("/register?role=donor");
    await expect(page.getByText("Food Donor").first()).toBeVisible();
    await expect(page.getByLabel("Full name")).toBeVisible();
    await expect(page.getByText(/submit|signup|After signup/i).first()).toBeVisible();

    // Bare /register starts at the informative choice screen.
    await page.goto("/register");
    await expect(page.getByText("Option A: Food Donor")).toBeVisible();
    await expect(page.getByText(/I have surplus food and want to make it available/i)).toBeVisible();
    await expect(page.getByText("Option B: Volunteer / NGO")).toBeVisible();
    await expect(page.getByText(/I want to discover nearby surplus food, collect it and deliver it/i)).toBeVisible();

    // Picking a role reveals the form with the chosen role summarised.
    await page.getByRole("button", { name: /register as volunteer/i }).click();
    await expect(page.getByLabel("Full name")).toBeVisible();
    await expect(page.getByText(/Volunteer \/ NGO/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Change" })).toBeVisible();
  });

  test("register a volunteer through the UI", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/register");
    await page.getByRole("button", { name: /register as volunteer/i }).click();
    await page.getByLabel("Full name").fill("E2E UI Volunteer");
    await page.getByLabel("Email").fill(`ui.vol.${Date.now()}@e2e.fb`);
    await page.getByLabel("Phone").fill("+919800000000");
    await page.getByLabel("Password", { exact: true }).fill(STRONG);
    await page.getByLabel("Confirm password").fill(STRONG);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
  });
});

test.describe("Volunteer guided onboarding", () => {
  test("personal info is auto-confirmed; location → radius → discovery → feed", async ({ page, request }) => {
    test.setTimeout(180_000);
    const volunteer = await registerVolunteerViaApi(request, "Wizard Volunteer");
    await uiLogin(page, volunteer.email, STRONG);

    await page.goto("/app/onboarding");
    // Personal info complete (API registration collected name+phone) → the
    // wizard lands on the location step.
    await expect(page.getByText(/Where do you usually cook \/ deliver\?/i)).toBeVisible({ timeout: 20_000 });

    // Guided path: Next saves the base location too, then the radius step.
    await page.getByRole("button", { name: /next: notification radius/i }).click();
    await expect(page.getByText(/How far should we look for food\?/i)).toBeVisible({ timeout: 20_000 });

    // Discovery explainer comes from the live config (escalation tiers).
    await page.getByRole("button", { name: /save & continue/i }).click();
    await expect(page.getByText(/How nearby food discovery works/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/alert radius widens/i).first()).toBeVisible();
    await expect(page.getByText(/safe-until countdown/i)).toBeVisible();

    await page.getByRole("button", { name: /got it — show me the feed/i }).click();
    await expect(page.getByText(/The rescue feed & map/i)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /open the rescue feed/i }).click();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /rescue feed/i })).toBeVisible({ timeout: 20_000 });
  });

  test("quick path: Save & start from the location step finishes onboarding", async ({ page, request }) => {
    test.setTimeout(180_000);
    const volunteer = await registerVolunteerViaApi(request, "Quick Volunteer");
    await uiLogin(page, volunteer.email, STRONG);

    await page.goto("/app/onboarding");
    await expect(page.getByText(/Where do you usually cook \/ deliver\?/i)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /save & start/i }).click();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 20_000 });
  });
});

test.describe("Donor guided onboarding", () => {
  test("org wizard: info → address → review → submit → pending explainer", async ({ page, request }) => {
    test.setTimeout(180_000);
    const email = `donor.wiz.${Date.now()}@e2e.fb`;
    const register = await request.post("http://127.0.0.1:8010/api/v1/auth/register/", {
      data: {
        email,
        password: STRONG,
        confirm_password: STRONG,
        role: "donor",
        full_name: "Wizard Donor",
        phone: "+919811111111",
      },
    });
    if (!register.ok()) throw new Error(`register failed: ${await register.text()}`);
    await uiLogin(page, email, STRONG);

    await page.goto("/app/onboarding");
    await expect(page.getByRole("heading", { name: "Your organization" })).toBeVisible({ timeout: 20_000 });

    await page.getByLabel("Organization name").fill(`Wizard Kitchen ${Date.now()}`);
    await page.getByRole("button", { name: "caterer" }).click();
    await page.getByRole("button", { name: /next: address & location/i }).click();

    await expect(page.getByText(/Organization address & location/i)).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Address").fill("42 Wizard Road, Vaniyambadi");
    await page.getByRole("button", { name: /next: review/i }).click();

    await expect(page.getByText(/Review & submit for verification/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("42 Wizard Road, Vaniyambadi")).toBeVisible();
    await page.getByRole("button", { name: /submit for verification/i }).click();

    // The exact pending message from the onboarding spec.
    await expect(page.getByText(/awaiting verification\. You can explore the platform, but food posting becomes available after approval/i)).toBeVisible({
      timeout: 20_000,
    });
  });

  test("post-food gate: pending donor sees the explainer instead of the wizard", async ({ page, request }) => {
    test.setTimeout(180_000);
    const email = `donor.gate.${Date.now()}@e2e.fb`;
    const register = await request.post("http://127.0.0.1:8010/api/v1/auth/register/", {
      data: {
        email,
        password: STRONG,
        confirm_password: STRONG,
        role: "donor",
        full_name: "Gate Donor",
        phone: "+919822222222",
      },
    });
    if (!register.ok()) throw new Error(`register failed: ${await register.text()}`);
    const loginRes = await request.post("http://127.0.0.1:8010/api/v1/auth/login/", { data: { email, password: STRONG } });
    if (!loginRes.ok()) throw new Error(`login failed: ${await loginRes.text()}`);
    const { access: token } = (await loginRes.json()) as { access: string };

    // Submit an org via API so the gate shows the "pending" branch.
    const org = await request.post("http://127.0.0.1:8010/api/v1/organizations/", {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `Gate Kitchen ${Date.now()}`, type: "restaurant", address: "1 Gate Street, Vaniyambadi", lat: 12.682, lng: 78.62 },
    });
    if (!org.ok()) throw new Error(`org create failed: ${await org.text()}`);

    await uiLogin(page, email, STRONG);
    await page.goto("/app/post");
    await expect(page.getByText(/Organization pending verification/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/awaiting verification\. You can explore the platform, but food posting becomes available after approval/i)).toBeVisible();
    await expect(page.getByLabel("What is it?")).toHaveCount(0); // wizard not shown
  });

  test("approved donor gets the posting wizard, no gate", async ({ page, request }) => {
    test.setTimeout(180_000);
    const donor = await createVerifiedDonor(request, "Approved Gate Donor");
    await uiLogin(page, donor.email, STRONG);
    await page.goto("/app/post");
    await expect(page.getByLabel("What is it?")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/After you post/i)).toBeVisible(); // workflow strip
  });
});
