import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard.js';

describe('CsrfGuard', () => {
  let guard: CsrfGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new CsrfGuard(reflector);
  });

  const createMockContext = (method: string, headers: Record<string, string> = {}, cookies: Record<string, string> = {}, isPublic = false): ExecutionContext => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);

    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          headers,
          cookies,
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  it('allows public endpoints without checking CSRF', () => {
    const ctx = createMockContext('POST', {}, {}, true);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows safe methods (GET, HEAD, OPTIONS) without checking CSRF', () => {
    const ctx = createMockContext('GET', {}, {});
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when header token is missing on POST', () => {
    const ctx = createMockContext('POST', {}, { csrf_token: 'valid-token' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when cookie token is missing on POST', () => {
    const ctx = createMockContext('POST', { 'x-csrf-token': 'valid-token' }, {});
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException on token mismatch', () => {
    const ctx = createMockContext(
      'POST',
      { 'x-csrf-token': 'token-a' },
      { csrf_token: 'token-b' },
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows mutation when header and cookie match', () => {
    const token = 'matching-secret-token-12345';
    const ctx = createMockContext(
      'POST',
      { 'x-csrf-token': token },
      { csrf_token: token },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
