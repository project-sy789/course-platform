# Edge Worker — `course-platform-edge`

Cloudflare Worker that fronts the Hetzner origin and adds two layers the
origin can't do as well by itself:

1. **Edge-Computed Key Delivery** — per-IP edge rate limit + UA bot block on
   the expensive endpoints (`/api/v1/videos/{id}/key`, `/manifest`,
   `/sub-manifest`) BEFORE the request reaches Hetzner. The origin's
   per-(user, video) limit still runs as the inner wall.

2. **Tokenized Signed Cookies for R2** — on a successful `/manifest`
   response, the worker mints a short-lived HMAC-signed cookie
   (`__Host-cp-media`). When segments are routed through `/edge/segment/*`,
   the worker validates that cookie at the edge and serves the bytes from an
   R2 binding — no per-segment Redis call on origin.

The worker does NOT see plaintext AES-128 keys. The KEK and envelope-decrypt
step stay on the origin where they belong; the worker only forwards the
key endpoint after passing edge checks.

## Layout

```
edge-worker/
  wrangler.toml
  package.json
  tsconfig.json
  src/
    index.ts        # router + handlers
    bot.ts          # UA heuristics
    ratelimit.ts    # KV-backed sliding window
    cookie.ts       # HMAC sign/verify + cookie helpers
  test/
    cookie.test.ts
```

## One-time setup

```bash
cd edge-worker
npm install

# 1. Create the KV namespace for the rate limiter, then paste the id into
#    wrangler.toml (replace REPLACE_WITH_KV_ID).
npx wrangler kv namespace create EDGE_RL

# 2. Set the HMAC secret used to sign media cookies. Pick a long random
#    value — rotation requires a transition window where the worker accepts
#    both old and new (not yet implemented; do it during a quiet hour).
openssl rand -base64 48 | npx wrangler secret put HMAC_SECRET

# 3. Edit wrangler.toml ORIGIN_HOST to point at a hostname that bypasses the
#    worker route (otherwise you'll create a fetch loop). Common options:
#      - a Cloudflare Tunnel hostname (recommended, no public origin IP)
#      - origin.example.com pointing at the Hetzner box on a non-worker route

# 4. Deploy.
npx wrangler deploy
```

## Origin contract

For the media cookie to be minted, the origin must echo the authenticated
user id back on the `/manifest` response:

```python
# backend/app/routers/videos.py — at the end of get_manifest / get_sub_manifest
return Response(
    content=rewritten_manifest,
    media_type="application/vnd.apple.mpegurl",
    headers={
        "Cache-Control": "no-store",
        "X-Cp-Uid": str(user.id),  # <-- the worker reads this and strips it
    },
)
```

The worker strips `X-Cp-Uid` before forwarding to the browser, so the header
is never visible client-side.

If `X-Cp-Uid` is absent (e.g. a deploy where the origin hasn't been updated
yet), the worker simply doesn't mint a cookie and segment requests fall
through to origin's existing presigned-URL flow. Backward-compatible.

## Routing segments through the worker (optional)

Today the origin rewrites segment URLs in the manifest to presigned R2 URLs
that go directly browser→R2. To switch to edge-validated segments:

1. Bind the R2 bucket in `wrangler.toml`:

   ```toml
   [[r2_buckets]]
   binding = "MEDIA"
   bucket_name = "course-platform-media"
   ```

2. In the origin's manifest rewriter, change segment URLs from
   `https://<r2-presigned>` to `/edge/segment/{video_id}/{r2_object_key}`.

3. Redeploy the worker (with the binding) and the origin together.

The worker will validate `__Host-cp-media`, then `MEDIA.get(objectKey)`,
then stream. Bytes never traverse origin.

## What the rate limit looks like

Defaults in `wrangler.toml`:

| Scope     | Per IP per min |
|-----------|---------------:|
| key       | 30             |
| manifest  | 20             |
| default   | 300            |

The algorithm is a sliding window across two adjacent minutes, weighted by
how far into the current minute we are (see `src/ratelimit.ts`). KV is
eventually consistent across regions (~30s), which is fine here — false
negatives are bounded; false positives are impossible.

## Tests

```bash
npm test
```

Covers the cookie sign/verify path: round-trip, tampered body, expired,
wrong secret. The rate limiter and end-to-end routing are exercised via
`wrangler dev` against a staging KV namespace — there's no in-process KV
mock that's faithful enough to be worth testing against.

## Anti-patterns to avoid

- **Don't put the KEK in worker secrets.** A leaked Worker secret is much
  cheaper to exfiltrate than a leaked origin file (Worker code is Anthropic-
  inspectable; Hetzner disk isn't). Keep envelope decryption at origin.
- **Don't cache `/key` or `/manifest` responses.** Both are per-request
  single-use. The worker explicitly sets `cf.cacheTtl: 0` on the proxy fetch.
- **Don't forget to strip `X-Cp-Uid`.** It's an internal header. The handler
  in `src/index.ts` already does this — keep it that way if you refactor.
