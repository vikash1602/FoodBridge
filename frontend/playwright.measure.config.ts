/** Measurement-only Playwright config: runs against `vite preview` (:4173,
 *  the production build) with no automatic webServer startup.
 *  Prereqs: backend on :8000, `npm run preview` on :4173.
 *  Run: npx playwright test --config=playwright.measure.config.ts
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /(measure|location|screenshots|screenshot-email)\.spec\.ts/,
  timeout: 180_000,
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
