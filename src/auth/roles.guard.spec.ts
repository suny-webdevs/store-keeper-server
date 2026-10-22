import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard.js';
import type { RequestUser } from '../common/types.js';

import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { GLOBAL_ROLE_KEY } from '../common/decorators/require-global-role.decorator.js';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const createMockContext = (
    user?: RequestUser,
    requiredRoles?: string[],
    isPublic = false,
  ): ExecutionContext => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => {
      if (key === IS_PUBLIC_KEY) return isPublic;
      if (key === GLOBAL_ROLE_KEY) return requiredRoles;
      return undefined;
    });

    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  it('allows access if endpoint is marked public', () => {
    const ctx = createMockContext(undefined, ['OWNER'], true);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows access if no global roles are required', () => {
    const ctx = createMockContext(undefined, undefined, false);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException if user has no globalRole', () => {
    const user: RequestUser = {
      userId: 'u1',
      tenantId: 't1',
      globalRole: null,
      branches: [],
    };
    const ctx = createMockContext(user, ['OWNER']);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException if user globalRole does not match requirement', () => {
    const user: RequestUser = {
      userId: 'u1',
      tenantId: 't1',
      globalRole: 'ADMIN',
      branches: [],
    };
    const ctx = createMockContext(user, ['OWNER']);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows access when user has matching global role', () => {
    const user: RequestUser = {
      userId: 'u1',
      tenantId: 't1',
      globalRole: 'OWNER',
      branches: [],
    };
    const ctx = createMockContext(user, ['OWNER', 'ADMIN']);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
