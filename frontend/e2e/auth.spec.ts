/**
 * Auth e2e — register, verify, login, /me, logout.
 *
 * Targets the running frontend at E2E_BASE_URL (default http://localhost:3000)
 * which must be configured to talk to the running backend.
 */
import { expect, test } from "@playwright/test";
import { apiContext, registerAndVerify, uniqueEmail } from "./helpers";

const PASSWORD = "pw-pw-pw-pw";

test("register → unverified login blocked → verify → login → /me", async ({ page }) => {
  const email = uniqueEmail("auth");
  const api = await apiContext();

  // Register through the UI
  await page.goto("/login");
  await page.getByRole("button", { name: /register/i }).click(); // toggle to register mode
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /register/i }).click();

  // Unverified — login form should reject the auto-login attempt with a visible error
  await expect(page.getByText(/email not verified/i)).toBeVisible({ timeout: 10_000 });

  // Force-verify via the e2e bypass
  await import("./helpers").then((h) => h.forceVerifyEmail(api, email));

  // Now login normally
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Lands on home — courses list
  await page.waitForURL("**/");

  // /me works via the API now
  const me = await api.get("/api/v1/auth/me", { /* cookies inherited via shared jar */ });
  // Direct API call doesn't share cookies with the browser context; instead
  // call through the page's fetch:
  const meBody = await page.evaluate(async () => {
    const r = await fetch("/api/v1/auth/me", { credentials: "include" });
    return { status: r.status, body: await r.json() };
  });
  expect(meBody.status).toBe(200);
  expect(meBody.body.email).toBe(email);
});

test("wrong password rejected with visible error", async ({ page }) => {
  const email = uniqueEmail("wrong");
  const api = await apiContext();
  await registerAndVerify(api, email, PASSWORD);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("not-the-right-one");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByText(/bad credentials/i)).toBeVisible();
});

test("forgot password link is reachable", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: /forgot password/i }).click();
  await page.waitForURL("**/forgot-password");
});
