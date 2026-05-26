# End-to-end tests (Playwright)

These specs drive a real browser against a real running stack. They verify
the integration boundary between Next.js and FastAPI — things unit/integration
tests can't catch (CORS misconfig, cookie-domain mismatch, missing routes,
hydration bugs).

## Prerequisites

1. **Backend running** — start the docker stack with the e2e bypass token set:
   ```sh
   E2E_BYPASS_TOKEN=local-dev-bypass docker compose up -d
   ```
   The token enables a single dev-only route (`/api/v1/_e2e/verify-email`)
   used to skip the SMTP loop. **Never set this in production.**

2. **Frontend running** at http://localhost:3000:
   ```sh
   cd frontend
   npm install
   NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev
   ```

3. **Playwright browsers installed** (one-time):
   ```sh
   npx playwright install chromium
   ```

## Run

```sh
cd frontend
E2E_BYPASS_TOKEN=local-dev-bypass npm run e2e          # headless
E2E_BYPASS_TOKEN=local-dev-bypass npm run e2e:ui       # Playwright UI mode
```

Override the targets if testing a deploy:
```sh
E2E_BASE_URL=https://staging.example.com \
E2E_API_BASE=https://api.staging.example.com \
E2E_BYPASS_TOKEN=$STAGING_BYPASS \
npm run e2e
```

## What's covered

- `auth.spec.ts` — register → unverified-login blocked → verify → login → /me;
  wrong-password error; forgot-password link reachable.
- `account.spec.ts` — logout-everywhere; data export downloads JSON; delete
  account anonymizes + invalidates session.

## What's intentionally NOT covered here

- **Stripe checkout** — needs Stripe test keys + webhook tunnel. Those tests
  live in `backend/tests/test_refund_gdpr.py` against mocked Stripe.
- **Video playback** — needs a real R2 bucket with a real HLS asset. Smoke
  manually instead.

## Failures

Failed runs drop traces under `frontend/test-results/`. Open them with:
```sh
npx playwright show-trace frontend/test-results/<dir>/trace.zip
```
