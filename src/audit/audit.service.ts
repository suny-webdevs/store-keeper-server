import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEvent {
  tenantId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

const REDACTED_KEYS = new Set([
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'authorization',
  'cookie',
]);

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record an audit event asynchronously (fire-and-forget).
   * Sanitizes all payload data to prevent sensitive leaks.
   */
  async record(event: AuditEvent): Promise<void> {
    try {
      const sanitizedBefore = event.before ? this.sanitize(event.before) : undefined;
      const sanitizedAfter = event.after ? this.sanitize(event.after) : undefined;

      await this.prisma.auditLog.create({
        data: {
          tenantId: event.tenantId,
          actorId: event.actorId ?? null,
          action: event.action,
          entityType: event.entityType,
          entityId: event.entityId ? String(event.entityId) : null,
          before: sanitizedBefore as any,
          after: sanitizedAfter as any,
          ip: event.ip ?? null,
          userAgent: event.userAgent ?? null,
        },
      });
    } catch (error) {
      // Never block request flow if audit logging fails
      this.logger.error(
        `Failed to record audit log for action ${event.action}: ${(error as Error).message}`,
      );
    }
  }

  private sanitize(obj: unknown, seen = new WeakSet<object>()): unknown {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return obj.toString();
    if (obj instanceof Date) return obj.toISOString();
    if (typeof obj !== 'object') return obj;

    if (seen.has(obj)) return '[CIRCULAR]';
    seen.add(obj);

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitize(item, seen));
    }

    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(key) || REDACTED_KEYS.has(key.toLowerCase())) {
        clean[key] = '[REDACTED]';
      } else {
        clean[key] = this.sanitize(val, seen);
      }
    }
    return clean;
  }
}
