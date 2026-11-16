import { afterEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { AuthModule } from './auth.module.js';
import { AuthController } from './auth.controller.js';
import { RegistrationService } from './registration.service.js';
import { SupabaseAuthService } from './supabase-auth.service.js';
import { SupabaseJwtGuard } from './supabase-jwt.guard.js';
import { RegistrationAuthGuard } from './registration-auth.guard.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuditService } from '../audit/audit.service.js';
import { ENV_CONFIG, ConfigModule } from '../config/config.module.js';
import type { EnvConfig } from '../config/env.config.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisModule } from '../redis/redis.module.js';
import { RedisService } from '../redis/redis.service.js';

function buildConfig(): EnvConfig {
  return {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/db',
    DIRECT_URL: 'postgresql://postgres:postgres@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    SUPABASE_URL: 'https://test-project.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    PORT: 4000,
    NODE_ENV: 'test',
    FRONTEND_URL: 'http://localhost:3000',
    REGISTRATION_ENABLED: true,
    SENTRY_DSN: '',
    CLOUDINARY_CLOUD_NAME: '',
    CLOUDINARY_API_KEY: '',
    CLOUDINARY_API_SECRET: '',
  };
}

describe('AuthModule wiring', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
  });

  it('resolves every auth provider with its dependencies', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        PrismaModule,
        RedisModule,
        AuditModule,
        AuthModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ user: {}, tenant: {}, $transaction: vi.fn() })
      .overrideProvider(RedisService)
      .useValue({
        client: {},
        getJson: vi.fn().mockResolvedValue(null),
        setJson: vi.fn().mockResolvedValue(undefined),
        del: vi.fn().mockResolvedValue(0),
      })
      .overrideProvider(ENV_CONFIG)
      .useValue(buildConfig())
      .overrideProvider(AuditService)
      .useValue({ record: vi.fn().mockResolvedValue(undefined) })
      .compile();

    expect(moduleRef.get(AuthController)).toBeInstanceOf(AuthController);
    expect(moduleRef.get(RegistrationService)).toBeInstanceOf(
      RegistrationService,
    );
    expect(moduleRef.get(RegistrationAuthGuard)).toBeInstanceOf(
      RegistrationAuthGuard,
    );
    expect(moduleRef.get(SupabaseJwtGuard)).toBeInstanceOf(SupabaseJwtGuard);
    expect(moduleRef.get(SupabaseAuthService)).toBeInstanceOf(
      SupabaseAuthService,
    );
  });
});
