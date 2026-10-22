import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService, type AuditEvent } from './audit.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

describe('AuditService', () => {
  let service: AuditService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 1n }),
      },
    };
    service = new AuditService(mockPrisma as PrismaService);
  });

  it('records an audit log event with sanitized data', async () => {
    const event: AuditEvent = {
      tenantId: 'tenant-123',
      actorId: 'user-456',
      action: 'user.create',
      entityType: 'User',
      entityId: 'user-789',
      before: null,
      after: {
        id: 'user-789',
        email: 'admin@store.com',
        password: 'super-secret-password',
        token: 'jwt-token-123',
        nested: {
          apiKey: 'secret-api-key',
          validField: 'hello',
        },
      },
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    };

    await service.record(event);

    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    const createArg = mockPrisma.auditLog.create.mock.calls[0][0];

    expect(createArg.data.tenantId).toBe('tenant-123');
    expect(createArg.data.actorId).toBe('user-456');
    expect(createArg.data.action).toBe('user.create');
    expect(createArg.data.entityId).toBe('user-789');

    // Password, token, apiKey should be redacted
    expect(createArg.data.after.password).toBe('[REDACTED]');
    expect(createArg.data.after.token).toBe('[REDACTED]');
    expect(createArg.data.after.nested.apiKey).toBe('[REDACTED]');
    expect(createArg.data.after.nested.validField).toBe('hello');
  });

  it('handles circular references without throwing stack overflow', async () => {
    const circularObj: any = { name: 'cyclic' };
    circularObj.self = circularObj;

    const event: AuditEvent = {
      tenantId: 'tenant-123',
      action: 'circular.test',
      entityType: 'Test',
      after: circularObj,
    };

    await expect(service.record(event)).resolves.not.toThrow();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);

    const createArg = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(createArg.data.after.self).toBe('[CIRCULAR]');
  });

  it('handles BigInt and Date serialization in payload', async () => {
    const now = new Date();
    const event: AuditEvent = {
      tenantId: 'tenant-123',
      action: 'types.test',
      entityType: 'Test',
      after: {
        bigNumber: 9007199254740993n,
        createdAt: now,
      },
    };

    await service.record(event);

    const createArg = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(createArg.data.after.bigNumber).toBe('9007199254740993');
    expect(createArg.data.after.createdAt).toBe(now.toISOString());
  });

  it('catches and logs error without throwing if database write fails', async () => {
    mockPrisma.auditLog.create.mockRejectedValueOnce(new Error('DB failure'));

    const event: AuditEvent = {
      tenantId: 'tenant-123',
      action: 'fail.test',
      entityType: 'Test',
    };

    await expect(service.record(event)).resolves.not.toThrow();
  });
});
