# Course Platform

Thai-first online-course platform with layered video-piracy mitigations:
encrypted HLS at the edge, per-session AES key delivery, IP+UA-pinned
playback sessions, edge rate-limit + bot-block, dynamic identity
watermarking (overlay or pixel-baked), anti-DevTools heuristics, anti-
sharing OTP + concurrent-session cap, slip-upload payments with SlipOK
auto-OCR, blue-green deploy on a single VPS, daily cold-backup to S3
Glacier Deep Archive.

> Read **[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)** before editing
> anything that touches the playback path. Read
> **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** for the request
> lifecycles and data model.

## Stack

- **Backend** — FastAPI · PostgreSQL 16 · Redis · arq worker (Docker Compose)
- **Frontend** — Next.js 14 (App Router) · Tailwind 3 · hls.js
- **Edge** — Cloudflare Worker (`edge-worker/`) for rate-limit, bot-block, HMAC media cookie
- **Storage** — Cloudflare R2 (encrypted segments + slip uploads)
- **Reverse proxy** — Caddy (auto TLS, blue-green via active-upstream snippet)
- **Monitoring** — Prometheus + Loki + Promtail + Grafana, 4 alert rules

## Repo layout

```
course-platform/
├── backend/            FastAPI service + alembic + tests
├── frontend/           Next.js app (public + /admin) + Playwright e2e + mock-backend
├── edge-worker/        Cloudflare Worker (TypeScript)
├── deploy/             Caddy active-upstream snippet, blue-green runbook
├── monitoring/         Prometheus, Loki, Grafana provisioning
├── scripts/            deploy.sh, rollback.sh, run_tests.sh, smoke.sh
├── docs/               ARCHITECTURE.md, THREAT_MODEL.md, restore-runbook.md, …
├── docker-compose.yml
├── Caddyfile
└── .env.example
```

## Quick start

### Local with the real stack

```bash
cp .env.example .env
# minimum required: JWT_SECRET, KEK_BASE64, DB_PASSWORD, GRAFANA_PASSWORD
#   openssl rand -hex 64           → JWT_SECRET
#   openssl rand -base64 32        → KEK_BASE64

docker compose up -d --build
docker compose exec api alembic upgrade head

# Frontend in another terminal
cd frontend
cp .env.example .env.local                         # NEXT_PUBLIC_API_BASE=http://localhost:8000
npm install
npm run dev                                        # http://localhost:3000
```

### Local with the mock backend (no Docker)

```bash
cd frontend
NEXT_PUBLIC_MOCK=1 npm run dev
```

`lib/mock-backend.ts` patches `window.fetch` and serves seed data from
`localStorage`. Useful for UI work and for the CI e2e run.

Demo credentials seeded by the mock:

| Role  | Email                  | Password    |
|-------|------------------------|-------------|
| admin | `admin@example.com`    | `admin1234` |
| user  | `user@example.com`     | `user1234`  |

A "รีเซ็ตข้อมูลจำลอง" button is rendered bottom-right when the mock
is active.

## Features

### Public site

- Editorial homepage + numbered course catalogue (`/`, `/courses`)
- Course detail with progress aside (`เรียนต่อ →`, %, per-lesson `✓` /
  partial bar) when signed-in
- Encrypted HLS player with watermark overlay (or pixel-baked, per-course)
- Lesson materials (PDF) downloads
- Account: enrollments, payments history, tax info, devices,
  GDPR export + delete
- Slip-upload checkout (no Stripe — Thai bank-transfer flow with SlipOK auto-OCR)
- Themed Thai 404 / error / loading fallbacks

### Admin (`/admin`)

- Dashboard with key-grant / key-denial counters
- Courses CRUD with inline edit + delete-with-enrolment-guard
- **Lesson management** under `/admin/courses/<slug>` —
  rename, reorder (↑↓), toggle preview, set per-lesson price,
  delete-with-entitlement-guard
- Multi-bitrate folder upload at `/admin/upload`
- Background encode-job tracking
- Slip-upload review queue with approve / reject + note
- User list (search, promote-to-admin handled CLI-side)
- Key-access log inspector with grant/deny filter
- Settings inspector (which integrations are wired up)

### Backend security layers

See `docs/THREAT_MODEL.md` for the rationale for each. The short
summary:

| Layer | What |
|---|---|
| 1 | Encrypted HLS at rest (R2) |
| 2 | Per-session AES key delivery, IP+UA pinned, expires_at |
| 3 | Cloudflare worker — rate-limit + bot UA block + HMAC media cookie |
| 4 | Device-pinned OTP + `MAX_CONCURRENT_SESSIONS` cap |
| 5 | Watermarking (overlay or pixel-baked) |
| 6 | DevTools-open + watermark-tamper detection |
| 7 | Origin hardening (HttpOnly + `__Host-` cookies, CSP, CSRF, rate-limited auth) |

### Operational

- Blue-green deploy with atomic active-upstream rewrite (see
  `deploy/README.md`)
- Daily `pg_dump` + R2 → S3 Glacier Deep Archive cold backup
- Prometheus / Grafana with 4 alert rules
- Loki + Promtail for centralized logs

## Tests

### Backend (pytest)

```bash
./scripts/run_tests.sh            # full suite, runs inside the api container
./scripts/run_tests.sh -k key     # filter
```

Coverage areas: key endpoint, manifest proxy, auth, devices,
anti-sharing, abuse-guard, credits, invoice, lesson entitlement,
materials, progress, rate-limit, refund/GDPR, slip payments,
time-limited enrolment, admin lesson CRUD, health.

### Frontend e2e (Playwright)

Two modes:

```bash
# Against the in-browser mock — no Docker needed.
cd frontend && CI=true npx playwright test critical-flow.spec.ts

# Against the full local stack (covers register/verify/login/etc).
docker compose up -d --build
cd frontend && npm run e2e
# requires E2E_BYPASS_TOKEN matched on both sides
```

CI uses the mock-backend mode for `critical-flow.spec.ts`.

## CI

Three GitHub Actions workflows under `.github/workflows/`:

- `backend.yml` — postgres-16 service container, `pytest -v`
- `frontend.yml` — `tsc --noEmit`, `next lint`, `next build`
- `e2e.yml` — Playwright critical-flow against the mock backend

All three run on PRs touching their respective tree, plus on push to main.

## Promoting an admin user

```bash
# Register via UI first, then:
docker compose exec api python -m scripts.make_admin you@example.com
```

## Production deploy (Hetzner)

1. Provision Ubuntu 24.04 VPS, full-disk encryption recommended.
2. `curl -fsSL https://get.docker.com | sh`
3. `git clone <repo> && cd course-platform`
4. Fill `.env` with strong secrets (see Quick start).
5. Edit `Caddyfile` — replace `api.example.com` with your domain.
6. `docker compose up -d --build`
7. `docker compose exec api alembic upgrade head`
8. Point DNS A-record at VPS IP.

For ongoing deploys read `deploy/README.md` — the blue-green dance has a
migration contract that must be respected.

## Video ingest

```bash
backend/scripts/encode_multibitrate.sh source.mp4 ./out https://api.example.com
# Produces ./out/master.m3u8 + 360p/ + 720p/ + 1080p/ + key.hex

# Then in the admin UI at /admin/upload, pick the folder.
```

For single-bitrate or hand-encoded HLS-AES, see the help text on
`/admin/upload`.

## Cold backup

Backups run via Ofelia daily at 03:17 UTC. Add `AWS_BACKUP_BUCKET`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` to `.env`. Both the R2
object tree and a `pg_dump` are copied to Deep Archive.

The DB dump holds `video_keys` (KEK-encrypted). **Without it, R2
segments are useless.** Use a separate AWS account / scoped IAM —
PutObject-only, no Delete. Restore guidance lives in
`docs/restore-runbook.md`.

## Threat model

The platform raises piracy cost and embeds identity into every leaked
frame. It does **not** prevent screen-recording or HDMI capture — that
is impossible at the application layer. Read `docs/THREAT_MODEL.md`
for the full layer-by-layer breakdown.
