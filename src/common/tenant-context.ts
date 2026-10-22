import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantStore {
  tenantId: string;
}

/**
 * AsyncLocalStorage instance for tenant context.
 * Populated by TenantContextInterceptor after JWT auth.
 * Read by PrismaService middleware to auto-inject tenantId.
 */
export const tenantStore = new AsyncLocalStorage<TenantStore>();
