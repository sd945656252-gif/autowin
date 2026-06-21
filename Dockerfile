FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci

FROM deps AS builder
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl curl ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 jiying \
  && useradd --system --uid 1001 --gid jiying --home-dir /app --shell /usr/sbin/nologin jiying
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder --chown=jiying:jiying /app/dist ./dist
COPY --from=builder --chown=jiying:jiying /app/prisma ./prisma
RUN ./node_modules/.bin/prisma generate
RUN mkdir -p uploads storage/private \
  && chown -R jiying:jiying /app
USER jiying
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD curl -fsS http://localhost:3000/api/health || exit 1
CMD ["node", "dist/api/server.cjs"]
