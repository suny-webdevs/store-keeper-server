import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BranchesService } from './branches.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RequestUser } from '../common/types.js';

describe('BranchesService', () => {
  let service: BranchesService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      branch: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      productBranchStock: {
        findFirst: vi.fn(),
      },
    };
    service = new BranchesService(mockPrisma as PrismaService);
  });

  describe('findAll', () => {
    it('returns all tenant branches for OWNER or ADMIN', async () => {
      const user: RequestUser = {
        userId: 'u1',
        tenantId: 't1',
        globalRole: 'OWNER',
        branches: [],
      };
      const branches = [{ id: 'b1', name: 'Branch 1' }, { id: 'b2', name: 'Branch 2' }];
      mockPrisma.branch.findMany.mockResolvedValue(branches);

      const result = await service.findAll(user);

      expect(result).toEqual(branches);
      expect(mockPrisma.branch.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
      });
    });

    it('returns only assigned branches for non-admin users', async () => {
      const user: RequestUser = {
        userId: 'u1',
        tenantId: 't1',
        globalRole: null,
        branches: [{ branchId: 'b1', role: 'CASHIER' }],
      };
      const branches = [{ id: 'b1', name: 'Branch 1' }];
      mockPrisma.branch.findMany.mockResolvedValue(branches);

      const result = await service.findAll(user);

      expect(result).toEqual(branches);
      expect(mockPrisma.branch.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['b1'] },
          deletedAt: null,
          isActive: true,
        },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('findOne', () => {
    it('returns branch if found', async () => {
      const branch = { id: 'b1', name: 'Branch 1' };
      mockPrisma.branch.findFirst.mockResolvedValue(branch);

      const result = await service.findOne('b1');
      expect(result).toEqual(branch);
    });

    it('throws NotFoundException if branch not found', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue(null);
      await expect(service.findOne('b1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a new branch with uppercase code', async () => {
      const dto = { name: 'Downtown', code: 'dt-01', address: '123 St' };
      mockPrisma.branch.create.mockResolvedValue({ id: 'b1', ...dto, code: 'DT-01' });

      const result = await service.create(dto);

      expect(result.code).toBe('DT-01');
      expect(mockPrisma.branch.create).toHaveBeenCalledWith({
        data: {
          name: 'Downtown',
          code: 'DT-01',
          address: '123 St',
          phone: undefined,
        },
      });
    });
  });

  describe('remove', () => {
    it('throws ConflictException if branch has remaining stock > 0', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', name: 'Branch 1' });
      mockPrisma.productBranchStock.findFirst.mockResolvedValue({ id: 's1', qtyOnHand: 15 });

      await expect(service.remove('b1')).rejects.toThrow(ConflictException);
    });

    it('soft-deletes branch when stock is 0', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', name: 'Branch 1' });
      mockPrisma.productBranchStock.findFirst.mockResolvedValue(null);
      mockPrisma.branch.update.mockResolvedValue({ id: 'b1', isActive: false });

      const result = await service.remove('b1');
      expect(result.isActive).toBe(false);
      expect(mockPrisma.branch.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: expect.objectContaining({ isActive: false }),
      });
    });
  });
});
