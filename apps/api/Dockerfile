FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/integrations/package.json packages/integrations/
RUN npm install
COPY . .
RUN npm run build:api
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 8793
CMD ["node", "dist/index.js"]
