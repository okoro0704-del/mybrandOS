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

# Schema seed lives outside the volume mount path so empty volumes do not hide it.
RUN mkdir -p /app/apps/api/schema-seed /app/apps/api/data \
  && DATABASE_URL="file:/app/apps/api/schema-seed/prod.db" npx prisma db push --skip-generate \
  && cp /app/apps/api/schema-seed/prod.db /app/apps/api/data/prod.db \
  && test -s /app/apps/api/data/prod.db

COPY apps/api/docker-entrypoint.sh /app/apps/api/docker-entrypoint.sh
RUN chmod +x /app/apps/api/docker-entrypoint.sh

EXPOSE 8793
CMD ["./docker-entrypoint.sh"]
