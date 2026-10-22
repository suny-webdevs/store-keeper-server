import { describe, expect, it } from 'vitest';
import { AuthController } from './auth.controller.js';
import type { Request } from 'express';
import type { RequestUser } from '../common/types.js';

describe('AuthController', () => {
  const controller = new AuthController();

  it('returns req.user when calling getMe', () => {
    const mockUser: RequestUser = {
      userId: 'user-123',
      tenantId: 'tenant-456',
      globalRole: 'ADMIN',
      branches: [{ branchId: 'branch-789', role: 'MANAGER' }],
    };

    const mockReq = { user: mockUser } as unknown as Request;

    const result = controller.getMe(mockReq);

    expect(result).toBe(mockUser);
    expect(result.userId).toBe('user-123');
    expect(result.tenantId).toBe('tenant-456');
    expect(result.globalRole).toBe('ADMIN');
  });
});
