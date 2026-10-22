import { SetMetadata } from '@nestjs/common';
import type { GlobalRole } from '@prisma/client';

export const GLOBAL_ROLE_KEY = 'globalRole';

/**
 * Require the user to have one of the specified global roles.
 * Checked by RolesGuard after JWT authentication.
 *
 * @example @RequireGlobalRole('OWNER', 'ADMIN')
 */
export const RequireGlobalRole = (...roles: GlobalRole[]) =>
  SetMetadata(GLOBAL_ROLE_KEY, roles);
