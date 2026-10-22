import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { LoggerModule } from 'nestjs-pino';

import { ConfigModule, ENV_CONFIG } from './config/config.module.js';
import type { EnvConfig } from './config/env.config.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { RedisService } from './redis/redis.service.js';
import { CacheModule } from './cache/cache.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CsrfGuard } from './auth/csrf.guard.js';
import { SupabaseJwtGuard } from './auth/supabase-jwt.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { BranchAccessGuard } from './auth/branch-access.guard.js';
import { AuditModule } from './audit/audit.module.js';
import { AuditInterceptor } from './audit/audit.interceptor.js';
import { HealthModule } from './health/health.module.js';
import { BranchesModule } from './branches/branches.module.js';
import { UsersModule } from './users/users.module.js';
import { TenantContextInterceptor } from './common/tenant.interceptor.js';
import { EnvelopeInterceptor } from './common/envelope.interceptor.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    CacheModule,
    AuthModule,
    AuditModule,
    HealthModule,
    BranchesModule,
    UsersModule,
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req) => (req.headers['x-request-id'] as string) || crypto.randomUUID(),
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'res.headers["set-cookie"]',
          '*.accessToken',
          '*.refreshToken',
        ],
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  singleLine: true,
                },
              }
            : undefined,
      },
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RedisModule],
      inject: [ENV_CONFIG, RedisService],
      useFactory: (_config: EnvConfig, redis: RedisService) => ({
        throttlers: [
          { name: 'default', limit: 100, ttl: 60000 },
          { name: 'auth', limit: 10, ttl: 60000 },
          { name: 'read', limit: 300, ttl: 60000 },
          { name: 'write', limit: 100, ttl: 60000 },
          { name: 'sync', limit: 60, ttl: 60000 },
          { name: 'export', limit: 5, ttl: 60000 },
        ],
        storage: new ThrottlerStorageRedisService(redis.client),
      }),
    }),
  ],
  providers: [
    // 1. ThrottlerGuard -> 429
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // 2. CsrfGuard -> 403 on mutation without valid CSRF
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
    // 3. SupabaseJwtGuard -> 401 on missing/invalid JWT
    {
      provide: APP_GUARD,
      useClass: SupabaseJwtGuard,
    },
    // 4. RolesGuard -> 403 if @RequireGlobalRole not met
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // 5. BranchAccessGuard -> 403 if @RequireBranchRole not met
    {
      provide: APP_GUARD,
      useClass: BranchAccessGuard,
    },
    // 6. TenantContextInterceptor -> AsyncLocalStorage tenantId set
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
    // 7. AuditInterceptor -> async audit logging
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    // 8. EnvelopeInterceptor -> standard { success, message, data, meta }
    {
      provide: APP_INTERCEPTOR,
      useClass: EnvelopeInterceptor,
    },
    // 9. AllExceptionsFilter -> normalized errors
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
