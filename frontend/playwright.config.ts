import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for end-to-end tests.
 *
 * Assumes a running stack: docker compose up -d (api + db + redis) AND
 * `npm run dev` (or `npm run start` after `npm run build`) on the frontend.
 *
 * The tests do NOT spin those up themselves — that keeps a single run/debug
 * loop fast in development. CI should `webServer.command` instead.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    extraHTTPHeaders: {
      // Frontend reads NEXT_PUBLIC_API_BASE; backend defaults to localhost:8000.
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
