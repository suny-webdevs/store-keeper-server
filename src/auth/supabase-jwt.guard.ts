import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import type { RequestUser } from '../common/types.js';
import { ENV_CONFIG } from '../config/config.module.js';
import type { EnvConfig } from '../config/env.config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

const JWKS_CACHE_KEY = 'sk:auth:jwks';
const JWKS_CACHE_TTL = 3600; // 1 hour
const USER_PROFILE_TTL = 300; // 5 minutes

@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseJwtGuard.name);
  private readonly jwksClient: jwksRsa.JwksClient;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
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

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip for public endpoints
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);

    if (!token) {
      throw new UnauthorizedException({
        message: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    try {
      const decoded = await this.verifyToken(token);
      const user = await this.loadUserProfile(decoded.sub!);
      req.user = user;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.warn(`JWT verification failed: ${(error as Error).message}`);
      throw new UnauthorizedException({
        message: 'Invalid or expired token',
        code: 'AUTH_INVALID',
      });
    }
  }

  private extractToken(req: Request): string | null {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    return auth.slice(7);
  }

  private async verifyToken(token: string): Promise<jwt.JwtPayload> {
    // Decode header to get kid
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
        },
        (err, decoded) => {
          if (err) return reject(err);
          if (!decoded || typeof decoded === 'string' || !decoded.sub) {
            return reject(new Error('Invalid token payload'));
          }
          resolve(decoded);
        },
      );
    });
  }

  /**
   * Get signing key with Redis-cached JWKS.
   * On kid miss, force-refresh JWKS once (handles key rotation).
   */
  private async getSigningKey(kid: string): Promise<string> {
    // Try cached JWKS first
    const cached = await this.redis.getJson<Record<string, string>>(JWKS_CACHE_KEY);
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
      this.logger.error(`Failed to fetch JWKS for kid ${kid}: ${(error as Error).message}`);
      throw new UnauthorizedException({
        message: 'Unable to verify token',
        code: 'AUTH_INVALID',
      });
    }
  }

  /**
   * Load user profile from DB (with branchAccess), cached in Redis.
   * Rejects inactive or soft-deleted users.
   */
  private async loadUserProfile(userId: string): Promise<RequestUser> {
    const cacheKey = `sk:user:profile:${userId}`;

    // Try cache first
    const cached = await this.redis.getJson<RequestUser>(cacheKey);
    if (cached) return cached;

    // Query DB (no tenant scoping needed — User.id is the Supabase UID)
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        branchAccess: {
          select: { branchId: true, role: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException({
        message: 'User not found',
        code: 'AUTH_INVALID',
      });
    }

    if (!user.isActive || user.deletedAt) {
      throw new UnauthorizedException({
        message: 'Account is deactivated',
        code: 'AUTH_INVALID',
      });
    }

    const profile: RequestUser = {
      userId: user.id,
      tenantId: user.tenantId,
      globalRole: user.globalRole,
      branches: user.branchAccess.map((ba) => ({
        branchId: ba.branchId,
        role: ba.role,
      })),
    };

    // Cache profile
    await this.redis.setJson(cacheKey, profile, USER_PROFILE_TTL);

    // Update lastLoginAt (fire-and-forget)
    this.prisma.user
      .update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      })
      .catch((err) => this.logger.warn(`Failed to update lastLoginAt: ${err.message}`));

    return profile;
  }
}
