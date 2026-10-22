import { SetMetadata } from '@nestjs/common';
import type { BranchRole } from '@prisma/client';

export const BRANCH_ROLE_KEY = 'branchRole';

/**
 * Minimum branch role required. The guard checks the user's role
 * for the target branch. Role hierarchy: MANAGER > CASHIER > VIEWER.
 *
 * Also makes BranchAccessGuard extract branchId from the request
 * and set it on req.branchId.
 *
 * @example @RequireBranchRole('MANAGER')  // MANAGER or higher (+ OWNER/ADMIN bypass)
 * @example @RequireBranchRole('CASHIER')  // CASHIER, MANAGER, or OWNER/ADMIN
 */
export const RequireBranchRole = (...roles: BranchRole[]) =>
  SetMetadata(BRANCH_ROLE_KEY, roles);
