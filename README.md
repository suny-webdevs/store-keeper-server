# Store Keeper Server

> **Production-grade multi-tenant backend API for the Store Keeper store management platform.**  
> Built with NestJS 10+, Prisma ORM, PostgreSQL, Redis, and BullMQ.

---

## Table of Contents

- [Store Keeper Server](#store-keeper-server)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Key Features](#key-features)
  - [Technology Stack](#technology-stack)
  - [System Architecture](#system-architecture)
    - [Multi-Tenancy \& Data Isolation](#multi-tenancy--data-isolation)
    - [Strict Guard Chain](#strict-guard-chain)
    - [Standard Response Envelope](#standard-response-envelope)
      - [Success Response](#success-response)
      - [Error Response](#error-response)
  - [Data Model \& Prisma Setup](#data-model--prisma-setup)
    - [Schema Overview](#schema-overview)
    - [Prisma Configuration (`prisma.config.ts`)](#prisma-configuration-prismaconfigts)
    - [Materialized Views \& Raw SQL Enhancements](#materialized-views--raw-sql-enhancements)
  - [Core Business Logic Workflows](#core-business-logic-workflows)
    - [1. Stock-In \& Weighted Average Cost (WAC)](#1-stock-in--weighted-average-cost-wac)
    - [2. Inventory Adjustments](#2-inventory-adjustments)
    - [3. Sales Lifecycle (Draft → Confirm → Cancel)](#3-sales-lifecycle-draft--confirm--cancel)
    - [4. Analytics Hot/Cold Router](#4-analytics-hotcold-router)
    - [5. Cache Strategy \& Stampede Protection](#5-cache-strategy--stampede-protection)
  - [API Reference](#api-reference)
    - [Endpoint Groups](#endpoint-groups)
      - [Health \& Readiness](#health--readiness)
      - [Authentication](#authentication)
      - [User Management](#user-management)
      - [Branches](#branches)
      - [Categories \& Products](#categories--products)
      - [Stock \& Inventory Ledger](#stock--inventory-ledger)
      - [Sales \& POS](#sales--pos)
      - [Analytics \& Exports](#analytics--exports)
    - [Error Codes Specification](#error-codes-specification)
    - [Pagination Patterns](#pagination-patterns)
  - [Environment Variables](#environment-variables)
  - [Development \& Setup](#development--setup)
    - [Prerequisites](#prerequisites)
    - [Quick Start](#quick-start)
  - [NPM Scripts](#npm-scripts)
  - [Testing \& Quality Assurance](#testing--quality-assurance)
  - [Worker Process (BullMQ)](#worker-process-bullmq)
  - [Engineering Anti-Patterns \& Invariants](#engineering-anti-patterns--invariants)
  - [License](#license)

---

## Overview

**Store Keeper Server** provides a multi-tenant API serving web and mobile POS/Store Management clients. It enforces isolation across tenants and branches, immutable ledger accounting for inventory, transactional consistency with row locking for financial operations, stampede-proof caching via Redis, and asynchronous processing using BullMQ queues.

---

## Key Features

- **Multi-Tenant Isolation**: Tenant scoping enforced automatically at both the HTTP context level (`AsyncLocalStorage`) and the database layer via Prisma middleware.
- **Hierarchical RBAC**: Global roles (`OWNER`, `ADMIN`) combined with branch-specific permissions (`MANAGER`, `CASHIER`, `VIEWER`).
- **Immutable Inventory Ledger**: Double-entry style append-only ledger (`inventory_ledger`). Stock levels are derived and tracked in real time on `product_branch_stock`.
- **WAC Accounting**: Dynamic Weighted Average Cost recalculation on stock receipts; profit margins calculated using snapshotted unit costs.
- **Transactional Integrity**: Pessimistic concurrency control (`SELECT ... FOR UPDATE`) to prevent race conditions during sale confirmations and stock movements.
- **Dual-Speed Analytics Engine**: Hot-path direct queries for recent data (&le; 30 days) and cold-path querying over concurrently refreshed Materialized Views.
- **Stampede-Resistant Cache**: Redis cache-aside helper utilizing atomic `SET NX` distributed locking.
- **Asynchronous Worker Pipelines**: Dedicated BullMQ worker process handling audit logging, exports (CSV/PDF), background report generation, and reservation expiry.
- **Enterprise-Grade Security**: Double-submit CSRF cookie protection, Supabase RS256 JWKS token validation, tiered Redis rate-limiting, and PII-sanitized structured logging.

---

## Technology Stack

| Layer                         | Technology                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Runtime & Framework**       | [Node.js](https://nodejs.org/) (v20+) / [Bun](https://bun.sh/) &bull; [NestJS 10+](https://nestjs.com/) (Express platform) |
| **Language**                  | [TypeScript](https://www.typescriptlang.org/) (Strict mode, ES Modules)                                                    |
| **Database & ORM**            | [PostgreSQL 16](https://www.postgresql.org/) (Supabase-hosted) &bull; [Prisma ORM 6.x](https://www.prisma.io/)             |
| **Caching & In-Memory Store** | [Redis 7](https://redis.io/) (Upstash-compatible) via `ioredis`                                                            |
| **Job Queue & Workers**       | [BullMQ](https://docs.bullmq.io/) (Redis-backed queues & processors)                                                       |
| **Authentication**            | [Supabase Auth](https://supabase.com/auth) via JWKS verification (`jwks-rsa` + `jsonwebtoken`)                             |
| **Validation & Schemas**      | `class-validator`, `class-transformer`, [Zod](https://zod.dev/) (Environment validation)                                   |
| **Documentation**             | [Swagger / OpenAPI](https://swagger.io/) (`@nestjs/swagger`) at `/docs` and `/docs-json`                                   |
| **Security & Utilities**      | `helmet`, `cookie-parser`, `compression`, `@nestjs/throttler`                                                              |
| **Logging & Monitoring**      | [Pino](https://getpino.io/) (`nestjs-pino`, structured JSON logs), [Sentry](https://sentry.io/)                            |
| **Testing & Linting**         | [Vitest](https://vitest.dev/), [Supertest](https://github.com/ladjs/supertest), [Oxlint](https://oxc.rs/)                  |

---

## System Architecture

### Multi-Tenancy & Data Isolation

Multi-tenancy is enforced transparently without requiring developers to manually include `tenantId` in every query:

1. **Extraction**: `SupabaseJwtGuard` verifies the JWT, loads the user record from the database (cached in Redis), and sets `req.user`.
2. **Context Propagation**: `TenantContextInterceptor` captures `req.user.tenantId` and sets it in a NodeJS `AsyncLocalStorage` store (`tenantStore`).
3. **Database Scoping**: The extended `PrismaService` intercepts queries:
   - Injects `{ where: { tenantId } }` into `findMany`, `findFirst`, `count`, `aggregate`, `groupBy`.
   - Injects `tenantId` into `create`, `createMany`, `update`, and `upsert` data payloads.
   - Cross-tenant queries return `404 Not Found` (rather than `403`) to prevent leaking resource existence.

```
Request ──► SupabaseJwtGuard (sets req.user) ──► TenantContextInterceptor (sets AsyncLocalStorage)
                                                            │
                                                            ▼
                                        PrismaService (auto-injects tenantId into queries)
```

### Strict Guard Chain

Guards execute in a deterministic sequence globally:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. ThrottlerGuard (Redis-backed rate limiting by tier)      │
├─────────────────────────────────────────────────────────────┤
│ 2. CsrfGuard (Double-submit token timing-safe match)        │
├─────────────────────────────────────────────────────────────┤
│ 3. SupabaseJwtGuard (Verifies RS256 JWT via Supabase JWKS)  │
├─────────────────────────────────────────────────────────────┤
│ 4. RolesGuard (Checks @RequireGlobalRole: OWNER | ADMIN)    │
├─────────────────────────────────────────────────────────────┤
│ 5. BranchAccessGuard (Checks @RequireBranchRole)            │
├─────────────────────────────────────────────────────────────┤
│ 6. TenantContextInterceptor (Populates AsyncLocalStorage)   │
├─────────────────────────────────────────────────────────────┤
│ 7. ValidationPipe (whitelist: true, transform: true)        │
└─────────────────────────────────────────────────────────────┘
```

### Standard Response Envelope

All API endpoints strictly adhere to a unified JSON envelope:

#### Success Response

```json
{
  "success": true,
  "message": "Resource retrieved successfully",
  "data": { ... },
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

#### Error Response

```json
{
  "success": false,
  "message": "Failed to confirm sale",
  "errors": [
    {
      "field": "items[0].qty",
      "code": "STOCK_INSUFFICIENT",
      "message": "Requested quantity exceeds available on-hand stock"
    }
  ],
  "meta": {
    "requestId": "c4b92c43-15be-443b-a279-3d0da7e721d0",
    "timestamp": "2026-10-22T13:00:00.000Z"
  }
}
```

---

## Data Model & Prisma Setup

### Schema Overview

The database uses PostgreSQL with all UUIDs represented as `@db.Uuid`. Monetary amounts use `Decimal(12, 2)` and unit costs use `Decimal(12, 4)`. Floating-point arithmetic is strictly prohibited for currency.

```
Tenants
  ├── Branches ──────────────► UserBranchAccess ◄── Users
  ├── Categories
  │     └── Products ────────► ProductVariants
  │               │
  │               ├── ProductBranchStock (Current qty_on_hand, qty_reserved, WAC)
  │               └── InventoryLedger (Append-only transaction history)
  │
  ├── Sales ─────────────────► SaleItems
  │     ├── Payments
  │     └── Reservations
  ├── AuditLogs
  └── ExportJobs
```

### Prisma Configuration (`prisma.config.ts`)

The project uses Prisma 6's official configuration file (`prisma.config.ts`), decoupling configuration from hardcoded strings and centralizing migrations and seed commands:

```typescript
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'bun run prisma/seed.ts',
  },
  engine: 'classic',
  datasource: {
    url: process.env.DATABASE_URL
      ? env('DATABASE_URL')
      : 'postgresql://postgres:password@localhost:5432/postgres',
    directUrl: process.env.DIRECT_URL ? env('DIRECT_URL') : undefined,
  },
});
```

- **Connection Pooling**: `DATABASE_URL` targets Supavisor transaction pooler (`:6543`) for application workloads.
- **Direct Migrations**: `DIRECT_URL` targets direct PostgreSQL (`:5432`) for schema migrations and advisory locking.

### Materialized Views & Raw SQL Enhancements

Custom migration `20261018000002_raw_sql_enhancements` provisions high-performance database objects:

1. **Full-Text Search & JSONB GIN Indexes**:
   - `products_attributes_gin`: GIN index on `products.attributes` JSONB.
   - `search_tsv`: Generated `tsvector` column on `coalesce(name, '') || ' ' || coalesce(sku, '')` with a GIN index.
2. **Database Integrity Constraints**:
   - `pbs_nonneg`: Check constraint ensuring `qty_on_hand >= 0` and `qty_reserved >= 0`.
3. **Analytics Materialized Views**:
   - `mv_sales_daily`: Pre-aggregated daily revenue, discounts, and sale counts per branch.
   - `mv_profit_loss_daily`: Aggregated daily COGS, revenue, and gross profit by product and branch.
   - `mv_stock_valuation_daily`: Daily snapshots of inventory valuation (`qty_on_hand * wac`).

---

## Core Business Logic Workflows

### 1. Stock-In & Weighted Average Cost (WAC)

When goods arrive, stock and unit costs are updated inside an atomic transaction:

$$\text{newWAC} = \frac{(Q \times W) + (q_{\text{in}} \times c_{\text{in}})}{Q + q_{\text{in}}}$$

Where:

- $Q$ = Current quantity on hand (`qty_on_hand`)
- $W$ = Current Weighted Average Cost (`wac`)
- $q_{\text{in}}$ = Incoming stock quantity
- $c_{\text{in}}$ = Unit cost of incoming stock

**Transaction Sequence:**

1. Execute `SELECT ... FOR UPDATE` on `product_branch_stock` to lock the row.
2. Append `STOCK_IN` record to `inventory_ledger`.
3. Compute `newWac` and update `product_branch_stock` (`qty_on_hand += qty`, `wac = newWac`).
4. **Post-Commit Hook**: Invalidate Redis cache keys (`sk:stock:*`, `sk:product:*`, `sk:analytics:*`).

### 2. Inventory Adjustments

- Applied for shrinkage, damage, audit corrections, or internal consumption.
- **WAC remains unchanged**; the unit cost recorded in `inventory_ledger` mirrors the current WAC to accurately value write-offs.
- Rejected if the resulting `qty_on_hand` would drop below zero.

### 3. Sales Lifecycle (Draft &rarr; Confirm &rarr; Cancel)

```
[ POST /sales ] (Draft)
       │
       ▼
Locks product stock
Creates PENDING reservations (expires in 15 mins)
Increments qty_reserved
       │
       ▼
[ POST /sales/:id/confirm ]
       │
       ▼
Locks sale & stock rows (idempotent: return 200 if already CONFIRMED)
Deducts qty_on_hand and qty_reserved
Appends SALE entries to inventory_ledger
Marks reservations CONFIRMED, sale CONFIRMED
       │
       ▼
[ POST /sales/:id/cancel ] (Requires MANAGER role)
       │
       ▼
Reverses stock deduction (qty_on_hand += qty)
Appends SALE_CANCEL entries to inventory_ledger
Sets sale status to CANCELLED
```

### 4. Analytics Hot/Cold Router

To maintain sub-50ms response times:

- **Hot Path ($from \ge today - 30\text{ days}$)**: Executes direct transactional SQL on `sales` and `sale_items`.
- **Cold Path ($from < today - 30\text{ days}$)**: Routes queries to pre-computed Materialized Views (`mv_sales_daily`, `mv_profit_loss_daily`).
- Results are cached in Redis under `sk:analytics:{type}:{branchId}:{from}:{to}` (TTL 5m).

### 5. Cache Strategy & Stampede Protection

The `CacheService.remember` implementation prevents cache stampedes using atomic distributed locks:

1. Query Redis for cache key.
2. On cache miss, attempt `SET sk:lock:{key} {workerId} NX EX 5`.
3. If lock acquired: Compute value via factory function, write result to Redis with TTL, release lock.
4. If lock busy: Await 50ms and retry reading key from cache.
5. Invalidation strictly occurs **post-commit** via `withPostCommit` to prevent cache thrashing.

---

## API Reference

Base URL prefix: `/v1`

### Endpoint Groups

#### Health & Readiness

| Method | Endpoint           | Description                              | Auth   |
| ------ | ------------------ | ---------------------------------------- | ------ |
| `GET`  | `/v1/health`       | Liveness probe (no DB check)             | Public |
| `GET`  | `/v1/health/ready` | Readiness probe (pings Postgres & Redis) | Public |

#### Authentication

| Method | Endpoint      | Description                                                 | Auth       |
| ------ | ------------- | ----------------------------------------------------------- | ---------- |
| `GET`  | `/v1/auth/me` | Returns current user profile, roles, and branch assignments | Bearer JWT |

#### User Management

| Method   | Endpoint                           | Description                       | Required Role    |
| -------- | ---------------------------------- | --------------------------------- | ---------------- |
| `GET`    | `/v1/users`                        | List tenant users (paginated)     | `OWNER`, `ADMIN` |
| `POST`   | `/v1/users/invite`                 | Invite user via email             | `OWNER`, `ADMIN` |
| `PATCH`  | `/v1/users/:id`                    | Update user status or global role | `OWNER`, `ADMIN` |
| `DELETE` | `/v1/users/:id`                    | Soft delete user                  | `OWNER`          |
| `POST`   | `/v1/users/:id/branches`           | Grant branch access               | `OWNER`, `ADMIN` |
| `DELETE` | `/v1/users/:id/branches/:branchId` | Revoke branch access              | `OWNER`, `ADMIN` |

#### Branches

| Method   | Endpoint           | Description                               | Required Role    |
| -------- | ------------------ | ----------------------------------------- | ---------------- |
| `GET`    | `/v1/branches`     | List branches accessible to user          | Authenticated    |
| `POST`   | `/v1/branches`     | Create branch                             | `OWNER`, `ADMIN` |
| `GET`    | `/v1/branches/:id` | Get branch details                        | Branch access    |
| `PATCH`  | `/v1/branches/:id` | Update branch metadata                    | `OWNER`, `ADMIN` |
| `DELETE` | `/v1/branches/:id` | Soft delete branch (blocked if stock > 0) | `OWNER`          |

#### Categories & Products

| Method | Endpoint                      | Description                                     | Required Role |
| ------ | ----------------------------- | ----------------------------------------------- | ------------- |
| `GET`  | `/v1/categories`              | List categories (`?tree=true` for hierarchy)    | Authenticated |
| `POST` | `/v1/categories`              | Create category with attribute schema           | `MANAGER`     |
| `GET`  | `/v1/products`                | Search/filter products (full-text search `?q=`) | Authenticated |
| `POST` | `/v1/products`                | Create product with variant definitions         | `MANAGER`     |
| `POST` | `/v1/products/:id/image/sign` | Generate Cloudinary pre-signed upload URL       | `MANAGER`     |

#### Stock & Inventory Ledger

| Method | Endpoint                             | Description                                       | Required Role       |
| ------ | ------------------------------------ | ------------------------------------------------- | ------------------- |
| `GET`  | `/v1/branches/:branchId/stock`       | List current stock levels                         | Branch access       |
| `POST` | `/v1/branches/:branchId/stock-in`    | Receive stock (recalculates WAC)                  | `MANAGER`           |
| `POST` | `/v1/branches/:branchId/adjustments` | Record shrinkage or adjustments                   | `MANAGER`           |
| `GET`  | `/v1/branches/:branchId/ledger`      | Audit trail of inventory movements (cursor-based) | `MANAGER`, `VIEWER` |

#### Sales & POS

| Method | Endpoint                       | Description                                     | Required Role |
| ------ | ------------------------------ | ----------------------------------------------- | ------------- |
| `GET`  | `/v1/branches/:branchId/sales` | List branch sales (cursor paginated)            | `CASHIER`+    |
| `POST` | `/v1/branches/:branchId/sales` | Create sale (`?immediate=true` to auto-confirm) | `CASHIER`+    |
| `POST` | `/v1/sales/:id/confirm`        | Finalize draft sale & deduct inventory          | `CASHIER`+    |
| `POST` | `/v1/sales/:id/cancel`         | Cancel sale & restore stock                     | `MANAGER`     |
| `POST` | `/v1/sales/:id/payments`       | Record payment against sale                     | `CASHIER`+    |
| `GET`  | `/v1/sales/:id/receipt`        | Download printable PDF receipt                  | `CASHIER`+    |

#### Analytics & Exports

| Method | Endpoint                      | Description                                    | Required Role    |
| ------ | ----------------------------- | ---------------------------------------------- | ---------------- |
| `GET`  | `/v1/analytics/sales-summary` | Aggregated revenue, discount, and sale metrics | `MANAGER`+       |
| `GET`  | `/v1/analytics/profit-loss`   | Gross profit and COGS analysis                 | `OWNER`, `ADMIN` |
| `GET`  | `/v1/analytics/dead-stock`    | Products with zero movements in $N$ days       | `MANAGER`+       |
| `POST` | `/v1/exports`                 | Request asynchronous CSV/PDF data export       | Authenticated    |

---

### Error Codes Specification

| Code                             | HTTP | Description                                              |
| -------------------------------- | ---- | -------------------------------------------------------- |
| `AUTH_REQUIRED`                  | 401  | Missing or malformed authorization header                |
| `AUTH_INVALID`                   | 401  | JWT expired, invalid signature, or inactive user         |
| `CSRF_MISSING` / `CSRF_MISMATCH` | 403  | Double-submit CSRF cookie validation failure             |
| `FORBIDDEN`                      | 403  | Insufficient global or branch permissions                |
| `NOT_FOUND`                      | 404  | Entity not found or belongs to another tenant            |
| `STOCK_INSUFFICIENT`             | 409  | Available stock (`qtyOnHand - qtyReserved`) insufficient |
| `DUPLICATE_SKU`                  | 409  | SKU conflict within tenant                               |
| `SALE_ALREADY_CONFIRMED`         | 409  | Mutation rejected because sale is already confirmed      |
| `RATE_LIMITED`                   | 429  | Throttling tier threshold exceeded                       |

---

### Pagination Patterns

1. **Offset-Based** (Products, Users, Categories):
   - Parameters: `?page=1&limit=20` (max limit: 100)
   - Metadata: `meta.pagination.{page, limit, total, totalPages, hasNext, hasPrev}`
2. **Cursor-Based** (Ledger, Sales, Audit Logs):
   - Parameters: `?cursor=eyJpZCI6MTIzfQ==&limit=50`
   - Metadata: `meta.pagination.{nextCursor, prevCursor, hasMore}`

---

## Environment Variables

All variables are validated at boot time via Zod (`src/config/env.config.ts`). Missing or invalid configuration will prevent application startup:

```bash
# ── Database ───────────────────────────────────────────────
DATABASE_URL="postgresql://postgres:password@db.supabase.co:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:password@db.supabase.co:5432/postgres"

# ── Redis ──────────────────────────────────────────────────
REDIS_URL="redis://default:password@your-redis-host:6379"

# ── Supabase Auth ──────────────────────────────────────────
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOi..."

# ── Application ───────────────────────────────────────────
PORT=4000
NODE_ENV="development" # development | production | test
FRONTEND_URL="http://localhost:3000"

# ── Optional Integrations ──────────────────────────────────
SENTRY_DSN=""
CLOUDINARY_CLOUD_NAME=""
CLOUDINARY_API_KEY=""
CLOUDINARY_API_SECRET=""
```

---

## Development & Setup

### Prerequisites

- **Bun** (v1.1+) or **Node.js** (v20+)
- **PostgreSQL 16** with `pgcrypto` support
- **Redis 7**

### Quick Start

1. **Clone & Install Dependencies**:

   ```bash
   git clone <repo-url> store-keeper-server
   cd store-keeper-server
   bun install
   ```

2. **Configure Environment**:

   ```bash
   cp .env.example .env
   # Edit .env with your PostgreSQL, Redis, and Supabase credentials
   ```

3. **Initialize Prisma & Database**:

   ```bash
   # Validate Prisma schema
   bun run prisma:validate

   # Generate Prisma Client
   bun run prisma:generate

   # Apply migrations to development database
   bun run prisma:migrate

   # Seed initial demo tenant, branch, and category
   bun run prisma:seed
   ```

4. **Start Application Server**:

   ```bash
   # Development watch mode
   bun run start:dev

   # Production build & start
   bun run build
   bun run start:prod
   ```

5. **Access OpenAPI Docs**:
   - Swagger UI: `http://localhost:4000/docs`
   - Raw OpenAPI JSON: `http://localhost:4000/docs-json`

---

## NPM Scripts

| Command                   | Action                                           |
| ------------------------- | ------------------------------------------------ |
| `bun run build`           | Compiles NestJS application to `dist/`           |
| `bun run start:dev`       | Runs server in development watch mode            |
| `bun run lint`            | Runs type-aware linting via `oxlint`             |
| `bun run format`          | Formats code with `prettier`                     |
| `bun run test`            | Runs unit tests with Vitest                      |
| `bun run test:cov`        | Generates unit test code coverage report         |
| `bun run test:e2e`        | Runs end-to-end test suite                       |
| `bun run prisma:validate` | Validates schema syntax and configuration        |
| `bun run prisma:generate` | Generates typed Prisma Client                    |
| `bun run prisma:migrate`  | Runs Prisma interactive migration generator      |
| `bun run prisma:deploy`   | Applies pending migrations in production         |
| `bun run prisma:seed`     | Executes `prisma/seed.ts` idempotent seed script |
| `bun run prisma:studio`   | Launches visual Prisma Studio database GUI       |

---

## Testing & Quality Assurance

Unit and integration tests are executed using [Vitest](https://vitest.dev/):

```bash
# Run all test suites
bun run test

# Run tests in watch mode
bun run test:watch

# Verify code coverage
bun run test:cov
```

Key test suites include:

- `SupabaseJwtGuard`: Token expiry, signature validation, JWKS cache hits/misses, key rotation.
- `RolesGuard` & `BranchAccessGuard`: Role hierarchies, cross-branch rejection (403), parameter extraction.
- `CsrfGuard`: Double-submit cookie verification and timing-safe equality.
- `CacheService`: Stampede prevention with atomic lock contention.
- `StockService`: WAC calculation accuracy and inventory ledger consistency.

---

## Worker Process (BullMQ)

Asynchronous tasks run in a separate background worker process to prevent long-running tasks from degrading HTTP throughput:

- **Audit Queue (`audit-log`)**: Asynchronous writing of audit logs.
- **Export Queue (`export`)**: Large CSV/PDF data generation uploaded to Supabase Storage.
- **Analytics Refresh (`analytics-refresh`)**: Periodic scheduled refresh of Materialized Views (`REFRESH MATERIALIZED VIEW CONCURRENTLY`).
- **Reservation Expiry (`reservation-expiry`)**: Scheduled reaper releasing inventory reserved by expired draft sales.

Run the worker:

```bash
node dist/worker.js
```

---

## Engineering Anti-Patterns & Invariants

To guarantee data integrity and multi-tenant security, the following invariants are strictly enforced:

- ❌ **No Ledger Updates/Deletes**: `inventory_ledger` is strictly append-only. Correct mistakes solely through adjustment transactions.
- ❌ **No Floating Point Currency**: Always use `Decimal(12,2)` for financial values and `Decimal(12,4)` for unit costs.
- ❌ **No Unscoped Queries**: Never bypass tenant filters or trust tenant IDs supplied from client request payloads.
- ❌ **No Cross-Tenant Existence Leaks**: Always return `404` (never `403`) when a user attempts to access an entity belonging to a different tenant.
- ❌ **No Invalidation Inside Transactions**: Redis cache invalidations must execute post-commit (`withPostCommit`) to avoid stale cache repopulation.
- ❌ **No Unprotected Mutations**: Every state mutation requires CSRF token matching and produces an entry in `audit_logs`.
- ❌ **No Raw Prisma Exceptions**: All Prisma errors are mapped to standardized HTTP errors (e.g., `P2002` &rarr; `409 Conflict`, `P2025` &rarr; `404 Not Found`).

---

## License

This project is proprietary and confidential. All rights reserved.
