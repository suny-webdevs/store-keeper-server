import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CacheService } from '../cache/cache.service.js';

describe('UsersService', () => {
  let service: UsersService;
  let mockPrisma: any;
  let mockCache: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      branch: {
        findFirst: vi.fn(),
      },
      userBranchAccess: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
      },
      $transaction: vi.fn((cb) => cb(mockPrisma)),
    };
    mockCache = {
      del: vi.fn().mockResolvedValue(undefined),
    };

    service = new UsersService(
      mockPrisma as PrismaService,
      mockCache as CacheService,
    );
  });

  describe('findAll', () => {
    it('returns paginated users with metadata', async () => {
      const users = [{ id: 'u1', email: 'test@example.com' }];
      mockPrisma.user.findMany.mockResolvedValue(users);
      mockPrisma.user.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20, skip: 0 });

      expect(result.items).toEqual(users);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
    });
  });

  describe('findOne', () => {
    it('returns user if found', async () => {
      const user = { id: 'u1', email: 'a@b.com' };
      mockPrisma.user.findFirst.mockResolvedValue(user);

      const result = await service.findOne('u1');
      expect(result).toEqual(user);
    });

    it('throws NotFoundException if user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.findOne('u1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('invite', () => {
    it('throws ConflictException on duplicate email', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u-existing', email: 'a@b.com' });

      await expect(
        service.invite({ email: 'a@b.com', fullName: 'Alice' }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates user and branch assignments in a transaction', async () => {
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(null) // existing email check
        .mockResolvedValueOnce({ id: 'u-new', email: 'new@b.com', fullName: 'Bob', branchAccess: [] }); // findOne return

      mockPrisma.user.create = vi.fn().mockResolvedValue({
        id: 'u-new',
        email: 'new@b.com',
        fullName: 'Bob',
      });
      mockPrisma.userBranchAccess.createMany = vi.fn().mockResolvedValue({ count: 1 });

      const result = await service.invite({
        email: 'new@b.com',
        fullName: 'Bob',
        branches: [{ branchId: 'b-1', role: 'CASHIER' }],
      });

      expect(mockPrisma.user.create).toHaveBeenCalled();
      expect(mockPrisma.userBranchAccess.createMany).toHaveBeenCalled();
      expect(result.id).toBe('u-new');
    });
  });

  describe('update', () => {
    it('updates user and invalidates profile cache', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      mockPrisma.user.update.mockResolvedValue({ id: 'u1', fullName: 'Updated' });

      const result = await service.update('u1', { fullName: 'Updated' });

      expect(result.fullName).toBe('Updated');
      expect(mockCache.del).toHaveBeenCalledWith('sk:user:profile:u1');
    });
  });

  describe('remove', () => {
    it('soft deletes user and invalidates profile cache', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      mockPrisma.user.update.mockResolvedValue({ id: 'u1', isActive: false });

      await service.remove('u1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({ isActive: false }),
      });
      expect(mockCache.del).toHaveBeenCalledWith('sk:user:profile:u1');
    });
  });

  describe('branch access management', () => {
    it('assigns branch access and invalidates cache', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1' });
      mockPrisma.userBranchAccess.upsert.mockResolvedValue({ userId: 'u1', branchId: 'b1', role: 'CASHIER' });

      const result = await service.assignBranch('u1', { branchId: 'b1', role: 'CASHIER' });

      expect(result.role).toBe('CASHIER');
      expect(mockCache.del).toHaveBeenCalledWith('sk:user:profile:u1');
    });

    it('removes branch access and invalidates cache', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      mockPrisma.userBranchAccess.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeBranch('u1', 'b1');

      expect(mockPrisma.userBranchAccess.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', branchId: 'b1' },
      });
      expect(mockCache.del).toHaveBeenCalledWith('sk:user:profile:u1');
    });
  });
});
