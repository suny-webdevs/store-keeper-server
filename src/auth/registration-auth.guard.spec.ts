import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { RegistrationAuthGuard } from './registration-auth.guard.js';
import type { SupabaseAuthService } from './supabase-auth.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('RegistrationAuthGuard', () => {
  let guard: RegistrationAuthGuard;
  let supabaseAuth: {
    verifyAccessToken: ReturnType<typeof vi.fn>;
    fetchAuthUser: ReturnType<typeof vi.fn>;
  };

  const createContext = (authorization?: string) => {
    const req: any = { headers: authorization ? { authorization } : {} };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { ctx, req };
  };

  beforeEach(() => {
    supabaseAuth = {
      verifyAccessToken: vi.fn(),
      fetchAuthUser: vi.fn(),
    };
    guard = new RegistrationAuthGuard(
      supabaseAuth as unknown as SupabaseAuthService,
    );
  });

  it('rejects a missing bearer token', async () => {
    const { ctx } = createContext();
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an invalid token from the verifier', async () => {
    supabaseAuth.verifyAccessToken.mockRejectedValue(
      new Error('bad signature'),
    );
    const { ctx } = createContext('Bearer invalid-token');

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a non-UUID subject', async () => {
    supabaseAuth.verifyAccessToken.mockResolvedValue({ sub: 'user-123' });
    const { ctx } = createContext('Bearer token');

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects anonymous identities', async () => {
    supabaseAuth.verifyAccessToken.mockResolvedValue({
      sub: USER_ID,
      is_anonymous: true,
    });
    const { ctx } = createContext('Bearer token');

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when GoTrue returns a different user id', async () => {
    supabaseAuth.verifyAccessToken.mockResolvedValue({ sub: USER_ID });
    supabaseAuth.fetchAuthUser.mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      email: 'owner@acme.com',
      emailConfirmedAt: new Date().toISOString(),
      isAnonymous: false,
    });
    const { ctx } = createContext('Bearer token');

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects unverified emails with EMAIL_NOT_VERIFIED', async () => {
    supabaseAuth.verifyAccessToken.mockResolvedValue({ sub: USER_ID });
    supabaseAuth.fetchAuthUser.mockResolvedValue({
      id: USER_ID,
      email: 'owner@acme.com',
      emailConfirmedAt: null,
      isAnonymous: false,
    });
    const { ctx } = createContext('Bearer token');

    const error = await guard.canActivate(ctx).catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('rejects accounts without an email with EMAIL_REQUIRED', async () => {
    supabaseAuth.verifyAccessToken.mockResolvedValue({ sub: USER_ID });
    supabaseAuth.fetchAuthUser.mockResolvedValue({
      id: USER_ID,
      email: null,
      emailConfirmedAt: new Date().toISOString(),
      isAnonymous: false,
    });
    const { ctx } = createContext('Bearer token');

    const error = await guard.canActivate(ctx).catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toMatchObject({ code: 'EMAIL_REQUIRED' });
  });

  it('populates a normalised registration identity on success', async () => {
    supabaseAuth.verifyAccessToken.mockResolvedValue({
      sub: USER_ID,
      role: 'authenticated',
    });
    supabaseAuth.fetchAuthUser.mockResolvedValue({
      id: USER_ID,
      email: '  OWNER@Acme.com ',
      emailConfirmedAt: new Date().toISOString(),
      isAnonymous: false,
    });
    const { ctx, req } = createContext('Bearer token');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.registrationIdentity).toEqual({
      userId: USER_ID,
      email: 'owner@acme.com',
    });
  });
});
