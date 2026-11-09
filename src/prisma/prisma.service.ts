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
  private readonly extendedClient: any;

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });

    this.extendedClient = this.setupTenantExtension();

    return new Proxy(this, {
      get(target: any, prop: string | symbol, receiver: any) {
        if (
          prop === 'onModuleInit' ||
          prop === 'onModuleDestroy' ||
          prop === 'logger' ||
          prop === 'extendedClient' ||
          prop === '$on'
        ) {
          const val = target[prop];
          return typeof val === 'function' ? val.bind(target) : val;
        }

        if (target.extendedClient && target.extendedClient[prop] !== undefined) {
          const val = target.extendedClient[prop];
          if (typeof val === 'function') {
            return val.bind(target.extendedClient);
          }
          return val;
        }

        const fallback = Reflect.get(target, prop, receiver);
        if (typeof fallback === 'function') {
          return fallback.bind(target);
        }
        return fallback;
      },
    });
  }

  async onModuleInit(): Promise<void> {
    // Log Prisma warnings/errors if supported
    if (typeof (this as any).$on === 'function') {
      (this as any).$on('warn', (e: any) => this.logger.warn(e.message));
      (this as any).$on('error', (e: any) => this.logger.error(e.message));
    }

    await this.$connect();
    this.logger.log('Prisma connected to database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }

  /**
   * Tenant-scoping client extension.
   * Reads tenantId from AsyncLocalStorage and auto-injects it into queries.
   * Skips when no tenant context is present (bootstrap queries, public endpoints).
   */
  private setupTenantExtension(): any {
    return this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }: any) {
            const store = tenantStore.getStore();
            const tenantId = store?.tenantId;

            // Skip if no tenant context or model isn't tenant-scoped
            if (!tenantId || !model || !TENANT_SCOPED_MODELS.has(model)) {
              return query(args);
            }

            // ── Read operations: inject tenantId into WHERE ──
            if (READ_ACTIONS.has(operation)) {
              args = args ?? {};
              args.where = { ...args.where, tenantId };
            }

            // ── Create: inject tenantId into DATA ──
            if (operation === 'create') {
              args = args ?? {};
              args.data = { ...args.data, tenantId };
            }

            // ── CreateMany: inject tenantId into each row ──
            if (operation === 'createMany') {
              args = args ?? {};
              if (Array.isArray(args.data)) {
                args.data = args.data.map(
                  (row: Record<string, unknown>) => ({ ...row, tenantId }),
                );
              } else {
                args.data = { ...args.data, tenantId };
              }
            }

            // ── Update/Delete with WHERE: inject tenantId ──
            if (WRITE_FILTER_ACTIONS.has(operation)) {
              args = args ?? {};
              args.where = { ...args.where, tenantId };
            }

            // ── Upsert: inject tenantId into WHERE + CREATE ──
            if (operation === 'upsert') {
              args = args ?? {};
              args.where = { ...args.where, tenantId };
              args.create = { ...args.create, tenantId };
            }

            return query(args);
          },
        },
      },
    });
  }
}
