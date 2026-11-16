import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { RegistrationService } from './registration.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { EnvConfig } from '../config/env.config.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '33333333-3333-4333-8333-333333333333';
const IDENTITY = { userId: USER_ID, email: 'Owner@Acme.com' };
const META = { ip: '127.0.0.1', userAgent: 'vitest' };

function buildConfig(overrides: Partial<EnvConfig> = {}): EnvConfig {
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
    ...overrides,
  };
}

describe('RegistrationService', () => {
  let service: RegistrationService;
  let mockPrisma: any;
  let mockAudit: { record: ReturnType<typeof vi.fn> };

  const tenantRecord = {
    id: TENANT_ID,
    name: 'Acme Retail',
    slug: 'acme-retail',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const userRecord = {
    id: USER_ID,
    tenantId: TENANT_ID,
    email: 'owner@acme.com',
    fullName: 'Jane Doe',
    globalRole: 'OWNER',
    isActive: true,
    lastLoginAt: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(userRecord),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(tenantRecord),
      },
      $transaction: vi.fn(async (cb: (tx: any) => unknown) => cb(mockPrisma)),
    };
    mockAudit = { record: vi.fn().mockResolvedValue(undefined) };

    service = new RegistrationService(
      mockPrisma as PrismaService,
      mockAudit as unknown as AuditService,
      buildConfig(),
    );
  });

  it('creates a tenant and OWNER atomically with a derived slug', async () => {
    const result = await service.register(
      { tenantName: 'Acme Retail', fullName: 'Jane Doe' },
      IDENTITY,
      META,
    );

    expect(mockPrisma.tenant.create).toHaveBeenCalledWith({
      data: { name: 'Acme Retail', slug: 'acme-retail' },
    });
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        id: USER_ID,
        tenantId: TENANT_ID,
        email: 'owner@acme.com',
        fullName: 'Jane Doe',
        globalRole: 'OWNER',
      },
    });
    expect(result.tenant).toMatchObject({
      id: TENANT_ID,
      name: 'Acme Retail',
      slug: 'acme-retail',
    });
    expect(result.user).toMatchObject({
      id: USER_ID,
      tenantId: TENANT_ID,
      email: 'owner@acme.com',
      globalRole: 'OWNER',
    });
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorId: USER_ID,
        action: 'tenant.register',
        entityType: 'Tenant',
        ip: '127.0.0.1',
      }),
    );
  });

  it('derives a safe slug from a name containing punctuation', async () => {
    await service.register(
      { tenantName: 'Acme & Sons', fullName: 'Jane Doe' },
      IDENTITY,
      META,
    );

    expect(mockPrisma.tenant.create).toHaveBeenCalledWith({
      data: { name: 'Acme & Sons', slug: 'acme-sons' },
    });
  });

  it('uses an explicitly provided slug as-is', async () => {
    await service.register(
      {
        tenantName: 'Acme Retail',
        slug: 'acme-store',
        fullName: 'Jane Doe',
      },
      IDENTITY,
      META,
    );

    expect(mockPrisma.tenant.create).toHaveBeenCalledWith({
      data: { name: 'Acme Retail', slug: 'acme-store' },
    });
  });

  it('rejects when registration is disabled', async () => {
    service = new RegistrationService(
      mockPrisma as PrismaService,
      mockAudit as unknown as AuditService,
      buildConfig({ REGISTRATION_ENABLED: false }),
    );

    const error = await service
      .register(
        { tenantName: 'Acme Retail', fullName: 'Jane Doe' },
        IDENTITY,
        META,
      )
      .catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toMatchObject({
      code: 'REGISTRATION_DISABLED',
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a Supabase identity that already has a local account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: USER_ID });

    const error = await service
      .register(
        { tenantName: 'Acme Retail', fullName: 'Jane Doe' },
        IDENTITY,
        META,
      )
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      code: 'ACCOUNT_ALREADY_REGISTERED',
    });
    expect(mockPrisma.tenant.create).not.toHaveBeenCalled();
  });

  it('rejects an email that already belongs to an active account', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
    });

    const error = await service
      .register(
        { tenantName: 'Acme Retail', fullName: 'Jane Doe' },
        IDENTITY,
        META,
      )
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'EMAIL_IN_USE' });
  });

  it('rejects a tenant slug that is already taken', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });

    const error = await service
      .register(
        { tenantName: 'Acme Retail', fullName: 'Jane Doe' },
        IDENTITY,
        META,
      )
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'TENANT_SLUG_TAKEN' });
  });

  it('rejects reserved slugs', async () => {
    const error = await service
      .register(
        { tenantName: 'Admin', slug: 'admin', fullName: 'Jane Doe' },
        IDENTITY,
        META,
      )
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects names from which no valid slug can be derived', async () => {
    const error = await service
      .register({ tenantName: '门店', fullName: 'Jane Doe' }, IDENTITY, META)
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('maps a concurrent unique violation on slug to TENANT_SLUG_TAKEN', async () => {
    mockPrisma.tenant.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['slug'] },
    });

    const error = await service
      .register(
        { tenantName: 'Acme Retail', fullName: 'Jane Doe' },
        IDENTITY,
        META,
      )
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'TENANT_SLUG_TAKEN' });
  });

  it('maps a concurrent unique violation on user id to ACCOUNT_ALREADY_REGISTERED', async () => {
    mockPrisma.user.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['users_pkey'] },
    });

    const error = await service
      .register(
        { tenantName: 'Acme Retail', fullName: 'Jane Doe' },
        IDENTITY,
        META,
      )
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      code: 'ACCOUNT_ALREADY_REGISTERED',
    });
  });
});
