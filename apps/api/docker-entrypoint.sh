#!/bin/sh
set -eu

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
