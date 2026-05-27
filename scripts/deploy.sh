#!/usr/bin/env bash
# Blue-green deploy on Hetzner.
#
# Flow:
#   1. Figure out which color is currently live by reading the active-upstream snippet.
#   2. Build + bring up the OTHER (idle) color.
#   3. Poll /healthz/ready on the idle color until it's serving.
#   4. Rewrite deploy/caddy.active-upstream to point at the idle color and
#      `caddy reload` (no dropped connections).
#   5. Drain for DRAIN_SECS so the old color finishes in-flight requests.
#   6. Stop the old color's api + worker.
#
# IMPORTANT: Database migrations MUST be backward-compatible (expand-then-contract).
# See deploy/README.md.
set -euo pipefail

cd "$(dirname "$0")/.."

ACTIVE_FILE="deploy/caddy.active-upstream"
SHARED="deploy/docker-compose.shared.yml"
DRAIN_SECS="${DRAIN_SECS:-60}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
CADDY_CONTAINER="${CADDY_CONTAINER:-course-platform-caddy-1}"

if grep -q "api-blue" "$ACTIVE_FILE"; then
	OLD=blue
	NEW=green
else
	OLD=green
	NEW=blue
fi
echo ">> active=$OLD  deploying=$NEW"

NEW_COMPOSE="deploy/docker-compose.${NEW}.yml"
OLD_COMPOSE="deploy/docker-compose.${OLD}.yml"

# 1. Make sure shared services (db, redis, caddy, monitoring) are up.
docker compose -f "$SHARED" up -d

# 2. Run forward (expand) migrations from the NEW image before flipping traffic.
echo ">> running migrations from new image"
docker compose -f "$SHARED" -f "$NEW_COMPOSE" build "api-${NEW}"
docker compose -f "$SHARED" -f "$NEW_COMPOSE" run --rm --entrypoint "" "api-${NEW}" \
	alembic upgrade head

# 3. Bring up the idle color.
docker compose -f "$SHARED" -f "$NEW_COMPOSE" up -d "api-${NEW}" "worker-${NEW}"

# 4. Health gate.
echo ">> waiting for api-${NEW} /healthz/ready (timeout ${HEALTH_TIMEOUT}s)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
until docker exec "$CADDY_CONTAINER" wget -q -O- "http://api-${NEW}:8000/healthz/ready" >/dev/null 2>&1; do
	if [ "$(date +%s)" -ge "$deadline" ]; then
		echo "!! api-${NEW} never became ready — aborting, leaving old color live"
		exit 1
	fi
	sleep 2
done
echo ">> api-${NEW} is ready"

# 5. Rewrite the snippet + caddy reload (atomic write).
tmp="$(mktemp)"
sed "s/api-${OLD}/api-${NEW}/g" "$ACTIVE_FILE" > "$tmp"
mv "$tmp" "$ACTIVE_FILE"
echo ">> reloading caddy"
docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile

# 6. Drain.
echo ">> draining old color for ${DRAIN_SECS}s"
sleep "$DRAIN_SECS"

# 7. Stop old color.
echo ">> stopping api-${OLD} + worker-${OLD}"
docker compose -f "$SHARED" -f "$OLD_COMPOSE" stop "api-${OLD}" "worker-${OLD}"

echo ">> done. live color is now ${NEW}"
