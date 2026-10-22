import { z } from 'zod/v4';

export const envSchema = z.object({
  // Database
  DATABASE_URL: z.url(),
  DIRECT_URL: z.url(),

  // Redis
  REDIS_URL: z.string().min(1),

  // Supabase
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),

  // Application
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_URL: z.url().default('http://localhost:3000'),

  // Sentry (optional in dev)
  SENTRY_DSN: z.string().optional().default(''),

  // Cloudinary (optional in dev)
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validate environment variables at boot time.
 * Throws with detailed errors if validation fails.
 */
export function validateEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = z.prettifyError(result.error);
    console.error('❌ Invalid environment variables:\n', formatted);
    process.exit(1);
  }
  return result.data;
}
