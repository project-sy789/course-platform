#!/usr/bin/env bash
# Emergency rollback: flip the active-upstream snippet back to whichever color
# is NOT currently live and reload caddy.
#
# Assumes the previous color's containers are still running (deploy.sh stops
# them after a DRAIN_SECS delay — within that window, rollback is instant; after
# that, this script will start them again first).
set -euo pipefail

cd "$(dirname "$0")/.."

ACTIVE_FILE="deploy/caddy.active-upstream"
SHARED="deploy/docker-compose.shared.yml"
CADDY_CONTAINER="${CADDY_CONTAINER:-course-platform-caddy-1}"

if grep -q "api-blue" "$ACTIVE_FILE"; then
	NEW=green
	OLD=blue
else
	NEW=blue
	OLD=green
fi
echo ">> rolling back: ${OLD} -> ${NEW}"

NEW_COMPOSE="deploy/docker-compose.${NEW}.yml"

# Make sure the target color is up (in case deploy.sh already stopped it).
docker compose -f "$SHARED" -f "$NEW_COMPOSE" up -d "api-${NEW}" "worker-${NEW}"

deadline=$(( $(date +%s) + 60 ))
until docker exec "$CADDY_CONTAINER" wget -q -O- "http://api-${NEW}:8000/healthz/ready" >/dev/null 2>&1; do
	if [ "$(date +%s)" -ge "$deadline" ]; then
		echo "!! api-${NEW} did not come back ready — manual intervention required"
		exit 1
	fi
	sleep 2
done

tmp="$(mktemp)"
sed "s/api-${OLD}/api-${NEW}/g" "$ACTIVE_FILE" > "$tmp"
mv "$tmp" "$ACTIVE_FILE"

docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile
echo ">> rolled back. live color is now ${NEW}"
echo ">> NOTE: the broken color (${OLD}) is still running for inspection — stop it manually when ready."
