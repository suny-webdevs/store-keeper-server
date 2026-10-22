import { SetMetadata } from '@nestjs/common';

export interface AuditedOptions {
  /** e.g. 'product.create', 'sale.confirm' */
  action: string;
  /** e.g. 'Product', 'Sale' */
  entityType: string;
  /** Capture the existing entity before mutation (for diff) */
  captureBefore?: boolean;
}

export const AUDITED_KEY = 'audited';

/**
 * Mark a controller method as audited.
 * The AuditInterceptor reads this metadata to log the mutation.
 */
export const Audited = (options: AuditedOptions) =>
  SetMetadata(AUDITED_KEY, options);
