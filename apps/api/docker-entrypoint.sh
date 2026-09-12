#!/bin/sh
set -eu
mkdir -p /app/apps/api/data
DB=/app/apps/api/data/prod.db
SEED=/app/apps/api/schema-seed/prod.db

if [ "${FORCE_DB_RESEED:-0}" = "1" ] || [ ! -s "$DB" ]; then
  echo "mybrandos: seeding data volume from schema-seed"
  cp "$SEED" "$DB"
else
  set +e
  node /app/apps/api/scripts/ensure-schema.js
  code=$?
  set -e
  if [ "$code" = "1" ]; then
    echo "mybrandos: volume DB missing schema; reseeding"
    cp "$SEED" "$DB"
  elif [ "$code" = "2" ]; then
    echo "mybrandos: applying additive schema (prisma db push)"
    npx prisma db push --skip-generate
  fi
fi

echo "mybrandos: starting api"
exec node dist/index.js
