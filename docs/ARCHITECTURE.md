# Architecture

A walkthrough of the system from the request side, then from the storage
side. For *why* each piece exists in the security context, see
[`THREAT_MODEL.md`](./THREAT_MODEL.md).

## Component diagram

```
                              ┌──────────────────────────┐
                              │   Cloudflare edge        │
            (browser)         │   (edge-worker)          │
              │               │   - rate-limit (KV)      │
              │ HTTPS         │   - bot-UA block         │
              ▼               │   - HMAC media cookie    │
   ┌────────────────────┐     └────────┬─────────────────┘
   │  Next.js 14 app    │              │
   │  - public site     │              │
   │  - /admin          │              ▼
   │  - mock-backend.ts │     ┌────────────────────┐         ┌────────────────┐
   │     (dev/CI)       │◀────│  Caddy (TLS)       │────────▶│  api (FastAPI) │
   └────────────────────┘     │  blue / green      │         │  - auth        │
              │               │  reverse proxy     │         │  - /key, /pb   │
              │  /key, /pb,    │  active-upstream   │         │  - admin       │
              │  /api/v1/*    │  snippet (deploy)  │         │  - progress    │
              │               └─┬──────────────────┘         └────┬─────────┘
              │                 │                                 │
              │                 ▼                                 ▼
              │       ┌──────────────────┐               ┌────────────────┐
              │       │  arq worker      │               │  PostgreSQL 16 │
              │       │  (video encode,  │◀──── Redis ──▶│  (sessions,    │
              │       │   slip OCR)      │   queue +     │   user, course,│
              │       └────────┬─────────┘   rate-limit  │   key_access)  │
              │                │                          └────────────────┘
              ▼                ▼                                 │
   ┌────────────────────┐    ┌──────────────────┐                │ daily pg_dump
   │  Cloudflare R2     │    │  SlipOK API      │                ▼
   │  - HLS .m3u8 + .ts │    │  (slip OCR)      │       ┌────────────────────┐
   │  - encrypted at    │    └──────────────────┘       │  S3 Glacier        │
   │    rest (AES-128)  │                               │  Deep Archive      │
   │  - slip-uploads/   │                               │  (cold backup)     │
   └────────────────────┘                               └────────────────────┘
```

## Request lifecycles

### Watching a paid lesson

1. Browser GETs `/courses/<slug>/lessons/<id>` (Next page).
2. The page POSTs `/api/v1/videos/<vid>/playback-session`. FastAPI
   creates a row pinned to (user_id, IP, UA, expires_at) and returns a
   manifest URL.
3. hls.js fetches the manifest. Caddy proxies; FastAPI rewrites
   `EXT-X-KEY` URIs to point at `/api/v1/key/<sid>`.
4. hls.js fetches each segment from R2 (or via the Cloudflare worker
   `/edge/segment/*` if the deploy is wired through it).
5. hls.js fetches the AES key. The Cloudflare worker performs rate-limit
   + bot UA block, then forwards. FastAPI re-validates IP+UA+expiry,
   decrypts the row's key with the KEK, and returns 16 raw bytes. Every
   call (granted or denied) is appended to `key_access_log`.
6. Player decrypts segments and plays. The `WatermarkOverlay` canvas
   renders identity on top; if the course has `pixel_watermark = true`,
   `PixelWatermarkPlayer` instead composites the identity into each
   drawn frame so screen recordings inherit it.
7. Every ~10 s the player PUTs `/api/v1/lessons/<id>/progress` with
   `{position_seconds, duration_seconds}`. Backend marks completed at
   90% watched and surfaces the % on `/courses/<slug>`.

### Buying a course (slip-upload flow)

1. User visits `/checkout/<slug>`, sees bank account + amount.
2. Transfers the money in their banking app, takes a screenshot, uploads
   it via `POST /api/v1/slip-uploads` (multipart).
3. Backend pushes the slip image to R2 under `slip-uploads/`, creates a
   `SlipUpload` row in `pending`, and POSTs to SlipOK API for OCR.
4. If SlipOK returns a confident match (amount + recipient + recent
   timestamp), backend auto-approves: creates an `Enrollment` and
   marks the slip `auto_approved`.
5. Otherwise an admin reviews at `/admin/slip-uploads` and clicks
   approve / reject. Approval calls `materialize_approval` which inserts
   the `Enrollment`.

### Promoting a video (admin upload → ready to watch)

1. Admin runs `backend/scripts/encode_multibitrate.sh source.mp4 ./out
   https://api.example.com` locally — produces master.m3u8 + 360p/ +
   720p/ + 1080p/ trees and a 16-byte AES key in `key.hex`.
2. Admin opens `/admin/upload`, picks the folder, the page POSTs each
   file to `/admin/uploads/<id>/file` preserving subdirectories.
3. Admin POSTs `/admin/uploads/finalize` with `{course_slug,
   lesson_title, position, aes_key_hex}`. Backend:
   - Validates the key length, walks the buffer, copies every file to
     R2 under `courses/<slug>/lessons/<video_uuid>/`.
   - Creates `Video`, `Lesson`, `VideoKey` rows. The `VideoKey` row
     stores the AES key encrypted with the KEK (AES-GCM).
4. Admin can then rename, reorder, toggle preview, set per-lesson price,
   or delete from `/admin/courses/<slug>`.

## Data model — the rows that matter

- `users` — email + password hash, `is_admin`, `email_verified`,
  `is_active`. Citext on email so case-insensitive uniqueness is enforced.
- `courses` — slug + title + price_cents + access_duration_days
  (`NULL` = lifetime) + `pixel_watermark` flag.
- `lessons` — FK course + video, position (unique within course),
  `is_preview`, `price_cents` (>0 enables individual purchase via
  `lesson_entitlements`).
- `videos` — FK to R2 manifest key. Owned by exactly one lesson.
- `video_keys` — `video_id, key_ciphertext, key_nonce, key_tag` (AES-GCM
  encrypted with KEK). One per video.
- `enrollments` — (user, course, expires_at). Lifetime when expires_at
  is NULL.
- `lesson_entitlements` — like enrollments but for a single lesson.
- `lesson_progress` — (user, lesson, position_seconds, duration_seconds,
  completed). Sticky completion: once true, stays true.
- `playback_sessions` — short-lived rows. (user, video, ip, ua,
  expires_at). Fetched on every `/key`.
- `key_access_log` — append-only audit. Every grant + denial. Used by
  `/admin/logs` and the Grafana denial-spike alert.
- `slip_uploads` — (user, target, amount, status, slip_ref, image_url,
  reviewed_at, review_note). `status` enum: pending / auto_approved /
  admin_approved / rejected.
- `encode_jobs` — arq job rows for the optional server-side multi-
  bitrate encode pipeline.

## Migration philosophy

Expand-then-contract is mandatory because the deploy is blue-green
([`deploy/README.md`](../deploy/README.md)). A migration that drops a
column the still-running blue API depends on will break it. The pattern
is always:

1. Migration N adds the new column nullable.
2. App release N+1 reads from either, writes both.
3. Migration N+2 backfills.
4. App release N+3 reads only from new.
5. Migration N+4 drops the old.

Steps 1, 3, 5 are pure-DB and ship in `alembic/versions/`. Steps 2, 4
are app changes.

## Background jobs (arq)

The `worker` container runs an arq worker pulling from Redis. Two job
types today:

- `encode_video` — wraps `encode_multibitrate.sh`, uploads the ladder to
  R2, registers the Video/Lesson/VideoKey rows. Triggered by
  `POST /admin/encode-jobs`.
- `verify_slip` — re-runs SlipOK OCR for a pending slip. Today only
  invoked synchronously from the upload endpoint; the job exists so the
  retry path can be moved off the request flow.

## Observability

- `/metrics` on api exposes Prometheus counters + histograms.
- Loki ingests api logs via Promtail.
- Grafana datasource + dashboard + 4 alert rules auto-provisioned from
  `monitoring/grafana/`.
- Alert sink: `ALERT_WEBHOOK_URL` env var (Discord/Slack/generic).

## Deploy

Blue-green via Caddy + `deploy/caddy.active-upstream` snippet rewrite.
See [`deploy/README.md`](../deploy/README.md) for the full sequence and
the migration contract that makes it safe.
