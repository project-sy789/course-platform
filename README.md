# Course Platform — HLS AES-128 with Secure Key Delivery

Decoupled architecture: encrypted HLS on Cloudflare R2, key delivery + auth on Hetzner VPS, Next.js player with dynamic canvas watermark.

## Stack
- **Backend**: FastAPI + PostgreSQL + Redis (Docker)
- **Frontend**: Next.js 14 (App Router) + Tailwind + hls.js
- **Storage**: Cloudflare R2 (HLS .m3u8 + .ts encrypted offline)
- **Reverse proxy**: Caddy (auto TLS)

## Layout
```
course-platform/
├── backend/        FastAPI service
├── frontend/       Next.js app (incl. /admin)
├── monitoring/     Prometheus + Grafana provisioning
├── docker-compose.yml
├── Caddyfile
└── .env.example
```

## Quick start (local)

```bash
cp .env.example .env
# fill secrets — at minimum: JWT_SECRET, KEK_BASE64, DB_PASSWORD, GRAFANA_PASSWORD
# generate them:
#   openssl rand -hex 64           # JWT_SECRET
#   openssl rand -base64 32        # KEK_BASE64

docker compose up -d --build
docker compose exec api alembic upgrade head

# Frontend (separate terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

## Running tests

The key delivery endpoint is the most security-critical surface in the system.
A green test run is a precondition for deploy.

```bash
./scripts/run_tests.sh           # full suite
./scripts/run_tests.sh -k key    # just /key endpoint tests
```

Tests run inside the api container against a dedicated `course_test` database
that is dropped + recreated each invocation. Redis is replaced with `fakeredis`
in-process so tests don't share state.

Covered:
- Every auth/enrollment path of `/api/v1/videos/{id}/playback-session` and `/key`
- IP and User-Agent mismatch (token replay) rejection
- Inactive user rejection between session creation and key fetch
- That every attempt — granted or denied — is written to `key_access_log`
- Auth flow (register / login / inactive user / duplicate email / weak password)
- Liveness + readiness health checks

## Promoting an admin user

```bash
# Register a user via the UI first, then:
docker compose exec api python -m scripts.make_admin you@example.com
# Sign in again, navigate to /admin
```

## Monitoring (Prometheus + Grafana)

See "Monitoring & alerting" section below for the full setup.

## Production deploy (Hetzner)

1. Provision Ubuntu 24.04 VPS
2. `curl -fsSL https://get.docker.com | sh`
3. `git clone <repo> && cd course-platform`
4. Fill `.env` with strong secrets
5. Edit `Caddyfile` — replace `api.example.com` with your domain
6. `docker compose up -d --build`
7. `docker compose exec api alembic upgrade head`
8. Point DNS A-record at VPS IP

## Video ingest workflow

```bash
# Multi-bitrate (recommended): use the helper script
backend/scripts/encode_multibitrate.sh source.mp4 ./out https://api.example.com
# Produces ./out/master.m3u8 + 360p/ + 720p/ + 1080p/ + key.hex

# Then upload via the admin UI at /admin/upload (folder picker preserves subdirs)
```

For single-bitrate, encode any HLS-AES asset with ffmpeg directly and upload the
flat file list — see the help text on `/admin/upload`.

## Cold backup to S3 Glacier Deep Archive

Add AWS credentials to `.env` (`AWS_BACKUP_BUCKET`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`). The Ofelia container runs `backup_to_glacier` daily at
03:17 UTC, copying:

- Every R2 object → `s3://<bucket>/media/<key>` (incremental — skips already-backed-up keys)
- `pg_dump` of the entire DB → `s3://<bucket>/db/<timestamp>.sql.gz`

Run manually:
```bash
docker compose exec api python -m scripts.backup_to_glacier
```

**Restoring** from Deep Archive takes 12–48h. Use AWS Console or `aws s3api restore-object`
on the specific keys you need; do not put restore on the hot path.

The DB dump contains `video_keys` (encrypted with the master KEK). **Without it,
R2 segments are useless — losing the DB is losing every video.** Treat the
backup AWS account as a separate trust boundary: PutObject only, no Delete.

## Monitoring & alerting (Prometheus + Grafana)

- API exposes `/metrics` (request rate, latency, status codes)
- Prometheus scrapes `api:8000/metrics` every 15s, retains 30 days
- Grafana auto-provisions:
  - Datasource (`Prometheus`)
  - Dashboard (`Course Platform — API`)
  - **Alert rules** (4): API down, 5xx rate, key denial spike, p95 latency
  - Contact point: webhook (set `ALERT_WEBHOOK_URL` in `.env` — Discord/Slack/generic)
- Login: `admin` / `${GRAFANA_PASSWORD}`. Expose behind a separate subdomain in production
  and IP-allowlist it.

## Threat model — what this prevents and what it doesn't

| Threat | Prevented? |
|---|---|
| Direct download of `.ts` segments | ✅ Encrypted, useless without key |
| Stealing key via DevTools | ⚠️  Logged + IP/UA bound; forensic, not preventive |
| Account sharing | ⚠️  Watermark identifies leaker |
| Screen recording (OBS, phone) | ❌ Cannot prevent — watermark survives, traceable |
| Skilled DevTools bypass | ❌ Heuristic only |

The system **raises cost of piracy and adds traceability**. It is not, and cannot be, a hard wall.
