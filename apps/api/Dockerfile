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
RUN mkdir -p /app/apps/api/data

EXPOSE 8793
# Apply schema at start so a mounted volume (empty or existing) gets tables without wiping data.
# Do not use --accept-data-loss in production.
CMD ["sh", "-c", "mkdir -p /app/apps/api/data && npx prisma db push && node dist/index.js"]
