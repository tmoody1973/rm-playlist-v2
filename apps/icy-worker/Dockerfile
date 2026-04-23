FROM oven/bun:1.3.4-alpine

WORKDIR /app

COPY bun.lock package.json ./
COPY apps/icy-worker/package.json ./apps/icy-worker/
COPY packages/ingestion/package.json ./packages/ingestion/
COPY packages/types/package.json ./packages/types/

RUN bun install --frozen-lockfile --production=false

COPY tsconfig.base.json ./
COPY apps/icy-worker ./apps/icy-worker
COPY packages/ingestion ./packages/ingestion
COPY packages/types ./packages/types

ENV NODE_ENV=production

CMD ["bun", "run", "apps/icy-worker/src/index.ts"]
