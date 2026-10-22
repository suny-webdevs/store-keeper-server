import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CacheService } from '../cache/cache.service.js';
import type { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AssignBranchDto, UpdateBranchRoleDto } from './dto/assign-branch.dto.js';
import type { InviteUserDto } from './dto/invite-user.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * List users with pagination and branch access details.
   */
  async findAll(query: PaginationQueryDto) {
    const { page, limit, skip } = query;

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { deletedAt: null },
        include: {
          branchAccess: {
            select: {
              id: true,
              branchId: true,
              role: true,
              branch: { select: { name: true, code: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where: { deletedAt: null } }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        branchAccess: {
          select: {
            id: true,
            branchId: true,
            role: true,
            branch: { select: { name: true, code: true } },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'User not found',
      });
    }

    return user;
  }

  /**
   * Invite / register a new user in the tenant.
   * Can assign branch access during invite.
   */
  async invite(dto: InviteUserDto) {
    // Check for existing active user with same email
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase(), deletedAt: null },
    });

    if (existing) {
      throw new ConflictException({
        code: 'DUPLICATE_EMAIL',
        message: 'A user with this email already exists in this tenant',
      });
    }

    const userId = randomUUID();

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          id: userId,
          email: dto.email.toLowerCase(),
          fullName: dto.fullName,
          globalRole: dto.globalRole ?? null,
        } as any,
      });

      if (dto.branches && dto.branches.length > 0) {
        await tx.userBranchAccess.createMany({
          data: dto.branches.map((b) => ({
            userId: created.id,
            branchId: b.branchId,
            role: b.role,
          })),
        });
      }

      return created;
    });

    return this.findOne(user.id);
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.globalRole !== undefined && { globalRole: dto.globalRole }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: {
        branchAccess: true,
      },
    });

    // Invalidate user profile cache
    await this.cache.del(`sk:user:profile:${id}`);

    return updated;
  }

  /**
   * Soft-delete user and revoke access.
   */
  async remove(id: string) {
    await this.findOne(id);

    const deleted = await this.prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    // Invalidate user profile cache
    await this.cache.del(`sk:user:profile:${id}`);

    return deleted;
  }

  /**
   * Assign branch access to user.
   */
  async assignBranch(userId: string, dto: AssignBranchDto) {
    await this.findOne(userId);

    // Verify branch exists and is active
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, deletedAt: null },
    });

    if (!branch) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Branch not found',
      });
    }

    const access = await this.prisma.userBranchAccess.upsert({
      where: {
        userId_branchId: {
          userId,
          branchId: dto.branchId,
        },
      },
      create: {
        userId,
        branchId: dto.branchId,
        role: dto.role,
      },
      update: {
        role: dto.role,
      },
    });

    await this.cache.del(`sk:user:profile:${userId}`);

    return access;
  }

  /**
   * Update role on branch access.
   */
  async updateBranchRole(userId: string, branchId: string, dto: UpdateBranchRoleDto) {
    await this.findOne(userId);

    const access = await this.prisma.userBranchAccess.findUnique({
      where: {
        userId_branchId: { userId, branchId },
      },
    });

    if (!access) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'User does not have access to this branch',
      });
    }

    const updated = await this.prisma.userBranchAccess.update({
      where: {
        userId_branchId: { userId, branchId },
      },
      data: {
        role: dto.role,
      },
    });

    await this.cache.del(`sk:user:profile:${userId}`);

    return updated;
  }

  /**
   * Remove branch access for user.
   */
  async removeBranch(userId: string, branchId: string) {
    await this.findOne(userId);

    await this.prisma.userBranchAccess.deleteMany({
      where: { userId, branchId },
    });

    await this.cache.del(`sk:user:profile:${userId}`);

    return { success: true };
  }
}
