import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';

/** HTTP methods that require CSRF validation */
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Double-submit cookie CSRF guard.
 * Requires X-CSRF-Token header to match csrf_token cookie on all mutations.
 * Uses timingSafeEqual to prevent timing attacks.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Skip for public endpoints
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();

    // Only enforce on mutation methods
    if (!MUTATION_METHODS.has(req.method)) return true;

    const headerToken = req.headers['x-csrf-token'];
    const cookieToken = req.cookies?.csrf_token;

    if (!headerToken || typeof headerToken !== 'string') {
      throw new ForbiddenException({
        message: 'CSRF token missing',
        code: 'CSRF_MISSING',
      });
    }

    if (!cookieToken || typeof cookieToken !== 'string') {
      throw new ForbiddenException({
        message: 'CSRF cookie missing',
        code: 'CSRF_MISSING',
      });
    }

    // Timing-safe comparison
    const headerBuf = Buffer.from(headerToken, 'utf8');
    const cookieBuf = Buffer.from(cookieToken, 'utf8');

    if (
      headerBuf.length !== cookieBuf.length ||
      !timingSafeEqual(headerBuf, cookieBuf)
    ) {
      throw new ForbiddenException({
        message: 'CSRF token mismatch',
        code: 'CSRF_MISMATCH',
      });
    }

    return true;
  }
}
