import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import type { RequestUser } from '../common/types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { SupabaseAuthService } from './supabase-auth.service.js';

const USER_PROFILE_TTL = 300; // 5 minutes

@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseJwtGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly supabaseAuth: SupabaseAuthService,
  ) {}

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
      const decoded = await this.supabaseAuth.verifyAccessToken(token);
      const user = await this.loadUserProfile(decoded.sub);
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
