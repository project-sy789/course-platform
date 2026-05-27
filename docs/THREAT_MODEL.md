# Threat model

This document is the canonical record of what this platform tries to defend
against, what it cannot defend against, and which layer is responsible for
each defence. It exists so that:

- new contributors understand *why* the architecture is shaped the way it is;
- when a regression breaks a layer, the next reviewer can tell what user-
  facing security property has been weakened;
- legal / business stakeholders can read it without source-diving and
  understand the residual risk before signing a content licence.

> **Bottom line.** The platform raises the cost of piracy and adds
> traceability to leaked copies. It does **not**, and cannot, prevent a
> determined attacker who controls their own playback device from
> capturing the picture leaving their screen. Pretending otherwise would
> be dishonest.

## Assets, ranked by value

| Rank | Asset | Where it lives | Loss scenario |
|---|---|---|---|
| 1 | Source video files | Cloudflare R2 (encrypted at rest) + cold backup in AWS Deep Archive | Mass download → republished as own product |
| 2 | AES-128 content keys | `video_keys` row, AES-GCM encrypted with KEK | Bulk decrypt of all leaked segments |
| 3 | KEK (key-encryption-key) | `.env` on the VPS, optionally `KEK_FILE` on disk | Compromises every content key in DB |
| 4 | User PII (emails, slip uploads) | Postgres + R2 (`slip-uploads/` prefix) | Privacy incident, legal exposure |
| 5 | Session JWTs | HttpOnly `__Host-session` cookie | Account takeover (limited blast radius — see device pinning) |

## Adversaries

We model three:

1. **Casual rip-and-share.** Average user opens DevTools, right-clicks the
   video, tries `youtube-dl` against the page URL. Goal: download +
   redistribute on Telegram / Drive.
2. **Account-shared cohort.** One paid account distributed among 5–50 people
   over the same Wi-Fi or via VPN. Goal: avoid paying once each.
3. **Determined ripper.** Knows hls.js internals, can run mitmproxy, has
   patience. Goal: rebuild the master playlist + decrypted ladder and post
   it commercially.

We **do not** model:

- a state actor with custody of the user's device (kernel-level capture);
- HDMI-out screen capture cards (the picture leaves the trust boundary);
- a malicious insider with `docker exec` on the VPS (everything is game).

## Defence layers — what each one buys you

The system is layered so that each adversary class hits a different wall.
Numbers below match the layer number printed in `app/main.py` startup logs
and in the architecture diagram in `docs/ARCHITECTURE.md`.

### Layer 1 — Encrypted segments at rest (HLS AES-128)

**What.** Every `.ts` segment in R2 is encrypted with a per-video AES-128
key. The manifest reference to that key is rewritten by the backend to
point at *our* `/key` endpoint, not at R2.

**Stops.** Casual rip-and-share. A `youtube-dl` of the public R2 URL
returns a directory listing of unintelligible bytes.

**Does not stop.** Anyone who can hit `/key` with a valid session.

### Layer 2 — Key delivery is per-session, time-bound, IP+UA pinned

**What.** `POST /api/v1/videos/{id}/playback-session` mints a short-lived
playback session bound to (user, IP, User-Agent, expires_at). `GET /key`
loads the row, re-checks IP+UA + expiry, decrypts via the KEK, and
returns the raw 16-byte AES key. Every grant + denial is written to
`key_access_log` with reason.

**Stops.** Replay of a captured key URL from a different IP or UA. Long-
running scrapers — sessions expire in minutes.

**Does not stop.** Same browser tab still playing the video.

**Tested by.** `tests/test_key_endpoint.py`, `tests/test_manifest_proxy.py`.

### Layer 3 — Cloudflare edge gateway with rate-limit + bot block

**What.** `edge-worker/` is a Cloudflare Worker that fronts `/key`,
`/manifest`, and `/edge/segment/*`. It enforces a sliding-window rate
limit (KV-backed, two adjacent minutes weighted by elapsed time),
blocks obvious tooling User-Agents (`python-requests`, `curl`, `wget`,
`go-http-client`, …), and signs an HMAC `__Host-` media cookie at
manifest time so segment fetches must originate from a paid session.

**Stops.** High-volume scrape from a single IP. Headless tooling that
forgets to spoof Accept headers.

**Does not stop.** A real browser playing one stream at the rate of a
human watching — that's identical to the legitimate case.

### Layer 4 — Device pinning + concurrent-session cap (anti-sharing)

**What.** First login from a new device fingerprint requires an OTP
emailed to the account. `MAX_CONCURRENT_SESSIONS` (default 3) is
enforced at the Redis layer; older sessions are evicted on overflow.

**Stops.** Adversary 2: an account being passed across a 50-person LINE
group fails the OTP + concurrent-session check after a few users.

**Does not stop.** A small ring (≤3 devices) that gets the OTP each time
and stays under the limit. This is intentional — a household genuinely
has multiple devices.

**Tested by.** `tests/test_anti_sharing.py`, `tests/test_devices.py`.

### Layer 5 — Watermarking (forensic, not preventive)

Two modes, configured per-course (`pixel_watermark` flag):

- **Overlay mode** (`WatermarkOverlay`). A `<canvas>` over the player
  draws `email • user_id_prefix • IP • timestamp` at a randomised
  position, on a 15-second hold-then-hop cycle. Cheap; bypassable by
  anyone who can edit the DOM. The `WatermarkSentinel` MutationObserver
  pauses playback if the canvas is removed or styled invisible.

- **Pixel mode** (`PixelWatermarkPlayer`). The video is rendered to a
  hidden `<video>`; each frame is copied to a `<canvas>` and the same
  identifier text is composited onto the frame buffer before the user
  sees it. Costs ~30% more CPU and disables HW decode, but the watermark
  survives screen recording, OBS, and phone-camera capture because it is
  literally inside the picture.

**Stops.** Nothing, by design. This is the only layer that keeps doing
its job after a leak — the captured frame names the leaker.

### Layer 6 — Anti-DevTools heuristics

`DevToolsGuard` watches for the window-size discrepancy that opening
DevTools introduces and pauses playback. `WatermarkSentinel` watches the
overlay canvas for tampering.

**Stops.** Casual users. Annoyance value only — anyone willing to install
a desktop debugger or use a headless browser bypasses both.

**Does not stop.** A skilled ripper with their own runtime.

### Layer 7 — Origin hardening

- HttpOnly + `__Host-`-prefixed cookies, `SameSite=Lax`, secure flag in production.
- CSRF protection on state-changing routes via origin checks (FastAPI middleware).
- CSP that disallows inline scripts and untrusted fonts.
- Rate-limit on auth endpoints (`/login`, `/register`, `/reset`) via Redis.
- All admin actions require `is_admin` server-side; nothing trusts the client flag.

## Out-of-scope, by deliberate decision

- **DRM (Widevine / FairPlay).** Requires CDM licensing fees and a
  service account with each browser vendor. Cost > marginal benefit
  for our content tier. Revisit if we sign a major-publisher catalogue.
- **HDMI-out / camera-out capture.** Inherent to consumer playback.
  Watermark is the answer; prevention is not.
- **Time-limited offline playback.** Users cannot download for offline
  watching. Adding that mode would have to ship its own DRM wrapper.

## Operational threats (separate from the playback path)

- **Compromise of the VPS** — every secret in `.env`, every key in the
  DB. Mitigations: full-disk encryption (Hetzner LUKS), `.env` 0600
  ownership, KEK loaded from a file outside the repo, Fail2ban on SSH,
  no public DB port.
- **Loss of the database** — irreversibly loses access to every video,
  because the KEK-encrypted content keys live there. Mitigations:
  daily `pg_dump` to AWS Deep Archive (separate trust boundary,
  PutObject-only credentials, no Delete permission).
- **Loss of the KEK** — content keys become unrecoverable, same outcome
  as above. Mitigations: KEK is stored in **two** places (`.env` on the
  VPS *and* a sealed copy off-site held by the project owner).

## Reviewing this document

Update this file in the same PR as any change to:

- `app/routers/videos.py` (key delivery)
- `app/middleware.py` / `app/abuse_guard.py` / `app/antisharing.py`
- `edge-worker/src/*`
- `components/SecurePlayer.tsx`, `components/PixelWatermarkPlayer.tsx`,
  `components/WatermarkOverlay.tsx`, `components/WatermarkSentinel.tsx`,
  `components/DevToolsGuard.tsx`
- The KEK / JWT secret loading code in `config.py`

If a defence layer is removed or weakened, this document is the source of
truth for the user-visible consequence — say so explicitly in the PR
description, not just in the diff.
