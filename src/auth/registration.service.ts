import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import type { RegistrationIdentity } from '../common/types.js';
import { ENV_CONFIG } from '../config/config.module.js';
import type { EnvConfig } from '../config/env.config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type RegisterTenantDto,
  type RegisterTenantResponseDto,
  TENANT_SLUG_PATTERN,
} from './dto/register-tenant.dto.js';

/**
 * Slugs that would collide with infrastructure, reserved routes, or common
 * impersonation targets. Checked after normalisation, before the DB.
 */
const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'blog',
  'dashboard',
  'docs',
  'health',
  'help',
  'internal',
  'login',
  'logout',
  'mail',
  'privacy',
  'public',
  'register',
  'root',
  'security',
  'signup',
  'static',
  'status',
  'store',
  'support',
  'system',
  'terms',
  'www',
]);

export interface RegistrationRequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(ENV_CONFIG) private readonly config: EnvConfig,
  ) {}

  /**
   * Create a tenant and its first OWNER in a single transaction.
   *
   * The caller's identity has already been verified by RegistrationAuthGuard
   * (JWKS signature + verified e-mail). Nothing security-relevant is accepted
   * from the request body: the owner id and email come from the verified
   * Supabase identity, and the OWNER role is assigned server-side.
   */
  async register(
    dto: RegisterTenantDto,
    identity: RegistrationIdentity,
    meta: RegistrationRequestMeta,
  ): Promise<RegisterTenantResponseDto> {
    if (!this.config.REGISTRATION_ENABLED) {
      throw new ForbiddenException({
        message: 'Self-service registration is currently disabled',
        code: 'REGISTRATION_DISABLED',
      });
    }

    const slug = dto.slug ?? this.deriveSlug(dto.tenantName);
    this.assertSlugIsUsable(slug);

    const email = identity.email.trim().toLowerCase();

    try {
      const { tenant, user } = await this.prisma.$transaction(async (tx) => {
        // 1. One local account per Supabase identity.
        const existingUser = await tx.user.findUnique({
          where: { id: identity.userId },
        });
        if (existingUser) {
          throw new ConflictException({
            message: 'This account is already registered',
            code: 'ACCOUNT_ALREADY_REGISTERED',
          });
        }

        // 2. An e-mail may only own one local account. Supabase guarantees
        //    e-mail uniqueness per project, so this also blocks duplicate
        //    identities created through other auth providers.
        const existingEmail = await tx.user.findFirst({
          where: {
            email: { equals: email, mode: 'insensitive' },
            deletedAt: null,
          },
          select: { id: true },
        });
        if (existingEmail) {
          throw new ConflictException({
            message: 'This email address is already registered',
            code: 'EMAIL_IN_USE',
          });
        }

        // 3. Tenant slugs are globally unique and user-visible.
        const existingTenant = await tx.tenant.findUnique({
          where: { slug },
          select: { id: true },
        });
        if (existingTenant) {
          throw new ConflictException({
            message: 'This tenant slug is already taken',
            code: 'TENANT_SLUG_TAKEN',
          });
        }

        const createdTenant = await tx.tenant.create({
          data: {
            name: dto.tenantName,
            slug,
          },
        });

        const createdUser = await tx.user.create({
          data: {
            id: identity.userId,
            tenantId: createdTenant.id,
            email,
            fullName: dto.fullName,
            globalRole: GlobalRole.OWNER,
          },
        });

        return { tenant: createdTenant, user: createdUser };
      });

      // Audit is fire-and-forget and must never fail the registration.
      void this.auditService.record({
        tenantId: tenant.id,
        actorId: user.id,
        action: 'tenant.register',
        entityType: 'Tenant',
        entityId: tenant.id,
        after: {
          name: tenant.name,
          slug: tenant.slug,
          ownerId: user.id,
          ownerRole: user.globalRole,
        },
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });

      return {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          createdAt: tenant.createdAt,
        },
        user: {
          id: user.id,
          tenantId: user.tenantId,
          email: user.email,
          fullName: user.fullName,
          globalRole: user.globalRole ?? GlobalRole.OWNER,
        },
      };
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  /**
   * Derive a URL-safe slug from a display name. Returns '' when the name
   * contains no latin alphanumerics; the caller must then supply a slug.
   */
  private deriveSlug(name: string): string {
    return name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)
      .replace(/-+$/g, '');
  }

  private assertSlugIsUsable(slug: string): void {
    if (
      slug.length < 3 ||
      slug.length > 50 ||
      !TENANT_SLUG_PATTERN.test(slug)
    ) {
      throw new BadRequestException({
        message:
          'Unable to derive a valid slug from tenantName; provide a slug explicitly',
        code: 'VALIDATION_FAILED',
        errors: [
          {
            field: 'slug',
            code: 'VALIDATION_FAILED',
            message:
              'slug must be 3-50 characters of lowercase letters, numbers and single hyphens',
          },
        ],
      });
    }

    if (RESERVED_SLUGS.has(slug)) {
      throw new BadRequestException({
        message: 'This tenant slug is reserved',
        code: 'VALIDATION_FAILED',
        errors: [
          {
            field: 'slug',
            code: 'VALIDATION_FAILED',
            message: 'Choose a different slug',
          },
        ],
      });
    }
  }

  /**
   * Translate a concurrent unique-constraint violation into the same
   * deterministic conflict the pre-checks return. Anything else is rethrown.
   */
  private mapUniqueViolation(error: unknown): unknown {
    const prismaError = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };

    if (prismaError?.code !== 'P2002') return error;

    const rawTarget = prismaError.meta?.target;
    const target = Array.isArray(rawTarget)
      ? rawTarget.join(',')
      : String(rawTarget ?? '');

    this.logger.warn(`Registration unique constraint hit: ${target}`);

    if (target.includes('slug')) {
      return new ConflictException({
        message: 'This tenant slug is already taken',
        code: 'TENANT_SLUG_TAKEN',
      });
    }

    if (target.includes('email')) {
      return new ConflictException({
        message: 'This email address is already registered',
        code: 'EMAIL_IN_USE',
      });
    }

    if (target.includes('id') || target.includes('pkey')) {
      return new ConflictException({
        message: 'This account is already registered',
        code: 'ACCOUNT_ALREADY_REGISTERED',
      });
    }

    return error;
  }
}
