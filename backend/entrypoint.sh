#!/usr/bin/env bash
# Container entrypoint. Runs migrations before starting uvicorn so deploys
# always land on a schema that matches the code.
set -euo pipefail

echo "==> alembic upgrade head"
alembic upgrade head

echo "==> starting uvicorn"
exec uvicorn app.main:app \
  --host 0.0.0.0 --port 8000 \
  --workers "${UVICORN_WORKERS:-2}" \
  --proxy-headers --forwarded-allow-ips '*'
