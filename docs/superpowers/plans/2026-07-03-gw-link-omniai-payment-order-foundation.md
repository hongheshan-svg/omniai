# Payment Order Foundation Implementation Plan (Payment sub-slice A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the order + credit-package contract: a package catalog, an order service/repository, and create/list order routes — with no crediting, no webhook, no real payment HTTP.

**Architecture:** Mirror the existing catalog (`ConfigModelCatalog`), repository seam (memory + Drizzle + cross-backend contract test), and service+route patterns. Orders are owned by `owner_user_id` (app-layer isolation, like generations/assets). Prices are integer `amountCents`. A generated opaque `checkoutRef` is carried for later webhook correlation (sub-slice B).

**Tech Stack:** Fastify, Drizzle ORM + postgres/pglite, vitest, TypeScript strict, `@gw-link-omniai/shared` contracts.

## Global Constraints

- Contracts live in `packages/shared/src/orders.ts`, re-exported from `index.ts`: `CreditPackage { id, displayName, credits, amountCents, currency }`, `OrderStatus = "pending" | "paid" | "failed"`, `Order { id, packageId, credits, amountCents, currency, status, checkoutRef, createdAt }`, `CreateOrderRequest { packageId }`.
- Prices are integer `amountCents`; `currency` is an ISO code (config uses `"CNY"`).
- `Order` is the product shape — it MUST NOT include `owner_user_id`.
- Package config path: `ApiConfig.packagesConfigPath` (env `GW_LINK_PACKAGES_CONFIG_PATH`, default `config/credit-packages.json`).
- Errors: unknown packageId → 404; unauthenticated `/v1/orders` → 401 `{ error: "Authentication required" }`; invalid POST body → 400 `{ error: "Invalid order request" }`. `/v1/packages` is public.
- Order created with `status: "pending"`; NO credit is granted in this slice; there is NO webhook and NO real payment HTTP.
- Services clone what they return/store (defensive cloning); time/ids come from injected `clock`/generators.
- Each task green before commit.

---

## Task 1: shared order + package contracts

**Files:**
- Create: `packages/shared/src/orders.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/orders.test.ts`

**Interfaces:**
- Produces: `CreditPackage`, `OrderStatus`, `Order`, `CreateOrderRequest` (types); a type-guard `isCreateOrderRequest(value: unknown): value is CreateOrderRequest`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/orders.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isCreateOrderRequest } from "../orders";

describe("isCreateOrderRequest", () => {
  it("accepts a valid request", () => {
    expect(isCreateOrderRequest({ packageId: "credits-100" })).toBe(true);
  });
  it("rejects invalid shapes", () => {
    expect(isCreateOrderRequest({})).toBe(false);
    expect(isCreateOrderRequest({ packageId: 5 })).toBe(false);
    expect(isCreateOrderRequest(null)).toBe(false);
    expect(isCreateOrderRequest("x")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/shared exec vitest run src/__tests__/orders.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement orders.ts**

Create `packages/shared/src/orders.ts`:

```typescript
export interface CreditPackage {
  id: string;
  displayName: string;
  credits: number;
  amountCents: number;
  currency: string;
}

export type OrderStatus = "pending" | "paid" | "failed";

export interface Order {
  id: string;
  packageId: string;
  credits: number;
  amountCents: number;
  currency: string;
  status: OrderStatus;
  checkoutRef: string;
  createdAt: string;
}

export interface CreateOrderRequest {
  packageId: string;
}

export function isCreateOrderRequest(value: unknown): value is CreateOrderRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { packageId?: unknown }).packageId === "string"
  );
}
```

- [ ] **Step 4: Export from index.ts**

In `packages/shared/src/index.ts`, add:

```typescript
export type { CreditPackage, Order, OrderStatus, CreateOrderRequest } from "./orders.js";
export { isCreateOrderRequest } from "./orders.js";
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @gw-link-omniai/shared exec vitest run src/__tests__/orders.test.ts`
Expected: PASS.

Run: `pnpm --filter @gw-link-omniai/shared typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/orders.ts packages/shared/src/index.ts packages/shared/src/__tests__/orders.test.ts
git commit -m "feat(shared): add order and credit-package contracts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: package catalog + config + GET /v1/packages

**Files:**
- Create: `config/credit-packages.json`
- Create: `apps/api/src/services/packageCatalog.ts`
- Create: `apps/api/src/routes/orders.ts` (packages route now; order routes added in Task 5)
- Modify: `apps/api/src/config.ts` (add `packagesConfigPath`)
- Modify: `apps/api/src/server.ts` (register packages route, public)
- Test: `apps/api/src/services/__tests__/packageCatalog.test.ts`
- Test: `apps/api/src/__tests__/config.test.ts` (packagesConfigPath), and every `ApiConfig` literal in tests gains `packagesConfigPath`

**Interfaces:**
- Consumes: `CreditPackage` (Task 1).
- Produces: `PackageCatalog { listPackages(): CreditPackage[]; getPackage(id: string): CreditPackage }`, `ConfigPackageCatalog`, `PackageCatalogError` (has `statusCode`), `loadPackageCatalogConfig(path: string): { packages: CreditPackage[] }`, `registerPackageRoutes(server, packageCatalog)`.

- [ ] **Step 1: Create the config file**

Create `config/credit-packages.json`:

```json
{
  "packages": [
    { "id": "credits-100", "displayName": "100 积分", "credits": 100, "amountCents": 990, "currency": "CNY" },
    { "id": "credits-500", "displayName": "500 积分", "credits": 500, "amountCents": 4500, "currency": "CNY" },
    { "id": "credits-1200", "displayName": "1200 积分", "credits": 1200, "amountCents": 9900, "currency": "CNY" }
  ]
}
```

- [ ] **Step 2: Write the failing catalog test**

Create `apps/api/src/services/__tests__/packageCatalog.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ConfigPackageCatalog, PackageCatalogError } from "../packageCatalog";

const config = {
  packages: [
    { id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" },
    { id: "credits-500", displayName: "500 积分", credits: 500, amountCents: 4500, currency: "CNY" }
  ]
};

describe("ConfigPackageCatalog", () => {
  it("lists all packages", () => {
    const catalog = new ConfigPackageCatalog(config);
    expect(catalog.listPackages().map((p) => p.id)).toEqual(["credits-100", "credits-500"]);
  });
  it("gets a package by id", () => {
    const catalog = new ConfigPackageCatalog(config);
    expect(catalog.getPackage("credits-500").credits).toBe(500);
  });
  it("throws a 404 catalog error for an unknown id", () => {
    const catalog = new ConfigPackageCatalog(config);
    expect(() => catalog.getPackage("nope")).toThrowError(PackageCatalogError);
    try {
      catalog.getPackage("nope");
    } catch (error) {
      expect((error as PackageCatalogError).statusCode).toBe(404);
    }
  });
  it("returns copies so callers cannot mutate catalog state", () => {
    const catalog = new ConfigPackageCatalog(config);
    catalog.listPackages()[0].credits = 1;
    expect(catalog.getPackage("credits-100").credits).toBe(100);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/packageCatalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement packageCatalog.ts**

Create `apps/api/src/services/packageCatalog.ts`:

```typescript
import { readFileSync } from "node:fs";
import type { CreditPackage } from "@gw-link-omniai/shared";

export interface PackageCatalogConfig {
  packages: CreditPackage[];
}

export class PackageCatalogError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "PackageCatalogError";
  }
}

export interface PackageCatalog {
  listPackages(): CreditPackage[];
  getPackage(id: string): CreditPackage;
}

function clonePackage(pkg: CreditPackage): CreditPackage {
  return { ...pkg };
}

export class ConfigPackageCatalog implements PackageCatalog {
  private readonly packages: CreditPackage[];

  constructor(config: PackageCatalogConfig) {
    this.packages = config.packages.map(clonePackage);
  }

  listPackages(): CreditPackage[] {
    return this.packages.map(clonePackage);
  }

  getPackage(id: string): CreditPackage {
    const found = this.packages.find((pkg) => pkg.id === id);
    if (!found) {
      throw new PackageCatalogError(`Unknown package: ${id}`, 404);
    }
    return clonePackage(found);
  }
}

export function loadPackageCatalogConfig(path: string): PackageCatalogConfig {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as PackageCatalogConfig;
  return parsed;
}
```

- [ ] **Step 5: Add packagesConfigPath to config.ts**

In `apps/api/src/config.ts`: add `packagesConfigPath: string;` to the `ApiConfig` interface (after `modelConfigPath`), and in the returned object of `loadConfig` add:

```typescript
    packagesConfigPath: env.GW_LINK_PACKAGES_CONFIG_PATH ?? "config/credit-packages.json",
```

- [ ] **Step 6: Update config test + all ApiConfig literals in tests**

In `apps/api/src/__tests__/config.test.ts`, update the `toEqual` assertions to include `packagesConfigPath: "config/credit-packages.json"` (and add a test for the env override `GW_LINK_PACKAGES_CONFIG_PATH`). Then add `packagesConfigPath: "config/credit-packages.json"` to EVERY `ApiConfig` object literal in the test suite. Find them all:

Run: `grep -rln "modelConfigPath:" apps/api/src`
For each test file that builds an `ApiConfig` literal (e.g. `services/__tests__/appServices.test.ts`, `__tests__/dbPersistence.test.ts`, `__tests__/server.test.ts`, `routes/__tests__/assets.test.ts`, `routes/__tests__/generations.test.ts`), add the `packagesConfigPath` field. (This mirrors how `devTopupEnabled` was threaded through in Slice 12.)

- [ ] **Step 7: Implement the packages route**

Create `apps/api/src/routes/orders.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { PackageCatalog } from "../services/packageCatalog";

export function registerPackageRoutes(server: FastifyInstance, packageCatalog: PackageCatalog): void {
  server.get("/v1/packages", async () => ({
    packages: packageCatalog.listPackages()
  }));
}
```

- [ ] **Step 8: Wire the catalog + packages route into buildServer**

In `apps/api/src/server.ts`: construct a `ConfigPackageCatalog` from `loadPackageCatalogConfig(resolveConfigPath(config.packagesConfigPath))` (mirror how the model catalog is built; if a `packageCatalog` option is not injected, build the default), accept `packageCatalog` as an optional `buildServer` option, and call `registerPackageRoutes(server, packageCatalog)`. `/v1/packages` needs no auth guard (public, like `/v1/models`).

Note: check `apps/api/src/services/modelConfig.ts` for `resolveConfigPath`; reuse it to resolve the packages path relative to the same base.

- [ ] **Step 9: Write a packages route test**

Add to a new `apps/api/src/routes/__tests__/orders.test.ts` (the order-route tests come in Task 5; start the file here):

```typescript
import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import { ConfigPackageCatalog } from "../../services/packageCatalog";

const packageCatalog = new ConfigPackageCatalog({
  packages: [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }]
});

describe("GET /v1/packages", () => {
  it("returns the public package catalog without auth", async () => {
    const server = buildServer({ packageCatalog });
    const response = await server.inject({ method: "GET", url: "/v1/packages" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      packages: [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }]
    });
  });
});
```

- [ ] **Step 10: Run tests + typecheck + commit**

Run: `pnpm --filter @gw-link-omniai/api test`
Expected: packageCatalog + packages-route + config tests pass; existing tests still green.

Run: `pnpm --filter @gw-link-omniai/api typecheck`
Expected: no errors.

```bash
git add config/credit-packages.json apps/api/src/services/packageCatalog.ts apps/api/src/routes/orders.ts apps/api/src/config.ts apps/api/src/server.ts apps/api/src/services/__tests__/packageCatalog.test.ts apps/api/src/routes/__tests__/orders.test.ts apps/api/src/__tests__/config.test.ts apps/api/src/services/__tests__/appServices.test.ts apps/api/src/__tests__/dbPersistence.test.ts apps/api/src/__tests__/server.test.ts apps/api/src/routes/__tests__/assets.test.ts apps/api/src/routes/__tests__/generations.test.ts
git commit -m "feat(api): add credit-package catalog + GET /v1/packages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: OrderRepository (memory + Drizzle + migration + contract test)

**Files:**
- Modify: `apps/api/src/repositories/types.ts` (`OrderRecord`, `OrderRepository`)
- Modify: `apps/api/src/repositories/memory.ts` (`InMemoryOrderRepository`)
- Modify: `apps/api/src/repositories/drizzle.ts` (`DrizzleOrderRepository`)
- Modify: `apps/api/src/db/schema.ts` (`orders` table)
- Create: migration SQL via `pnpm --filter @gw-link-omniai/api db:generate`
- Modify: `apps/api/src/repositories/__tests__/repositoryContract.test.ts` (order cases)

**Interfaces:**
- Consumes: `OrderStatus` (Task 1).
- Produces: `OrderRecord { id, packageId, credits, amountCents, currency, status, checkoutRef, createdAt }`; `OrderRepository { insert(record, ownerUserId), listByOwner(ownerUserId), get(ownerUserId, id) }`.

- [ ] **Step 1: Add the contract-test cases (failing)**

In `apps/api/src/repositories/__tests__/repositoryContract.test.ts`, add order cases to the existing cross-backend suite (it already parametrizes over memory + pglite factories — follow the file's existing structure). The cases:

```typescript
  it("inserts and lists orders by owner only", async () => {
    const repo = makeOrderRepository(); // per the file's factory pattern for the current backend
    const record = {
      id: "order_1",
      packageId: "credits-100",
      credits: 100,
      amountCents: 990,
      currency: "CNY",
      status: "pending" as const,
      checkoutRef: "checkout_1",
      createdAt: "2026-07-03T00:00:00.000Z"
    };
    await repo.insert(record, "user-a");
    await repo.insert({ ...record, id: "order_2", checkoutRef: "checkout_2" }, "user-b");
    const listA = await repo.listByOwner("user-a");
    expect(listA.map((o) => o.id)).toEqual(["order_1"]);
    expect(await repo.get("user-a", "order_1")).toMatchObject({ id: "order_1", status: "pending" });
    expect(await repo.get("user-a", "order_2")).toBeNull();
  });
```

Match the file's actual harness (how it builds each backend's repositories and iterates; add an order-repository factory alongside the existing ones). Read the current file first and follow its exact structure — do not invent a new harness.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts`
Expected: FAIL — order repository / methods missing.

- [ ] **Step 3: Add the repository interface**

In `apps/api/src/repositories/types.ts`, add (import `OrderStatus` from `@gw-link-omniai/shared`):

```typescript
export interface OrderRecord {
  id: string;
  packageId: string;
  credits: number;
  amountCents: number;
  currency: string;
  status: OrderStatus;
  checkoutRef: string;
  createdAt: string;
}

export interface OrderRepository {
  insert(record: OrderRecord, ownerUserId: string): Promise<void> | void;
  listByOwner(ownerUserId: string): Promise<OrderRecord[]> | OrderRecord[];
  get(ownerUserId: string, id: string): Promise<OrderRecord | null> | OrderRecord | null;
}
```

- [ ] **Step 4: Add InMemoryOrderRepository**

In `apps/api/src/repositories/memory.ts`, add (mirror `InMemoryAssetRepository` / how existing in-memory repos clone at the storage boundary with `structuredClone` and filter by owner):

```typescript
export class InMemoryOrderRepository implements OrderRepository {
  private readonly rows: Array<{ ownerUserId: string; record: OrderRecord }> = [];

  insert(record: OrderRecord, ownerUserId: string): void {
    this.rows.push({ ownerUserId, record: structuredClone(record) });
  }

  listByOwner(ownerUserId: string): OrderRecord[] {
    return this.rows
      .filter((row) => row.ownerUserId === ownerUserId)
      .map((row) => structuredClone(row.record));
  }

  get(ownerUserId: string, id: string): OrderRecord | null {
    const row = this.rows.find((r) => r.ownerUserId === ownerUserId && r.record.id === id);
    return row ? structuredClone(row.record) : null;
  }
}
```

- [ ] **Step 5: Add the orders table to schema.ts**

In `apps/api/src/db/schema.ts`, add an `orders` pgTable mirroring the `creditTransactions` / `assets` tables (same imports: `pgTable`, `text`, `integer`, `timestamp`, foreign key to `users.id` with `onDelete: "cascade"`). Columns: `id` (text, primary key), `ownerUserId` (text, FK → users.id cascade, not null), `packageId` (text, not null), `credits` (integer, not null), `amountCents` (integer, not null), `currency` (text, not null), `status` (text, not null), `checkoutRef` (text, not null), `createdAt` (timestamp/text per the convention used by `creditTransactions.createdAt`). Match the exact column-helper style already in the file.

- [ ] **Step 6: Add DrizzleOrderRepository**

In `apps/api/src/repositories/drizzle.ts`, add `DrizzleOrderRepository` mirroring `DrizzleCreditTransactionRepository` (constructor takes `db`; `insert` maps `OrderRecord` + ownerUserId to the `orders` row; `listByOwner` selects where `ownerUserId` equals and maps rows back to `OrderRecord`; `get` selects by owner + id, returns null if none). Map `createdAt` the same way the existing repos map their timestamp column.

- [ ] **Step 7: Generate the migration**

Run: `pnpm --filter @gw-link-omniai/api db:generate`
Expected: a new SQL migration file under the api package's drizzle migrations dir creating the `orders` table. Commit it as generated (do not hand-edit).

- [ ] **Step 8: Run the contract test + typecheck**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts`
Expected: PASS on both memory and pglite backends.

Run: `pnpm --filter @gw-link-omniai/api typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/repositories apps/api/src/db
git commit -m "feat(api): add OrderRepository (memory + Drizzle + migration)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: OrderService + wiring

**Files:**
- Create: `apps/api/src/services/orderService.ts`
- Modify: `apps/api/src/services/appServices.ts` (add `orderService` + `packageCatalog` to `AppServices` + `createDbServices` + `createServices`)
- Modify: `apps/api/src/server.ts` (default `orderService`, pass into order routes in Task 5)
- Test: `apps/api/src/services/__tests__/orderService.test.ts`

**Interfaces:**
- Consumes: `PackageCatalog` (Task 2), `OrderRepository`/`InMemoryOrderRepository` (Task 3), `Order`/`CreditPackage` (Task 1).
- Produces: `OrderService { createOrder(userId, packageId): Promise<Order>; listOrders(userId): Promise<Order[]> }`, `OrderServiceImpl`, `InMemoryOrderService`, `OrderServiceError` (has `statusCode`).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/__tests__/orderService.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ConfigPackageCatalog } from "../packageCatalog";
import { InMemoryOrderRepository } from "../../repositories/memory";
import { OrderServiceImpl, OrderServiceError } from "../orderService";

function makeService() {
  const catalog = new ConfigPackageCatalog({
    packages: [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }]
  });
  let seq = 0;
  return new OrderServiceImpl(new InMemoryOrderRepository(), catalog, {
    idGenerator: () => `order_${++seq}`,
    checkoutRefGenerator: () => `checkout_${seq}`,
    clock: { now: () => new Date("2026-07-03T00:00:00.000Z") }
  });
}

describe("OrderServiceImpl", () => {
  it("creates a pending order from a package", async () => {
    const order = await makeService().createOrder("user-a", "credits-100");
    expect(order).toEqual({
      id: "order_1",
      packageId: "credits-100",
      credits: 100,
      amountCents: 990,
      currency: "CNY",
      status: "pending",
      checkoutRef: "checkout_1",
      createdAt: "2026-07-03T00:00:00.000Z"
    });
  });

  it("throws a 404 for an unknown package", async () => {
    await expect(makeService().createOrder("user-a", "nope")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("lists a user's own orders only", async () => {
    const service = makeService();
    await service.createOrder("user-a", "credits-100");
    await service.createOrder("user-b", "credits-100");
    const listA = await service.listOrders("user-a");
    expect(listA).toHaveLength(1);
    expect(listA[0].id).toBe("order_1");
  });

  it("does not leak internal references (defensive clone)", async () => {
    const service = makeService();
    const order = await service.createOrder("user-a", "credits-100");
    order.status = "paid";
    const [reloaded] = await service.listOrders("user-a");
    expect(reloaded.status).toBe("pending");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/orderService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement orderService.ts**

Create `apps/api/src/services/orderService.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { Order } from "@gw-link-omniai/shared";
import type { OrderRecord, OrderRepository } from "../repositories/types";
import { InMemoryOrderRepository } from "../repositories/memory";
import { PackageCatalogError, type PackageCatalog } from "./packageCatalog";

export interface OrderServiceClock {
  now(): Date;
}

export interface OrderServiceOptions {
  idGenerator?: () => string;
  checkoutRefGenerator?: () => string;
  clock?: OrderServiceClock;
}

export class OrderServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "OrderServiceError";
  }
}

export interface OrderService {
  createOrder(userId: string, packageId: string): Promise<Order>;
  listOrders(userId: string): Promise<Order[]>;
}

function toOrder(record: OrderRecord): Order {
  return {
    id: record.id,
    packageId: record.packageId,
    credits: record.credits,
    amountCents: record.amountCents,
    currency: record.currency,
    status: record.status,
    checkoutRef: record.checkoutRef,
    createdAt: record.createdAt
  };
}

export class OrderServiceImpl implements OrderService {
  private readonly orders: OrderRepository;
  private readonly catalog: PackageCatalog;
  private readonly idGenerator: () => string;
  private readonly checkoutRefGenerator: () => string;
  private readonly clock: OrderServiceClock;

  constructor(orders: OrderRepository, catalog: PackageCatalog, options: OrderServiceOptions = {}) {
    this.orders = orders;
    this.catalog = catalog;
    this.idGenerator = options.idGenerator ?? (() => `order_${randomUUID()}`);
    this.checkoutRefGenerator = options.checkoutRefGenerator ?? (() => `checkout_${randomUUID()}`);
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async createOrder(userId: string, packageId: string): Promise<Order> {
    let pkg;
    try {
      pkg = this.catalog.getPackage(packageId);
    } catch (error) {
      if (error instanceof PackageCatalogError) {
        throw new OrderServiceError(error.message, error.statusCode);
      }
      throw error;
    }
    const record: OrderRecord = {
      id: this.idGenerator(),
      packageId: pkg.id,
      credits: pkg.credits,
      amountCents: pkg.amountCents,
      currency: pkg.currency,
      status: "pending",
      checkoutRef: this.checkoutRefGenerator(),
      createdAt: this.clock.now().toISOString()
    };
    await this.orders.insert(record, userId);
    return toOrder(record);
  }

  async listOrders(userId: string): Promise<Order[]> {
    const records = await this.orders.listByOwner(userId);
    return records.map(toOrder);
  }
}

export class InMemoryOrderService extends OrderServiceImpl {
  constructor(catalog: PackageCatalog, options: OrderServiceOptions = {}) {
    super(new InMemoryOrderRepository(), catalog, options);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/orderService.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into appServices + buildServer**

In `apps/api/src/services/appServices.ts`: add `orderService: OrderService` and `packageCatalog: PackageCatalog` to the `AppServices` interface; build a `ConfigPackageCatalog` from `loadPackageCatalogConfig(resolveConfigPath(config.packagesConfigPath))` inside `createServices`; construct the order service (`new OrderServiceImpl(new DrizzleOrderRepository(db), packageCatalog, ...)` in the DB path, `new InMemoryOrderService(packageCatalog, ...)` in the in-memory path); return both. In `apps/api/src/server.ts`, default `orderService`/`packageCatalog` from options or the same construction, so `buildServer` can inject them. (Follow exactly how `creditService`/`modelCatalog` are threaded.)

- [ ] **Step 6: Typecheck + api tests + commit**

Run: `pnpm --filter @gw-link-omniai/api typecheck`
Expected: no errors.

Run: `pnpm --filter @gw-link-omniai/api test`
Expected: all api tests green (orderService + everything prior).

```bash
git add apps/api/src/services/orderService.ts apps/api/src/services/appServices.ts apps/api/src/server.ts apps/api/src/services/__tests__/orderService.test.ts
git commit -m "feat(api): add OrderService + wiring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: POST /v1/orders + GET /v1/orders

**Files:**
- Modify: `apps/api/src/routes/orders.ts` (add order routes; keep the packages route)
- Modify: `apps/api/src/server.ts` (register order routes with auth guard, pass `orderService`)
- Test: `apps/api/src/routes/__tests__/orders.test.ts` (add order-route cases)

**Interfaces:**
- Consumes: `OrderService` (Task 4), `isCreateOrderRequest` (Task 1), `createAuthGuard` (existing `routes/authGuard.ts`), `OrderServiceError` (Task 4).
- Produces: `registerOrderRoutes(server, { orderService, authService })`.

- [ ] **Step 1: Write the failing route tests**

Add to `apps/api/src/routes/__tests__/orders.test.ts` (the file has the packages test from Task 2; reuse the sign-in helper pattern from `server.test.ts` — start-login → verify-login → bearer token). Add:

```typescript
// helper: authenticate against the built server, returns a bearer token
async function authenticate(server: ReturnType<typeof buildServer>): Promise<string> {
  const start = await server.inject({ method: "POST", url: "/v1/auth/start-login", payload: { destination: "buyer@example.com" } });
  const { challengeId, devCode } = start.json() as { challengeId: string; devCode: string };
  const verify = await server.inject({ method: "POST", url: "/v1/auth/verify-login", payload: { challengeId, code: devCode } });
  return (verify.json() as { token: string }).token;
}

describe("orders routes", () => {
  it("creates a pending order for an authenticated user", async () => {
    const server = buildServer({ packageCatalog });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: `Bearer ${token}` },
      payload: { packageId: "credits-100" }
    });
    expect(response.statusCode).toBe(201);
    const { order } = response.json() as { order: { packageId: string; status: string; checkoutRef: string; credits: number } };
    expect(order).toMatchObject({ packageId: "credits-100", status: "pending", credits: 100 });
    expect(order.checkoutRef).toBeTruthy();
  });

  it("rejects an unauthenticated create", async () => {
    const server = buildServer({ packageCatalog });
    const response = await server.inject({ method: "POST", url: "/v1/orders", payload: { packageId: "credits-100" } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Authentication required" });
  });

  it("rejects an invalid body", async () => {
    const server = buildServer({ packageCatalog });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: `Bearer ${token}` },
      payload: { packageId: 5 }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid order request" });
  });

  it("returns 404 for an unknown package", async () => {
    const server = buildServer({ packageCatalog });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: `Bearer ${token}` },
      payload: { packageId: "nope" }
    });
    expect(response.statusCode).toBe(404);
  });

  it("lists only the caller's own orders", async () => {
    const server = buildServer({ packageCatalog });
    const tokenA = await authenticate(server);
    await server.inject({ method: "POST", url: "/v1/orders", headers: { authorization: `Bearer ${tokenA}` }, payload: { packageId: "credits-100" } });
    const listA = await server.inject({ method: "GET", url: "/v1/orders", headers: { authorization: `Bearer ${tokenA}` } });
    expect(listA.statusCode).toBe(200);
    expect((listA.json() as { orders: unknown[] }).orders).toHaveLength(1);
  });
});
```

Note: `buildServer({ packageCatalog })` must build a default in-memory `orderService` bound to that same `packageCatalog` (verify Task 4 wiring makes this true — if `buildServer` builds the order service from the injected `packageCatalog`, unknown-package 404 and successful create both work with the single-package test catalog).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/routes/__tests__/orders.test.ts`
Expected: FAIL — `/v1/orders` not registered.

- [ ] **Step 3: Implement the order routes**

In `apps/api/src/routes/orders.ts`, add (keep `registerPackageRoutes`):

```typescript
import { isCreateOrderRequest } from "@gw-link-omniai/shared";
import { createAuthGuard } from "./authGuard";
import type { AuthService } from "../services/authService";
import type { OrderService } from "../services/orderService";
import { OrderServiceError } from "../services/orderService";

export function registerOrderRoutes(
  server: FastifyInstance,
  deps: { orderService: OrderService; authService: AuthService }
): void {
  const preHandler = createAuthGuard(deps.authService);

  server.post("/v1/orders", { preHandler }, async (request, reply) => {
    if (!isCreateOrderRequest(request.body)) {
      return reply.status(400).send({ error: "Invalid order request" });
    }
    try {
      const order = await deps.orderService.createOrder(request.userId!, request.body.packageId);
      return reply.status(201).send({ order });
    } catch (error) {
      if (error instanceof OrderServiceError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  server.get("/v1/orders", { preHandler }, async (request) => ({
    orders: await deps.orderService.listOrders(request.userId!)
  }));
}
```

(Add the `import type { FastifyInstance } from "fastify";` if not already present, and `import type { PackageCatalog }` remains for the packages route.)

- [ ] **Step 4: Register order routes in buildServer**

In `apps/api/src/server.ts`, call `registerOrderRoutes(server, { orderService, authService })` (alongside `registerPackageRoutes`). `/v1/orders` is guarded by the auth guard inside `registerOrderRoutes`; `/v1/packages` stays public.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/routes/__tests__/orders.test.ts`
Expected: PASS (packages + 5 order-route tests).

Run: `pnpm --filter @gw-link-omniai/api typecheck`
Expected: no errors.

- [ ] **Step 6: Full workspace**

Run: `pnpm test`
Expected: all packages green.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/orders.ts apps/api/src/server.ts apps/api/src/routes/__tests__/orders.test.ts
git commit -m "feat(api): add POST/GET /v1/orders (auth-guarded, per-user)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`
- Modify: `.env.example`

- [ ] **Step 1: Update README.md**

Add a "### Payment Orders (foundation)" section (after the Credit Foundation section) describing: `GET /v1/packages` (public catalog), `POST /v1/orders` (auth-guarded, creates a `pending` order with a generated `checkoutRef`), `GET /v1/orders` (per-user). State explicitly: no credit is granted, no webhook, and no real payment HTTP in this slice — the webhook that verifies signatures and credits the account via `topUp` is a later sub-slice. Mention `GW_LINK_PACKAGES_CONFIG_PATH`.

- [ ] **Step 2: Update mvp-skeleton.md**

Add a `## Payment Order Foundation Slice` paragraph: package catalog (`config/credit-packages.json` → `ConfigPackageCatalog`), `OrderRepository` (memory + Drizzle, `orders` table, owner-scoped), `OrderService.createOrder`/`listOrders`, routes (`/v1/packages` public, `/v1/orders` guarded). Note prices are integer `amountCents`; orders are `pending`; crediting + webhook + real payment providers are later sub-slices.

- [ ] **Step 3: Update .env.example**

Add a comment block for `GW_LINK_PACKAGES_CONFIG_PATH` (default `config/credit-packages.json`, overrides the credit-package catalog path).

- [ ] **Step 4: Full workspace validation + commit**

Run: `pnpm test` — all green. Run: `pnpm typecheck` — clean.

```bash
git add README.md docs/architecture/mvp-skeleton.md .env.example
git commit -m "docs: document payment order foundation (Slice 22)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ shared contracts (spec §1) → Task 1
- ✅ package catalog + config + GET /v1/packages (spec §2) → Task 2
- ✅ OrderRepository memory+drizzle+migration+contract test (spec §3) → Task 3
- ✅ OrderService + wiring (spec §4) → Task 4
- ✅ POST/GET /v1/orders (spec §5) → Task 5
- ✅ docs + .env.example (spec §6) → Task 6
- ✅ error handling 404/401/400 + owner isolation → Tasks 4, 5
- ✅ non-goals honored (no credit, no webhook, no real payment HTTP)

**Placeholder scan:** Task 3 Steps 5-6 (schema + Drizzle repo) reference mirroring the existing `creditTransactions`/`assets` table + `DrizzleCreditTransactionRepository` rather than pasting full code — this is deliberate (the implementer must match the file's exact column-helper + mapping style, which is the safest way to stay consistent); every other step has concrete code. Task 3 Step 1 says to match the existing contract-test harness (read-first) rather than invent one.

**Type consistency:** `Order`/`OrderRecord`/`OrderStatus` fields identical across shared, repo, service, routes. `createOrder(userId, packageId): Promise<Order>` / `listOrders(userId): Promise<Order[]>` consistent across service, wiring, routes, tests. `PackageCatalog.getPackage` throws `PackageCatalogError(404)`, mapped to `OrderServiceError(404)` in the service and to a 404 response in the route. `amountCents`/`currency`/`checkoutRef` names consistent throughout.
