# Store Keeper Server — API Test Documentation

> **Automated End-to-End API Testing & Response Specifications**  
> **Runtime:** Bun `v1.3.14` &bull; **Framework:** NestJS 10+ (Express Platform) &bull; **Database / ORM:** PostgreSQL / Prisma ORM &bull; **Cache:** Redis  
> **Test Status:** 45 / 45 Tests Passed (100% Pass Rate)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Global Architecture & Envelope Standards](#2-global-architecture--envelope-standards)
   - [Success Response Envelope](#21-success-response-envelope)
   - [Error Response Envelope](#22-error-response-envelope)
   - [Standard Error Codes](#23-standard-error-codes)
   - [Security & Guard Chain](#24-security--guard-chain)
3. [Health & Readiness Endpoints (`/v1/health`)](#3-health--readiness-endpoints-v1health)
   - [`GET /v1/health` (Liveness Probe)](#31-get-v1health-liveness-probe)
   - [`GET /v1/health/ready` (Readiness Probe)](#32-get-v1healthready-readiness-probe)
4. [Authentication Endpoints (`/v1/auth`)](#4-authentication-endpoints-v1auth)
   - [`GET /v1/auth/me` (Get Current User Profile)](#41-get-v1authme-get-current-user-profile)
5. [Branches Management Endpoints (`/v1/branches`)](#5-branches-management-endpoints-v1branches)
   - [`GET /v1/branches` (List Accessible Branches)](#51-get-v1branches-list-accessible-branches)
   - [`POST /v1/branches` (Create Branch)](#52-post-v1branches-create-branch)
   - [`GET /v1/branches/:id` (Get Branch by ID)](#53-get-v1branchesid-get-branch-by-id)
   - [`PATCH /v1/branches/:id` (Update Branch)](#54-patch-v1branchesid-update-branch)
   - [`DELETE /v1/branches/:id` (Soft-Delete Branch)](#55-delete-v1branchesid-soft-delete-branch)
6. [User Management Endpoints (`/v1/users`)](#6-user-management-endpoints-v1users)
   - [`GET /v1/users` (List Tenant Users with Pagination)](#61-get-v1users-list-tenant-users-with-pagination)
   - [`POST /v1/users/invite` (Invite User to Tenant)](#62-post-v1usersinvite-invite-user-to-tenant)
   - [`PATCH /v1/users/:id` (Update User Profile/Roles)](#63-patch-v1usersid-update-user-profileroles)
   - [`DELETE /v1/users/:id` (Deactivate / Soft-Delete User)](#64-delete-v1usersid-deactivate--soft-delete-user)
   - [`POST /v1/users/:id/branches` (Assign Branch Access)](#65-post-v1usersidbranches-assign-branch-access)
   - [`PATCH /v1/users/:id/branches/:branchId` (Update Branch Role)](#66-patch-v1usersidbranchesbranchid-update-branch-role)
   - [`DELETE /v1/users/:id/branches/:branchId` (Remove Branch Access)](#67-delete-v1usersidbranchesbranchid-remove-branch-access)
7. [Running the Test Suite with Bun](#7-running-the-test-suite-with-bun)

---

## 1. Executive Summary

This document provides complete, verified documentation for all HTTP API endpoints implemented in the Store Keeper Server. All endpoints, guards, interceptors, validation pipes, and error filters were exercised and validated using **Bun** (`v1.3.14`).

### Test Execution Metrics
- **Total Test Cases Executed:** 45
- **Passed:** 45 (100%)
- **Failed:** 0 (0%)
- **Test Categories:** Health & Readiness, Authentication, Branches Management, User Administration & Branch Access Control
- **Execution Modes Verified:** Successful returns (200 OK, 201 Created), validation failures (400 Bad Request), authentication failures (401 Unauthorized), authorization and CSRF rejections (403 Forbidden), resource missing states (404 Not Found), business logic conflicts & unique constraints (409 Conflict), and infrastructure outages (503 Service Unavailable).

---

## 2. Global Architecture & Envelope Standards

All responses conform to the Store Keeper unified response envelope specification, managed by `EnvelopeInterceptor` for successful calls and `AllExceptionsFilter` for exceptions.

### 2.1 Success Response Envelope

```json
{
  "success": true,
  "message": "OK",
  "data": { ... },
  "meta": {
    "requestId": "a8cc2ee5-138a-47d0-96e9-cd8d3d5b084b",
    "timestamp": "2026-11-09T06:34:43.800Z",
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 42,
      "totalPages": 3,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

- `message`: Contextual action status string (`"OK"` for GET, `"Created successfully"` for POST, `"Updated successfully"` for PATCH/PUT, `"Deleted successfully"` for DELETE).
- `data`: Typed resource payload, single object, array, or `null`.
- `meta.requestId`: Correlation ID propagated from the incoming `X-Request-Id` header (or UUID generated if missing).
- `meta.timestamp`: ISO 8601 server timestamp.
- `meta.pagination`: Hoisted automatically whenever paginated data is returned.

### 2.2 Error Response Envelope

```json
{
  "success": false,
  "message": "Human-readable summary of error",
  "errors": [
    {
      "code": "ERROR_CODE",
      "message": "Detailed error explanation",
      "field": "optionalFieldTarget"
    }
  ],
  "meta": {
    "requestId": "9328d1ee-8233-466a-80c6-18eac8fa958a",
    "timestamp": "2026-11-09T06:33:01.563Z"
  }
}
```

### 2.3 Standard Error Codes

| Error Code | HTTP Status | Description |
| :--- | :---: | :--- |
| `AUTH_REQUIRED` | 401 | Missing Bearer token in `Authorization` header |
| `AUTH_INVALID` | 401 | Expired token, signature verification failure, or deactivated account |
| `CSRF_MISSING` | 403 | State-mutating request (`POST`, `PATCH`, `DELETE`) without matching CSRF token |
| `CSRF_MISMATCH` | 403 | `X-CSRF-Token` header does not match `csrf_token` cookie |
| `FORBIDDEN` | 403 | User role does not satisfy `@RequireGlobalRole` or `@RequireBranchRole` |
| `VALIDATION_FAILED` | 400 | Request body or query parameters failed `class-validator` rules |
| `NOT_FOUND` | 404 | Target resource ID does not exist or has been soft-deleted |
| `DUPLICATE_CODE` / `DUPLICATE_ENTRY` | 409 | Unique constraint violation on branch code |
| `DUPLICATE_EMAIL` | 409 | User with specified email already exists in tenant |
| `BRANCH_HAS_STOCK` | 409 | Deletion blocked because branch has positive inventory stock (`qtyOnHand > 0`) |
| `SERVICE_UNAVAILABLE` | 503 | Database or Redis dependency unreachable |
| `RATE_LIMITED` | 429 | Rate limit exceeded on endpoint |
| `INTERNAL_ERROR` | 500 | Unhandled server exception |

### 2.4 Security & Guard Chain

For non-public endpoints, the request must traverse:
1. **`ThrottlerGuard`**: Tiered rate-limiting via Redis (`default`: 100/min, `auth`: 10/min, `read`: 300/min, `write`: 100/min).
2. **`CsrfGuard`**: Validates `X-CSRF-Token` header matches `csrf_token` cookie via `crypto.timingSafeEqual` for mutations (`POST`, `PATCH`, `PUT`, `DELETE`).
3. **`SupabaseJwtGuard`**: Extracts Bearer token, verifies RS256 signature via cached JWKS from Redis, and loads active user profile.
4. **`RolesGuard`**: Checks global user roles (`OWNER`, `ADMIN`).
5. **`BranchAccessGuard`**: Validates branch-level permissions (`MANAGER`, `CASHIER`, `VIEWER`).
6. **`TenantContextInterceptor`**: Injects `req.user.tenantId` into NodeJS `AsyncLocalStorage` (`tenantStore`).

---

## 3. Health & Readiness Endpoints (`/v1/health`)

### 3.1 `GET /v1/health` (Liveness Probe)
Verifies process liveness without checking external dependencies (DB/Redis). Marked `@Public()`.

#### Request
```http
GET /v1/health HTTP/1.1
Host: localhost:4000
```

#### Successful Return (200 OK)
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "status": "ok",
    "timestamp": "2026-11-09T06:34:43.800Z",
    "uptime": 0.315623208
  },
  "meta": {
    "requestId": "a8cc2ee5-138a-47d0-96e9-cd8d3d5b084b",
    "timestamp": "2026-11-09T06:34:43.800Z"
  }
}
```

---

### 3.2 `GET /v1/health/ready` (Readiness Probe)
Pings both PostgreSQL database (`SELECT 1`) and Redis (`PING`). Marked `@Public()`.

#### Request
```http
GET /v1/health/ready HTTP/1.1
Host: localhost:4000
```

#### Successful Return (200 OK — Both Dependencies Healthy)
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "status": "ready",
    "database": "up",
    "redis": "up",
    "timestamp": "2026-11-09T06:34:43.801Z"
  },
  "meta": {
    "requestId": "b11a91cf-e812-4eb2-b7b2-df82c7f41cf1",
    "timestamp": "2026-11-09T06:34:43.801Z"
  }
}
```

#### Error Return (503 Service Unavailable — Database Unreachable)
```json
{
  "success": false,
  "message": "Service dependencies are unavailable",
  "errors": [
    {
      "code": "SERVICE_UNAVAILABLE",
      "message": "Service dependencies are unavailable"
    }
  ],
  "meta": {
    "requestId": "fddc4242-23d0-4cfe-9a78-a35f4a1e7cf9",
    "timestamp": "2026-11-09T06:34:43.803Z"
  }
}
```

#### Error Return (503 Service Unavailable — Redis Unreachable)
```json
{
  "success": false,
  "message": "Service dependencies are unavailable",
  "errors": [
    {
      "code": "SERVICE_UNAVAILABLE",
      "message": "Service dependencies are unavailable"
    }
  ],
  "meta": {
    "requestId": "e72ad184-e439-4ce4-823a-f111f1811a43",
    "timestamp": "2026-11-09T06:34:43.804Z"
  }
}
```

---

## 4. Authentication Endpoints (`/v1/auth`)

### 4.1 `GET /v1/auth/me` (Get Current User Profile)
Returns the authenticated user's profile and branch permissions loaded from JWT + database (cached in Redis).

#### Request
```http
GET /v1/auth/me HTTP/1.1
Host: localhost:4000
Authorization: Bearer <valid_jwt_token>
```

#### Successful Return (200 OK)
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "userId": "user-admin-1",
    "tenantId": "tenant-alpha",
    "globalRole": "ADMIN",
    "branches": [
      {
        "branchId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "role": "MANAGER"
      }
    ]
  },
  "meta": {
    "requestId": "3b4f6e11-e6c1-4c63-b82b-8a7199c0b321",
    "timestamp": "2026-11-09T06:34:43.805Z"
  }
}
```

#### Error Return (401 Unauthorized — Missing Authorization Header)
```json
{
  "success": false,
  "message": "Authentication required",
  "errors": [
    {
      "code": "AUTH_REQUIRED",
      "message": "Authentication required"
    }
  ],
  "meta": {
    "requestId": "cc729f01-5743-41a4-94c3-6316fa713912",
    "timestamp": "2026-11-09T06:34:43.806Z"
  }
}
```

#### Error Return (401 Unauthorized — Invalid / Malformed Token)
```json
{
  "success": false,
  "message": "Invalid or expired token",
  "errors": [
    {
      "code": "AUTH_INVALID",
      "message": "Invalid or expired token"
    }
  ],
  "meta": {
    "requestId": "ee921f08-3012-4ea5-891a-7b3c2009aa81",
    "timestamp": "2026-11-09T06:34:43.806Z"
  }
}
```

#### Error Return (401 Unauthorized — Expired Token)
```json
{
  "success": false,
  "message": "Invalid or expired token",
  "errors": [
    {
      "code": "AUTH_INVALID",
      "message": "Invalid or expired token"
    }
  ],
  "meta": {
    "requestId": "488f2190-b1cb-42a1-949d-e47854aa5012",
    "timestamp": "2026-11-09T06:34:43.807Z"
  }
}
```

#### Error Return (401 Unauthorized — Deactivated Account)
```json
{
  "success": false,
  "message": "Account is deactivated",
  "errors": [
    {
      "code": "AUTH_INVALID",
      "message": "Account is deactivated"
    }
  ],
  "meta": {
    "requestId": "9812af11-b44c-4e81-8172-10827364ca90",
    "timestamp": "2026-11-09T06:34:43.807Z"
  }
}
```

#### Error Return (401 Unauthorized — User Not Found in Database)
```json
{
  "success": false,
  "message": "User not found",
  "errors": [
    {
      "code": "AUTH_INVALID",
      "message": "User not found"
    }
  ],
  "meta": {
    "requestId": "12984ea0-7a01-447a-9b43-ee882711ab45",
    "timestamp": "2026-11-09T06:34:43.807Z"
  }
}
```

---

## 5. Branches Management Endpoints (`/v1/branches`)

### 5.1 `GET /v1/branches` (List Accessible Branches)
Returns branches visible to the user:
- Users with global `OWNER` or `ADMIN` roles receive all active tenant branches.
- Users with branch-only roles (`CASHIER`, `MANAGER`, `VIEWER`) receive only assigned active branches.

#### Request (Global OWNER / ADMIN)
```http
GET /v1/branches HTTP/1.1
Host: localhost:4000
Authorization: Bearer <owner_or_admin_jwt>
```

#### Successful Return (200 OK — OWNER / ADMIN)
```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "name": "Downtown Main Branch",
      "code": "MAIN-DT",
      "address": "100 Main St",
      "phone": "+1-555-0100",
      "tenantId": "tenant-alpha",
      "isActive": true,
      "deletedAt": null
    },
    {
      "id": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      "name": "Uptown Branch",
      "code": "UPTOWN-01",
      "address": "200 Uptown Ave",
      "phone": "+1-555-0200",
      "tenantId": "tenant-alpha",
      "isActive": true,
      "deletedAt": null
    }
  ],
  "meta": {
    "requestId": "a0487123-cb89-4e78-ba67-e921d782163b",
    "timestamp": "2026-11-09T06:34:43.808Z"
  }
}
```

#### Successful Return (200 OK — CASHIER / Non-Admin)
Only returns the branch where the cashier has active assignment:
```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "name": "Downtown Main Branch",
      "code": "MAIN-DT",
      "address": "100 Main St",
      "phone": "+1-555-0100",
      "tenantId": "tenant-alpha",
      "isActive": true,
      "deletedAt": null
    }
  ],
  "meta": {
    "requestId": "54eecba1-19b8-4721-a398-d1082736152a",
    "timestamp": "2026-11-09T06:34:43.809Z"
  }
}
```

#### Error Return (401 Unauthorized — Unauthenticated)
```json
{
  "success": false,
  "message": "Authentication required",
  "errors": [
    {
      "code": "AUTH_REQUIRED",
      "message": "Authentication required"
    }
  ],
  "meta": {
    "requestId": "87e1a0b3-19cb-4ef1-9871-c01928371192",
    "timestamp": "2026-11-09T06:34:43.809Z"
  }
}
```

---

### 5.2 `POST /v1/branches` (Create Branch)
Creates a new branch. Requires:
- Global role: `OWNER` or `ADMIN`
- CSRF Double-Submit protection (`X-CSRF-Token` header matching `csrf_token` cookie)
- Branch code is normalized to uppercase automatically

#### Request
```http
POST /v1/branches HTTP/1.1
Host: localhost:4000
Authorization: Bearer <admin_jwt>
X-CSRF-Token: test-valid-csrf-token-abc123xyz789
Cookie: csrf_token=test-valid-csrf-token-abc123xyz789
Content-Type: application/json

{
  "name": "North Branch",
  "code": "NORTH-01",
  "address": "300 North Way",
  "phone": "+1-555-0300"
}
```

#### Successful Return (201 Created)
```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "id": "b3f07a12-8819-4a92-8871-c89102837411",
    "name": "North Branch",
    "code": "NORTH-01",
    "address": "300 North Way",
    "phone": "+1-555-0300",
    "isActive": true,
    "deletedAt": null
  },
  "meta": {
    "requestId": "ef912831-a871-4701-ba11-901827461823",
    "timestamp": "2026-11-09T06:34:43.810Z"
  }
}
```

#### Error Return (403 Forbidden — CSRF Token Missing)
```json
{
  "success": false,
  "message": "CSRF token missing",
  "errors": [
    {
      "code": "CSRF_MISSING",
      "message": "CSRF token missing"
    }
  ],
  "meta": {
    "requestId": "a0182736-b182-4918-a827-c10293847561",
    "timestamp": "2026-11-09T06:34:43.811Z"
  }
}
```

#### Error Return (403 Forbidden — CSRF Token Mismatch)
```json
{
  "success": false,
  "message": "CSRF token mismatch",
  "errors": [
    {
      "code": "CSRF_MISMATCH",
      "message": "CSRF token mismatch"
    }
  ],
  "meta": {
    "requestId": "10293847-5612-4819-a182-736451928374",
    "timestamp": "2026-11-09T06:34:43.811Z"
  }
}
```

#### Error Return (403 Forbidden — Insufficient Global Role)
Occurs when a user with `CASHIER` role attempts branch creation:
```json
{
  "success": false,
  "message": "Insufficient permissions",
  "errors": [
    {
      "code": "FORBIDDEN",
      "message": "Insufficient permissions"
    }
  ],
  "meta": {
    "requestId": "56124819-a182-7364-5192-837410293847",
    "timestamp": "2026-11-09T06:34:43.812Z"
  }
}
```

#### Error Return (400 Bad Request — Validation Failure)
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "code": "VALIDATION_FAILED",
      "message": "name should not be empty"
    },
    {
      "code": "VALIDATION_FAILED",
      "message": "code should not be empty"
    }
  ],
  "meta": {
    "requestId": "73645192-8374-1029-3847-56124819a182",
    "timestamp": "2026-11-09T06:34:43.813Z"
  }
}
```

#### Error Return (409 Conflict — Duplicate Branch Code)
```json
{
  "success": false,
  "message": "Duplicate value for: code",
  "errors": [
    {
      "field": "code",
      "code": "DUPLICATE_ENTRY",
      "message": "Value already exists"
    }
  ],
  "meta": {
    "requestId": "9328d1ee-8233-466a-80c6-18eac8fa958a",
    "timestamp": "2026-11-09T06:34:43.814Z"
  }
}
```

---

### 5.3 `GET /v1/branches/:id` (Get Branch by ID)
Retrieves a branch by its unique identifier.

#### Request
```http
GET /v1/branches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 HTTP/1.1
Host: localhost:4000
Authorization: Bearer <jwt_token>
```

#### Successful Return (200 OK)
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "name": "Downtown Main Branch",
    "code": "MAIN-DT",
    "address": "100 Main St",
    "phone": "+1-555-0100",
    "tenantId": "tenant-alpha",
    "isActive": true,
    "deletedAt": null
  },
  "meta": {
    "requestId": "83741029-3847-5612-4819-a18273645192",
    "timestamp": "2026-11-09T06:34:43.814Z"
  }
}
```

#### Error Return (404 Not Found — Branch Does Not Exist)
```json
{
  "success": false,
  "message": "Branch not found",
  "errors": [
    {
      "code": "NOT_FOUND",
      "message": "Branch not found"
    }
  ],
  "meta": {
    "requestId": "38475612-4819-a182-7364-519283741029",
    "timestamp": "2026-11-09T06:34:43.815Z"
  }
}
```

---

### 5.4 `PATCH /v1/branches/:id` (Update Branch)
Updates branch details. Requires `OWNER` or `ADMIN` role + CSRF token.

#### Request
```http
PATCH /v1/branches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 HTTP/1.1
Host: localhost:4000
Authorization: Bearer <admin_jwt>
X-CSRF-Token: test-valid-csrf-token-abc123xyz789
Cookie: csrf_token=test-valid-csrf-token-abc123xyz789
Content-Type: application/json

{
  "name": "Downtown Main Flagship Branch",
  "phone": "+1-555-9999"
}
```

#### Successful Return (200 OK)
```json
{
  "success": true,
  "message": "Updated successfully",
  "data": {
    "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "name": "Downtown Main Flagship Branch",
    "code": "MAIN-DT",
    "address": "100 Main St",
    "phone": "+1-555-9999",
    "tenantId": "tenant-alpha",
    "isActive": true,
    "deletedAt": null
  },
  "meta": {
    "requestId": "4819a182-7364-5192-8374-102938475612",
    "timestamp": "2026-11-09T06:34:43.816Z"
  }
}
```

#### Error Return (400 Bad Request — Non-Whitelisted Property)
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "code": "VALIDATION_FAILED",
      "message": "property illegalField should not exist"
    }
  ],
  "meta": {
    "requestId": "a1827364-5192-8374-1029-384756124819",
    "timestamp": "2026-11-09T06:34:43.816Z"
  }
}
```

#### Error Return (404 Not Found — Branch Does Not Exist)
```json
{
  "success": false,
  "message": "Branch not found",
  "errors": [
    {
      "code": "NOT_FOUND",
      "message": "Branch not found"
    }
  ],
  "meta": {
    "requestId": "51928374-1029-3847-5612-4819a1827364",
    "timestamp": "2026-11-09T06:34:43.817Z"
  }
}
```

---

### 5.5 `DELETE /v1/branches/:id` (Soft-Delete Branch)
Soft-deletes a branch. **Strict Business Invariants:**
1. Only the global **`OWNER`** can delete a branch (`ADMIN` is forbidden).
2. Deletion is **blocked with 409 Conflict** if any product has active stock on hand (`qtyOnHand > 0`).

#### Request (OWNER on Zero-Stock Branch)
```http
DELETE /v1/branches/b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22 HTTP/1.1
Host: localhost:4000
Authorization: Bearer <owner_jwt>
X-CSRF-Token: test-valid-csrf-token-abc123xyz789
Cookie: csrf_token=test-valid-csrf-token-abc123xyz789
```

#### Successful Return (200 OK — Soft-Deleted)
```json
{
  "success": true,
  "message": "Deleted successfully",
  "data": {
    "id": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
    "name": "Uptown Branch",
    "code": "UPTOWN-01",
    "isActive": false,
    "deletedAt": "2026-11-09T06:34:43.819Z"
  },
  "meta": {
    "requestId": "10293847-a182-7364-5192-837456124819",
    "timestamp": "2026-11-09T06:34:43.819Z"
  }
}
```

#### Error Return (409 Conflict — Blocked by Positive Stock on Hand)
```json
{
  "success": false,
  "message": "Cannot delete branch with active stock on hand",
  "errors": [
    {
      "code": "BRANCH_HAS_STOCK",
      "message": "Cannot delete branch with active stock on hand"
    }
  ],
  "meta": {
    "requestId": "73645192-1029-3847-5612-4819a1828374",
    "timestamp": "2026-11-09T06:34:43.818Z"
  }
}
```

#### Error Return (403 Forbidden — ADMIN Attempting Branch Delete)
```json
{
  "success": false,
  "message": "Insufficient permissions",
  "errors": [
    {
      "code": "FORBIDDEN",
      "message": "Insufficient permissions"
    }
  ],
  "meta": {
    "requestId": "83745612-4819-a182-7364-519210293847",
    "timestamp": "2026-11-09T06:34:43.818Z"
  }
}
```

---

## 6. User Management Endpoints (`/v1/users`)

All endpoints in this group require `@RequireGlobalRole('OWNER', 'ADMIN')` at the controller level.

### 6.1 `GET /v1/users` (List Tenant Users with Pagination)
Lists all tenant users with pagination metadata and branch assignment details.

#### Request
```http
GET /v1/users?page=1&limit=10 HTTP/1.1
Host: localhost:4000
Authorization: Bearer <admin_jwt>
```

#### Successful Return (200 OK)
```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "user-owner-1",
      "email": "owner@store.com",
      "fullName": "Store Owner",
      "tenantId": "tenant-alpha",
      "globalRole": "OWNER",
      "isActive": true,
      "deletedAt": null,
      "branchAccess": [
        {
          "branchId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          "role": "MANAGER",
          "branch": {
            "name": "Downtown Main Branch",
            "code": "MAIN-DT"
          }
        }
      ]
    },
    {
      "id": "user-admin-1",
      "email": "admin@store.com",
      "fullName": "Store Admin",
      "tenantId": "tenant-alpha",
      "globalRole": "ADMIN",
      "isActive": true,
      "deletedAt": null,
      "branchAccess": [
        {
          "branchId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          "role": "MANAGER",
          "branch": {
            "name": "Downtown Main Branch",
            "code": "MAIN-DT"
          }
        }
      ]
    }
  ],
  "meta": {
    "requestId": "48197364-5192-8374-1029-3847a1825612",
    "timestamp": "2026-11-09T06:34:43.820Z",
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 3,
      "totalPages": 1,
      "hasNext": false,
      "hasPrev": false
    }
  }
}
```

#### Error Return (403 Forbidden — Non-Admin Access)
```json
{
  "success": false,
  "message": "Insufficient permissions",
  "errors": [
    {
      "code": "FORBIDDEN",
      "message": "Insufficient permissions"
    }
  ],
  "meta": {
    "requestId": "51924819-7364-8374-1029-3847a1825612",
    "timestamp": "2026-11-09T06:34:43.821Z"
  }
}
```

#### Error Return (400 Bad Request — Invalid Pagination Query)
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "code": "VALIDATION_FAILED",
      "message": "page must not be less than 1"
    },
    {
      "code": "VALIDATION_FAILED",
      "message": "limit must not be greater than 100"
    }
  ],
  "meta": {
    "requestId": "3847a182-5612-4819-7364-519283741029",
    "timestamp": "2026-11-09T06:34:43.821Z"
  }
}
```

---

### 6.2 `POST /v1/users/invite` (Invite User to Tenant)
Creates a new tenant user and optionally assigns branch roles within an atomic transaction.

#### Request
```http
POST /v1/users/invite HTTP/1.1
Host: localhost:4000
Authorization: Bearer <admin_jwt>
X-CSRF-Token: test-valid-csrf-token-abc123xyz789
Cookie: csrf_token=test-valid-csrf-token-abc123xyz789
Content-Type: application/json

{
  "email": "newmanager@store.com",
  "fullName": "New Branch Manager",
  "globalRole": "ADMIN",
  "branches": [
    {
      "branchId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "role": "MANAGER"
    }
  ]
}
```

#### Successful Return (201 Created)
```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "id": "e0a12938-4756-4192-8374-b18273645192",
    "email": "newmanager@store.com",
    "fullName": "New Branch Manager",
    "globalRole": "ADMIN",
    "isActive": true,
    "branchAccess": [
      {
        "id": "uba-1794205843823",
        "branchId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "role": "MANAGER",
        "branch": {
          "name": "Downtown Main Branch",
          "code": "MAIN-DT"
        }
      }
    ]
  },
  "meta": {
    "requestId": "aa60ae4f-ca34-40bc-8a79-6d54764d5e51",
    "timestamp": "2026-11-09T06:34:43.823Z"
  }
}
```

#### Error Return (409 Conflict — Duplicate Email)
```json
{
  "success": false,
  "message": "A user with this email already exists in this tenant",
  "errors": [
    {
      "code": "DUPLICATE_EMAIL",
      "message": "A user with this email already exists in this tenant"
    }
  ],
  "meta": {
    "requestId": "a1825612-4819-7364-5192-837410293847",
    "timestamp": "2026-11-09T06:34:43.824Z"
  }
}
```

#### Error Return (400 Bad Request — Invalid Email Format)
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "code": "VALIDATION_FAILED",
      "message": "email must be an email"
    }
  ],
  "meta": {
    "requestId": "56124819-7364-5192-8374-10293847a182",
    "timestamp": "2026-11-09T06:34:43.824Z"
  }
}
```

---

### 6.3 `PATCH /v1/users/:id` (Update User Profile/Roles)
Updates user fields (`fullName`, `globalRole`, `isActive`) and automatically invalidates the Redis cached profile `sk:user:profile:${id}`.

#### Request
```http
PATCH /v1/users/user-cashier-1 HTTP/1.1
Host: localhost:4000
Authorization: Bearer <admin_jwt>
X-CSRF-Token: test-valid-csrf-token-abc123xyz789
Cookie: csrf_token=test-valid-csrf-token-abc123xyz789
Content-Type: application/json

{
  "fullName": "Senior Store Cashier",
  "isActive": true
}
```

#### Successful Return (200 OK)
```json
{
  "success": true,
  "message": "Updated successfully",
  "data": {
    "id": "user-cashier-1",
    "email": "cashier@store.com",
    "fullName": "Senior Store Cashier",
    "globalRole": null,
    "isActive": true,
    "deletedAt": null
  },
  "meta": {
    "requestId": "73645192-8374-1029-3847-a18256124819",
    "timestamp": "2026-11-09T06:34:43.825Z"
  }
}
```

#### Error Return (404 Not Found — User Does Not Exist)
```json
{
  "success": false,
  "message": "User not found",
  "errors": [
    {
      "code": "NOT_FOUND",
      "message": "User not found"
    }
  ],
  "meta": {
    "requestId": "83741029-3847-a182-5612-481973645192",
    "timestamp": "2026-11-09T06:34:43.825Z"
  }
}
```

---

### 6.4 `DELETE /v1/users/:id` (Deactivate / Soft-Delete User)
Soft-deletes user (`deletedAt: now()`, `isActive: false`) and evicts their Redis profile cache.

#### Request
```http
DELETE /v1/users/user-cashier-1 HTTP/1.1
Host: localhost:4000
Authorization: Bearer <admin_jwt>
X-CSRF-Token: test-valid-csrf-token-abc123xyz789
Cookie: csrf_token=test-valid-csrf-token-abc123xyz789
```

#### Successful Return (200 OK)
```json
{
  "success": true,
  "message": "Deleted successfully",
  "data": {
    "id": "user-cashier-1",
    "email": "cashier@store.com",
    "fullName": "Senior Store Cashier",
    "isActive": false,
    "deletedAt": "2026-11-09T06:34:43.826Z"
  },
  "meta": {
    "requestId": "10293847-a182-5612-4819-736451928374",
    "timestamp": "2026-11-09T06:34:43.826Z"
  }
}
```

#### Error Return (404 Not Found — User Does Not Exist)
```json
{
  "success": false,
  "message": "User not found",
  "errors": [
    {
      "code": "NOT_FOUND",
      "message": "User not found"
    }
  ],
  "meta": {
    "requestId": "3847a182-5612-4819-7364-519283741029",
    "timestamp": "2026-11-09T06:34:43.826Z"
  }
}
```

---

### 6.5 `POST /v1/users/:id/branches` (Assign Branch Access)
Assigns or upserts branch access role (`MANAGER`, `CASHIER`, `VIEWER`) to a user. Invalidates target user's cached profile.

#### Request
```http
POST /v1/users/user-admin-1/branches HTTP/1.1
Host: localhost:4000
Authorization: Bearer <admin_jwt>
X-CSRF-Token: test-valid-csrf-token-abc123xyz789
Cookie: csrf_token=test-valid-csrf-token-abc123xyz789
Content-Type: application/json

{
  "branchId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  "role": "MANAGER"
}
```

#### Successful Return (201 Created)
```json
{
  "success": true,
  "message": "Created successfully",
  "data": {
    "id": "uba-1794205843827",
    "userId": "user-admin-1",
    "branchId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "role": "MANAGER"
  },
  "meta": {
    "requestId": "cb0c8c7b-2dd8-4f63-8464-f102545fc4b1",
    "timestamp": "2026-11-09T06:34:43.827Z"
  }
}
```

#### Error Return (404 Not Found — Branch Not Found)
```json
{
  "success": false,
  "message": "Branch not found",
  "errors": [
    {
      "code": "NOT_FOUND",
      "message": "Branch not found"
    }
  ],
  "meta": {
    "requestId": "b7568298-82f2-414a-b576-e39125fbc978",
    "timestamp": "2026-11-09T06:34:43.827Z"
  }
}
```

#### Error Return (400 Bad Request — Invalid Role Enum)
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "code": "VALIDATION_FAILED",
      "message": "role must be one of the following values: MANAGER, CASHIER, VIEWER"
    }
  ],
  "meta": {
    "requestId": "48197364-5192-8374-1029-3847a1825612",
    "timestamp": "2026-11-09T06:34:43.828Z"
  }
}
```

---

### 6.6 `PATCH /v1/users/:id/branches/:branchId` (Update Branch Role)
Updates the role on an existing branch access assignment.

#### Request
```http
PATCH /v1/users/user-admin-1/branches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 HTTP/1.1
Host: localhost:4000
Authorization: Bearer <admin_jwt>
X-CSRF-Token: test-valid-csrf-token-abc123xyz789
Cookie: csrf_token=test-valid-csrf-token-abc123xyz789
Content-Type: application/json

{
  "role": "VIEWER"
}
```

#### Successful Return (200 OK)
```json
{
  "success": true,
  "message": "Updated successfully",
  "data": {
    "id": "uba-1794205843827",
    "userId": "user-admin-1",
    "branchId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "role": "VIEWER"
  },
  "meta": {
    "requestId": "e6aed6a2-51d7-4996-af3d-23909f6a1c3b",
    "timestamp": "2026-11-09T06:34:43.828Z"
  }
}
```

#### Error Return (404 Not Found — User Lacks Access to Branch)
```json
{
  "success": false,
  "message": "User does not have access to this branch",
  "errors": [
    {
      "code": "NOT_FOUND",
      "message": "User does not have access to this branch"
    }
  ],
  "meta": {
    "requestId": "51928374-1029-3847-a182-561248197364",
    "timestamp": "2026-11-09T06:34:43.829Z"
  }
}
```

---

### 6.7 `DELETE /v1/users/:id/branches/:branchId` (Remove Branch Access)
Removes user access from a branch and invalidates the cached profile.

#### Request
```http
DELETE /v1/users/user-admin-1/branches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 HTTP/1.1
Host: localhost:4000
Authorization: Bearer <admin_jwt>
X-CSRF-Token: test-valid-csrf-token-abc123xyz789
Cookie: csrf_token=test-valid-csrf-token-abc123xyz789
```

#### Successful Return (200 OK)
```json
{
  "success": true,
  "message": "Deleted successfully",
  "data": {
    "success": true
  },
  "meta": {
    "requestId": "83741029-3847-a182-5612-481973645192",
    "timestamp": "2026-11-09T06:34:43.829Z"
  }
}
```

#### Error Return (404 Not Found — Target User Not Found)
```json
{
  "success": false,
  "message": "User not found",
  "errors": [
    {
      "code": "NOT_FOUND",
      "message": "User not found"
    }
  ],
  "meta": {
    "requestId": "10293847-a182-5612-4819-736451928374",
    "timestamp": "2026-11-09T06:34:43.830Z"
  }
}
```

---

## 7. Running the Test Suite with Bun

The full automated suite exercises all 45 test cases end-to-end through the NestJS / Express HTTP application lifecycle using **Bun**:

```bash
# Run the complete test suite with bun
bun /Users/macminim4/.gemini/antigravity/brain/69887880-5fe5-48cb-98db-ea3b37318409/scratch/run-all-tests.ts
```

### Test Suite Execution Output
```text
🚀 Starting Complete API In-Memory Test Suite with Bun...

✅ [200] Health > GET /v1/health — Liveness probe (no dependencies)
✅ [200] Health > GET /v1/health/ready — Readiness probe healthy (DB + Redis up)
✅ [503] Health > GET /v1/health/ready — Readiness probe failing (Database down)
✅ [503] Health > GET /v1/health/ready — Readiness probe failing (Redis down)
✅ [200] Auth > GET /v1/auth/me — Success with valid JWT token
✅ [401] Auth > GET /v1/auth/me — Error 401 when Authorization header is missing
✅ [401] Auth > GET /v1/auth/me — Error 401 with malformed token
✅ [401] Auth > GET /v1/auth/me — Error 401 with expired JWT token
✅ [401] Auth > GET /v1/auth/me — Error 401 for deactivated user
✅ [401] Auth > GET /v1/auth/me — Error 401 for non-existent user in DB
✅ [200] Branches > GET /v1/branches — Success (OWNER sees all tenant branches)
✅ [200] Branches > GET /v1/branches — Success (CASHIER sees only assigned active branches)
✅ [401] Branches > GET /v1/branches — Error 401 unauthenticated
✅ [201] Branches > POST /v1/branches — Success create new branch (ADMIN + CSRF)
✅ [403] Branches > POST /v1/branches — Error 403 when CSRF token is missing on mutation
✅ [403] Branches > POST /v1/branches — Error 403 when CSRF token mismatches cookie
✅ [403] Branches > POST /v1/branches — Error 403 when user lacks OWNER/ADMIN role
✅ [400] Branches > POST /v1/branches — Error 400 Validation failure (empty name, missing code)
✅ [409] Branches > POST /v1/branches — Error 409 Conflict on duplicate branch code
✅ [200] Branches > GET /v1/branches/:id — Success get branch details by ID
✅ [404] Branches > GET /v1/branches/:id — Error 404 when branch not found
✅ [200] Branches > PATCH /v1/branches/:id — Success update branch (ADMIN + CSRF)
✅ [400] Branches > PATCH /v1/branches/:id — Error 400 with non-whitelisted properties
✅ [404] Branches > PATCH /v1/branches/:id — Error 404 when updating non-existent branch
✅ [409] Branches > DELETE /v1/branches/:id — Error 409 Conflict if branch has active stock on hand
✅ [403] Branches > DELETE /v1/branches/:id — Error 403 when ADMIN tries to delete (OWNER required)
✅ [200] Branches > DELETE /v1/branches/:id — Success soft-delete branch with 0 stock (OWNER)
✅ [404] Branches > DELETE /v1/branches/:id — Error 404 when deleting non-existent branch
✅ [200] Users > GET /v1/users — Success list tenant users with pagination (ADMIN)
✅ [403] Users > GET /v1/users — Error 403 when non-admin accesses user management
✅ [400] Users > GET /v1/users — Error 400 for invalid pagination parameters (page=0)
✅ [201] Users > POST /v1/users/invite — Success invite new user with branch access (ADMIN + CSRF)
✅ [409] Users > POST /v1/users/invite — Error 409 Conflict on duplicate email
✅ [400] Users > POST /v1/users/invite — Error 400 Validation failure on invalid email
✅ [200] Users > PATCH /v1/users/:id — Success update user profile (ADMIN + CSRF)
✅ [404] Users > PATCH /v1/users/:id — Error 404 when updating non-existent user
✅ [200] Users > DELETE /v1/users/:id — Success soft-delete / deactivate user (ADMIN + CSRF)
✅ [404] Users > DELETE /v1/users/:id — Error 404 when deleting non-existent user
✅ [201] Users > POST /v1/users/:id/branches — Success assign branch access (ADMIN + CSRF)
✅ [404] Users > POST /v1/users/:id/branches — Error 404 when branch not found
✅ [400] Users > POST /v1/users/:id/branches — Error 400 Validation failure on invalid role
✅ [200] Users > PATCH /v1/users/:id/branches/:branchId — Success update branch role (ADMIN + CSRF)
✅ [404] Users > PATCH /v1/users/:id/branches/:branchId — Error 404 when access record not found
✅ [200] Users > DELETE /v1/users/:id/branches/:branchId — Success remove branch access (ADMIN + CSRF)
✅ [404] Users > DELETE /v1/users/:id/branches/:branchId — Error 404 when user not found

─────────────────────────────────────────────────────────────
📊 Test Summary: 45 PASSED, 0 FAILED out of 45 total tests
─────────────────────────────────────────────────────────────
```

