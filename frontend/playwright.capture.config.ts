/** Screenshot-capture config: runs against `vite preview` (:4173, the
 *  production build) with the dev backend on :8000 (demo users seeded).
 *  Prereq: backend on :8000, `npm run preview -- --port 4173` on :4173.
 *  Run: set SHOT_TAG=before|after && npx playwright test --config=playwright.capture.config.ts e2e/capture-onboarding.spec.ts
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /capture-onboarding\.spec\.ts/,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["line"]],
  use: {
    baseURL: "http://localhost:4173",
    channel: "chrome",
    trace: "off",
  },
});
