// dotenv/config loads .env into process.env before any Prisma command runs.
// When prisma.config.ts is detected, Prisma skips its own .env loading —
// this import compensates for that.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'bun run prisma/seed.ts',
  },

  // Datasource is only included when DIRECT_URL (or DATABASE_URL) is present.
  //
  // Why DIRECT_URL for the CLI datasource?
  //   In Prisma 7, prisma.config.ts `datasource.url` is used exclusively by
  //   CLI commands (migrate deploy, db push, introspect). These commands need
  //   a DIRECT (non-pooled) connection — Supabase's pgBouncer/Supavisor
  //   transaction-mode pooler does NOT support DDL statements needed for
  //   migrations. DIRECT_URL bypasses the pooler (port 5432).
  //
  //   The runtime PrismaClient reads DATABASE_URL directly from the environment
  //   (Prisma 7 default convention) for query traffic — this uses the pooled
  //   connection (port 6543).
  //
  // Why conditional?
  //   `prisma generate` runs at Docker BUILD TIME — no env vars exist in the
  //   build context. It only reads the schema to emit TypeScript types and
  //   never connects to the database, so no URL is needed.
  //   `prisma migrate deploy` runs at CONTAINER RUNTIME (via docker-entrypoint.sh)
  //   where DIRECT_URL is injected by the orchestrator (Render, Docker Compose…).
  //
  // Using process.env directly (not Prisma's env()) so a missing var returns
  // undefined instead of throwing PrismaConfigEnvError.
  ...(process.env.DIRECT_URL || process.env.DATABASE_URL
    ? {
        datasource: {
          url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
        },
      }
    : {}),
});
