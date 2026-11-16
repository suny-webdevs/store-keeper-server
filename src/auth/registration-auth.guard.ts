import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ErrorCode, type RegistrationIdentity } from '../common/types.js';
import { SupabaseAuthService } from './supabase-auth.service.js';

/**
 * Any RFC 4122 UUID. Supabase user ids are UUIDs, and User.id is a UUID PK,
 * so rejecting non-UUID subjects here keeps junk identities out of the DB.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Authentication for self-service tenant registration.
 *
 * This guard is intentionally stricter than SupabaseJwtGuard:
 *   1. Verifies the Supabase RS256 access token via JWKS.
 *   2. Rejects anonymous and non-UUID subjects.
 *   3. Calls Supabase Auth to confirm the e-mail is verified.
 *
 * It does NOT require (or create) a local User row — that is exactly what
 * the registration endpoint exists to do.
 *
 * Used together with @Public() so the global JWT guard does not reject a
 * valid Supabase user who has no local profile yet. CSRF does not apply
 * because this flow authenticates with a Bearer token and sets no cookies.
 */
@Injectable()
export class RegistrationAuthGuard implements CanActivate {
  constructor(private readonly supabaseAuth: SupabaseAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);

    if (!token) {
      throw new UnauthorizedException({
        message: 'Authentication required',
        code: ErrorCode.AUTH_REQUIRED,
      });
    }

    const claims = await this.verifyToken(token);

    if (
      !UUID_PATTERN.test(claims.sub) ||
      claims.is_anonymous === true ||
      (claims.role !== undefined && claims.role !== 'authenticated')
    ) {
      throw new UnauthorizedException({
        message: 'Invalid registration identity',
        code: ErrorCode.AUTH_INVALID,
      });
    }

    const authUser = await this.supabaseAuth.fetchAuthUser(token);

    if (authUser.id !== claims.sub || authUser.isAnonymous) {
      throw new UnauthorizedException({
        message: 'Invalid registration identity',
        code: ErrorCode.AUTH_INVALID,
      });
    }

    const email = authUser.email?.trim().toLowerCase();
    if (!email) {
      throw new ForbiddenException({
        message: 'An email address is required to register',
        code: ErrorCode.EMAIL_REQUIRED,
      });
    }

    // Confirmation state is only available from GoTrue, not from JWT claims.
    if (claims.email_verified === false || !authUser.emailConfirmedAt) {
      throw new ForbiddenException({
        message: 'Verify your email address before registering',
        code: ErrorCode.EMAIL_NOT_VERIFIED,
      });
    }

    const identity: RegistrationIdentity = { userId: claims.sub, email };
    req.registrationIdentity = identity;
    return true;
  }

  private extractToken(req: Request): string | null {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.slice(7).trim();
    return token.length > 0 ? token : null;
  }

  private async verifyToken(token: string) {
    try {
      return await this.supabaseAuth.verifyAccessToken(token);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException({
        message: 'Invalid or expired token',
        code: ErrorCode.AUTH_INVALID,
      });
    }
  }
}
