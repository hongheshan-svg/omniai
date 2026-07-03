# Order Details + Receipt UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let desktop users expand an order to see full details, and view a formatted receipt for paid orders, backed by an additive `Order.paidAt` timestamp.

**Architecture:** Add an optional `paidAt` field to the `Order` contract, persisted through the repository seam (in-memory + Drizzle + one migration) and written by the webhook credit path when an order is marked paid. The desktop renders detail and receipt purely client-side from the already-fetched order list — no new endpoint.

**Tech Stack:** TypeScript (ESM, strict), Fastify, Drizzle ORM + postgres/pglite, React 18 + Vite (desktop), vitest.

## Global Constraints

- `Order.paidAt` is **optional and additive** (`paidAt?: string`, ISO 8601); never required. Unpaid/historical orders have no `paidAt`.
- `updateStatus` signature is `updateStatus(id: string, status: OrderStatus, paidAt?: string): Promise<void> | void`; passing no `paidAt` must leave the stored `paidAt` untouched.
- The webhook credit path stays otherwise unchanged (verify + idempotent + credit); only the mark-paid call gains a timestamp. Idempotent re-delivery must NOT overwrite `paidAt`.
- No new HTTP endpoint. The desktop renders detail/receipt from the existing `listOrders` data.
- Receipt is a **receipt**, not a tax invoice: no tax, no invoice title (抬头), no tax id.
- Services clone defensively; time/ids come from injected `clock`/generators, never inline `Date.now()`.
- Migrations are explicit and committed; startup never auto-migrates. Generated migrations live in `apps/api/drizzle/`.
- Chinese UI copy; code and commit messages in English. Every commit ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: `Order.paidAt` contract + repository persistence

**Files:**
- Modify: `packages/shared/src/orders.ts` (add `paidAt?` to `Order`)
- Modify: `apps/api/src/repositories/types.ts` (add `paidAt?` to `OrderRecord`; widen `updateStatus`)
- Modify: `apps/api/src/repositories/memory.ts` (`InMemoryOrderRepository.updateStatus`)
- Modify: `apps/api/src/db/schema.ts` (add `paid_at` column)
- Modify: `apps/api/src/repositories/drizzle.ts` (`mapOrderRow` + `DrizzleOrderRepository.updateStatus`)
- Generate: `apps/api/drizzle/0005_*.sql` (via `db:generate`)
- Modify: `apps/api/src/services/orderService.ts` (`toOrder` passes `paidAt`)
- Test: `apps/api/src/repositories/__tests__/repositoryContract.test.ts`

**Interfaces:**
- Consumes: existing `Order`, `OrderRecord`, `OrderRepository`, `orders` Drizzle table.
- Produces:
  - `Order.paidAt?: string`, `OrderRecord.paidAt?: string`
  - `OrderRepository.updateStatus(id: string, status: OrderStatus, paidAt?: string): Promise<void> | void`
  - `toOrder(record): Order` now carries `paidAt`.

- [ ] **Step 1: Add `paidAt` to the `Order` contract**

In `packages/shared/src/orders.ts`, add the field to `Order` (after `createdAt`):

```typescript
export interface Order {
  id: string;
  packageId: string;
  credits: number;
  amountCents: number;
  currency: string;
  status: OrderStatus;
  checkoutRef: string;
  createdAt: string;
  paidAt?: string;
}
```

- [ ] **Step 2: Add `paidAt` to `OrderRecord` and widen `updateStatus`**

In `apps/api/src/repositories/types.ts`, add `paidAt?: string;` to `OrderRecord` (after `createdAt`), and change the `updateStatus` line in `OrderRepository`:

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
  paidAt?: string;
}
```

```typescript
  updateStatus(id: string, status: OrderStatus, paidAt?: string): Promise<void> | void;
```

- [ ] **Step 3: Write the failing contract test**

In `apps/api/src/repositories/__tests__/repositoryContract.test.ts`, find the existing orders test that ends with:

```typescript
    await orders.updateStatus("order_1", "paid");
    expect((await orders.get("owner-a", "order_1"))?.status).toBe("paid");
  });
```

Replace those two `updateStatus`/`expect` lines (keep everything above them in the test) with:

```typescript
    await orders.updateStatus("order_1", "paid");
    const afterStatusOnly = await orders.get("owner-a", "order_1");
    expect(afterStatusOnly?.status).toBe("paid");
    expect(afterStatusOnly?.paidAt).toBeUndefined();

    await orders.updateStatus("order_1", "paid", "2026-07-03T01:02:00.000Z");
    expect((await orders.get("owner-a", "order_1"))?.paidAt).toBe("2026-07-03T01:02:00.000Z");
  });
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts`
Expected: FAIL — `updateStatus` rejects the third argument / `paidAt` is not stored (both memory and pglite variants).

- [ ] **Step 5: Implement `InMemoryOrderRepository.updateStatus`**

In `apps/api/src/repositories/memory.ts`, replace the `updateStatus` method of `InMemoryOrderRepository`:

```typescript
  updateStatus(id: string, status: OrderStatus, paidAt?: string): void {
    const row = this.rows.find((r) => r.record.id === id);
    if (row) {
      row.record.status = status;
      if (paidAt !== undefined) {
        row.record.paidAt = paidAt;
      }
    }
  }
```

- [ ] **Step 6: Add the `paid_at` column to the Drizzle schema**

In `apps/api/src/db/schema.ts`, in the `orders` table definition, add a nullable column after `createdAt`:

```typescript
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" })
```

(Note: no `.notNull()` — the column is nullable. Keep the trailing comma correct: `createdAt` line now ends with a comma, `paidAt` line has none before the closing `}`.)

- [ ] **Step 7: Map and write `paidAt` in the Drizzle repository**

In `apps/api/src/repositories/drizzle.ts`, update `mapOrderRow` to carry `paidAt`:

```typescript
function mapOrderRow(row: typeof orders.$inferSelect): OrderRecord {
  return {
    id: row.id,
    packageId: row.packageId,
    credits: row.credits,
    amountCents: row.amountCents,
    currency: row.currency,
    status: row.status as OrderStatus,
    checkoutRef: row.checkoutRef,
    createdAt: row.createdAt.toISOString(),
    ...(row.paidAt ? { paidAt: row.paidAt.toISOString() } : {})
  };
}
```

And replace `DrizzleOrderRepository.updateStatus`:

```typescript
  async updateStatus(id: string, status: OrderStatus, paidAt?: string): Promise<void> {
    await this.db
      .update(orders)
      .set({ status, ...(paidAt !== undefined ? { paidAt: new Date(paidAt) } : {}) })
      .where(eq(orders.id, id));
  }
```

- [ ] **Step 8: Generate the migration**

Run: `pnpm --filter @gw-link-omniai/api db:generate`
Expected: a new file `apps/api/drizzle/0005_*.sql` containing `ALTER TABLE "orders" ADD COLUMN "paid_at" timestamp with time zone;` (plus a `meta/` snapshot update). Do not hand-edit; commit what is generated.

- [ ] **Step 9: Pass `paidAt` through `toOrder`**

In `apps/api/src/services/orderService.ts`, update `toOrder`:

```typescript
function toOrder(record: OrderRecord): Order {
  return {
    id: record.id,
    packageId: record.packageId,
    credits: record.credits,
    amountCents: record.amountCents,
    currency: record.currency,
    status: record.status,
    checkoutRef: record.checkoutRef,
    createdAt: record.createdAt,
    ...(record.paidAt !== undefined ? { paidAt: record.paidAt } : {})
  };
}
```

- [ ] **Step 10: Run the contract test to verify it passes**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts`
Expected: PASS (memory + pglite). The pglite run applies the new `0005` migration from `apps/api/drizzle/`.

- [ ] **Step 11: Typecheck shared + api**

Run: `pnpm --filter @gw-link-omniai/shared typecheck && pnpm --filter @gw-link-omniai/api typecheck`
Expected: clean.

- [ ] **Step 12: Commit**

```bash
git add packages/shared/src/orders.ts apps/api/src/repositories/types.ts apps/api/src/repositories/memory.ts apps/api/src/db/schema.ts apps/api/src/repositories/drizzle.ts apps/api/drizzle apps/api/src/services/orderService.ts apps/api/src/repositories/__tests__/repositoryContract.test.ts
git commit -m "feat(api): add optional Order.paidAt persisted through updateStatus

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: PaymentService writes `paidAt` on mark-paid

**Files:**
- Modify: `apps/api/src/services/paymentService.ts`
- Test: `apps/api/src/services/__tests__/paymentService.test.ts`

**Interfaces:**
- Consumes: `OrderRepository.updateStatus(id, status, paidAt?)` (Task 1), `CreditService.topUp`.
- Produces: `PaymentServiceOptions.clock?: { now(): Date }`; `handleWebhookEvent` stamps `paidAt` from `clock.now().toISOString()` when marking an order paid.

- [ ] **Step 1: Write the failing test**

`apps/api/src/services/__tests__/paymentService.test.ts` already imports `InMemoryOrderRepository`, `PaymentServiceImpl`, `signWebhookPayload` and defines helpers `pendingOrder(repo)` (inserts order `order_1` for owner `user-a`, checkoutRef `checkout_1`), `fakeCredits()` (returns `{ service, calls }`), `event(checkoutRef?, type?)` (returns a signed-body JSON string), and `const SECRET`. Reuse them — no new imports. Add this test inside the existing `describe(...)` block:

```typescript
it("stamps paidAt from the injected clock when marking an order paid", async () => {
  const orders = new InMemoryOrderRepository();
  pendingOrder(orders);
  const { service: credits } = fakeCredits();
  const fixed = new Date("2026-07-03T02:30:00.000Z");
  const payment = new PaymentServiceImpl(orders, credits, { secret: SECRET, clock: { now: () => fixed } });

  const rawBody = event();
  await payment.handleWebhookEvent({ rawBody, signature: signWebhookPayload(rawBody, SECRET) });

  const order = await orders.get("user-a", "order_1");
  expect(order?.status).toBe("paid");
  expect(order?.paidAt).toBe("2026-07-03T02:30:00.000Z");

  // Idempotent re-delivery does not overwrite paidAt.
  const later = new Date("2026-07-03T09:00:00.000Z");
  const payment2 = new PaymentServiceImpl(orders, credits, { secret: SECRET, clock: { now: () => later } });
  await payment2.handleWebhookEvent({ rawBody, signature: signWebhookPayload(rawBody, SECRET) });
  expect((await orders.get("user-a", "order_1"))?.paidAt).toBe("2026-07-03T02:30:00.000Z");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/paymentService.test.ts -t "stamps paidAt"`
Expected: FAIL — `clock` is not an accepted option / `paidAt` is undefined.

- [ ] **Step 3: Add the clock option and stamp `paidAt`**

In `apps/api/src/services/paymentService.ts`, extend `PaymentServiceOptions` and the class:

```typescript
export interface PaymentServiceOptions {
  secret?: string;
  clock?: { now(): Date };
}

export class PaymentServiceImpl implements PaymentService {
  private readonly clock: { now(): Date };

  constructor(
    private readonly orders: OrderRepository,
    private readonly credits: CreditService,
    private readonly options: PaymentServiceOptions = {}
  ) {
    this.clock = options.clock ?? { now: () => new Date() };
  }
```

Then change the mark-paid line in `handleWebhookEvent`:

```typescript
    await this.orders.updateStatus(found.record.id, "paid", this.clock.now().toISOString());
    await this.credits.topUp(found.ownerUserId, found.record.credits, found.record.id, "purchase");
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/paymentService.test.ts`
Expected: PASS (new test + all existing payment tests).

- [ ] **Step 5: Typecheck api**

Run: `pnpm --filter @gw-link-omniai/api typecheck`
Expected: clean. (No `server.ts` change: `PaymentServiceImpl` is constructed with `{ secret }`; `clock` defaults to real time.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/paymentService.ts apps/api/src/services/__tests__/paymentService.test.ts
git commit -m "feat(api): stamp Order.paidAt via injected clock on webhook mark-paid

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Desktop order presentation helpers

**Files:**
- Modify: `apps/desktop/src/orderModel.ts`
- Test: `apps/desktop/src/__tests__/orderModel.test.ts`

**Interfaces:**
- Consumes: `Order`, `CreditPackage`, `OrderStatus` from `@gw-link-omniai/shared`.
- Produces:
  - `formatMoney(amountCents: number, currency: string): string`
  - `formatDateTime(iso: string): string`
  - `buildReceiptLines(order: Order, packageName: string): Array<{ label: string; value: string }>`
  - `formatPackagePrice(pkg: CreditPackage): string` (now delegates to `formatMoney`)
  - existing `getOrderStatusLabel` unchanged.

- [ ] **Step 1: Write the failing tests**

Replace the body of `apps/desktop/src/__tests__/orderModel.test.ts` with:

```typescript
import { describe, expect, it } from "vitest";
import type { Order } from "@gw-link-omniai/shared";
import {
  buildReceiptLines,
  formatDateTime,
  formatMoney,
  formatPackagePrice,
  getOrderStatusLabel
} from "../orderModel";

describe("orderModel", () => {
  it("formats money by currency", () => {
    expect(formatMoney(990, "CNY")).toBe("¥9.90");
    expect(formatMoney(4500, "CNY")).toBe("¥45.00");
    expect(formatMoney(1000, "USD")).toBe("10.00 USD");
  });

  it("formats a package price via formatMoney", () => {
    expect(formatPackagePrice({ id: "p", displayName: "P", credits: 100, amountCents: 990, currency: "CNY" })).toBe("¥9.90");
  });

  it("labels order status", () => {
    expect(getOrderStatusLabel("pending")).toBe("待支付");
    expect(getOrderStatusLabel("paid")).toBe("已支付");
    expect(getOrderStatusLabel("failed")).toBe("支付失败");
  });

  it("formats an ISO timestamp to minute precision", () => {
    expect(formatDateTime("2026-07-03T21:19:05.000Z")).toBe("2026-07-03 21:19");
  });

  it("builds receipt lines for a paid order", () => {
    const order: Order = {
      id: "order_1",
      packageId: "credits-100",
      credits: 100,
      amountCents: 990,
      currency: "CNY",
      status: "paid",
      checkoutRef: "checkout_1",
      createdAt: "2026-07-03T00:00:00.000Z",
      paidAt: "2026-07-03T02:30:00.000Z"
    };
    expect(buildReceiptLines(order, "100 积分")).toEqual([
      { label: "收据编号", value: "order_1" },
      { label: "日期", value: "2026-07-03 02:30" },
      { label: "项目", value: "100 积分" },
      { label: "积分", value: "100" },
      { label: "金额", value: "¥9.90" },
      { label: "状态", value: "已支付" }
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/orderModel.test.ts`
Expected: FAIL — `formatMoney`, `formatDateTime`, `buildReceiptLines` are not exported.

- [ ] **Step 3: Implement the helpers**

Replace the contents of `apps/desktop/src/orderModel.ts` with:

```typescript
import type { CreditPackage, Order, OrderStatus } from "@gw-link-omniai/shared";

export function formatMoney(amountCents: number, currency: string): string {
  const amount = (amountCents / 100).toFixed(2);
  return currency === "CNY" ? `¥${amount}` : `${amount} ${currency}`;
}

export function formatPackagePrice(pkg: CreditPackage): string {
  return formatMoney(pkg.amountCents, pkg.currency);
}

const orderStatusLabels: Record<OrderStatus, string> = {
  pending: "待支付",
  paid: "已支付",
  failed: "支付失败"
};

export function getOrderStatusLabel(status: OrderStatus): string {
  return orderStatusLabels[status];
}

export function formatDateTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function buildReceiptLines(order: Order, packageName: string): Array<{ label: string; value: string }> {
  return [
    { label: "收据编号", value: order.id },
    { label: "日期", value: order.paidAt ? formatDateTime(order.paidAt) : "—" },
    { label: "项目", value: packageName },
    { label: "积分", value: `${order.credits}` },
    { label: "金额", value: formatMoney(order.amountCents, order.currency) },
    { label: "状态", value: "已支付" }
  ];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/orderModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck desktop**

Run: `pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/orderModel.ts apps/desktop/src/__tests__/orderModel.test.ts
git commit -m "feat(desktop): order money/date/receipt formatters

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Desktop inline order detail + receipt

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `formatMoney`, `formatDateTime`, `buildReceiptLines`, `getOrderStatusLabel` (Task 3); `Order` (with `paidAt`, Task 1); existing `packages`/`orders` state.
- Produces: an expandable order detail block keyed by `selectedOrderId`, and a receipt block for paid orders.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/__tests__/App.test.tsx` already defines `createFakeClient(overrides)` (a fake `ApiClient` whose `listOrders` returns a closure array), the `signIn(client)` helper (renders `<App client={client} />` and completes the login flow, awaiting `"Signed in as creator"`), and imports `render`, `screen`, `within`, `fireEvent`, and the `Order` type. Seed orders by overriding `listOrders`. Add these two tests inside the `describe("Desktop App", ...)` block:

```typescript
it("expands a paid order to show detail and a receipt", async () => {
  const paidOrder: Order = {
    id: "order_seed",
    packageId: "credits-100",
    credits: 100,
    amountCents: 990,
    currency: "CNY",
    status: "paid",
    checkoutRef: "checkout_seed",
    createdAt: "2026-07-03T00:00:00.000Z",
    paidAt: "2026-07-03T02:30:00.000Z"
  };
  const client = createFakeClient({ listOrders: async () => [paidOrder] });
  await signIn(client);

  const ordersSection = screen.getByLabelText("订单");
  fireEvent.click(await within(ordersSection).findByRole("button", { name: "查看" }));

  const receipt = await screen.findByLabelText("收据");
  expect(within(receipt).getByText("¥9.90")).toBeTruthy();
  expect(within(receipt).getByText("2026-07-03 02:30")).toBeTruthy();
});

it("expands a pending order to show detail without a receipt", async () => {
  const pendingOrder: Order = {
    id: "order_pending",
    packageId: "credits-100",
    credits: 100,
    amountCents: 990,
    currency: "CNY",
    status: "pending",
    checkoutRef: "checkout_pending",
    createdAt: "2026-07-03T00:00:00.000Z"
  };
  const client = createFakeClient({ listOrders: async () => [pendingOrder] });
  await signIn(client);

  const ordersSection = screen.getByLabelText("订单");
  fireEvent.click(await within(ordersSection).findByRole("button", { name: "查看" }));

  await within(ordersSection).findByLabelText("订单详情");
  expect(screen.queryByLabelText("收据")).toBeNull();
});
```

(No new imports are needed — `render`/`screen`/`within`/`fireEvent`/`Order` are already imported in this file.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx -t "expands"`
Expected: FAIL — no `查看` button / no `收据` region rendered.

- [ ] **Step 3: Add `selectedOrderId` state and reset it on sign-out**

In `apps/desktop/src/App.tsx`, add state next to the other `useState` hooks (near `const [orders, setOrders] = useState<Order[]>([]);`):

```typescript
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
```

In `handleSignedOut`, add a reset alongside `setOrders([]);`:

```typescript
    setSelectedOrderId(null);
```

- [ ] **Step 4: Import the new helpers**

Update the orderModel import line in `apps/desktop/src/App.tsx`:

```typescript
import { buildReceiptLines, formatDateTime, formatMoney, formatPackagePrice, getOrderStatusLabel } from "./orderModel";
```

- [ ] **Step 5: Render the detail + receipt inline in the 订单 section**

In `apps/desktop/src/App.tsx`, replace the existing 订单 section:

```tsx
      <section aria-label="订单">
        <h2>订单</h2>
        {orders.map((order) => (
          <article key={order.id}>
            <p>{order.packageId} · <span>{getOrderStatusLabel(order.status)}</span></p>
          </article>
        ))}
      </section>
```

with:

```tsx
      <section aria-label="订单">
        <h2>订单</h2>
        {orders.map((order) => {
          const expanded = order.id === selectedOrderId;
          const packageName = packages.find((p) => p.id === order.packageId)?.displayName ?? order.packageId;
          return (
            <article key={order.id}>
              <p>
                {order.packageId} · <span>{getOrderStatusLabel(order.status)}</span>{" "}
                <button type="button" onClick={() => setSelectedOrderId(expanded ? null : order.id)}>
                  {expanded ? "收起" : "查看"}
                </button>
              </p>
              {expanded && (
                <div aria-label="订单详情">
                  <p>订单号：{order.id}</p>
                  <p>套餐：{packageName}</p>
                  <p>积分：{order.credits}</p>
                  <p>金额：{formatMoney(order.amountCents, order.currency)}</p>
                  <p>状态：{getOrderStatusLabel(order.status)}</p>
                  <p>下单时间：{formatDateTime(order.createdAt)}</p>
                  {order.paidAt && <p>付款时间：{formatDateTime(order.paidAt)}</p>}
                  <p>凭证：{order.checkoutRef}</p>
                  {order.status === "paid" && (
                    <dl aria-label="收据">
                      {buildReceiptLines(order, packageName).map((line) => (
                        <div key={line.label}>
                          <dt>{line.label}</dt>
                          <dd>{line.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </section>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx`
Expected: PASS (new test + all existing App tests).

- [ ] **Step 7: Typecheck desktop**

Run: `pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
git commit -m "feat(desktop): inline order detail + receipt for paid orders

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a README section**

In `README.md`, after the `### Desktop Checkout` section, add:

```markdown
### Order Details & Receipt

Each order in the desktop "订单" list has a 查看/收起 toggle that expands an
inline detail block (order id, package, credits, amount, status, created
time, paid time, checkout ref). Paid orders additionally render a formatted
收据 (receipt). The receipt and detail are rendered purely client-side from
the order list returned by `GET /v1/orders` — there is no per-order endpoint.
The paid time comes from `Order.paidAt`, an optional field stamped by the
webhook credit path when an order is marked paid; unpaid orders have none.
This is a receipt, not a tax invoice (no tax, title, or tax id).
```

- [ ] **Step 2: Add an mvp-skeleton paragraph**

In `docs/architecture/mvp-skeleton.md`, at the end of the file, add:

```markdown

## Order Details & Receipt Slice

`Order` gains an optional additive `paidAt` (ISO), persisted through the
repository seam: `OrderRecord.paidAt`, a nullable `paid_at` column
(migration `0005`), and a widened `OrderRepository.updateStatus(id, status,
paidAt?)`. `PaymentServiceImpl` takes an injected `clock` and stamps
`paidAt = clock.now()` when it marks an order paid in the webhook credit
path; idempotent re-delivery does not overwrite it. The desktop renders
order detail and, for paid orders, a receipt entirely client-side from the
existing `listOrders` data — no new endpoint. `orderModel.ts` adds
`formatMoney`, `formatDateTime`, and `buildReceiptLines`; `App.tsx` adds a
`selectedOrderId` inline expander. Deferred: a `GET /v1/orders/:id`
endpoint, mobile order UI, real tax invoices (fapiao/title/tax id), and
receipt export/print.
```

- [ ] **Step 3: Run the full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all packages green (shared, api, desktop, mobile, admin, root), typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document order details + receipt (Slice 25)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- Follow existing patterns: defensive cloning at the repository storage boundary, injected `clock`/id generators, product fields only on API surfaces.
- Do not add a per-order HTTP endpoint — the desktop already has full orders from `listOrders`.
- `formatDateTime` intentionally slices the stored ISO string (UTC, minute precision) for deterministic tests; timezone localization is deferred.
- When adding tests to existing files, read the file first and reuse its established helpers/fakes rather than introducing parallel ones.
