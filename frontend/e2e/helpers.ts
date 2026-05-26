/**
 * Shared helpers for e2e specs.
 *
 * E2E_API_BASE / E2E_BYPASS_TOKEN are read from env so the same suite can
 * run against any deploy that opts in. Default targets the local stack.
 */
import { APIRequestContext, request } from "@playwright/test";

export const API_BASE = process.env.E2E_API_BASE ?? "http://localhost:8000";
const BYPASS = process.env.E2E_BYPASS_TOKEN ?? "";

export function uniqueEmail(prefix = "pw"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

export async function apiContext(): Promise<APIRequestContext> {
  return await request.newContext({ baseURL: API_BASE });
}

export async function registerUser(
  api: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  const r = await api.post("/api/v1/auth/register", {
    data: { email, password },
  });
  if (r.status() !== 201) {
    throw new Error(`register ${email} failed: ${r.status()} ${await r.text()}`);
  }
}

export async function forceVerifyEmail(
  api: APIRequestContext,
  email: string,
): Promise<void> {
  if (!BYPASS) {
    throw new Error(
      "E2E_BYPASS_TOKEN env var not set — start the API with E2E_BYPASS_TOKEN=... " +
        "and pass the same value to Playwright via E2E_BYPASS_TOKEN.",
    );
  }
  const r = await api.post(`/api/v1/_e2e/verify-email?email=${encodeURIComponent(email)}`, {
    headers: { "x-e2e-token": BYPASS },
  });
  if (r.status() !== 200) {
    throw new Error(`force-verify ${email} failed: ${r.status()} ${await r.text()}`);
  }
}

export async function registerAndVerify(
  api: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  await registerUser(api, email, password);
  await forceVerifyEmail(api, email);
}
