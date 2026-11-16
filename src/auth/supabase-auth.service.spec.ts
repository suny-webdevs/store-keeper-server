import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseAuthService } from './supabase-auth.service.js';
import type { RedisService } from '../redis/redis.service.js';
import type { EnvConfig } from '../config/env.config.js';

function buildConfig(): EnvConfig {
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
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('SupabaseAuthService.fetchAuthUser', () => {
  let service: SupabaseAuthService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const redis = {
      getJson: vi.fn().mockResolvedValue(null),
      setJson: vi.fn().mockResolvedValue(undefined),
    };
    service = new SupabaseAuthService(
      redis as unknown as RedisService,
      buildConfig(),
    );
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a minimal projection of the GoTrue user', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'owner@acme.com',
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        is_anonymous: false,
        user_metadata: { secret: 'must-not-be-returned' },
      }),
    );

    const user = await service.fetchAuthUser('access-token');

    expect(user).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'owner@acme.com',
      emailConfirmedAt: '2026-01-01T00:00:00.000Z',
      isAnonymous: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://test-project.supabase.co/auth/v1/user',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          apikey: 'test-anon-key',
          authorization: 'Bearer access-token',
        }),
      }),
    );
  });

  it('preserves an unconfirmed email state', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'owner@acme.com',
        email_confirmed_at: null,
        is_anonymous: false,
      }),
    );

    const user = await service.fetchAuthUser('access-token');
    expect(user.emailConfirmedAt).toBeNull();
  });

  it('maps a rejected token to UnauthorizedException', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'bad jwt' }));

    await expect(service.fetchAuthUser('bad-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('maps upstream errors to ServiceUnavailableException', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { message: 'boom' }));

    await expect(service.fetchAuthUser('access-token')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('fails closed when Supabase is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.fetchAuthUser('access-token')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('fails closed on malformed JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    } as unknown as Response);

    await expect(service.fetchAuthUser('access-token')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('rejects a malformed user payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { email: 'owner@acme.com' }));

    await expect(service.fetchAuthUser('access-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
