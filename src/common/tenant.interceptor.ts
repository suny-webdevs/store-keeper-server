import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tenantStore } from './tenant-context.js';

/**
 * Populates AsyncLocalStorage with the tenant context from req.user.
 * Must run AFTER SupabaseJwtGuard has set req.user.
 * PrismaService reads from this store to auto-inject tenantId.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      // No tenant context (public endpoints, pre-auth) — skip scoping
      return next.handle();
    }

    return new Observable((subscriber) => {
      tenantStore.run({ tenantId }, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
