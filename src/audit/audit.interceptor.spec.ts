import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditInterceptor } from './audit.interceptor.js';
import type { AuditService } from './audit.service.js';
import type { CallHandler, ExecutionContext } from '@nestjs/common';

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let mockReflector: Reflector;
  let mockAuditService: Partial<AuditService>;

  beforeEach(() => {
    mockReflector = new Reflector();
    mockAuditService = {
      record: vi.fn().mockResolvedValue(undefined),
    };
    interceptor = new AuditInterceptor(mockReflector, mockAuditService as AuditService);
  });

  function createMockContext(method: string, user?: any, body?: any, params?: any): ExecutionContext {
    const req = {
      method,
      user,
      body,
      params,
      ip: '127.0.0.1',
      headers: { 'user-agent': 'Vitest' },
      socket: { remoteAddress: '127.0.0.1' },
    };

    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
      getClass: () => ({ name: 'UsersController' }),
      getHandler: () => ({ name: 'create' }),
    } as unknown as ExecutionContext;
  }

  function createCallHandler(returnValue: any): CallHandler {
    return {
      handle: () => of(returnValue),
    };
  }

  it('skips auditing for GET requests', async () => {
    const context = createMockContext('GET', { tenantId: 'tenant-1' });
    const next = createCallHandler({ data: 'ok' });

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual({ data: 'ok' });
    expect(mockAuditService.record).not.toHaveBeenCalled();
  });

  it('audits POST requests for authenticated users', async () => {
    const user = { userId: 'user-1', tenantId: 'tenant-1' };
    const body = { name: 'Main Branch' };
    const context = createMockContext('POST', user, body);
    const responsePayload = { id: 'branch-1', name: 'Main Branch' };
    const next = createCallHandler(responsePayload);

    vi.spyOn(mockReflector, 'getAllAndOverride').mockReturnValue({
      action: 'branch.create',
      entityType: 'Branch',
    });

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual(responsePayload);
    expect(mockAuditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorId: 'user-1',
        action: 'branch.create',
        entityType: 'Branch',
        entityId: 'branch-1',
        after: responsePayload,
      }),
    );
  });

  it('skips recording if request is unauthenticated (no tenantId)', async () => {
    const context = createMockContext('POST', undefined, { name: 'Test' });
    const next = createCallHandler({ id: 'item-1' });

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual({ id: 'item-1' });
    expect(mockAuditService.record).not.toHaveBeenCalled();
  });
});
