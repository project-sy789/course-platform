# Blue-Green Deploy on Hetzner

Two copies of the stateless tier (`api` + `worker`) run side-by-side as
**blue** and **green**. Caddy reverse-proxies traffic to whichever color is
currently "live"; deploys flip the proxy from one to the other with no
dropped connections.

Stateful + cross-cutting services (`db`, `redis`, `mailserver`, `caddy`,
`prometheus`, `grafana`, `loki`, `promtail`, `ofelia`) live in a single
shared stack and are NOT duplicated.

## Files

- `deploy/docker-compose.shared.yml` — db, redis, caddy, monitoring. Always up.
- `deploy/docker-compose.blue.yml` — `api-blue` + `worker-blue`.
- `deploy/docker-compose.green.yml` — `api-green` + `worker-green`.
- `deploy/Caddyfile.prod` — static. Includes `import /etc/caddy/active-upstream`.
- `deploy/caddy.active-upstream` — single-line snippet `reverse_proxy api-<color>:8000 {...}`.
  Rewritten by `scripts/deploy.sh` on every flip.
- `scripts/deploy.sh` — main deploy.
- `scripts/rollback.sh` — flip back to the previous color.

## First-time setup

```bash
# .env must be present at repo root with DB_PASSWORD, MAIL_*, GRAFANA_PASSWORD,
# ALERT_WEBHOOK_URL, KEK_FILE, R2_*, SLIPOK_API_KEY, etc. — see .env.example.

# Bring up shared services + blue color for the very first time:
docker compose -f deploy/docker-compose.shared.yml up -d
docker compose -f deploy/docker-compose.shared.yml -f deploy/docker-compose.blue.yml \
	run --rm --entrypoint "" api-blue alembic upgrade head
docker compose -f deploy/docker-compose.shared.yml -f deploy/docker-compose.blue.yml \
	up -d api-blue worker-blue
```

The repo ships with `deploy/caddy.active-upstream` already pointing at
`api-blue`, so Caddy will route correctly out of the box.

## Normal deploy

```bash
git pull
./scripts/deploy.sh
```

`deploy.sh` will:

1. Detect the live color from `deploy/caddy.active-upstream`.
2. Build the idle color's image.
3. Run `alembic upgrade head` from the new image (BEFORE flipping traffic).
4. `up -d` the idle color's `api-*` + `worker-*`.
5. Poll `/healthz/ready` on the idle container until it's serving (or abort).
6. Rewrite `caddy.active-upstream` and `caddy reload` — graceful, no drops.
7. Sleep `DRAIN_SECS` (default 60s) so the old color finishes in-flight requests.
8. `stop` the old color's containers.

Override the drain window or health timeout:

```bash
DRAIN_SECS=120 HEALTH_TIMEOUT=180 ./scripts/deploy.sh
```

## Rollback

If a deploy regresses something, within roughly DRAIN_SECS the old color is
still running and the flip is instant:

```bash
./scripts/rollback.sh
```

After the drain window the old color has been stopped — `rollback.sh` will
start it again before flipping. That path takes ~10–30s for the container to
come up and pass health checks.

## Migration contract — READ THIS

Blue-green only works if **both colors can talk to the same database
schema at the same time**. That means every schema change must be split into
an expand step (deployed first, backward-compatible) and a contract step
(deployed in a later release, after no code reads the old shape):

- **Adding a column** — fine. Old code ignores it.
- **Adding a table** — fine.
- **Removing a column** — DO NOT drop it in the same release that stops
  reading it. Release N: stop reading. Release N+1: drop column.
- **Renaming a column** — add the new column + dual-write in release N,
  switch reads in release N+1, drop the old column in release N+2.
- **NOT NULL on an existing column** — release N adds the column nullable
  + backfills + dual-writes. Release N+1 sets NOT NULL.
- **Type change on existing column** — same expand/contract pattern.

If you need a breaking migration, do a maintenance-window deploy instead:
stop both colors, run the migration, start one color. Don't try to push
a destructive migration through `deploy.sh` — it will run `alembic upgrade
head` from the new image while the old color is still serving traffic.

## Backups (ofelia)

`ofelia` is in the shared stack and runs cron jobs against labeled
containers. The `api-blue` and `api-green` services have
`ofelia.enabled: "false"` by default — when promoting a color to "active",
toggle that label on the live one (or always run backups from the shared
postgres container directly, which is what the current job spec does — see
`monitoring/`).

## What `caddy reload` actually does

Caddy 2 supports config reload without dropping in-flight connections:
listeners stay open across the swap, the new config is built in memory,
and only after successful build does the new config become active. So the
sequence is safe:

1. `mv` the new snippet over `caddy.active-upstream` (atomic on same FS).
2. `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`.
3. Caddy reads the new `import` content, validates, swaps.

If validation fails (e.g. the snippet is malformed), Caddy keeps the old
config and `caddy reload` exits non-zero — `deploy.sh` will fail loudly
without flipping.
