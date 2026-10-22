import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDITED_KEY, type AuditedOptions } from '../common/decorators/audited.decorator.js';
import { AuditService } from './audit.service.js';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const method = req.method.toUpperCase();

    // Only audit mutations (POST, PUT, PATCH, DELETE)
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next.handle();
    }

    const auditedMeta = this.reflector.getAllAndOverride<AuditedOptions>(AUDITED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const controllerName = context.getClass().name.replace('Controller', '');
    const action = auditedMeta?.action ?? `${method.toLowerCase()}.${controllerName.toLowerCase()}`;
    const entityType = auditedMeta?.entityType ?? controllerName;

    const before = req.body && typeof req.body === 'object' ? req.body : undefined;

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          // If request was unauthenticated, tenant context might be missing
          const tenantId = req.user?.tenantId;
          if (!tenantId) return;

          const data = responseBody && typeof responseBody === 'object' && 'data' in responseBody
            ? responseBody.data
            : responseBody;

          const entityId = data?.id ?? req.params?.id ?? null;

          // Fire and forget
          this.auditService
            .record({
              tenantId,
              actorId: req.user?.userId,
              action,
              entityType,
              entityId: entityId ? String(entityId) : null,
              before: auditedMeta?.captureBefore ? before : undefined,
              after: data && typeof data === 'object' ? data : undefined,
              ip: req.ip ?? req.socket.remoteAddress,
              userAgent: req.headers['user-agent'],
            })
            .catch(() => {});
        },
      }),
    );
  }
}
