#!/bin/sh
set -eu
mkdir -p /app/apps/api/data
DB=/app/apps/api/data/prod.db
SEED=/app/apps/api/schema-seed/prod.db

if [ "${FORCE_DB_RESEED:-0}" = "1" ] || [ ! -s "$DB" ]; then
  echo "mybrandos: seeding data volume from schema-seed"
  cp "$SEED" "$DB"
elif ! node /app/apps/api/scripts/ensure-schema.js; then
  echo "mybrandos: volume DB missing schema; reseeding"
  cp "$SEED" "$DB"
fi

echo "mybrandos: starting api"
exec node dist/index.js
