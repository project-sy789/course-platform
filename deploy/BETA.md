# Beta deploy — Cloudflare Pages frontend + VPS backend

Cheapest path to a working beta. Frontend lives on Cloudflare Pages (free,
auto-deploys from this repo); backend keeps the FastAPI stack on a single
small VPS.

For the full blue/green self-hosted variant see [README.md](README.md). This
file documents the beta-only path — fewer moving parts, no Caddy in front
of the frontend, no Postfix container, no monitoring stack.

```
   Browser
      │
      │ https://course-platform.pages.dev (or custom domain)
      ▼
┌──────────────────────┐
│  Cloudflare Pages    │   ← Next.js bundle, auto-built from main
│  (frontend, static)  │
└──────────┬───────────┘
           │ fetch + cookies (CORS)
           │
           ▼
┌──────────────────────┐    ┌───────────┐
│   VPS (Hetzner/DO)   │───▶│ Postgres  │
│   - api (uvicorn)    │    │ (same VM) │
│   - worker (arq)     │    └───────────┘
│   - redis            │
│   - caddy (TLS only) │    R2 (videos, slips) — Cloudflare
└──────────────────────┘    Email provider — Resend/Postmark
```

## Cost sketch

- Cloudflare Pages — **0 บาท** (free plan, 500 builds/mo)
- VPS — Hetzner CX22 (~€4/mo ≈ 150฿) or DO basic ($6 ≈ 220฿)
- R2 — **0 บาท** until ~10 GB stored (~10 hours of HLS at 720p)
- Domain — ~400฿/year for `.com`, ~700฿/year for `.in.th`
- Email — Resend free up to 3,000 emails/mo
- **รวม ~150-400฿/เดือน** for a working beta

## Frontend: Cloudflare Pages

### One-time setup

1. Create a Cloudflare account, note the **Account ID** from the dashboard
   home page (right sidebar).
2. Create an API token: My Profile → API Tokens → Create Token → use the
   **"Edit Cloudflare Pages"** template. Save the token.
3. Create a Pages project named `course-platform`:
   - Either via dashboard (Pages → Create → Connect to Git), or
   - Skip the dashboard and let the GitHub Action create it on first run
     via `wrangler pages deploy ... --project-name=course-platform`.
4. Set these in GitHub repo settings:
   - **Secrets**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - **Variables**: `NEXT_PUBLIC_API_BASE` = `https://api.<your-domain>`
5. Push to `main` — `.github/workflows/pages.yml` builds + deploys.

The default URL will be `https://course-platform.pages.dev`. To attach a
custom domain (eg `app.example.com`), use Pages dashboard → Custom domains.

### What the build does

`npm run pages:build` invokes `@cloudflare/next-on-pages@1`, which:

- Runs `next build` as normal.
- Compiles Next's server output (route handlers, dynamic pages) into
  Cloudflare Workers-compatible bundles.
- Drops the result in `.vercel/output/static`, which `wrangler pages deploy`
  uploads.

Dynamic routes (`/courses/[slug]`, `/admin/courses/[slug]`, etc.) work
without `generateStaticParams` because Pages serves them via Workers, not
as pre-rendered static files. No URL refactor needed.

### Local one-shot deploy

If you don't want to push to `main`:

```bash
cd course-platform/frontend
npx wrangler login    # opens browser, once
NEXT_PUBLIC_API_BASE=https://api.example.com npm run pages:build
npm run pages:deploy
```

## Backend: single-VPS minimal stack

The full README assumes blue/green + Caddy in front of two API replicas.
For beta, one of each is enough:

```bash
ssh root@<vps>
git clone <repo> /srv/course-platform
cd /srv/course-platform
cp .env.example .env
$EDITOR .env                              # fill all `change-me-*` values

docker compose -f docker-compose.yml up -d db redis
docker compose -f docker-compose.yml run --rm api alembic upgrade head
docker compose -f docker-compose.yml up -d api worker

# TLS: point a subdomain (eg api.example.com) at the VPS IP, then run
# Caddy in front so the browser can reach the API over HTTPS. The repo's
# top-level docker-compose.yml already binds Caddy on 80/443.
```

### Required `.env` values for beta

The minimum that must be **not** the default `.env.example` placeholder:

| Var | Why |
| --- | --- |
| `DB_PASSWORD` | Postgres `course` user password |
| `JWT_SECRET` | signs session cookies — rotating logs everyone out |
| `KEK_BASE64` (or `KEK_FILE`) | encrypts per-video AES keys at rest |
| `DEVICE_FINGERPRINT_SALT` | anti-sharing fingerprint salt |
| `CORS_ORIGINS` | must include the Pages URL (eg `https://course-platform.pages.dev,https://app.example.com`) |
| `FRONTEND_URL` | absolute URL of the Pages site — used in verification + reset links |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_PUBLIC_BASE` | video storage |
| `RECEIVER_BANK_*`, `PROMPTPAY_ID` | shown on checkout (or set via `/admin/settings`) |

Email provider (`EMAIL_PROVIDER` + `EMAIL_API_KEY`) and `SLIPOK_API_KEY` are
optional in `.env` — the admin can set them at runtime via
`/admin/settings` after the first deploy. Leaving `EMAIL_PROVIDER=disabled`
just makes signup/reset emails a no-op; the rest of the app still works.

### CORS check

After the VPS is up, from a Pages preview run:

```js
fetch("https://api.example.com/healthz", { credentials: "include" })
  .then(r => r.ok && r.headers.get("access-control-allow-credentials"))
```

If the network panel shows the request blocked by CORS, `CORS_ORIGINS` on
the backend doesn't include the Pages URL — fix that env var, restart the
api container, retry.

## What you do NOT get in this beta layout

- No Caddy in front of the frontend (Pages handles TLS + caching itself).
- No blue/green for API — single replica. Deploys cause ~5s downtime
  while the container restarts. Acceptable for closed beta; revisit when
  going GA (see [README.md](README.md)).
- No Postfix — using a SaaS email provider (Resend/Postmark) via
  `/admin/settings`.
- No Loki/Grafana/Prometheus — `docker logs` is your monitoring. Add
  Sentry or Better Stack for proactive alerts.
- No automated backup restore drill — set a calendar reminder to do one
  manually before opening signup.

## When to graduate to the full README

Move from this BETA layout to the full blue/green stack when ANY of:

- You have paying customers and want zero-downtime deploys.
- You need centralized logs / alerts.
- Single VPS is hitting CPU or RAM caps during encode bursts.
- The compliance review for going GA requires documented DR procedures.
