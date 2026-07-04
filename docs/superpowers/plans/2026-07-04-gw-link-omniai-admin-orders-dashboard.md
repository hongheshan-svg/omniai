# Admin 订单看板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the admin console's "Orders" module with a real, dev-gated cross-user orders dashboard (summary + table).

**Architecture:** A dev-gated `GET /v1/admin/orders` (off in production) returns all orders via a new `OrderRepository.listAll()`. The admin app fetches it and renders a summary (`summarizeOrders`) plus a table. `Order` carries no user PII, so the dev endpoint leaks none; real admin role/authorization is deferred.

**Tech Stack:** TypeScript (ESM, strict), Fastify, Drizzle ORM + postgres/pglite, `@gw-link-omniai/shared`, Next.js 14 admin (jsdom vitest), vitest.

## Global Constraints

- `GET /v1/admin/orders` is **public but dev-gated**: returns `403 { error: "Admin orders are disabled" }` when `devAdminEnabled` is false; `devAdminEnabled` defaults OFF when `NODE_ENV=production`, on otherwise (parsed exactly like `parseDevPaymentsEnabled`).
- `OrderRepository.listAll()` returns every owner's orders ordered by `createdAt`; the endpoint exposes only product `Order` fields (no owner id, no PII).
- Adding `devAdminEnabled` to `ApiConfig` makes it a required field — every full `ApiConfig` object literal in the codebase/tests must add it (grep for them).
- Adding `listAllOrders` to the `ApiClient` interface breaks every fake that implements the FULL interface — add a stub to desktop `App.test` and mobile `appModel.test` fakes (admin fakes use `as unknown as ApiClient` partial casts and are unaffected).
- Services clone defensively; the repository clones at the storage boundary.
- Revenue/credits totals count PAID orders only; revenue is formatted as CNY (single-currency assumption; all packages are CNY).
- Chinese UI copy; code and commit messages in English. Every commit ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: `listAll` repository method + `listAllOrders` service

**Files:**
- Modify: `apps/api/src/repositories/types.ts` (add `listAll` to `OrderRepository`)
- Modify: `apps/api/src/repositories/memory.ts` (`InMemoryOrderRepository.listAll`)
- Modify: `apps/api/src/repositories/drizzle.ts` (`DrizzleOrderRepository.listAll`)
- Modify: `apps/api/src/services/orderService.ts` (`OrderService.listAllOrders`)
- Test: `apps/api/src/repositories/__tests__/repositoryContract.test.ts`

**Interfaces:**
- Produces: `OrderRepository.listAll(): Promise<OrderRecord[]> | OrderRecord[]`; `OrderService.listAllOrders(): Promise<Order[]>`.

- [ ] **Step 1: Write the failing contract test**

In `apps/api/src/repositories/__tests__/repositoryContract.test.ts`, inside the same `describe` block that holds the orders test, add a new test:

```typescript
  it("lists all orders across owners", async () => {
    const { orders } = createRepositories();
    await orders.insert(
      { id: "order_a", packageId: "credits-100", credits: 100, amountCents: 990, currency: "CNY", status: "pending", checkoutRef: "chk_a", createdAt: "2026-07-04T00:00:00.000Z" },
      "owner-a"
    );
    await orders.insert(
      { id: "order_b", packageId: "credits-100", credits: 100, amountCents: 990, currency: "CNY", status: "paid", checkoutRef: "chk_b", createdAt: "2026-07-04T01:00:00.000Z" },
      "owner-b"
    );
    const all = await orders.listAll();
    expect(all.map((o) => o.id).sort()).toEqual(["order_a", "order_b"]);
  });
```

**Note:** match how the existing orders test obtains its `orders` repository handle — the contract file has a helper/fixture (e.g. `createRepositories()` or a `beforeEach` that assigns `orders`). Read the file first and use the same accessor the neighboring orders test uses; the assertion (both ids returned) is the fixed requirement.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts`
Expected: FAIL — `orders.listAll` is not a function (memory + pglite).

- [ ] **Step 3: Add `listAll` to the repository interface**

In `apps/api/src/repositories/types.ts`, add to `OrderRepository` (after `listByOwner`):

```typescript
  listAll(): Promise<OrderRecord[]> | OrderRecord[];
```

- [ ] **Step 4: Implement in-memory `listAll`**

In `apps/api/src/repositories/memory.ts`, add to `InMemoryOrderRepository` (after `listByOwner`):

```typescript
  listAll(): OrderRecord[] {
    return this.rows
      .map((row) => structuredClone(row.record))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
```

- [ ] **Step 5: Implement Drizzle `listAll`**

In `apps/api/src/repositories/drizzle.ts`, add to `DrizzleOrderRepository` (after `listByOwner`):

```typescript
  async listAll(): Promise<OrderRecord[]> {
    const rows = await this.db.select().from(orders).orderBy(orders.createdAt);
    return rows.map(mapOrderRow);
  }
```

- [ ] **Step 6: Add `listAllOrders` to the service**

In `apps/api/src/services/orderService.ts`, add to the `OrderService` interface:

```typescript
  listAllOrders(): Promise<Order[]>;
```

and implement in `OrderServiceImpl` (after `listOrders`):

```typescript
  async listAllOrders(): Promise<Order[]> {
    const records = await this.orders.listAll();
    return records.map(toOrder);
  }
```

- [ ] **Step 7: Run the contract test to verify it passes**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts`
Expected: PASS (memory + pglite).

- [ ] **Step 8: Typecheck api**

Run: `pnpm --filter @gw-link-omniai/api typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/repositories/types.ts apps/api/src/repositories/memory.ts apps/api/src/repositories/drizzle.ts apps/api/src/services/orderService.ts apps/api/src/repositories/__tests__/repositoryContract.test.ts
git commit -m "feat(api): OrderRepository.listAll + OrderService.listAllOrders

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `devAdminEnabled` config + `GET /v1/admin/orders`

**Files:**
- Modify: `apps/api/src/config.ts` (`devAdminEnabled` + `parseDevAdminEnabled`)
- Create: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/server.ts` (register admin routes)
- Modify: `apps/api/src/__tests__/config.test.ts` and any other full `ApiConfig` literals
- Create: `apps/api/src/routes/__tests__/admin.test.ts`

**Interfaces:**
- Consumes: `OrderService.listAllOrders` (Task 1).
- Produces: `ApiConfig.devAdminEnabled: boolean`; `registerAdminRoutes(server, { orderService, devAdminEnabled })`; `GET /v1/admin/orders`.

- [ ] **Step 1: Add the config field + parser**

In `apps/api/src/config.ts`, add `devAdminEnabled: boolean;` to `ApiConfig` (after `devPaymentsEnabled`). Add a parser mirroring `parseDevPaymentsEnabled`:

```typescript
function parseDevAdminEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.GW_LINK_DEV_ADMIN_ENABLED;

  if (value === undefined) {
    return env.NODE_ENV === "production" ? false : true;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Invalid GW_LINK_DEV_ADMIN_ENABLED value: ${value}`);
}
```

And in `loadConfig`'s returned object, add after `devPaymentsEnabled: parseDevPaymentsEnabled(env),`:

```typescript
    devAdminEnabled: parseDevAdminEnabled(env),
```

- [ ] **Step 2: Update every full `ApiConfig` literal**

Adding a required field breaks all full `ApiConfig` objects. Find them:

Run: `grep -rn "devPaymentsEnabled" apps/api/src --include=*.ts`

For each full `ApiConfig` literal (e.g. `apps/api/src/routes/__tests__/payments.test.ts`'s `config()` helper, `apps/api/src/__tests__/config.test.ts`'s expected objects, and any in `apps/api/src/__tests__/server.test.ts`), add `devAdminEnabled: <same value as devPaymentsEnabled or true>` so the object still typechecks. In `config.test.ts`, if it asserts `loadConfig(...)` equals an expected object or checks specific fields, add the matching `devAdminEnabled` expectation (default `true` when `NODE_ENV` is not production, `false` when it is — mirror the existing `devPaymentsEnabled` assertions exactly).

- [ ] **Step 3: Write the failing route test**

Create `apps/api/src/routes/__tests__/admin.test.ts` (mirror the server-build + `authenticate` helpers from `apps/api/src/routes/__tests__/payments.test.ts`):

```typescript
import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import type { ApiConfig } from "../../config";
import { ConfigPackageCatalog } from "../../services/packageCatalog";

const packageCatalog = new ConfigPackageCatalog({
  packages: [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }]
});

function config(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    port: 8787,
    gatewayBaseUrl: "https://gateway.gw-link.local",
    authDevCodesEnabled: true,
    modelConfigPath: "config/models.json",
    packagesConfigPath: "config/credit-packages.json",
    initialCredits: 100,
    publicBaseUrl: "http://localhost:8787",
    devTopupEnabled: false,
    devPaymentsEnabled: true,
    devAdminEnabled: true,
    ...overrides
  };
}

async function authenticate(server: ReturnType<typeof buildServer>): Promise<string> {
  const start = await server.inject({ method: "POST", url: "/v1/auth/start-login", payload: { destination: "buyer@example.com" } });
  const { challengeId, devCode } = start.json() as { challengeId: string; devCode: string };
  const verify = await server.inject({ method: "POST", url: "/v1/auth/verify-login", payload: { challengeId, code: devCode } });
  return (verify.json() as { token: string }).token;
}

describe("GET /v1/admin/orders", () => {
  it("returns 403 when admin is disabled", async () => {
    const server = buildServer({ config: config({ devAdminEnabled: false }), packageCatalog });
    const response = await server.inject({ method: "GET", url: "/v1/admin/orders" });
    expect(response.statusCode).toBe(403);
  });

  it("lists all orders when admin is enabled", async () => {
    const server = buildServer({ config: config(), packageCatalog });
    const token = await authenticate(server);
    await server.inject({ method: "POST", url: "/v1/orders", headers: { authorization: `Bearer ${token}` }, payload: { packageId: "credits-100" } });

    const response = await server.inject({ method: "GET", url: "/v1/admin/orders" });
    expect(response.statusCode).toBe(200);
    const { orders } = response.json() as { orders: Array<{ packageId: string }> };
    expect(orders).toHaveLength(1);
    expect(orders[0]?.packageId).toBe("credits-100");
  });
});
```

- [ ] **Step 4: Run the route test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/routes/__tests__/admin.test.ts`
Expected: FAIL — `/v1/admin/orders` is not registered (404, not 403/200).

- [ ] **Step 5: Create the admin route**

Create `apps/api/src/routes/admin.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { OrderService } from "../services/orderService";

export function registerAdminRoutes(
  server: FastifyInstance,
  deps: { orderService: OrderService; devAdminEnabled: boolean }
): void {
  server.get("/v1/admin/orders", async (_request, reply) => {
    if (!deps.devAdminEnabled) {
      return reply.status(403).send({ error: "Admin orders are disabled" });
    }
    return reply.status(200).send({ orders: await deps.orderService.listAllOrders() });
  });
}
```

- [ ] **Step 6: Wire it into `buildServer`**

In `apps/api/src/server.ts`, import and register (near the other `registerXRoutes` calls, e.g. after `registerOrderRoutes`):

```typescript
import { registerAdminRoutes } from "./routes/admin";
```

```typescript
  registerAdminRoutes(server, {
    orderService,
    devAdminEnabled: options.config?.devAdminEnabled ?? false
  });
```

- [ ] **Step 7: Run the route test to verify it passes**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/routes/__tests__/admin.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the full api suite + typecheck**

Run: `pnpm --filter @gw-link-omniai/api test && pnpm --filter @gw-link-omniai/api typecheck`
Expected: PASS/clean (confirms all `ApiConfig` literals were updated).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/routes/admin.ts apps/api/src/server.ts apps/api/src/__tests__/config.test.ts apps/api/src/routes/__tests__/admin.test.ts apps/api/src/routes/__tests__/payments.test.ts apps/api/src/__tests__/server.test.ts
git commit -m "feat(api): dev-gated GET /v1/admin/orders

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(Only `git add` the files you actually changed; run `git status` first.)

---

### Task 3: shared `apiClient.listAllOrders` + fake stubs

**Files:**
- Modify: `packages/shared/src/apiClient.ts`
- Test: `packages/shared/src/__tests__/apiClient.test.ts`
- Modify: `apps/desktop/src/__tests__/App.test.tsx` (add stub to `createFakeClient`)
- Modify: `apps/mobile/src/__tests__/appModel.test.ts` (add stub to `createFakeClient`)

**Interfaces:**
- Produces: `ApiClient.listAllOrders(): Promise<Order[]>` (GET `/v1/admin/orders`, no token, unwrap `{ orders }`).

- [ ] **Step 1: Write the failing apiClient test**

In `packages/shared/src/__tests__/apiClient.test.ts`, add a test mirroring the existing `listOrders`/`listPackages` tests (fetch mock asserting URL + method + unwrap). Add:

```typescript
  it("listAllOrders GETs /v1/admin/orders and unwraps orders", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ orders: [{ id: "order_1" }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = createApiClient({ baseUrl: "http://api.test", fetch: fetchMock as unknown as typeof fetch });
    const orders = await client.listAllOrders();
    expect(orders).toEqual([{ id: "order_1" }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/v1/admin/orders");
    expect((init as RequestInit | undefined)?.method ?? "GET").toBe("GET");
  });
```

**Note:** match the existing test file's imports/setup (`createApiClient`, `vi`); if its other tests use a shared `fetchMock` helper, reuse it and keep the assertion (URL `/v1/admin/orders`, unwrap `{ orders }`).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gw-link-omniai/shared exec vitest run src/__tests__/apiClient.test.ts`
Expected: FAIL — `listAllOrders` not on the client.

- [ ] **Step 3: Add `listAllOrders` to the interface + implementation**

In `packages/shared/src/apiClient.ts`, add to the `ApiClient` interface (after `listOrders`):

```typescript
  listAllOrders(): Promise<Order[]>;
```

and to the returned client object (after `listOrders`):

```typescript
    async listAllOrders() {
      const { orders } = await send<{ orders: Order[] }>("/v1/admin/orders");
      return orders;
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gw-link-omniai/shared exec vitest run src/__tests__/apiClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Add stubs to the full-interface fakes**

In `apps/desktop/src/__tests__/App.test.tsx`, in `createFakeClient`'s `base` object (next to `listOrders`/`devCompletePayment`), add:

```typescript
    listAllOrders: async () => { throw new Error("unused"); },
```

In `apps/mobile/src/__tests__/appModel.test.ts`, in `createFakeClient`'s `base` object (next to the checkout methods), add the same line:

```typescript
    listAllOrders: async () => { throw new Error("unused"); },
```

- [ ] **Step 6: Typecheck + tests for all three touched packages**

Run: `pnpm --filter @gw-link-omniai/shared test && pnpm --filter @gw-link-omniai/shared typecheck && pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/mobile test`
Expected: all green (the stubs keep desktop/mobile fakes implementing the full interface).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/apiClient.ts packages/shared/src/__tests__/apiClient.test.ts apps/desktop/src/__tests__/App.test.tsx apps/mobile/src/__tests__/appModel.test.ts
git commit -m "feat(shared): apiClient.listAllOrders + fake stubs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: admin `summarizeOrders` model

**Files:**
- Create: `apps/admin/src/ordersDashboardModel.ts`
- Test: `apps/admin/src/__tests__/ordersDashboardModel.test.ts`

**Interfaces:**
- Produces: `summarizeOrders(orders: Order[]): OrderDashboardSummary` where `OrderDashboardSummary = { total, paid, pending, failed, revenueCents, creditsSold }`.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/__tests__/ordersDashboardModel.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { Order } from "@gw-link-omniai/shared";
import { summarizeOrders } from "../ordersDashboardModel";

function order(overrides: Partial<Order>): Order {
  return {
    id: "o",
    packageId: "credits-100",
    credits: 100,
    amountCents: 990,
    currency: "CNY",
    status: "pending",
    checkoutRef: "chk",
    createdAt: "2026-07-04T00:00:00.000Z",
    ...overrides
  };
}

describe("summarizeOrders", () => {
  it("returns zeros for no orders", () => {
    expect(summarizeOrders([])).toEqual({ total: 0, paid: 0, pending: 0, failed: 0, revenueCents: 0, creditsSold: 0 });
  });

  it("counts statuses and sums revenue/credits from paid orders only", () => {
    const orders: Order[] = [
      order({ id: "a", status: "paid", amountCents: 990, credits: 100 }),
      order({ id: "b", status: "paid", amountCents: 4500, credits: 500 }),
      order({ id: "c", status: "pending" }),
      order({ id: "d", status: "failed" })
    ];
    expect(summarizeOrders(orders)).toEqual({ total: 4, paid: 2, pending: 1, failed: 1, revenueCents: 5490, creditsSold: 600 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gw-link-omniai/admin exec vitest run src/__tests__/ordersDashboardModel.test.ts`
Expected: FAIL — module not found / `summarizeOrders` not exported.

- [ ] **Step 3: Implement the model**

Create `apps/admin/src/ordersDashboardModel.ts`:

```typescript
import type { Order } from "@gw-link-omniai/shared";

export interface OrderDashboardSummary {
  total: number;
  paid: number;
  pending: number;
  failed: number;
  revenueCents: number;
  creditsSold: number;
}

export function summarizeOrders(orders: Order[]): OrderDashboardSummary {
  const summary: OrderDashboardSummary = { total: orders.length, paid: 0, pending: 0, failed: 0, revenueCents: 0, creditsSold: 0 };
  for (const order of orders) {
    if (order.status === "paid") {
      summary.paid += 1;
      summary.revenueCents += order.amountCents;
      summary.creditsSold += order.credits;
    } else if (order.status === "pending") {
      summary.pending += 1;
    } else if (order.status === "failed") {
      summary.failed += 1;
    }
  }
  return summary;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gw-link-omniai/admin exec vitest run src/__tests__/ordersDashboardModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck admin**

Run: `pnpm --filter @gw-link-omniai/admin typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/ordersDashboardModel.ts apps/admin/src/__tests__/ordersDashboardModel.test.ts
git commit -m "feat(admin): summarizeOrders dashboard model

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: admin `OrdersSection` + appShell wiring

**Files:**
- Create: `apps/admin/src/OrdersSection.tsx`
- Test: `apps/admin/src/__tests__/OrdersSection.test.tsx`
- Modify: `apps/admin/src/appShell.tsx` (render the section under "Orders")
- Modify: `apps/admin/src/__tests__/appShell.test.tsx` (fake now needs `listAllOrders`)

**Interfaces:**
- Consumes: `summarizeOrders` (Task 4); `ApiClient.listAllOrders` (Task 3); shared `formatMoney`, `formatDateTime`, `getOrderStatusLabel`.

- [ ] **Step 1: Write the failing OrdersSection test**

Create `apps/admin/src/__tests__/OrdersSection.test.tsx` (mirror `ModelCatalogSection.test.tsx`):

```typescript
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ApiClient, Order } from "@gw-link-omniai/shared";
import { OrdersSection } from "../OrdersSection";

const orders: Order[] = [
  { id: "order_1", packageId: "credits-100", credits: 100, amountCents: 990, currency: "CNY", status: "paid", checkoutRef: "chk_1", createdAt: "2026-07-04T00:00:00.000Z", paidAt: "2026-07-04T00:05:00.000Z" },
  { id: "order_2", packageId: "credits-500", credits: 500, amountCents: 4500, currency: "CNY", status: "pending", checkoutRef: "chk_2", createdAt: "2026-07-04T01:00:00.000Z" }
];

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return { listAllOrders: async () => orders, ...overrides } as unknown as ApiClient;
}

describe("OrdersSection", () => {
  it("renders the orders summary and table", async () => {
    render(<OrdersSection client={fakeClient()} />);
    expect(await screen.findByText("order_1")).toBeTruthy();
    const summary = screen.getByLabelText("订单概览");
    expect(within(summary).getByText("总数：2")).toBeTruthy();
    expect(within(summary).getByText("已付：1")).toBeTruthy();
    expect(within(summary).getByText("待付：1")).toBeTruthy();
    expect(within(summary).getByText("营收：¥9.90")).toBeTruthy();
    expect(within(summary).getByText("售出积分：100")).toBeTruthy();
  });

  it("shows an error when loading fails", async () => {
    const client = fakeClient({ listAllOrders: async () => { throw new Error("boom"); } });
    render(<OrdersSection client={client} />);
    expect(await screen.findByText("订单加载失败，请稍后重试")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gw-link-omniai/admin exec vitest run src/__tests__/OrdersSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `OrdersSection`**

Create `apps/admin/src/OrdersSection.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { createApiClient, type ApiClient, type Order, formatMoney, formatDateTime, getOrderStatusLabel } from "@gw-link-omniai/shared";
import { summarizeOrders } from "./ordersDashboardModel";

export function OrdersSection({ client }: { client?: ApiClient } = {}) {
  const [orders, setOrders] = useState<Order[] | undefined>(undefined);
  const [error, setError] = useState(false);

  useEffect(() => {
    const api = client ?? createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL });
    let cancelled = false;
    api
      .listAllOrders()
      .then((loaded) => {
        if (!cancelled) {
          setOrders(loaded);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (error) {
    return <p>订单加载失败，请稍后重试</p>;
  }
  if (!orders) {
    return <p>加载中…</p>;
  }

  const summary = summarizeOrders(orders);
  return (
    <div>
      <dl aria-label="订单概览">
        <div>{`总数：${summary.total}`}</div>
        <div>{`已付：${summary.paid}`}</div>
        <div>{`待付：${summary.pending}`}</div>
        <div>{`失败：${summary.failed}`}</div>
        <div>{`营收：${formatMoney(summary.revenueCents, "CNY")}`}</div>
        <div>{`售出积分：${summary.creditsSold}`}</div>
      </dl>
      <ul aria-label="订单列表">
        {orders.map((order) => (
          <li key={order.id}>
            <span>{order.id}</span>
            <span>{order.packageId}</span>
            <span>{getOrderStatusLabel(order.status)}</span>
            <span>{formatMoney(order.amountCents, order.currency)}</span>
            <span>{formatDateTime(order.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gw-link-omniai/admin exec vitest run src/__tests__/OrdersSection.test.tsx`
Expected: PASS. (Each summary stat is a single text node like `总数：2` via a template literal, so `getByText("总数：2")` matches exactly.)

- [ ] **Step 5: Wire into appShell**

In `apps/admin/src/appShell.tsx`, import and render the section under the "Orders" module. Update the import block:

```typescript
import { OrdersSection } from "./OrdersSection";
```

and change the module render so both "Model Display" and "Orders" render their sections:

```tsx
            {module === "Model Display" ? <ModelCatalogSection client={client} /> : null}
            {module === "Orders" ? <OrdersSection client={client} /> : null}
```

- [ ] **Step 6: Update the appShell test fake**

In `apps/admin/src/__tests__/appShell.test.tsx`, the fake client now also needs `listAllOrders` (the shell renders `OrdersSection`, which calls it). Update both fakes in that file:

```typescript
    const client = { listModels: async () => [], listAllOrders: async () => [] } as unknown as ApiClient;
```

(Apply to the `client` used in the "renders the operations modules" test; the second test does not render the shell.)

- [ ] **Step 7: Run the admin suite + typecheck**

Run: `pnpm --filter @gw-link-omniai/admin test && pnpm --filter @gw-link-omniai/admin typecheck`
Expected: all green (OrdersSection, ordersDashboardModel, appShell, catalog tests).

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/OrdersSection.tsx apps/admin/src/__tests__/OrdersSection.test.tsx apps/admin/src/appShell.tsx apps/admin/src/__tests__/appShell.test.tsx
git commit -m "feat(admin): OrdersSection dashboard wired into the shell

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Documentation + .env.example

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`
- Modify: `.env.example`

- [ ] **Step 1: README**

In `README.md`, after the `### Receipt Export` section, add:

```markdown
### Admin Orders Dashboard

The admin console's "Orders" module shows a cross-user orders dashboard —
totals by status plus revenue and credits sold (`summarizeOrders`) and an
order table. It reads `GET /v1/admin/orders`, a **dev-gated** endpoint
(`GW_LINK_DEV_ADMIN_ENABLED`, off in production) that returns every order via
`OrderRepository.listAll()`. `Order` carries no user PII, so the dev endpoint
exposes none. Real admin role/authorization (an authenticated admin surface)
is later work; today the endpoint is public but disabled in production.
```

- [ ] **Step 2: mvp-skeleton**

In `docs/architecture/mvp-skeleton.md`, at the end, add:

```markdown

## Admin Orders Dashboard Slice

`OrderRepository.listAll()` returns every owner's orders (memory + Drizzle,
ordered by `createdAt`); `OrderService.listAllOrders()` maps them to `Order`.
A dev-gated `GET /v1/admin/orders` (`ApiConfig.devAdminEnabled`, env
`GW_LINK_DEV_ADMIN_ENABLED`, off in production, `403` when disabled) exposes
them — public but gated, and `Order` has no PII. `apiClient.listAllOrders()`
fetches it. The admin app adds `summarizeOrders` (counts + paid-only revenue
and credits) and an `OrdersSection` (summary + table) wired into the shell's
"Orders" module. Deferred: real admin role/authorization, transactions
dashboard, filtering/pagination.
```

- [ ] **Step 3: .env.example**

In `.env.example`, after the `GW_LINK_DEV_PAYMENTS_ENABLED` block, add:

```bash

# Dev-only admin orders endpoint (GET /v1/admin/orders returns every user's
# orders for the admin console dashboard). Order records carry no user PII.
# Defaults on outside production, off when NODE_ENV=production. NEVER enable
# in production until a real authenticated admin authorization surface exists —
# today the endpoint is public when enabled.
# GW_LINK_DEV_ADMIN_ENABLED=true
```

- [ ] **Step 4: Full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all packages green, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/architecture/mvp-skeleton.md .env.example
git commit -m "docs: document admin orders dashboard (Slice 28)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- The admin endpoint is intentionally public + dev-gated (off in production); do NOT add an auth guard — the admin console has no login flow, and `Order` carries no PII. Real admin authz is a documented later slice.
- When adding `devAdminEnabled` (Task 2) and `listAllOrders` (Task 3), the compile breaks are the point: fix every full `ApiConfig` literal and every full-`ApiClient` fake. Run the package's typecheck to find them all.
- Follow existing patterns: `OrdersSection` mirrors `ModelCatalogSection`; the route test mirrors `payments.test.ts`; `summarizeOrders` is a pure framework-free model like `catalogModel`.

---

## Option A Auth Revision (supersedes Tasks 2, 3, 5)

Automated security review flagged the public `/v1/admin/orders` as HIGH (missing auth / cross-tenant disclosure). Per the chosen resolution, the endpoint becomes **authenticated + admin-allowlisted + hardened against production**, and the admin console gains a **login**. Task 1 (listAll) and Task 4 (summarizeOrders) are unchanged. The tasks below fix-forward the already-committed Task 2/3 code on this branch.

### Task 2A: Authenticated, admin-gated `/v1/admin/orders` (supersedes Task 2)

**Files:** `apps/api/src/config.ts`; `apps/api/src/routes/adminGuard.ts` (new); `apps/api/src/routes/admin.ts`; `apps/api/src/server.ts`; `apps/api/src/routes/__tests__/admin.test.ts`; `apps/api/src/__tests__/config.test.ts`; every full `ApiConfig` literal.

- [ ] **Step 1: config — `adminEmails` + production hardening.** Add `adminEmails: string[];` to `ApiConfig`. Add a parser:

```typescript
function parseAdminEmails(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.split(",").map((e) => e.trim()).filter((e) => e.length > 0);
}
```

Harden `parseDevAdminEnabled` so production can never enable it:

```typescript
function parseDevAdminEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.GW_LINK_DEV_ADMIN_ENABLED;
  const isProduction = env.NODE_ENV === "production";
  if (value === undefined) return isProduction ? false : true;
  if (value === "true") {
    if (isProduction) {
      throw new Error("GW_LINK_DEV_ADMIN_ENABLED must not be true in production");
    }
    return true;
  }
  if (value === "false") return false;
  throw new Error(`Invalid GW_LINK_DEV_ADMIN_ENABLED value: ${value}`);
}
```

In `loadConfig`, add `adminEmails: parseAdminEmails(env.GW_LINK_ADMIN_EMAILS),`.

- [ ] **Step 2: admin guard.** Create `apps/api/src/routes/adminGuard.ts`:

```typescript
import type { preHandlerHookHandler } from "fastify";
import type { AuthService } from "../services/authService";
import { readBearerToken } from "./bearer";

export function createAdminGuard(authService: AuthService, adminEmails: string[]): preHandlerHookHandler {
  return async (request, reply) => {
    const token = readBearerToken(request.headers.authorization);
    const session = await authService.getSession(token);
    if (!session.authenticated || !session.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }
    if (!adminEmails.includes(session.user.destination)) {
      return reply.status(403).send({ error: "Admin access required" });
    }
    request.userId = session.user.id;
  };
}
```

- [ ] **Step 3: rework the route.** Replace `apps/api/src/routes/admin.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/authService";
import type { OrderService } from "../services/orderService";
import { createAdminGuard } from "./adminGuard";

export function registerAdminRoutes(
  server: FastifyInstance,
  deps: { orderService: OrderService; authService: AuthService; adminEmails: string[]; devAdminEnabled: boolean }
): void {
  const preHandler = createAdminGuard(deps.authService, deps.adminEmails);
  server.get("/v1/admin/orders", { preHandler }, async (_request, reply) => {
    if (!deps.devAdminEnabled) {
      return reply.status(403).send({ error: "Admin orders are disabled" });
    }
    return reply.status(200).send({ orders: await deps.orderService.listAllOrders() });
  });
}
```

- [ ] **Step 4: wire in `server.ts`.** Update the `registerAdminRoutes` call to pass `authService`, `adminEmails: options.config?.adminEmails ?? []`, `devAdminEnabled: options.config?.devAdminEnabled ?? false`.

- [ ] **Step 5: rework the route test** (`apps/api/src/routes/__tests__/admin.test.ts`) so it enshrines SECURE behavior. Add `adminEmails: ["buyer@example.com"]` to the `config()` helper defaults (buyer@example.com is the address `authenticate()` logs in as). Tests:
  - unauthenticated GET (no bearer) → **401**.
  - authenticated as a NON-admin (log in as `other@example.com`, i.e. an address not in `adminEmails`) → **403** with `Admin access required`.
  - admin (`buyer@example.com`) but `config({ devAdminEnabled: false })` → **403** with `Admin orders are disabled`.
  - admin + enabled → **200**, lists the seeded order.

  Use `Authorization: Bearer <token>` headers; reuse the `authenticate()` helper (parameterize it by destination, or add a second helper for the non-admin login).

- [ ] **Step 6: config test.** In `apps/api/src/__tests__/config.test.ts`: assert `parseDevAdminEnabled` throws when `NODE_ENV=production` and `GW_LINK_DEV_ADMIN_ENABLED=true` (replace the earlier expectation that production+true returned true); assert `adminEmails` parses `"a@x.com,b@y.com"` → `["a@x.com","b@y.com"]` and defaults to `[]`. Add `adminEmails: []` (or the expected value) to any full-object `ApiConfig` expectation.

- [ ] **Step 7: fix every full `ApiConfig` literal.** `grep -rn "devAdminEnabled" apps/api/src --include=*.ts`; add `adminEmails: []` to each full `ApiConfig` object that now lacks it. Then `pnpm --filter @gw-link-omniai/api test && pnpm --filter @gw-link-omniai/api typecheck` must be green/clean.

- [ ] **Step 8: commit** — `fix(api): require admin auth + allowlist for GET /v1/admin/orders; refuse in prod` (with the Co-Authored-By trailer).

### Task 3A: `apiClient.listAllOrders(token)` (supersedes Task 3)

**Files:** `packages/shared/src/apiClient.ts`; `packages/shared/src/__tests__/apiClient.test.ts`. (Desktop/mobile fake stubs `async () => { throw }` already satisfy the new signature — leave them.)

- [ ] **Step 1: update the interface + impl** so the method takes a token and sends it:

```typescript
  listAllOrders(token: string): Promise<Order[]>;
```

```typescript
    async listAllOrders(token) {
      const { orders } = await send<{ orders: Order[] }>("/v1/admin/orders", { token });
      return orders;
    },
```

- [ ] **Step 2: update the apiClient test** so it passes a token and asserts the `Authorization: Bearer <token>` header is sent (mirror how the existing `listOrders` token test asserts the header). Keep the URL `/v1/admin/orders` + unwrap `{ orders }` assertions.

- [ ] **Step 3:** `pnpm --filter @gw-link-omniai/shared test && pnpm --filter @gw-link-omniai/shared typecheck && pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/mobile test` → all green.

- [ ] **Step 4: commit** — `fix(shared): apiClient.listAllOrders requires a token` (with trailer).

### Task 5A: admin console login + token-scoped OrdersSection (supersedes Task 5)

**Files:** `apps/admin/src/OrdersSection.tsx`; `apps/admin/src/__tests__/OrdersSection.test.tsx`; `apps/admin/src/adminAuthModel.ts` (new, framework-free) + test; `apps/admin/src/appShell.tsx`; `apps/admin/src/__tests__/appShell.test.tsx`.

- [ ] **Step 1: `OrdersSection` takes a `token`.** Signature `OrdersSection({ client, token }: { client?: ApiClient; token?: string })`. When `!token`, render `<p>请先登录</p>` and do not fetch. When `token`, call `client.listAllOrders(token)` in the effect (deps `[client, token]`); keep loading/error (`订单加载失败，请稍后重试`) and the summary+table exactly as in Task 5. Update `OrdersSection.test` to pass a `token="t"` in the success/error tests, and add a test that with no token it shows `请先登录` and never calls the client.

- [ ] **Step 2: `adminAuthModel.ts`** — a small framework-free login controller mirroring the mobile `appModel` shape but minimal:

```typescript
import { ApiError, type ApiClient } from "@gw-link-omniai/shared";

export type AdminStage = "signedOut" | "codeSent" | "signedIn";
export interface AdminAuthState { stage: AdminStage; challengeId: string | null; token: string | null; error: string | null; }
export interface AdminAuthController {
  getState(): AdminAuthState;
  subscribe(listener: () => void): () => void;
  startLogin(email: string): Promise<void>;
  verify(code: string): Promise<void>;
}
export function createAdminAuthController(client: ApiClient): AdminAuthController { /* startLogin -> verifyLogin -> token; map ApiError to a Chinese error */ }
```

Implement with a listener set + `setState` merge (mirror `apps/mobile/src/appModel.ts`'s controller mechanics). `startLogin` → `client.startLogin({ destination: email })` → `stage: "codeSent"`, store `challengeId`; `verify` → `client.verifyLogin({ challengeId, code })` → `stage: "signedIn"`, store `token`; errors → `error: "登录失败，请重试"`. Add a `adminAuthModel.test.ts` (fake client): startLogin advances to codeSent; verify sets token + signedIn; a failing verify sets error.

- [ ] **Step 3: `appShell` login + wiring.** Make `AdminAppShell` a client component that builds an `adminAuthController` from the client (default `createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL })`), subscribes via `useSyncExternalStore`. When `stage !== "signedIn"`: render a login form (email input + 发送验证码; when `codeSent`, a code input + 登录) and still render the module list, but pass `token={undefined}` to `OrdersSection` (so it shows 请先登录). When `signedIn`: pass `token={state.token}` to `OrdersSection`. Keep all five module headings rendered. Render `<OrdersSection client={client} token={token} />` under the "Orders" module and `<ModelCatalogSection client={client} />` under "Model Display".

- [ ] **Step 4: update `appShell.test`.** The fake client now needs `listModels`, `listAllOrders`, `startLogin`, `verifyLogin`. Keep the existing "renders modules" assertions (they still hold — headings render regardless of auth). Add a test: fill email → 发送验证码 → fill code → 登录 → the Orders section transitions from `请先登录` to showing the summary (fake `listAllOrders` returns orders; fake `verifyLogin` returns a token).

- [ ] **Step 5:** `pnpm --filter @gw-link-omniai/admin test && pnpm --filter @gw-link-omniai/admin typecheck` → green.

- [ ] **Step 6: commit** — `feat(admin): admin login + token-scoped orders dashboard` (with trailer).

### Task 6 (updated): docs + .env.example

Same as the original Task 6, but the README/mvp-skeleton must describe the AUTHENTICATED admin model (auth guard + `GW_LINK_ADMIN_EMAILS` allowlist + `devAdminEnabled` as an additional kill-switch that throws in production + admin console login), NOT a public endpoint. `.env.example`: add `GW_LINK_ADMIN_EMAILS` (comma-separated admin allowlist) and update the `GW_LINK_DEV_ADMIN_ENABLED` comment to say the endpoint is admin-authenticated and that `true` in production throws at boot.
