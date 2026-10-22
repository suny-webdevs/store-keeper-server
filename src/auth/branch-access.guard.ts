import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { BranchRole } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { BRANCH_ROLE_KEY } from '../common/decorators/require-branch-role.decorator.js';

/**
 * Role hierarchy: MANAGER > CASHIER > VIEWER
 * OWNER and ADMIN (global roles) bypass branch-level checks.
 */
const ROLE_HIERARCHY: Record<BranchRole, number> = {
  VIEWER: 1,
  CASHIER: 2,
  MANAGER: 3,
};

/**
 * Checks @RequireBranchRole metadata. Extracts branchId from
 * params, query, or body and verifies the user has sufficient
 * branch-level access. Sets req.branchId for downstream use.
 *
 * OWNER and ADMIN global roles bypass branch role checks.
 */
@Injectable()
export class BranchAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<BranchRole[] | undefined>(
      BRANCH_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No branch role requirement on this endpoint
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;

    if (!user) {
      throw new ForbiddenException({
        message: 'Authentication required',
        code: 'FORBIDDEN',
      });
    }

    // OWNER and ADMIN bypass branch-level checks
    if (user.globalRole === 'OWNER' || user.globalRole === 'ADMIN') {
      const branchId = this.extractBranchId(req);
      if (branchId) req.branchId = branchId;
      return true;
    }

    // Extract branchId from request
    const branchId = this.extractBranchId(req);
    if (!branchId) {
      throw new ForbiddenException({
        message: 'Branch context required',
        code: 'FORBIDDEN',
      });
    }

    // Find user's access to this branch
    const access = user.branches.find((b) => b.branchId === branchId);
    if (!access) {
      throw new ForbiddenException({
        message: 'No access to this branch',
        code: 'FORBIDDEN',
      });
    }

    // Check role hierarchy: user's role must be >= the minimum required
    const minRequired = Math.min(...requiredRoles.map((r) => ROLE_HIERARCHY[r]));
    const userLevel = ROLE_HIERARCHY[access.role];

    if (userLevel < minRequired) {
      throw new ForbiddenException({
        message: 'Insufficient branch permissions',
        code: 'FORBIDDEN',
      });
    }

    req.branchId = branchId;
    return true;
  }

  /**
   * Extract branchId from params > query > body (in priority order).
   */
  private extractBranchId(req: Request): string | undefined {
    return (
      (req.params as Record<string, string>).branchId ??
      (req.query as Record<string, string>).branchId ??
      (req.body as Record<string, string>)?.branchId ??
      undefined
    );
  }
}
