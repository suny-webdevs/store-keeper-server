import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BranchesController } from './branches.controller.js';
import type { BranchesService } from './branches.service.js';
import type { Request } from 'express';
import type { RequestUser } from '../common/types.js';

describe('BranchesController', () => {
  let controller: BranchesController;
  let mockService: Partial<BranchesService>;

  beforeEach(() => {
    mockService = {
      findAll: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };
    controller = new BranchesController(mockService as BranchesService);
  });

  it('delegates findAll with req.user', async () => {
    const mockUser: RequestUser = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      globalRole: 'OWNER',
      branches: [],
    };
    const mockReq = { user: mockUser } as unknown as Request;
    const mockBranches = [{ id: 'branch-1', name: 'Branch 1', code: 'B1' }];
    vi.mocked(mockService.findAll!).mockResolvedValueOnce(mockBranches as any);

    const result = await controller.findAll(mockReq);

    expect(mockService.findAll).toHaveBeenCalledWith(mockUser);
    expect(result).toBe(mockBranches);
  });

  it('delegates create to BranchesService', async () => {
    const dto = { name: 'Main Branch', code: 'MAIN' };
    const mockCreated = { id: 'branch-1', ...dto };
    vi.mocked(mockService.create!).mockResolvedValueOnce(mockCreated as any);

    const result = await controller.create(dto);

    expect(mockService.create).toHaveBeenCalledWith(dto);
    expect(result).toBe(mockCreated);
  });

  it('delegates findOne to BranchesService', async () => {
    const mockBranch = { id: 'branch-1', name: 'Branch 1', code: 'B1' };
    vi.mocked(mockService.findOne!).mockResolvedValueOnce(mockBranch as any);

    const result = await controller.findOne('branch-1');

    expect(mockService.findOne).toHaveBeenCalledWith('branch-1');
    expect(result).toBe(mockBranch);
  });

  it('delegates update to BranchesService', async () => {
    const dto = { name: 'Updated Branch Name' };
    const mockUpdated = { id: 'branch-1', name: 'Updated Branch Name', code: 'B1' };
    vi.mocked(mockService.update!).mockResolvedValueOnce(mockUpdated as any);

    const result = await controller.update('branch-1', dto);

    expect(mockService.update).toHaveBeenCalledWith('branch-1', dto);
    expect(result).toBe(mockUpdated);
  });

  it('delegates remove to BranchesService', async () => {
    const mockDeleted = { id: 'branch-1', deletedAt: new Date(), isActive: false };
    vi.mocked(mockService.remove!).mockResolvedValueOnce(mockDeleted as any);

    const result = await controller.remove('branch-1');

    expect(mockService.remove).toHaveBeenCalledWith('branch-1');
    expect(result).toBe(mockDeleted);
  });
});
