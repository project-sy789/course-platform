/**
 * Account self-service e2e — sessions, data export, account deletion.
 *
 * Each test creates a fresh user so they can run in parallel.
 */
import { expect, test } from "@playwright/test";
import { apiContext, registerAndVerify, uniqueEmail } from "./helpers";

const PASSWORD = "pw-pw-pw-pw";

async function loginViaApi(page: import("@playwright/test").Page,
                           email: string, password: string) {
  await page.request.post("/api/v1/auth/login", { data: { email, password } });
  // Cookies set by the API request are stored in the page's context, but
  // navigating loads them on subsequent same-origin requests.
  await page.goto("/account");
}

test("logout-all signs the browser out", async ({ page }) => {
  const email = uniqueEmail("logout");
  await registerAndVerify(await apiContext(), email, PASSWORD);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/");

  await page.goto("/account");
  await page.getByRole("button", { name: /sign out everywhere/i }).click();
  await page.waitForURL("**/login");

  const me = await page.evaluate(async () => {
    const r = await fetch("/api/v1/auth/me", { credentials: "include" });
    return r.status;
  });
  expect(me).toBe(401);
});

test("export downloads a JSON of the account's data", async ({ page }) => {
  const email = uniqueEmail("export");
  await registerAndVerify(await apiContext(), email, PASSWORD);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/");

  await page.goto("/account");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /download my data/i }).click(),
  ]);

  const path = await download.path();
  expect(path).toBeTruthy();

  const fs = await import("node:fs/promises");
  const text = await fs.readFile(path!, "utf8");
  const body = JSON.parse(text);
  expect(body.user.email).toBe(email);
});

test("delete-account anonymizes and revokes session", async ({ page }) => {
  const email = uniqueEmail("delete");
  await registerAndVerify(await apiContext(), email, PASSWORD);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/");

  await page.goto("/account");
  await page.getByPlaceholder(email).fill(email);

  // The page uses confirm(); accept it.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /^delete my account$/i }).click();

  await page.waitForURL("**/login");

  // Old session is dead
  const me = await page.evaluate(async () => {
    const r = await fetch("/api/v1/auth/me", { credentials: "include" });
    return r.status;
  });
  expect(me).toBe(401);

  // Re-login with the same email/password fails — the email no longer exists
  // (replaced with a tombstone) and the password hash was disabled.
  const loginStatus = await page.evaluate(
    async ({ e, p }) => {
      const r = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: e, password: p }),
      });
      return r.status;
    },
    { e: email, p: PASSWORD },
  );
  expect(loginStatus).toBe(401);
});
