// dotenv/config is loaded first so DATABASE_URL and DIRECT_URL are in process.env
// before Prisma's WASM schema parser runs. When prisma.config.ts is detected,
// Prisma skips its own .env loading — this import compensates for that.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'bun run prisma/seed.ts',
  },
  datasource: {
    url: env('DIRECT_URL'),  },
});
