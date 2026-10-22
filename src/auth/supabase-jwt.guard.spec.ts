import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'node:crypto';
import { SupabaseJwtGuard } from './supabase-jwt.guard.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RedisService } from '../redis/redis.service.js';
import type { EnvConfig } from '../config/env.config.js';

describe('SupabaseJwtGuard', () => {
  let guard: SupabaseJwtGuard;
  let reflector: Reflector;
  let mockPrisma: any;
  let mockRedis: any;
  const mockConfig: EnvConfig = {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/db',
    DIRECT_URL: 'postgresql://postgres:postgres@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    SUPABASE_URL: 'https://test-project.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    PORT: 4000,
    NODE_ENV: 'test',
    FRONTEND_URL: 'http://localhost:3000',
    SENTRY_DSN: '',
    CLOUDINARY_CLOUD_NAME: '',
    CLOUDINARY_API_KEY: '',
    CLOUDINARY_API_SECRET: '',
  };

  // Generate test RSA key pair
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  beforeEach(() => {
    reflector = new Reflector();
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn().mockReturnValue(Promise.resolve({})),
      },
    };
    mockRedis = {
      getJson: vi.fn(),
      setJson: vi.fn().mockResolvedValue(undefined),
    };

    guard = new SupabaseJwtGuard(
      reflector,
      mockPrisma as PrismaService,
      mockRedis as RedisService,
      mockConfig,
    );

    // Mock Redis returning cached public key for test kid 'test-kid'
    mockRedis.getJson.mockImplementation((key: string) => {
      if (key === 'sk:auth:jwks') {
        return Promise.resolve({ 'test-kid': publicKey });
      }
      return Promise.resolve(null);
    });
  });

  const createMockContext = (authHeader?: string, isPublic = false): { ctx: ExecutionContext; req: any } => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);

    const req: any = {
      headers: authHeader ? { authorization: authHeader } : {},
    };

    const ctx = {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    return { ctx, req };
  };

  it('allows public endpoints without authorization header', async () => {
    const { ctx } = createMockContext(undefined, true);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('throws UnauthorizedException when authorization header is missing', async () => {
    const { ctx } = createMockContext(undefined, false);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when token header is missing kid', async () => {
    // Sign token without kid
    const token = jwt.sign(
      { sub: 'user-123' },
      privateKey,
      { algorithm: 'RS256' }, // no keyid option
    );

    const { ctx } = createMockContext(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when token is expired', async () => {
    const token = jwt.sign(
      {
        sub: 'user-123',
        aud: 'authenticated',
        iss: `${mockConfig.SUPABASE_URL}/auth/v1`,
        exp: Math.floor(Date.now() / 1000) - 60, // expired 1 min ago
      },
      privateKey,
      { algorithm: 'RS256', keyid: 'test-kid' },
    );

    const { ctx } = createMockContext(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when token signature is tampered', async () => {
    const validToken = jwt.sign(
      {
        sub: 'user-123',
        aud: 'authenticated',
        iss: `${mockConfig.SUPABASE_URL}/auth/v1`,
      },
      privateKey,
      { algorithm: 'RS256', keyid: 'test-kid' },
    );

    // Tamper with payload
    const parts = validToken.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'user-hacker' })).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const { ctx } = createMockContext(`Bearer ${tamperedToken}`);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('verifies valid token, loads profile from DB, and populates req.user', async () => {
    const token = jwt.sign(
      {
        sub: 'user-123',
        aud: 'authenticated',
        iss: `${mockConfig.SUPABASE_URL}/auth/v1`,
      },
      privateKey,
      { algorithm: 'RS256', keyid: 'test-kid' },
    );

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      tenantId: 'tenant-456',
      globalRole: 'ADMIN',
      isActive: true,
      deletedAt: null,
      branchAccess: [{ branchId: 'b-1', role: 'MANAGER' }],
    });

    const { ctx, req } = createMockContext(`Bearer ${token}`);
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req.user).toEqual({
      userId: 'user-123',
      tenantId: 'tenant-456',
      globalRole: 'ADMIN',
      branches: [{ branchId: 'b-1', role: 'MANAGER' }],
    });
  });

  it('throws UnauthorizedException if user is deactivated or deleted', async () => {
    const token = jwt.sign(
      {
        sub: 'user-inactive',
        aud: 'authenticated',
        iss: `${mockConfig.SUPABASE_URL}/auth/v1`,
      },
      privateKey,
      { algorithm: 'RS256', keyid: 'test-kid' },
    );

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-inactive',
      tenantId: 'tenant-456',
      globalRole: null,
      isActive: false, // inactive
      deletedAt: null,
      branchAccess: [],
    });

    const { ctx } = createMockContext(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
