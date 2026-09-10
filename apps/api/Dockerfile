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

# Bake schema-only SQLite outside the volume mount path.
# Empty Railway volumes mount over /data and would hide a build-time DB there.
RUN mkdir -p /app/apps/api/schema-seed /app/apps/api/data \
  && DATABASE_URL="file:/app/apps/api/schema-seed/prod.db" npx prisma db push --skip-generate \
  && test -s /app/apps/api/schema-seed/prod.db

EXPOSE 8793
# Seed once when the volume has no DB file. Do not run prisma on boot (can hang on Railway).
# Avoid shell $VARS in Railway start overrides — they get expanded before the container.
CMD ["sh", "-c", "mkdir -p /app/apps/api/data && (test -s /app/apps/api/data/prod.db || cp /app/apps/api/schema-seed/prod.db /app/apps/api/data/prod.db) && exec node dist/index.js"]
