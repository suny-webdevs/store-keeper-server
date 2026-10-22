import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { BranchAccessGuard } from './branch-access.guard.js';
import type { RequestUser } from '../common/types.js';

import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { BRANCH_ROLE_KEY } from '../common/decorators/require-branch-role.decorator.js';

describe('BranchAccessGuard', () => {
  let guard: BranchAccessGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new BranchAccessGuard(reflector);
  });

  const createMockContext = (
    req: {
      user?: RequestUser;
      params?: Record<string, string>;
      query?: Record<string, string>;
      body?: Record<string, string>;
    },
    requiredRoles?: string[],
    isPublic = false,
  ): ExecutionContext => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => {
      if (key === IS_PUBLIC_KEY) return isPublic;
      if (key === BRANCH_ROLE_KEY) return requiredRoles;
      return undefined;
    });

    return {
      switchToHttp: () => ({
        getRequest: () => ({
          ...req,
          params: req.params ?? {},
          query: req.query ?? {},
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  it('allows access to public endpoints', () => {
    const ctx = createMockContext({}, ['MANAGER'], true);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows access when no branch role is required', () => {
    const ctx = createMockContext({}, undefined, false);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when user is unauthenticated', () => {
    const ctx = createMockContext({}, ['MANAGER']);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('bypasses branch checks for OWNER and ADMIN', () => {
    const user: RequestUser = {
      userId: 'u1',
      tenantId: 't1',
      globalRole: 'OWNER',
      branches: [],
    };
    const ctx = createMockContext({ user, params: { branchId: 'b-1' } }, ['MANAGER']);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when branchId is missing', () => {
    const user: RequestUser = {
      userId: 'u1',
      tenantId: 't1',
      globalRole: null,
      branches: [{ branchId: 'b-1', role: 'MANAGER' }],
    };
    const ctx = createMockContext({ user }, ['MANAGER']);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user has no access to target branch', () => {
    const user: RequestUser = {
      userId: 'u1',
      tenantId: 't1',
      globalRole: null,
      branches: [{ branchId: 'b-2', role: 'MANAGER' }],
    };
    const ctx = createMockContext({ user, params: { branchId: 'b-1' } }, ['MANAGER']);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user branch role is insufficient (hierarchical check)', () => {
    const user: RequestUser = {
      userId: 'u1',
      tenantId: 't1',
      globalRole: null,
      branches: [{ branchId: 'b-1', role: 'CASHIER' }],
    };
    // Requires MANAGER, user only has CASHIER
    const ctx = createMockContext({ user, params: { branchId: 'b-1' } }, ['MANAGER']);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows access when user branch role meets or exceeds required hierarchy', () => {
    const user: RequestUser = {
      userId: 'u1',
      tenantId: 't1',
      globalRole: null,
      branches: [{ branchId: 'b-1', role: 'MANAGER' }],
    };
    // Requires CASHIER, MANAGER satisfies
    const ctx = createMockContext({ user, params: { branchId: 'b-1' } }, ['CASHIER']);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
