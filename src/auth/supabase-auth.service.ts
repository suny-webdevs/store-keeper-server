import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { ENV_CONFIG } from '../config/config.module.js';
import type { EnvConfig } from '../config/env.config.js';
import { RedisService } from '../redis/redis.service.js';

const JWKS_CACHE_KEY = 'sk:auth:jwks';
const JWKS_CACHE_TTL = 3600; // 1 hour
const SUPABASE_TIMEOUT_MS = 5000;

/** Claims we rely on from a Supabase access token. */
export interface SupabaseAccessTokenClaims extends jwt.JwtPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  is_anonymous?: boolean;
  role?: string;
  session_id?: string;
}

/** Minimal, non-sensitive projection of the Supabase Auth user object. */
export interface SupabaseAuthUser {
  id: string;
  email: string | null;
  emailConfirmedAt: string | null;
  isAnonymous: boolean;
}

/**
 * Verifies Supabase-issued access tokens and reads authoritative account
 * state from Supabase Auth.
 *
 * Verification is deliberately centralized here so that every consumer
 * (normal JWT guard, registration guard, future guards) shares exactly
 * the same algorithm, issuer, audience, and JWKS-cache behaviour.
 */
@Injectable()
export class SupabaseAuthService {
  private readonly logger = new Logger(SupabaseAuthService.name);
  private readonly jwksClient: jwksRsa.JwksClient;

  constructor(
    private readonly redis: RedisService,
    @Inject(ENV_CONFIG) private readonly config: EnvConfig,
  ) {
    this.jwksClient = jwksRsa({
      jwksUri: `${config.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
      cache: false, // We cache in Redis ourselves
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }

  /**
   * Verify the RS256 signature, issuer, audience, and expiry of a Supabase
   * access token. Throws UnauthorizedException on any failure.
   */
  async verifyAccessToken(token: string): Promise<SupabaseAccessTokenClaims> {
    // Decode the header only to obtain the key id (never trust unverified claims).
    const header = jwt.decode(token, { complete: true })?.header;
    if (!header?.kid) {
      throw new UnauthorizedException({
        message: 'Invalid token: missing kid',
        code: 'AUTH_INVALID',
      });
    }

    const signingKey = await this.getSigningKey(header.kid);

    return new Promise((resolve, reject) => {
      jwt.verify(
        token,
        signingKey,
        {
          algorithms: ['RS256'],
          audience: 'authenticated',
          issuer: `${this.config.SUPABASE_URL}/auth/v1`,
          clockTolerance: 5,
        },
        (err, decoded) => {
          if (err) return reject(err);
          if (
            !decoded ||
            typeof decoded === 'string' ||
            typeof decoded.sub !== 'string' ||
            decoded.sub.length === 0
          ) {
            return reject(new Error('Invalid token payload'));
          }
          resolve(decoded as SupabaseAccessTokenClaims);
        },
      );
    });
  }

  /**
   * Fetch the authoritative user record from Supabase Auth using the caller's
   * access token. This is where e-mail confirmation state lives: it is NOT a
   * JWT claim, so it must be read from GoTrue.
   *
   * Fails closed if Supabase cannot be reached.
   */
  async fetchAuthUser(accessToken: string): Promise<SupabaseAuthUser> {
    let response: Response;

    try {
      response = await fetch(`${this.config.SUPABASE_URL}/auth/v1/user`, {
        method: 'GET',
        headers: {
          apikey: this.config.SUPABASE_ANON_KEY,
          authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(
        `Supabase user lookup failed: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException({
        message: 'Unable to verify account status',
        code: 'SERVICE_UNAVAILABLE',
      });
    }

    // A rejected token is an authentication failure, not an outage.
    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException({
        message: 'Invalid or expired token',
        code: 'AUTH_INVALID',
      });
    }

    if (!response.ok) {
      // Do not log the body: it may contain user PII.
      this.logger.error(
        `Supabase user lookup returned HTTP ${response.status}`,
      );
      throw new ServiceUnavailableException({
        message: 'Unable to verify account status',
        code: 'SERVICE_UNAVAILABLE',
      });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      this.logger.error('Supabase user lookup returned malformed JSON');
      throw new ServiceUnavailableException({
        message: 'Unable to verify account status',
        code: 'SERVICE_UNAVAILABLE',
      });
    }

    if (typeof body !== 'object' || body === null) {
      throw new UnauthorizedException({
        message: 'Invalid or expired token',
        code: 'AUTH_INVALID',
      });
    }

    const record = body as Record<string, unknown>;
    if (typeof record.id !== 'string' || record.id.length === 0) {
      throw new UnauthorizedException({
        message: 'Invalid or expired token',
        code: 'AUTH_INVALID',
      });
    }

    return {
      id: record.id,
      email: typeof record.email === 'string' ? record.email : null,
      emailConfirmedAt:
        typeof record.email_confirmed_at === 'string'
          ? record.email_confirmed_at
          : null,
      isAnonymous: record.is_anonymous === true,
    };
  }

  /**
   * Get signing key with Redis-cached JWKS.
   * On kid miss, force-refresh JWKS once (handles key rotation).
   */
  private async getSigningKey(kid: string): Promise<string> {
    // Try cached JWKS first
    const cached =
      await this.redis.getJson<Record<string, string>>(JWKS_CACHE_KEY);
    if (cached?.[kid]) return cached[kid];

    // Fetch fresh JWKS
    try {
      const key = await this.jwksClient.getSigningKey(kid);
      const publicKey = key.getPublicKey();

      // Cache the key mapped by kid
      const newCache = { ...cached, [kid]: publicKey };
      await this.redis.setJson(JWKS_CACHE_KEY, newCache, JWKS_CACHE_TTL);

      return publicKey;
    } catch (error) {
      this.logger.error(
        `Failed to fetch JWKS for kid ${kid}: ${(error as Error).message}`,
      );
      throw new UnauthorizedException({
        message: 'Unable to verify token',
        code: 'AUTH_INVALID',
      });
    }
  }
}
