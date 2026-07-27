FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3001 \
    RELAY_CONFIG_PATH=/app/config/relay.config.json \
    RELAY_DATABASE_PATH=/data/relay.sqlite

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && mkdir -p /app/config /data \
    && chown node:node /data

COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 3001
VOLUME ["/data"]

CMD ["node", "dist/server/server/index.js"]
