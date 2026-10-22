import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateBranchDto } from './dto/create-branch.dto.js';
import type { UpdateBranchDto } from './dto/update-branch.dto.js';
import type { RequestUser } from '../common/types.js';

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List branches:
   * OWNER/ADMIN see all tenant branches.
   * Other roles only see branches assigned to them.
   */
  async findAll(user: RequestUser) {
    const isGlobalAdmin = user.globalRole === 'OWNER' || user.globalRole === 'ADMIN';

    if (isGlobalAdmin) {
      return this.prisma.branch.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
      });
    }

    const assignedBranchIds = user.branches.map((b) => b.branchId);
    return this.prisma.branch.findMany({
      where: {
        id: { in: assignedBranchIds },
        deletedAt: null,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, deletedAt: null },
    });

    if (!branch) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Branch not found',
      });
    }

    return branch;
  }

  async create(dto: CreateBranchDto) {
    return this.prisma.branch.create({
      data: {
        name: dto.name,
        code: dto.code.toUpperCase(),
        address: dto.address,
        phone: dto.phone,
      } as any,
    });
  }

  async update(id: string, dto: UpdateBranchDto) {
    await this.findOne(id);

    return this.prisma.branch.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  /**
   * Delete branch (OWNER only).
   * Blocked if positive stock exists.
   */
  async remove(id: string) {
    await this.findOne(id);

    // Check if branch has remaining stock
    const activeStock = await this.prisma.productBranchStock.findFirst({
      where: {
        branchId: id,
        qtyOnHand: { gt: 0 },
      },
    });

    if (activeStock) {
      throw new ConflictException({
        code: 'BRANCH_HAS_STOCK',
        message: 'Cannot delete branch with active stock on hand',
      });
    }

    // Soft delete to protect audit and historical ledger integrity
    return this.prisma.branch.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });
  }
}
