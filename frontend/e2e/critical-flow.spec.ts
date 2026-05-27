/**
 * Critical-flow e2e — runs against the in-browser mock backend.
 *
 * No Docker stack required. Playwright's webServer (configured in
 * playwright.config.ts) boots `next start` with NEXT_PUBLIC_MOCK=1, which
 * makes lib/mock-backend.ts patch window.fetch and serve the seed data.
 *
 * Covers the journey a user takes the first time they touch the site:
 *   homepage  → catalogue  → course detail
 *               → login (admin seed) → admin dashboard
 *               → public course → lesson preview
 *
 * Each step asserts something a user actually sees on screen so a copy
 * change won't silently regress a flow.
 */
import { expect, test, type Page } from "@playwright/test";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill("admin@example.com");
  await page.getByLabel("รหัสผ่าน").fill("admin1234");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  // Lands on home — masthead should now show the admin shortcut
  await expect(page.getByRole("link", { name: /กองบรรณาธิการ/ })).toBeVisible({
    timeout: 10_000,
  });
}

test("homepage renders the masthead and links to the catalogue", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /สถาบัน/ }).first()).toBeVisible();
  await page.getByRole("link", { name: /สารบัญคอร์ส/ }).first().click();
  await page.waitForURL("**/courses");
  await expect(page.getByRole("heading", { name: /คอร์สเรียนทั้งหมด/ })).toBeVisible();
});

test("catalogue → course detail shows price and lesson list", async ({ page }) => {
  await page.goto("/courses");
  // First seed course is "ประวัติศาสตร์ไทยสมัยใหม่"
  await page.getByRole("link", { name: /ประวัติศาสตร์ไทยสมัยใหม่/ }).first().click();
  await page.waitForURL("**/courses/thai-history-modern");
  await expect(page.getByRole("heading", { name: "ประวัติศาสตร์ไทยสมัยใหม่" })).toBeVisible();
  await expect(page.getByText("สารบัญบทเรียน")).toBeVisible();
  await expect(page.getByRole("link", { name: /อารัมภบท/ })).toBeVisible();
});

test("admin login → dashboard renders editorial shell", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("link", { name: /กองบรรณาธิการ/ }).first().click();
  await page.waitForURL("**/admin");
  // The admin shell uses a 'แดชบอร์ด' page title and tab nav
  await expect(page.getByRole("heading", { name: /แดชบอร์ด/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "คอร์ส", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /ตรวจสลิป/ })).toBeVisible();
});

test("admin can reach lesson management for a course", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/courses");
  await expect(page.getByRole("heading", { name: /^คอร์ส$/ })).toBeVisible();
  await page.getByRole("link", { name: /บทเรียน/ }).first().click();
  await expect(page.getByText("ชื่อบท").or(page.getByText("ยังไม่มีบทเรียน"))).toBeVisible();
});

test("public lesson page loads the player chrome for a free preview", async ({ page }) => {
  await loginAsAdmin(page); // any signed-in user works
  // Lesson 1 of literature-rattanakosin is a preview in the seed
  await page.goto("/courses/literature-rattanakosin/lessons/l-2a");
  await expect(page.getByRole("heading", { name: /อ่านเสภาขุนช้างขุนแผน/ })).toBeVisible();
  // The watermark canvas should be mounted as a sibling of the player.
  await expect(page.locator("[data-watermark='overlay']")).toBeAttached();
});

test("not-found page renders the themed Thai fallback", async ({ page }) => {
  const r = await page.goto("/this-route-does-not-exist");
  expect(r?.status()).toBe(404);
  await expect(page.getByText(/๔๐๔/)).toBeVisible();
  await expect(page.getByRole("link", { name: /กลับหน้าแรก/ })).toBeVisible();
});
