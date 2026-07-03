# Desktop Checkout UI Implementation Plan (Payment sub-slice C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End-to-end desktop checkout — pick a credit package, create an order, complete payment (dev), and see the balance update.

**Architecture:** Add four apiClient methods (`listPackages`/`createOrder`/`listOrders`/`devCompletePayment`); a dev-gated `POST /v1/payments/dev-complete` that server-side signs a `payment.succeeded` event and feeds the real `PaymentService` (reusing the audited verify+idempotent+credit path — the client never holds the secret); a desktop package-checkout section. In production (`GW_LINK_DEV_PAYMENTS_ENABLED` off) dev-complete returns 403.

**Tech Stack:** Fastify, `@gw-link-omniai/shared` apiClient, React 18 + vitest/jsdom.

## Global Constraints

- apiClient methods: `listPackages(): Promise<CreditPackage[]>` (public), `createOrder(packageId, token): Promise<Order>`, `listOrders(token): Promise<Order[]>`, `devCompletePayment(orderId, token): Promise<Order>`.
- `ApiConfig.devPaymentsEnabled: boolean` (env `GW_LINK_DEV_PAYMENTS_ENABLED`; default off in production, on otherwise; `"true"`/`"false"`/throw — identical to `devTopupEnabled`).
- `dev-complete` errors: 403 disabled / 401 unauth / 400 invalid body `{ error: "Invalid dev-complete request" }` / 404 not owned-or-missing / 500 secret unconfigured (from PaymentService). Success → 200 `{ order: <updated> }`.
- The dev-complete handler signs with `config.paymentWebhookSecret` and calls the real `PaymentService.handleWebhookEvent` (real verify + idempotency). The client never sees the secret.
- Keep the existing fixed-100 "充值" button (dev-topup). Add a separate package-checkout section.
- `formatPackagePrice(pkg)` → `¥{amountCents/100 to 2dp}`; `getOrderStatusLabel`: pending→"待支付", paid→"已支付", failed→"支付失败".
- Non-goals: real provider checkout page/redirect, mobile checkout, refunds, order detail page.
- Each task green before commit.

---

## Task 1: apiClient package/order/checkout methods

**Files:**
- Modify: `packages/shared/src/apiClient.ts`
- Test: `packages/shared/src/__tests__/apiClient.test.ts`

**Interfaces:**
- Produces: `ApiClient.listPackages()`, `.createOrder(packageId, token)`, `.listOrders(token)`, `.devCompletePayment(orderId, token)`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/shared/src/__tests__/apiClient.test.ts` (the file has `jsonResponse`, `baseUrl`, `vi`):

```typescript
it("lists packages publicly", async () => {
  const packages = [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }];
  const fetchMock = vi.fn(async () => jsonResponse({ packages }));
  const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });
  const result = await client.listPackages();
  expect(result).toEqual(packages);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://api.test/v1/packages");
  expect((init.headers as Record<string, string>).authorization).toBeUndefined();
});

it("creates an order with the bearer token", async () => {
  const order = { id: "order_1", packageId: "credits-100", credits: 100, amountCents: 990, currency: "CNY", status: "pending", checkoutRef: "checkout_1", createdAt: "2026-07-03T00:00:00.000Z" };
  const fetchMock = vi.fn(async () => jsonResponse({ order }));
  const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });
  const result = await client.createOrder("credits-100", "tok-1");
  expect(result).toEqual(order);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://api.test/v1/orders");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body as string)).toEqual({ packageId: "credits-100" });
  expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
});

it("lists orders with the bearer token", async () => {
  const fetchMock = vi.fn(async () => jsonResponse({ orders: [] }));
  const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });
  expect(await client.listOrders("tok-1")).toEqual([]);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://api.test/v1/orders");
  expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
});

it("completes a dev payment with the bearer token", async () => {
  const order = { id: "order_1", packageId: "credits-100", credits: 100, amountCents: 990, currency: "CNY", status: "paid", checkoutRef: "checkout_1", createdAt: "2026-07-03T00:00:00.000Z" };
  const fetchMock = vi.fn(async () => jsonResponse({ order }));
  const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });
  const result = await client.devCompletePayment("order_1", "tok-1");
  expect(result).toEqual(order);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://api.test/v1/payments/dev-complete");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body as string)).toEqual({ orderId: "order_1" });
  expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gw-link-omniai/shared exec vitest run src/__tests__/apiClient.test.ts` — FAIL (methods missing).

- [ ] **Step 3: Implement the methods**

In `packages/shared/src/apiClient.ts`: add `CreditPackage` and `Order` to the type import block (from `@gw-link-omniai/shared`). Add to the `ApiClient` interface (after `listModels`):

```typescript
  listPackages(): Promise<CreditPackage[]>;
  createOrder(packageId: string, token: string): Promise<Order>;
  listOrders(token: string): Promise<Order[]>;
  devCompletePayment(orderId: string, token: string): Promise<Order>;
```

Add the implementations to the returned object (after `listModels`):

```typescript
    async listPackages() {
      const { packages } = await send<{ packages: CreditPackage[] }>("/v1/packages");
      return packages;
    },
    async createOrder(packageId, token) {
      const { order } = await send<{ order: Order }>("/v1/orders", { method: "POST", body: { packageId }, token });
      return order;
    },
    async listOrders(token) {
      const { orders } = await send<{ orders: Order[] }>("/v1/orders", { token });
      return orders;
    },
    async devCompletePayment(orderId, token) {
      const { order } = await send<{ order: Order }>("/v1/payments/dev-complete", { method: "POST", body: { orderId }, token });
      return order;
    }
```

- [ ] **Step 4: Run + typecheck + commit**

Run: `pnpm --filter @gw-link-omniai/shared exec vitest run src/__tests__/apiClient.test.ts` — PASS.
Run: `pnpm --filter @gw-link-omniai/shared typecheck` — clean.

```bash
git add packages/shared/src/apiClient.ts packages/shared/src/__tests__/apiClient.test.ts
git commit -m "feat(shared): apiClient package/order/checkout methods

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: dev-complete endpoint + config + getOrder

**Files:**
- Modify: `apps/api/src/config.ts` (+ `devPaymentsEnabled`)
- Modify: `apps/api/src/services/orderService.ts` (+ `getOrder`)
- Modify: `apps/api/src/routes/payments.ts` (deps object + dev-complete route)
- Modify: `apps/api/src/server.ts` (registerPaymentRoutes deps)
- Test: `apps/api/src/services/__tests__/orderService.test.ts`, `apps/api/src/routes/__tests__/payments.test.ts`, `apps/api/src/__tests__/config.test.ts` (+ all ApiConfig literals)

**Interfaces:**
- Consumes: `PaymentService`, `OrderService`, `AuthService`, `signWebhookPayload`, `PaymentServiceError`.
- Produces: `ApiConfig.devPaymentsEnabled`; `OrderService.getOrder(userId, orderId): Promise<Order | null>`; `POST /v1/payments/dev-complete`.

- [ ] **Step 1: Add devPaymentsEnabled config (required boolean → thread through test literals)**

In `apps/api/src/config.ts`: add `devPaymentsEnabled: boolean;` to `ApiConfig` (after `devTopupEnabled`); add a `parseDevPaymentsEnabled(env)` function IDENTICAL to `parseDevTopupEnabled` but reading `env.GW_LINK_DEV_PAYMENTS_ENABLED` (throw message names `GW_LINK_DEV_PAYMENTS_ENABLED`); in `loadConfig` add `devPaymentsEnabled: parseDevPaymentsEnabled(env),`.

Because `devPaymentsEnabled` is a REQUIRED boolean, EVERY `ApiConfig` object literal in the test suite must add `devPaymentsEnabled: true` (mirroring how `devTopupEnabled` was threaded in Slice 12). Find them: `grep -rln "devTopupEnabled" apps/api/src` — add `devPaymentsEnabled: true` (or the appropriate value) beside each `devTopupEnabled`. Update `config.test.ts` `toEqual` assertions + add a "disables in production by default" test. Run `pnpm --filter @gw-link-omniai/api typecheck` to confirm no literal was missed.

- [ ] **Step 2: Add OrderService.getOrder (write failing test first)**

Add to `apps/api/src/services/__tests__/orderService.test.ts`:

```typescript
it("gets a user's own order by id", async () => {
  const service = makeService();
  const created = await service.createOrder("user-a", "credits-100");
  expect(await service.getOrder("user-a", created.id)).toMatchObject({ id: created.id, status: "pending" });
  expect(await service.getOrder("user-b", created.id)).toBeNull();
  expect(await service.getOrder("user-a", "missing")).toBeNull();
});
```

Then in `apps/api/src/services/orderService.ts`: add `getOrder(userId: string, orderId: string): Promise<Order | null>;` to the `OrderService` interface, and implement:

```typescript
  async getOrder(userId: string, orderId: string): Promise<Order | null> {
    const record = await this.orders.get(userId, orderId);
    return record ? toOrder(record) : null;
  }
```

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/orderService.test.ts` — PASS.

- [ ] **Step 3: Write the failing dev-complete route tests**

Add to `apps/api/src/routes/__tests__/payments.test.ts` (reuse its `config(secret)` helper + `authenticate`; extend `config` to also take `devPaymentsEnabled`). Add a `config2(secret, devPaymentsEnabled)` variant or extend the existing helper to set `devPaymentsEnabled`. Tests:

```typescript
describe("POST /v1/payments/dev-complete", () => {
  it("returns 403 when dev payments are disabled", async () => {
    const server = buildServer({ config: { ...config(SECRET), devPaymentsEnabled: false }, packageCatalog });
    const token = await authenticate(server);
    const created = await server.inject({ method: "POST", url: "/v1/orders", headers: { authorization: `Bearer ${token}` }, payload: { packageId: "credits-100" } });
    const { order } = created.json() as { order: { id: string } };
    const response = await server.inject({ method: "POST", url: "/v1/payments/dev-complete", headers: { authorization: `Bearer ${token}` }, payload: { orderId: order.id } });
    expect(response.statusCode).toBe(403);
  });

  it("rejects an unauthenticated dev-complete", async () => {
    const server = buildServer({ config: { ...config(SECRET), devPaymentsEnabled: true }, packageCatalog });
    const response = await server.inject({ method: "POST", url: "/v1/payments/dev-complete", payload: { orderId: "x" } });
    expect(response.statusCode).toBe(401);
  });

  it("404s for an order the caller does not own", async () => {
    const server = buildServer({ config: { ...config(SECRET), devPaymentsEnabled: true }, packageCatalog });
    const token = await authenticate(server);
    const response = await server.inject({ method: "POST", url: "/v1/payments/dev-complete", headers: { authorization: `Bearer ${token}` }, payload: { orderId: "missing" } });
    expect(response.statusCode).toBe(404);
  });

  it("completes payment and credits the buyer (idempotent)", async () => {
    const server = buildServer({ config: { ...config(SECRET), devPaymentsEnabled: true }, packageCatalog });
    const token = await authenticate(server);
    const auth = { authorization: `Bearer ${token}` };
    const created = await server.inject({ method: "POST", url: "/v1/orders", headers: auth, payload: { packageId: "credits-100" } });
    const { order } = created.json() as { order: { id: string } };
    const before = ((await server.inject({ method: "GET", url: "/v1/credits/balance", headers: auth })).json() as { balance: { credits: number } }).balance.credits;

    const done = await server.inject({ method: "POST", url: "/v1/payments/dev-complete", headers: auth, payload: { orderId: order.id } });
    expect(done.statusCode).toBe(200);
    expect((done.json() as { order: { status: string } }).order.status).toBe("paid");
    const after = ((await server.inject({ method: "GET", url: "/v1/credits/balance", headers: auth })).json() as { balance: { credits: number } }).balance.credits;
    expect(after).toBe(before + 100);

    // idempotent
    await server.inject({ method: "POST", url: "/v1/payments/dev-complete", headers: auth, payload: { orderId: order.id } });
    const final = ((await server.inject({ method: "GET", url: "/v1/credits/balance", headers: auth })).json() as { balance: { credits: number } }).balance.credits;
    expect(final).toBe(before + 100);
  });
});
```

(Ensure the `config` helper includes `devPaymentsEnabled` in the `ApiConfig` literal it returns; because it's a required field now, the helper must set it.)

- [ ] **Step 4: Implement the route (deps refactor + dev-complete)**

Rewrite `apps/api/src/routes/payments.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import { createAuthGuard } from "./authGuard";
import type { AuthService } from "../services/authService";
import type { OrderService } from "../services/orderService";
import type { PaymentService } from "../services/paymentService";
import { PaymentServiceError } from "../services/paymentService";
import { signWebhookPayload } from "../services/webhookSignature";

export interface PaymentRouteDeps {
  paymentService: PaymentService;
  orderService: OrderService;
  authService: AuthService;
  secret?: string;
  devPaymentsEnabled: boolean;
}

export function registerPaymentRoutes(server: FastifyInstance, deps: PaymentRouteDeps): void {
  server.post("/v1/payments/webhook", async (request, reply) => {
    const rawBody = request.rawBody ?? "";
    const header = request.headers["x-gw-signature"];
    const signature = Array.isArray(header) ? header[0] : header;
    try {
      await deps.paymentService.handleWebhookEvent({ rawBody, signature });
      return reply.status(200).send({ received: true });
    } catch (error) {
      if (error instanceof PaymentServiceError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  const preHandler = createAuthGuard(deps.authService);
  server.post("/v1/payments/dev-complete", { preHandler }, async (request, reply) => {
    if (!deps.devPaymentsEnabled) {
      return reply.status(403).send({ error: "Dev payment completion is disabled" });
    }
    const body = request.body;
    if (typeof body !== "object" || body === null || typeof (body as { orderId?: unknown }).orderId !== "string") {
      return reply.status(400).send({ error: "Invalid dev-complete request" });
    }
    const orderId = (body as { orderId: string }).orderId;
    const order = await deps.orderService.getOrder(request.userId!, orderId);
    if (!order) {
      return reply.status(404).send({ error: "Order not found" });
    }
    const rawBody = JSON.stringify({ type: "payment.succeeded", checkoutRef: order.checkoutRef });
    const signature = deps.secret ? signWebhookPayload(rawBody, deps.secret) : undefined;
    try {
      await deps.paymentService.handleWebhookEvent({ rawBody, signature });
    } catch (error) {
      if (error instanceof PaymentServiceError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
    const updated = await deps.orderService.getOrder(request.userId!, orderId);
    return reply.status(200).send({ order: updated });
  });
}
```

- [ ] **Step 5: Update buildServer registration**

In `apps/api/src/server.ts`, change `registerPaymentRoutes(server, paymentService);` to:

```typescript
  registerPaymentRoutes(server, {
    paymentService,
    orderService,
    authService,
    secret: options.config?.paymentWebhookSecret,
    devPaymentsEnabled: options.config?.devPaymentsEnabled ?? false
  });
```

- [ ] **Step 6: Run tests + typecheck + full workspace**

Run: `pnpm --filter @gw-link-omniai/api test` — all green (orderService getOrder + dev-complete route + config + existing).
Run: `pnpm --filter @gw-link-omniai/api typecheck` — clean.
Run: `pnpm test` && `pnpm typecheck` — all green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): add dev-gated POST /v1/payments/dev-complete + OrderService.getOrder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: desktop package checkout

**Files:**
- Create: `apps/desktop/src/orderModel.ts`
- Test: `apps/desktop/src/__tests__/orderModel.test.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `apiClient.listPackages/createOrder/listOrders/devCompletePayment` (Task 1); `CreditPackage`/`Order`.
- Produces: `formatPackagePrice(pkg): string`, `getOrderStatusLabel(status): string`.

- [ ] **Step 1: orderModel — write failing test**

Create `apps/desktop/src/__tests__/orderModel.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { formatPackagePrice, getOrderStatusLabel } from "../orderModel";

describe("orderModel", () => {
  it("formats a package price", () => {
    expect(formatPackagePrice({ id: "p", displayName: "P", credits: 100, amountCents: 990, currency: "CNY" })).toBe("¥9.90");
    expect(formatPackagePrice({ id: "p", displayName: "P", credits: 500, amountCents: 4500, currency: "CNY" })).toBe("¥45.00");
  });
  it("labels order status", () => {
    expect(getOrderStatusLabel("pending")).toBe("待支付");
    expect(getOrderStatusLabel("paid")).toBe("已支付");
    expect(getOrderStatusLabel("failed")).toBe("支付失败");
  });
});
```

- [ ] **Step 2: Implement orderModel**

Create `apps/desktop/src/orderModel.ts`:

```typescript
import type { CreditPackage, OrderStatus } from "@gw-link-omniai/shared";

export function formatPackagePrice(pkg: CreditPackage): string {
  return `¥${(pkg.amountCents / 100).toFixed(2)}`;
}

const orderStatusLabels: Record<OrderStatus, string> = {
  pending: "待支付",
  paid: "已支付",
  failed: "支付失败"
};

export function getOrderStatusLabel(status: OrderStatus): string {
  return orderStatusLabels[status];
}
```

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/orderModel.test.ts` — PASS.

- [ ] **Step 3: Extend the App fake client (App.test)**

In `apps/desktop/src/__tests__/App.test.tsx`, add to `createFakeClient`'s `base` object (mirror how `listModels` etc. are defined) — a stateful packages/orders/checkout fake:

```typescript
    listPackages: async () => [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }],
    createOrder: async (packageId: string) => {
      const order = { id: `order-${orders.length + 1}`, packageId, credits: 100, amountCents: 990, currency: "CNY" as const, status: "pending" as const, checkoutRef: `checkout-${orders.length + 1}`, createdAt: "2026-07-03T00:00:00.000Z" };
      orders = [order, ...orders];
      return order;
    },
    listOrders: async () => orders,
    devCompletePayment: async (orderId: string) => {
      orders = orders.map((o) => (o.id === orderId ? { ...o, status: "paid" as const } : o));
      balance += 100;
      const updated = orders.find((o) => o.id === orderId)!;
      return updated;
    }
```
Add `let orders: Order[] = [];` next to the existing `let tasks`/`let balance` declarations, and import `Order` from `@gw-link-omniai/shared`.

- [ ] **Step 4: Write the failing App test**

Add to `apps/desktop/src/__tests__/App.test.tsx`:

```typescript
it("buys a credit package and updates the balance", async () => {
  const client = createFakeClient();
  await signIn(client);
  await screen.findByText("积分：100");

  fireEvent.click(screen.getByRole("button", { name: "购买 100 积分" }));

  expect(await screen.findByText("积分：200")).toBeTruthy();
  const orders = screen.getByLabelText("订单");
  expect(await within(orders).findByText("已支付")).toBeTruthy();
});
```

- [ ] **Step 5: Wire the checkout section into App.tsx**

In `apps/desktop/src/App.tsx`:
- Import `formatPackagePrice, getOrderStatusLabel` from `./orderModel`, and `CreditPackage, Order` types from `@gw-link-omniai/shared`.
- Add state: `const [packages, setPackages] = useState<CreditPackage[]>([]);` and `const [orders, setOrders] = useState<Order[]>([]);`.
- In `loadUserData`, also load them: add `api.listPackages()` and `api.listOrders(authToken)` to the `Promise.all`, and `setPackages(...)` / `setOrders(...)`.
- Add `handleBuy`:

```typescript
  async function handleBuy(pkg: CreditPackage) {
    if (!token) {
      return;
    }
    setActionError(undefined);
    try {
      const order = await api.createOrder(pkg.id, token);
      await api.devCompletePayment(order.id, token);
      setBalance(await api.getCreditBalance(token));
      setOrders(await api.listOrders(token));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleSignedOut("登录已失效，请重新登录");
        return;
      }
      setActionError(errorMessage(error));
    }
  }
```
- In the signed-in view (not the header), add a checkout section:

```tsx
        <section aria-label="套餐">
          <h2>积分套餐</h2>
          {packages.map((pkg) => (
            <article key={pkg.id}>
              <p>{pkg.displayName} · {formatPackagePrice(pkg)} · {pkg.credits} 积分</p>
              <button type="button" onClick={() => handleBuy(pkg)}>购买 {pkg.displayName}</button>
            </article>
          ))}
        </section>
        <section aria-label="订单">
          <h2>订单</h2>
          {orders.map((order) => (
            <article key={order.id}>
              <p>{order.packageId} · {getOrderStatusLabel(order.status)}</p>
            </article>
          ))}
        </section>
```
- Clear `packages`/`orders` in `handleSignedOut` (`setPackages([])`, `setOrders([])`). Keep the existing "充值" button.

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @gw-link-omniai/desktop test` — orderModel + App (incl. buy) green.
Run: `pnpm --filter @gw-link-omniai/desktop typecheck` — clean.
Run: `pnpm test` — all green.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/orderModel.ts apps/desktop/src/__tests__/orderModel.test.ts apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
git commit -m "feat(desktop): package checkout section (buy -> dev-complete -> balance)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Documentation

**Files:**
- Modify: `README.md`, `docs/architecture/mvp-skeleton.md`, `.env.example`

- [ ] **Step 1: README.md**

Add a "### Desktop Checkout" section: the desktop lists credit packages (`GET /v1/packages`), a "购买" creates an order (`POST /v1/orders`) and completes it in dev via `POST /v1/payments/dev-complete` (gated by `GW_LINK_DEV_PAYMENTS_ENABLED`, off in production), which server-side signs a `payment.succeeded` event and runs the real webhook path — the client never holds the secret; the balance and order list refresh. In production the real provider's webhook (sub-slice B) drives crediting.

- [ ] **Step 2: mvp-skeleton.md**

Add a `## Desktop Checkout Slice` paragraph: apiClient `listPackages`/`createOrder`/`listOrders`/`devCompletePayment`; the dev-gated `dev-complete` endpoint (signs + feeds the real `PaymentService`, `devPaymentsEnabled` default off in prod); `OrderService.getOrder`; desktop package-checkout section reusing the audited credit path. Note real-provider checkout page/redirect + mobile checkout are later work.

- [ ] **Step 3: .env.example**

Add a `GW_LINK_DEV_PAYMENTS_ENABLED` comment block: enables `POST /v1/payments/dev-complete` (server-side signs + completes an order, bypassing a real provider); default on outside production, off in production; NEVER enable in production.

- [ ] **Step 4: Full workspace + commit**

Run: `pnpm test` && `pnpm typecheck` — all green.

```bash
git add README.md docs/architecture/mvp-skeleton.md .env.example
git commit -m "docs: document desktop checkout (Slice 24)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ apiClient 4 methods (spec §1) → Task 1
- ✅ devPaymentsEnabled + getOrder + dev-complete route + wiring (spec §2) → Task 2
- ✅ desktop orderModel + checkout section (spec §3) → Task 3
- ✅ docs + .env.example (spec §4) → Task 4
- ✅ errors 403/401/400/404/500 + client never holds secret → Task 2
- ✅ non-goals honored (no real provider page, no mobile checkout)

**Placeholder scan:** Task 2 Step 1 (thread `devPaymentsEnabled` through ApiConfig literals) + Task 3 Step 3 (extend the existing fake client) instruct grep/mirror rather than pasting every literal — deliberate, mirrors the devTopupEnabled precedent; all novel code (methods, route, orderModel, App wiring) is complete.

**Type consistency:** `listPackages()/createOrder(packageId, token)/listOrders(token)/devCompletePayment(orderId, token)` identical across interface, impl, App calls, tests. `getOrder(userId, orderId): Promise<Order | null>` consistent. `devPaymentsEnabled` consistent across config/buildServer/route. `formatPackagePrice`/`getOrderStatusLabel` consistent across orderModel + App. dev-complete signs with `deps.secret` and feeds `paymentService.handleWebhookEvent` (Task 4 of slice B's signature).
