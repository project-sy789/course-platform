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
├── frontend/       Next.js app
├── docker-compose.yml
├── Caddyfile
└── .env.example
```

## Quick start (local)

```bash
cp .env.example .env
# fill secrets — at minimum: JWT_SECRET, KEK_BASE64, DB_PASSWORD
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
# Encode HLS with AES-128 outside this stack:
KEY=$(openssl rand -hex 16)
echo -n "$KEY" | xxd -r -p > video.key
cat > key_info.txt <<EOF
https://api.example.com/api/v1/videos/PLACEHOLDER_VIDEO_ID/key
$(pwd)/video.key
EOF

ffmpeg -i source.mp4 \
  -hls_time 6 -hls_key_info_file key_info.txt -hls_playlist_type vod \
  -hls_segment_filename 'seg_%03d.ts' index.m3u8

# Upload .m3u8 + .ts segments to R2 under courses/<course>/lessons/<id>/
# Then register the key in DB:
docker compose exec api python -m scripts.ingest_video \
  --r2-key courses/intro/lessons/01/index.m3u8 \
  --aes-key-hex "$KEY" \
  --course-slug intro --lesson-title "Welcome" --position 1
```

## Threat model — what this prevents and what it doesn't

| Threat | Prevented? |
|---|---|
| Direct download of `.ts` segments | ✅ Encrypted, useless without key |
| Stealing key via DevTools | ⚠️  Logged + IP/UA bound; forensic, not preventive |
| Account sharing | ⚠️  Watermark identifies leaker |
| Screen recording (OBS, phone) | ❌ Cannot prevent — watermark survives, traceable |
| Skilled DevTools bypass | ❌ Heuristic only |

The system **raises cost of piracy and adds traceability**. It is not, and cannot be, a hard wall.
