import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersController } from './users.controller.js';
import type { UsersService } from './users.service.js';
import { BranchRole, GlobalRole } from '@prisma/client';

describe('UsersController', () => {
  let controller: UsersController;
  let mockService: Partial<UsersService>;

  beforeEach(() => {
    mockService = {
      findAll: vi.fn(),
      findOne: vi.fn(),
      invite: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      assignBranch: vi.fn(),
      updateBranchRole: vi.fn(),
      removeBranch: vi.fn(),
    };
    controller = new UsersController(mockService as UsersService);
  });

  it('delegates findAll to UsersService', async () => {
    const mockResult = { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false } };
    vi.mocked(mockService.findAll!).mockResolvedValueOnce(mockResult);

    const result = await controller.findAll({ page: 1, limit: 20, skip: 0 });

    expect(mockService.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, skip: 0 });
    expect(result).toBe(mockResult);
  });

  it('delegates invite to UsersService', async () => {
    const dto = { email: 'test@store.com', fullName: 'Test User', globalRole: GlobalRole.ADMIN };
    const mockCreated = { id: 'user-1', ...dto };
    vi.mocked(mockService.invite!).mockResolvedValueOnce(mockCreated as any);

    const result = await controller.invite(dto);

    expect(mockService.invite).toHaveBeenCalledWith(dto);
    expect(result).toBe(mockCreated);
  });

  it('delegates update to UsersService', async () => {
    const dto = { fullName: 'Updated Name', isActive: true };
    const mockUpdated = { id: 'user-1', ...dto };
    vi.mocked(mockService.update!).mockResolvedValueOnce(mockUpdated as any);

    const result = await controller.update('user-1', dto);

    expect(mockService.update).toHaveBeenCalledWith('user-1', dto);
    expect(result).toBe(mockUpdated);
  });

  it('delegates remove to UsersService', async () => {
    const mockRemoved = { id: 'user-1', isActive: false, deletedAt: new Date() };
    vi.mocked(mockService.remove!).mockResolvedValueOnce(mockRemoved as any);

    const result = await controller.remove('user-1');

    expect(mockService.remove).toHaveBeenCalledWith('user-1');
    expect(result).toBe(mockRemoved);
  });

  it('delegates assignBranch to UsersService', async () => {
    const dto = { branchId: 'branch-1', role: BranchRole.CASHIER };
    const mockAccess = { id: 'access-1', userId: 'user-1', ...dto };
    vi.mocked(mockService.assignBranch!).mockResolvedValueOnce(mockAccess as any);

    const result = await controller.assignBranch('user-1', dto);

    expect(mockService.assignBranch).toHaveBeenCalledWith('user-1', dto);
    expect(result).toBe(mockAccess);
  });

  it('delegates updateBranchRole to UsersService', async () => {
    const dto = { role: BranchRole.MANAGER };
    const mockUpdated = { id: 'access-1', userId: 'user-1', branchId: 'branch-1', role: BranchRole.MANAGER };
    vi.mocked(mockService.updateBranchRole!).mockResolvedValueOnce(mockUpdated as any);

    const result = await controller.updateBranchRole('user-1', 'branch-1', dto);

    expect(mockService.updateBranchRole).toHaveBeenCalledWith('user-1', 'branch-1', dto);
    expect(result).toBe(mockUpdated);
  });

  it('delegates removeBranch to UsersService', async () => {
    vi.mocked(mockService.removeBranch!).mockResolvedValueOnce({ success: true });

    const result = await controller.removeBranch('user-1', 'branch-1');

    expect(mockService.removeBranch).toHaveBeenCalledWith('user-1', 'branch-1');
    expect(result).toEqual({ success: true });
  });
});
