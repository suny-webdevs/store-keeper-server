import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { tenantStore } from './tenant-context.js';
import { TenantContextInterceptor } from './tenant.interceptor.js';
import type { CallHandler, ExecutionContext } from '@nestjs/common';

describe('TenantContextInterceptor', () => {
  let interceptor: TenantContextInterceptor;

  beforeEach(() => {
    interceptor = new TenantContextInterceptor();
  });

  function createMockContext(tenantId?: string): ExecutionContext {
    const req = {
      user: tenantId ? { tenantId } : undefined,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  it('populates AsyncLocalStorage tenantStore with tenantId from req.user', async () => {
    const context = createMockContext('tenant-xyz-123');

    const next: CallHandler = {
      handle: () => {
        // Assert inside the handle execution that tenantStore has tenantId
        const currentStore = tenantStore.getStore();
        expect(currentStore?.tenantId).toBe('tenant-xyz-123');
        return of({ data: 'success' });
      },
    };

    const result = await firstValueFrom(interceptor.intercept(context, next));
    expect(result).toEqual({ data: 'success' });
  });

  it('skips populating tenantStore when tenantId is missing (public / pre-auth)', async () => {
    const context = createMockContext(undefined);

    const next: CallHandler = {
      handle: () => {
        const currentStore = tenantStore.getStore();
        expect(currentStore).toBeUndefined();
        return of({ data: 'public-ok' });
      },
    };

    const result = await firstValueFrom(interceptor.intercept(context, next));
    expect(result).toEqual({ data: 'public-ok' });
  });
});
