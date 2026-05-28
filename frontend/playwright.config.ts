import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for end-to-end tests.
 *
 * Two modes:
 *
 * 1. Default (local dev): assumes a stack is already running — docker
 *    compose up -d (api + db + redis) AND `npm run dev` for the frontend.
 *    Keeps the run/debug loop fast.
 *
 * 2. CI / mock-backend mode (E2E_USE_MOCK=1 or CI=1): Playwright starts
 *    `next start` itself with NEXT_PUBLIC_MOCK=1 so lib/mock-backend.ts
 *    intercepts /api/v1/* and serves the seed data — no Docker stack
 *    needed. critical-flow.spec.ts is written for this mode.
 */
// GitHub Actions sets CI=true; e2e.yml used to override it to "1" which
// silently broke this check and left baseURL with no server. Accept any
// truthy CI value to make the mode flip robust either way.
const useMock = process.env.E2E_USE_MOCK === "1" || !!process.env.CI;

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
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: useMock
    ? {
        command: "npm run build && npm run start -- -p 3000",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: { NEXT_PUBLIC_MOCK: "1" },
      }
    : undefined,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
