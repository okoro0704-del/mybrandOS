#!/bin/sh
set -eu
mkdir -p /app/apps/api/data
if [ ! -s /app/apps/api/data/prod.db ]; then
  echo "mybrandos: seeding empty data volume from schema-seed"
  cp /app/apps/api/schema-seed/prod.db /app/apps/api/data/prod.db
fi
echo "mybrandos: starting api"
exec node dist/index.js
