import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvelopeInterceptor } from './envelope.interceptor.js';
import type { CallHandler, ExecutionContext } from '@nestjs/common';

describe('EnvelopeInterceptor', () => {
  let interceptor: EnvelopeInterceptor;

  beforeEach(() => {
    interceptor = new EnvelopeInterceptor();
  });

  function createMockContext(method: string, existingStatus = 200, reqId?: string) {
    const req = {
      method,
      requestId: reqId,
    };
    const res = {
      statusCode: existingStatus,
      status: vi.fn().mockImplementation((code) => {
        res.statusCode = code;
        return res;
      }),
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;

    return { context, req, res };
  }

  function createCallHandler(returnValue: any): CallHandler {
    return {
      handle: () => of(returnValue),
    };
  }

  it('wraps GET response in standard envelope', async () => {
    const { context } = createMockContext('GET', 200, 'req-123');
    const next = createCallHandler({ name: 'Store' });

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(result.success).toBe(true);
    expect(result.message).toBe('OK');
    expect(result.data).toEqual({ name: 'Store' });
    expect(result.meta.requestId).toBe('req-123');
    expect(typeof result.meta.timestamp).toBe('string');
  });

  it('sets status 201 and message on POST response', async () => {
    const { context, res } = createMockContext('POST', 200, 'req-456');
    const next = createCallHandler({ id: 'new-id' });

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(res.status).toHaveBeenCalledWith(201);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Created successfully');
    expect(result.data).toEqual({ id: 'new-id' });
    expect(result.meta.requestId).toBe('req-456');
  });

  it('hoists pagination to meta when present in returned object', async () => {
    const { context } = createMockContext('GET');
    const pagination = { page: 1, limit: 10, total: 100, totalPages: 10, hasNext: true, hasPrev: false };
    const next = createCallHandler({
      items: [{ id: 'item-1' }],
      pagination,
    });

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'item-1' }]);
    expect(result.meta.pagination).toEqual(pagination);
  });

  it('preserves existing envelope if already formatted', async () => {
    const { context } = createMockContext('GET', 200, 'req-999');
    const existingEnvelope = {
      success: true,
      message: 'Custom message',
      data: { custom: true },
      meta: { customMeta: 'abc' },
    };
    const next = createCallHandler(existingEnvelope);

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(result.success).toBe(true);
    expect(result.message).toBe('Custom message');
    expect(result.data).toEqual({ custom: true });
    expect(result.meta.requestId).toBe('req-999');
  });
});
