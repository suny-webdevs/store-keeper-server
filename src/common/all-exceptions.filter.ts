import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ErrorCode, type Envelope, type EnvelopeError } from './types.js';

/**
 * Global exception filter that normalizes ALL errors to the standard envelope:
 * { success: false, message, errors?, meta: { requestId, timestamp } }
 *
 * Handles:
 * - HttpException (NestJS built-in + custom)
 * - Prisma known errors (P2002, P2003, P2025)
 * - Unknown / unhandled errors
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    let status: number;
    let message: string;
    let errors: EnvelopeError[] | undefined;
    let code: string = ErrorCode.INTERNAL_ERROR;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'string') {
        message = response;
      } else if (typeof response === 'object' && response !== null) {
        const resp = response as Record<string, unknown>;
        message = (resp.message as string) ?? exception.message;
        code = (resp.code as string) ?? this.httpStatusToErrorCode(status);

        // class-validator returns { message: string[] }
        if (Array.isArray(resp.message)) {
          errors = (resp.message as string[]).map((msg) => ({
            code: ErrorCode.VALIDATION_FAILED,
            message: msg,
          }));
          message = 'Validation failed';
          code = ErrorCode.VALIDATION_FAILED;
        }

        // Custom errors may provide { errors: [...] }
        if (Array.isArray(resp.errors)) {
          errors = resp.errors as EnvelopeError[];
        }
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const result = this.handlePrismaError(exception);
      status = result.status;
      message = result.message;
      code = result.code;
      errors = result.errors;
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'An unexpected error occurred';
      code = ErrorCode.INTERNAL_ERROR;
    }

    // Log server errors
    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId: req.requestId, path: req.url },
        `Unhandled ${status} error`,
      );
    }

    const envelopeErrors: EnvelopeError[] = errors ?? [{ code, message }];

    const envelope: Envelope = {
      success: false,
      message,
      errors: envelopeErrors,
      meta: {
        requestId: req.requestId ?? crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      },
    };

    res.status(status).json(envelope);
  }

  private handlePrismaError(error: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string;
    code: string;
    errors?: EnvelopeError[];
  } {
    switch (error.code) {
      // Unique constraint violation
      case 'P2002': {
        const target = (error.meta?.target as string[]) ?? [];
        const field = target.join(', ');
        const code = this.uniqueFieldToErrorCode(field);
        return {
          status: HttpStatus.CONFLICT,
          message: `Duplicate value for: ${field}`,
          code,
          errors: [{ field, code, message: `Value already exists` }],
        };
      }
      // Foreign key constraint violation
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          message: 'Cannot perform operation: referenced record exists',
          code: 'BLOCKED_BY_REFERENCE',
        };
      // Record not found
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Record not found',
          code: ErrorCode.NOT_FOUND,
        };
      // Database connection or connection pool timeout
      case 'P1001':
      case 'P2024':
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Database connection temporarily unavailable',
          code: ErrorCode.SERVICE_UNAVAILABLE,
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database error',
          code: ErrorCode.INTERNAL_ERROR,
        };
    }
  }

  private uniqueFieldToErrorCode(field: string): string {
    if (field.includes('sku')) return ErrorCode.DUPLICATE_SKU;
    if (field.includes('barcode')) return ErrorCode.DUPLICATE_BARCODE;
    if (field.includes('email')) return ErrorCode.DUPLICATE_EMAIL;
    if (field.includes('code')) return 'DUPLICATE_CODE';
    return 'DUPLICATE_ENTRY';
  }

  private httpStatusToErrorCode(status: number): string {
    switch (status) {
      case 400:
        return ErrorCode.VALIDATION_FAILED;
      case 401:
        return ErrorCode.AUTH_REQUIRED;
      case 403:
        return ErrorCode.FORBIDDEN;
      case 404:
        return ErrorCode.NOT_FOUND;
      case 429:
        return ErrorCode.RATE_LIMITED;
      case 503:
        return ErrorCode.SERVICE_UNAVAILABLE;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }
}
