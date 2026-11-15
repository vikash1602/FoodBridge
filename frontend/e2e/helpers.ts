/** Shared E2E helpers: API setup via the backend, UI login via the app. */

import { APIRequestContext, Page, expect } from "@playwright/test";

export const API = "http://127.0.0.1:8010/api/v1";
export const DEMO_PASSWORD = "DemoPass123!";

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1000)}@e2e.fb`;
}

async function loginViaApi(request: APIRequestContext, email: string, password: string): Promise<string> {
  const response = await request.post(`${API}/auth/login/`, { data: { email, password } });
  if (!response.ok()) throw new Error(`API login failed for ${email}: ${await response.text()}`);
  const json = (await response.json()) as { access: string };
  return json.access;
}

/** Register a donor via API and get their organization approved by the admin. */
export async function createVerifiedDonor(
  request: APIRequestContext,
  name: string,
): Promise<{ email: string; token: string; orgName: string }> {
  const email = uniqueEmail("donor");
  const password = "StrongPass123!";
  const register = await request.post(`${API}/auth/register/`, {
    data: { email, password, confirm_password: password, role: "donor", full_name: name, phone: "+919876543200" },
  });
  if (!register.ok()) throw new Error(`register failed: ${await register.text()}`);

  const donorToken = await loginViaApi(request, email, password);
  const orgName = `E2E Kitchen ${Date.now()}`;
  const org = await request.post(`${API}/organizations/`, {
    headers: { Authorization: `Bearer ${donorToken}` },
    data: { name: orgName, type: "restaurant", address: "12 Test Street, Vaniyambadi", lat: 12.682, lng: 78.62 },
  });
  if (!org.ok()) throw new Error(`org create failed: ${await org.text()}`);

  const adminToken = await loginViaApi(request, "admin@foodbridge.dev", DEMO_PASSWORD);
  const orgId = ((await org.json()) as { id: number }).id;
  const approve = await request.post(`${API}/organizations/${orgId}/approve/`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { note: "e2e auto-approve" },
  });
  if (!approve.ok()) throw new Error(`approve failed: ${await approve.text()}`);
  return { email, token: donorToken, orgName };
}

export async function registerVolunteerViaApi(
  request: APIRequestContext,
  name: string,
): Promise<{ email: string; token: string }> {
  const email = uniqueEmail("volunteer");
  const password = "StrongPass123!";
  const register = await request.post(`${API}/auth/register/`, {
    data: { email, password, confirm_password: password, role: "volunteer", full_name: name, phone: "+919765432100" },
  });
  if (!register.ok()) throw new Error(`volunteer register failed: ${await register.text()}`);
  const token = await loginViaApi(request, email, password);
  return { email, token };
}

/** Create an open listing near the city centre via API. */
export async function createListingViaApi(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<number> {
  const response = await request.post(`${API}/listings/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title,
      food_type: "cooked",
      is_veg: true,
      quantity_value: 10,
      quantity_unit: "meals",
      pickup_address: "12 Test Street, Vaniyambadi",
      lat: 12.6825,
      lng: 78.6215,
      ready_from: new Date().toISOString(),
      safe_until: new Date(Date.now() + 3 * 3600_000).toISOString(),
    },
  });
  if (!response.ok()) throw new Error(`listing create failed: ${await response.text()}`);
  return ((await response.json()) as { id: number }).id;
}

export async function loginWithOtp(page: Page, email: string): Promise<void> {
  // Demo accounts share DemoPass123!; password login is used because Resend
  // is configured and the dev_code toast no longer appears (Phase C fix).
  await uiLogin(page, email, DEMO_PASSWORD);
}

async function doUiLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // URL is the viewport-agnostic success signal: mobile viewports have no
  // desktop sidebar, so the Sign out button is not always present.
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });
}

export async function uiLogin(page: Page, email: string, password: string): Promise<void> {
  // The first-login product tour must not interfere with flow tests — mark
  // tours as already seen. Tour-specific specs use uiLoginWithTour to
  // exercise the real auto-start.
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "fb.tour.v1",
        JSON.stringify({ volunteer: "completed", donor: "completed" }),
      );
    } catch {
      /* storage unavailable */
    }
  });
  await doUiLogin(page, email, password);
}

/** Login WITHOUT suppressing the product tour — for tour/onboarding specs. */
export async function uiLoginWithTour(page: Page, email: string, password: string): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("fb.tour.v1");
    } catch {
      /* ignore */
    }
  });
  await doUiLogin(page, email, password);
}

export async function uiLogout(page: Page): Promise<void> {
  const signOut = page.getByRole("button", { name: "Sign out" });
  if (await signOut.isVisible()) {
    await signOut.click();
    await expect(page).toHaveURL(/\/(login)?$/, { timeout: 15_000 });
  }
}
