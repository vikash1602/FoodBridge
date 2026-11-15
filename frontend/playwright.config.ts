import { defineConfig } from "@playwright/test";

/**
 * E2E tests run against a dedicated backend database (foodbridge_e2e) with the
 * demo seed, on isolated ports. Prepare once:
 *   1. CREATE DATABASE foodbridge_e2e OWNER foodbridge;   (psql)
 *   2. npx playwright test                                 (starts both servers)
 */
export default defineConfig({
  testDir: "./e2e",
  // measure.spec.ts is a production-preview measurement suite — it runs under
  // playwright.measure.config.ts (vite preview on :4173), not this config.
  testIgnore: /measure\.spec\.ts/,
  timeout: 150_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5175",
    trace: "retain-on-failure",
    // Use the system Chrome. Playwright's downloaded Chromium builds are
    // blocked by some Windows Application Control policies ("spawn UNKNOWN").
    channel: "chrome",
  },
  webServer: [
    {
      command:
        ".venv\\Scripts\\python.exe manage.py migrate && .venv\\Scripts\\python.exe manage.py seed_demo && .venv\\Scripts\\python.exe -m uvicorn config.asgi:application --host 0.0.0.0 --port 8010",
      cwd: "../backend",
      url: "http://127.0.0.1:8010/api/v1/config/",
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        DATABASE_URL: "postgres://foodbridge:foodbridge@127.0.0.1:5432/foodbridge_e2e",
        SECRET_KEY: "e2e-secret-key-not-for-production-0123456789",
        DEBUG: "True",
        PORT: "8010",
        CORS_ALLOWED_ORIGINS: "http://localhost:5175,http://127.0.0.1:5175",
        FRONTEND_URL: "http://localhost:5175",
        AUTH_THROTTLE_RATE: "1000/min",
      },
    },
    {
      command: "npm run dev -- --port 5175 --strictPort",
      url: "http://localhost:5175/",
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        VITE_API_URL: "http://127.0.0.1:8010",
      },
    },
  ],
});
