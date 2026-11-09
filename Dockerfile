# syntax=docker/dockerfile:1

# =============================================================================
# Stage 1: Base image with Node.js 22 LTS, Bun binary, and system libraries
# =============================================================================
FROM node:22-bookworm-slim AS base

WORKDIR /app

# Install system dependencies required by Prisma engine, SSL certificates, healthcheck curl, and dumb-init
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    curl \
    dumb-init \
  && rm -rf /var/lib/apt/lists/*

# Copy official Bun binary from oven/bun image for fast lockfile resolution and script execution
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

# =============================================================================
# Stage 2: Install all dependencies (development + production)
# =============================================================================
FROM base AS dependencies

COPY package.json bun.lock ./
COPY prisma.config.ts ./
COPY prisma ./prisma

RUN bun install --frozen-lockfile

# Generate Prisma Client engines and TypeScript typings
RUN bun run prisma:generate

# =============================================================================
# Stage 3: Install production dependencies only
# =============================================================================
FROM base AS prod-deps

COPY package.json bun.lock ./
COPY prisma.config.ts ./
COPY prisma ./prisma

RUN bun install --production --frozen-lockfile

# =============================================================================
# Stage 4: Build TypeScript application into JavaScript dist
# =============================================================================
FROM base AS builder

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json tsconfig*.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

RUN bun run build

# =============================================================================
# Stage 5: Development stage (for local Docker-based development)
# =============================================================================
FROM base AS development

ENV NODE_ENV=development
ENV PORT=4000

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

EXPOSE 4000

CMD ["bun", "run", "start:dev"]

# =============================================================================
# Stage 6: Production runtime image (minimal, non-root, secure)
# =============================================================================
FROM base AS runner

ENV NODE_ENV=production
ENV PORT=4000

# Create dedicated non-root user and group
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 -g nodejs nodejs

WORKDIR /app

# Copy production dependencies
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy generated Prisma Client and Prisma CLI binaries for runtime migrations
COPY --from=dependencies /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=dependencies /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=dependencies /app/node_modules/prisma ./node_modules/prisma
COPY --from=dependencies /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

# Copy built application and schema files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json

# Copy entrypoint script and set permissions
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 4000

# Container liveness healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:4000/v1/health || exit 1

ENTRYPOINT ["dumb-init", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]

