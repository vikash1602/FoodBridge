/** UI-regression config: runs against `vite preview` (:4173, the PRODUCTION
 *  build) with the dev backend on :8000 (demo users, password DemoPass123!).
 *  Prereq: backend on :8000. The preview server is started automatically.
 *  Run: set UI_REGRESSION=1&& npx playwright test --config=playwright.ui.config.ts e2e/ui-regression.spec.ts
 *  (UI_REGRESSION=1 scopes the spec to this config — see the spec header.)
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /ui-regression\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["line"]],
  use: {
    baseURL: "http://localhost:4173",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
