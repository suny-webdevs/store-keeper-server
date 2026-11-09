import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'bun run prisma/seed.ts',
  },
  engine: 'classic',
  datasource: {
    url: process.env.DATABASE_URL ?? env('DATABASE_URL'),
    directUrl: process.env.DIRECT_URL ?? env('DIRECT_URL'),
  },
});
