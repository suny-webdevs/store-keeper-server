# syntax=docker/dockerfile:1

# =============================================================================
# Stage 1: Base — Node.js 22 LTS + Bun + system libs
# =============================================================================
FROM node:22-bookworm-slim AS base

WORKDIR /app

# openssl  → Prisma schema-engine binary (migrate deploy)
# ca-certs → TLS connections to Supabase / external services
# curl     → healthcheck probe (GET /v1/health)
# dumb-init→ PID-1 signal forwarding for graceful shutdown
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    curl \
    dumb-init \
  && rm -rf /var/lib/apt/lists/*

# Pull Bun binary from the official image
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

# =============================================================================
# Stage 2: Install ALL dependencies + generate Prisma Client (Prisma 7)
#
# In Prisma 7 the generated client lands entirely inside
# node_modules/@prisma/client (WASM engines, schema.prisma, type defs).
# node_modules/.prisma/client holds the hash-named generated artefacts.
# node_modules/@prisma/engines holds the schema-engine binary for migrations.
# =============================================================================
FROM base AS dependencies

COPY package.json bun.lock ./
COPY prisma.config.ts ./
COPY prisma ./prisma

RUN bun install --frozen-lockfile

# Generate the Prisma Client for the linux-arm64 / linux-x64 binary target
RUN bun run prisma:generate

# =============================================================================
# Stage 3: Production-only dependency install (no devDependencies)
# =============================================================================
FROM base AS prod-deps

COPY package.json bun.lock ./
COPY prisma.config.ts ./
COPY prisma ./prisma

RUN bun install --production --frozen-lockfile

# =============================================================================
# Stage 4: TypeScript → JavaScript build
# =============================================================================
FROM base AS builder

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json tsconfig*.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

RUN bun run build

# =============================================================================
# Stage 5: Development — hot-reload via NestJS watch mode
# =============================================================================
FROM base AS development

ENV NODE_ENV=development
ENV PORT=4000

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

EXPOSE 4000

CMD ["bun", "run", "start:dev"]

# =============================================================================
# Stage 6: Production runner — minimal, non-root, hardened
# =============================================================================
FROM base AS runner

ENV NODE_ENV=production
ENV PORT=4000

# Dedicated non-root user (UID/GID 1001)
RUN groupadd --system --gid 1001 nodejs && \
    useradd  --system --uid 1001 -g nodejs nodejs

WORKDIR /app

# ── Production node_modules ──────────────────────────────────────────────────
COPY --from=prod-deps /app/node_modules ./node_modules

# ── Prisma 7: overwrite with the generate-enriched @prisma/client and engines
#    @prisma/client  — runtime client + WASM query engine + schema.prisma copy
#    .prisma/client  — hash-named generated artefacts (types, query compiler)
#    @prisma/engines — schema-engine binary required by `prisma migrate deploy`
#    prisma binary   — CLI entry-point used by docker-entrypoint.sh
# ────────────────────────────────────────────────────────────────────────────
COPY --from=dependencies /app/node_modules/@prisma/client   ./node_modules/@prisma/client
COPY --from=dependencies /app/node_modules/.prisma          ./node_modules/.prisma
COPY --from=dependencies /app/node_modules/@prisma/engines  ./node_modules/@prisma/engines
COPY --from=dependencies /app/node_modules/prisma           ./node_modules/prisma
COPY --from=dependencies /app/node_modules/.bin/prisma      ./node_modules/.bin/prisma

# ── Application artefacts ────────────────────────────────────────────────────
COPY --from=builder /app/dist           ./dist
COPY --from=builder /app/prisma         ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json   ./package.json

# ── Entrypoint ───────────────────────────────────────────────────────────────
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 4000

# Liveness probe — hits the public /v1/health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:4000/v1/health || exit 1

ENTRYPOINT ["dumb-init", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
