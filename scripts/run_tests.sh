#!/usr/bin/env bash
# Run the test suite inside the api container against a dedicated test DB.
# Safe to re-run: the test DB is dropped + recreated each invocation.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Installing dev deps"
docker compose exec -T api pip install -q -r requirements-dev.txt

echo "==> (Re)creating course_test database"
docker compose exec -T db psql -U course -d course \
  -c "DROP DATABASE IF EXISTS course_test;" \
  -c "CREATE DATABASE course_test;"

echo "==> Running pytest"
docker compose exec -T \
  -e TEST_DATABASE_URL="postgresql+psycopg://course:${DB_PASSWORD:?DB_PASSWORD missing in env}@db:5432/course_test" \
  api pytest -v "$@"
