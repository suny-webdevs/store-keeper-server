import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantStore } from '../common/tenant-context.js';

/**
 * Models that have a direct tenantId column and should be auto-scoped.
 * Child models (SaleItem, Payment, Reservation, ProductBranchStock,
 * UserBranchAccess, ProductVariant) are scoped via their parent relationships.
 */
const TENANT_SCOPED_MODELS = new Set([
  'Branch',
  'User',
  'Category',
  'Product',
  'InventoryLedger',
  'Sale',
  'ExportJob',
  'AuditLog',
]);

/**
 * Operations where tenantId should be injected into the WHERE clause.
 */
const READ_ACTIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

const WRITE_FILTER_ACTIONS = new Set([
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });

    this.setupTenantMiddleware();
  }

  async onModuleInit(): Promise<void> {
    // Log Prisma warnings/errors
    (this as any).$on('warn', (e: any) => this.logger.warn(e.message));
    (this as any).$on('error', (e: any) => this.logger.error(e.message));

    await this.$connect();
    this.logger.log('Prisma connected to database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }

  /**
   * Tenant-scoping middleware.
   * Reads tenantId from AsyncLocalStorage and auto-injects it into queries.
   * Skips when no tenant context is present (bootstrap queries, public endpoints).
   */
  private setupTenantMiddleware(): void {
    (this as any).$use(async (params: any, next: (params: any) => Promise<any>) => {
      const store = tenantStore.getStore();
      const tenantId = store?.tenantId;

      // Skip if no tenant context or model isn't tenant-scoped
      if (!tenantId || !params.model || !TENANT_SCOPED_MODELS.has(params.model)) {
        return next(params);
      }

      const action = params.action;

      // ── Read operations: inject tenantId into WHERE ──
      if (READ_ACTIONS.has(action)) {
        params.args = params.args ?? {};
        params.args.where = { ...params.args.where, tenantId };
      }

      // ── Create: inject tenantId into DATA ──
      if (action === 'create') {
        params.args = params.args ?? {};
        params.args.data = { ...params.args.data, tenantId };
      }

      // ── CreateMany: inject tenantId into each row ──
      if (action === 'createMany') {
        params.args = params.args ?? {};
        if (Array.isArray(params.args.data)) {
          params.args.data = params.args.data.map(
            (row: Record<string, unknown>) => ({ ...row, tenantId }),
          );
        } else {
          params.args.data = { ...params.args.data, tenantId };
        }
      }

      // ── Update/Delete with WHERE: inject tenantId ──
      if (WRITE_FILTER_ACTIONS.has(action)) {
        params.args = params.args ?? {};
        params.args.where = { ...params.args.where, tenantId };
      }

      // ── Upsert: inject tenantId into WHERE + CREATE ──
      if (action === 'upsert') {
        params.args = params.args ?? {};
        params.args.where = { ...params.args.where, tenantId };
        params.args.create = { ...params.args.create, tenantId };
      }

      return next(params);
    });
  }
}
