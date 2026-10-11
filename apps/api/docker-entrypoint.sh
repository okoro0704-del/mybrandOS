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
  if [ "$code" = "10" ]; then
    echo "mybrandos: volume DB missing schema; backing it up, then reseeding"
    cp "$DB" "$DB.pre-reseed-$(date +%s)"
    cp "$SEED" "$DB"
  elif [ "$code" = "2" ]; then
    echo "mybrandos: applying additive schema (prisma db push)"
    npx prisma db push --skip-generate
  elif [ "$code" != "0" ]; then
    # Check could not read the database: never reseed or push on uncertainty.
    echo "mybrandos: schema check could not run (code $code); starting with the database unchanged"
  fi
fi

echo "mybrandos: starting api"
exec node dist/index.js
