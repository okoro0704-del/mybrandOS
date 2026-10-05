FROM node:20-slim
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY vendor/digiconomy-space-runtime-1.0.0.tgz vendor/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/integrations/package.json packages/integrations/
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV WEB_DIST=/app/apps/web/dist
# DATABASE_URL (PostgreSQL) is supplied by the platform. The image never creates or alters a
# schema on its own: run `npx prisma migrate deploy` as an explicit release step (Railway
# pre-deploy command), or set RUN_MIGRATIONS=1 where no pre-deploy hook exists. The API's
# startup guard refuses to serve if the schema does not match the committed migrations.
WORKDIR /app/apps/api
RUN sed -i 's/\r$//' /app/apps/api/docker-entrypoint.sh && chmod +x /app/apps/api/docker-entrypoint.sh

EXPOSE 8793
CMD ["./docker-entrypoint.sh"]
