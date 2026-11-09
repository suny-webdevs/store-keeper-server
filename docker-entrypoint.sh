#!/bin/sh
set -e

# Run database migrations if RUN_MIGRATIONS is true or 1
if [ "$RUN_MIGRATIONS" = "true" ] || [ "$RUN_MIGRATIONS" = "1" ]; then
  echo "🚀 Running Prisma migrations (prisma migrate deploy)..."
  ./node_modules/.bin/prisma migrate deploy || {
    echo "⚠️ Prisma migrate deploy encountered an issue, proceeding..."
  }
fi

# Run database seed if RUN_SEED is true or 1
if [ "$RUN_SEED" = "true" ] || [ "$RUN_SEED" = "1" ]; then
  echo "🌱 Seeding database (bun run prisma/seed.ts)..."
  bun run prisma/seed.ts || {
    echo "⚠️ Database seed encountered an issue, proceeding..."
  }
fi

# Execute container command (default: node dist/main.js)
exec "$@"

