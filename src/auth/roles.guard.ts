import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { GlobalRole } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { GLOBAL_ROLE_KEY } from '../common/decorators/require-global-role.decorator.js';

/**
 * Checks @RequireGlobalRole metadata against req.user.globalRole.
 * Runs AFTER SupabaseJwtGuard has populated req.user.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<GlobalRole[] | undefined>(
      GLOBAL_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No role requirement on this endpoint
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;

    if (!user?.globalRole) {
      throw new ForbiddenException({
        message: 'Insufficient permissions',
        code: 'FORBIDDEN',
      });
    }

    if (!requiredRoles.includes(user.globalRole)) {
      throw new ForbiddenException({
        message: 'Insufficient permissions',
        code: 'FORBIDDEN',
      });
    }

    return true;
  }
}
