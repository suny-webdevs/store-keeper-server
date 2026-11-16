import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller.js';
import type { RegistrationService } from './registration.service.js';
import type { Request } from 'express';
import type { RegistrationIdentity, RequestUser } from '../common/types.js';

describe('AuthController', () => {
  const registrationService = {
    register: vi.fn(),
  };
  const controller = new AuthController(
    registrationService as unknown as RegistrationService,
  );

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

  it('delegates registration with the verified identity and request meta', async () => {
    const identity: RegistrationIdentity = {
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'owner@acme.com',
    };
    const expected = {
      tenant: {
        id: 't1',
        name: 'Acme',
        slug: 'acme',
        createdAt: new Date(),
      },
      user: {
        id: identity.userId,
        tenantId: 't1',
        email: identity.email,
        fullName: 'Jane Doe',
        globalRole: 'OWNER',
      },
    };
    registrationService.register.mockResolvedValue(expected);

    const mockReq = {
      registrationIdentity: identity,
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'user-agent': 'vitest' },
    } as unknown as Request;

    const dto = { tenantName: 'Acme', fullName: 'Jane Doe' };
    const result = await controller.register(dto, mockReq);

    expect(result).toBe(expected);
    expect(registrationService.register).toHaveBeenCalledWith(dto, identity, {
      ip: '127.0.0.1',
      userAgent: 'vitest',
    });
  });

  it('rejects registration when the guard did not populate an identity', async () => {
    const mockReq = {} as unknown as Request;

    await expect(
      controller.register(
        { tenantName: 'Acme', fullName: 'Jane Doe' },
        mockReq,
      ),
    ).rejects.toThrow('Authentication required');
  });
});
