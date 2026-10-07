#!/bin/sh
set -eu

# Railway-internal cutover (docs/postgres-migration.md). In these modes the API never starts:
# a maintenance/status server runs instead, and DATABASE_URL (still the SQLite source) is not
# used — the target is CUTOVER_TARGET_DATABASE_URL, passed explicitly.
case "${CUTOVER_MODE:-}" in
  job|preflight)
    echo "mybrandos: CUTOVER_MODE=${CUTOVER_MODE} — running the cutover runner instead of the API"
    exec node --import tsx scripts/cutover/main.ts
    ;;
  "") ;;
  *)
    echo "mybrandos: unknown CUTOVER_MODE; refusing to start" >&2
    exit 1
    ;;
esac

case "${DATABASE_URL:-}" in
  postgres://*|postgresql://*) ;;
  *)
    echo "mybrandos: DATABASE_URL must be a PostgreSQL URL; refusing to start" >&2
    exit 1
    ;;
esac

# Schema changes are explicit. Never `prisma db push` here.
if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
  echo "mybrandos: RUN_MIGRATIONS=1 — applying committed migrations (prisma migrate deploy)"
  npx prisma migrate deploy
fi

echo "mybrandos: starting api (startup verifies the schema matches committed migrations)"
exec node dist/index.js
