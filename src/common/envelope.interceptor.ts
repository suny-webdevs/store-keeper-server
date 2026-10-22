import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, map } from 'rxjs';
import type { Envelope, EnvelopeMeta } from './types.js';

/**
 * Wraps all controller responses in the standard envelope:
 * { success: true, message: string, data: T, meta: { requestId, timestamp } }
 *
 * This interceptor does NOT wrap error responses — those are handled
 * by AllExceptionsFilter which produces the same envelope shape.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Envelope> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data) => {
        const meta: EnvelopeMeta = {
          requestId: req.requestId ?? crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        };

        // If the handler returned a raw envelope (e.g. pagination), pass through
        if (data && typeof data === 'object' && 'success' in data && 'meta' in data) {
          // Merge requestId into the existing meta
          data.meta = { ...meta, ...data.meta };
          return data as Envelope;
        }

        // If data contains a pagination property, hoist it to meta
        if (data && typeof data === 'object' && 'pagination' in data) {
          const { pagination, ...rest } = data;
          meta.pagination = pagination;
          // If the remaining data has a single `items` key, unwrap it
          const payload = 'items' in rest ? rest.items : rest;
          return {
            success: true,
            message: this.getSuccessMessage(req),
            data: payload,
            meta,
          };
        }

        // Set 201 for POST that created a resource
        if (req.method === 'POST' && res.statusCode === 200) {
          res.status(201);
        }

        return {
          success: true,
          message: this.getSuccessMessage(req),
          data: data ?? null,
          meta,
        };
      }),
    );
  }

  private getSuccessMessage(req: Request): string {
    switch (req.method) {
      case 'POST':
        return 'Created successfully';
      case 'PATCH':
      case 'PUT':
        return 'Updated successfully';
      case 'DELETE':
        return 'Deleted successfully';
      default:
        return 'OK';
    }
  }
}
