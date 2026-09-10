FROM node:20-slim
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/integrations/package.json packages/integrations/
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV WEB_DIST=/app/apps/web/dist
ENV DATABASE_URL=file:/app/apps/api/data/prod.db
WORKDIR /app/apps/api

# Schema seed outside volume mount + initial data DB for non-volume boots.
RUN mkdir -p /app/apps/api/schema-seed /app/apps/api/data \
  && DATABASE_URL="file:/app/apps/api/schema-seed/prod.db" npx prisma db push --skip-generate \
  && cp /app/apps/api/schema-seed/prod.db /app/apps/api/data/prod.db \
  && test -s /app/apps/api/data/prod.db \
  && printf '%s\n' \
       '#!/bin/sh' \
       'set -eu' \
       'mkdir -p /app/apps/api/data' \
       'if [ ! -s /app/apps/api/data/prod.db ]; then' \
       '  echo "mybrandos: seeding empty data volume from schema-seed"' \
       '  cp /app/apps/api/schema-seed/prod.db /app/apps/api/data/prod.db' \
       'fi' \
       'echo "mybrandos: starting api"' \
       'exec node dist/index.js' \
       > /app/apps/api/docker-entrypoint.sh \
  && chmod +x /app/apps/api/docker-entrypoint.sh

EXPOSE 8793
CMD ["node", "dist/index.js"]
