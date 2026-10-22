import type { GlobalRole, BranchRole } from '@prisma/client';

/* ──────────────────────────── Request User ──────────────────────────── */

export interface BranchAccess {
  branchId: string;
  role: BranchRole;
}

/** Populated by SupabaseJwtGuard onto req.user */
export interface RequestUser {
  userId: string;
  tenantId: string;
  globalRole: GlobalRole | null;
  branches: BranchAccess[];
}

/* ──────────────────────────── Response Envelope ──────────────────────── */

export interface EnvelopeError {
  field?: string;
  code: string;
  message: string;
}

export interface PaginationMeta {
  // Offset-based
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
  // Cursor-based
  nextCursor?: string;
  prevCursor?: string;
  hasMore?: boolean;
}

export interface EnvelopeMeta {
  requestId: string;
  timestamp: string;
  pagination?: PaginationMeta;
}

export interface Envelope<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: EnvelopeError[];
  meta: EnvelopeMeta;
}

/* ──────────────────────────── Error Codes ──────────────────────────── */

export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_INVALID: 'AUTH_INVALID',
  CSRF_MISSING: 'CSRF_MISSING',
  CSRF_MISMATCH: 'CSRF_MISMATCH',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE_SKU: 'DUPLICATE_SKU',
  DUPLICATE_BARCODE: 'DUPLICATE_BARCODE',
  DUPLICATE_EMAIL: 'DUPLICATE_EMAIL',
  CATEGORY_ATTR_INVALID: 'CATEGORY_ATTR_INVALID',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  STOCK_INSUFFICIENT: 'STOCK_INSUFFICIENT',
  STOCK_RESERVED_CONFLICT: 'STOCK_RESERVED_CONFLICT',
  SALE_NOT_DRAFT: 'SALE_NOT_DRAFT',
  SALE_ALREADY_CONFIRMED: 'SALE_ALREADY_CONFIRMED',
  RESERVATION_EXPIRED: 'RESERVATION_EXPIRED',
  IDEMPOTENT_REPLAY: 'IDEMPOTENT_REPLAY',
  EXPORT_TOO_LARGE: 'EXPORT_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

/* ─────────────────────── Express augmentation ──────────────────────── */

declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;
      branchId?: string;
      requestId?: string;
    }
  }
}
