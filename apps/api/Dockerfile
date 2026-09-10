FROM node:20-slim
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl ca-certificates sqlite3 && rm -rf /var/lib/apt/lists/*

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

# Bake a schema-only SQLite into the image (not under the volume mount path).
# An empty Railway volume mounts over /app/apps/api/data and would otherwise hide a build-time DB.
RUN mkdir -p /app/apps/api/schema-seed /app/apps/api/data \
  && DATABASE_URL="file:/app/apps/api/schema-seed/prod.db" npx prisma db push --skip-generate \
  && test -s /app/apps/api/schema-seed/prod.db

EXPOSE 8793
# If the volume has no usable DB yet, seed it from the image. Never use --accept-data-loss here.
CMD ["sh", "-c", "mkdir -p /app/apps/api/data; DB=/app/apps/api/data/prod.db; SEED=/app/apps/api/schema-seed/prod.db; if [ ! -f \"$DB\" ] || [ ! -s \"$DB\" ]; then cp \"$SEED\" \"$DB\"; elif [ \"$(sqlite3 \"$DB\" \"SELECT count(*) FROM sqlite_master WHERE type='table';\")\" = \"0\" ]; then cp \"$SEED\" \"$DB\"; fi; exec node dist/index.js"]
