# Payment Webhook Credit Implementation Plan (Payment sub-slice B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed, idempotent `POST /v1/payments/webhook` that marks the matching order paid and credits its owner — the only automatic credit-granting path.

**Architecture:** HMAC-SHA256 over the raw request body (constant-time verify) gates a public webhook route. A `PaymentService` looks up the order by `checkoutRef`, and on the `pending → paid` transition marks it paid then credits the owner via `creditService.topUp(..., "purchase")`. `OrderService` and `PaymentService` share one `OrderRepository` instance so the webhook sees orders created by `POST /v1/orders`.

**Tech Stack:** Fastify, Drizzle/pglite, node:crypto (HMAC + timingSafeEqual), vitest, TypeScript strict.

## Global Constraints

- HMAC-SHA256 over the raw request body; signature in header `x-gw-signature` (hex); constant-time compare via `crypto.timingSafeEqual`.
- Webhook gated by `ApiConfig.paymentWebhookSecret` (env `GW_LINK_PAYMENT_WEBHOOK_SECRET`, optional). Secret UNSET → 500; never process unsigned/unconfigured.
- Status codes: 500 unconfigured / 401 invalid-or-missing signature / 400 invalid JSON or event shape / 404 unknown order / 200 (ignored non-`payment.succeeded`, idempotent already-processed, or success).
- Credit amount comes from the stored ORDER (`record.credits`), never from the event. `topUp` reason `"purchase"` for webhook credits.
- Idempotency: only `status === "pending"` is processed; mark paid FIRST, then credit (protects against double-credit on re-delivery; a `topUp` failure after mark-paid leaves paid-but-uncredited — a documented limitation, real fix = DB transaction, deferred).
- `OrderService` + `PaymentService` share ONE `OrderRepository` instance (built explicitly in `buildServer`/`createServices`, injected into both).
- The secret must never appear in any response body or log.
- Non-goals: real provider signature formats, concurrency/row-locks, `payment.failed`, refunds, retry queue, client UI.
- Each task green before commit.

---

## Task 1: PaymentWebhookEvent + OrderRepository lookup/update

**Files:**
- Modify: `packages/shared/src/orders.ts` (+ `index.ts` export), `packages/shared/src/__tests__/orders.test.ts`
- Modify: `apps/api/src/repositories/types.ts`, `memory.ts`, `drizzle.ts`
- Modify: `apps/api/src/repositories/__tests__/repositoryContract.test.ts`

**Interfaces:**
- Produces: `PaymentWebhookEvent { type: string; checkoutRef: string }`, `isPaymentWebhookEvent`; `OrderRepository.getByCheckoutRef(checkoutRef): Promise<{ record: OrderRecord; ownerUserId: string } | null> | ...`, `OrderRepository.updateStatus(id, status): Promise<void> | void`.

- [ ] **Step 1: shared — write the failing test**

Add to `packages/shared/src/__tests__/orders.test.ts`:

```typescript
import { isPaymentWebhookEvent } from "../orders";

describe("isPaymentWebhookEvent", () => {
  it("accepts a valid event", () => {
    expect(isPaymentWebhookEvent({ type: "payment.succeeded", checkoutRef: "checkout_1" })).toBe(true);
  });
  it("rejects invalid shapes", () => {
    expect(isPaymentWebhookEvent({ type: "payment.succeeded" })).toBe(false);
    expect(isPaymentWebhookEvent({ checkoutRef: "x" })).toBe(false);
    expect(isPaymentWebhookEvent({ type: 1, checkoutRef: "x" })).toBe(false);
    expect(isPaymentWebhookEvent(null)).toBe(false);
  });
});
```

- [ ] **Step 2: shared — implement + export**

In `packages/shared/src/orders.ts` add:

```typescript
export interface PaymentWebhookEvent {
  type: string;
  checkoutRef: string;
}

export function isPaymentWebhookEvent(value: unknown): value is PaymentWebhookEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { checkoutRef?: unknown }).checkoutRef === "string"
  );
}
```

In `packages/shared/src/index.ts`, extend the orders export line to add `PaymentWebhookEvent` (type) and `isPaymentWebhookEvent` (value):

```typescript
export type { CreditPackage, Order, OrderStatus, CreateOrderRequest, PaymentWebhookEvent } from "./orders.js";
export { isCreateOrderRequest, isPaymentWebhookEvent } from "./orders.js";
```

Run: `pnpm --filter @gw-link-omniai/shared exec vitest run src/__tests__/orders.test.ts` — PASS.

- [ ] **Step 3: repo — add contract-test cases (failing)**

In `apps/api/src/repositories/__tests__/repositoryContract.test.ts`, add order lookup/update cases following the file's existing order-repo factory + user-pre-insert convention (from sub-slice A):

```typescript
  it("finds an order by checkout ref and updates its status", async () => {
    const repo = makeOrderRepository();
    const record = {
      id: "order_1", packageId: "credits-100", credits: 100, amountCents: 990,
      currency: "CNY", status: "pending" as const, checkoutRef: "checkout_abc",
      createdAt: "2026-07-03T00:00:00.000Z"
    };
    await repo.insert(record, "owner-a");
    const found = await repo.getByCheckoutRef("checkout_abc");
    expect(found).toMatchObject({ ownerUserId: "owner-a", record: { id: "order_1", status: "pending" } });
    expect(await repo.getByCheckoutRef("missing")).toBeNull();
    await repo.updateStatus("order_1", "paid");
    expect((await repo.get("owner-a", "order_1"))?.status).toBe("paid");
  });
```

Adapt to the file's exact harness (pre-insert `owner-a`; use its per-backend factory). Read the file first.

- [ ] **Step 4: repo — extend the interface + both implementations**

In `apps/api/src/repositories/types.ts`, add to `OrderRepository`:

```typescript
  getByCheckoutRef(checkoutRef: string): Promise<{ record: OrderRecord; ownerUserId: string } | null> | { record: OrderRecord; ownerUserId: string } | null;
  updateStatus(id: string, status: OrderStatus): Promise<void> | void;
```

In `apps/api/src/repositories/memory.ts`, add to `InMemoryOrderRepository`:

```typescript
  getByCheckoutRef(checkoutRef: string): { record: OrderRecord; ownerUserId: string } | null {
    const row = this.rows.find((r) => r.record.checkoutRef === checkoutRef);
    return row ? { record: structuredClone(row.record), ownerUserId: row.ownerUserId } : null;
  }

  updateStatus(id: string, status: OrderStatus): void {
    const row = this.rows.find((r) => r.record.id === id);
    if (row) {
      row.record.status = status;
    }
  }
```
(import `OrderStatus` from `@gw-link-omniai/shared` if not already.)

In `apps/api/src/repositories/drizzle.ts`, add to `DrizzleOrderRepository` (reuse the existing `mapOrderRow` + `eq`):

```typescript
  async getByCheckoutRef(checkoutRef: string): Promise<{ record: OrderRecord; ownerUserId: string } | null> {
    const rows = await this.db.select().from(orders).where(eq(orders.checkoutRef, checkoutRef)).limit(1);
    const row = rows[0];
    return row ? { record: mapOrderRow(row), ownerUserId: row.ownerUserId } : null;
  }

  async updateStatus(id: string, status: OrderStatus): Promise<void> {
    await this.db.update(orders).set({ status }).where(eq(orders.id, id));
  }
```

- [ ] **Step 5: Run contract test + typecheck + commit**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts` — PASS (memory + pglite).
Run: `pnpm --filter @gw-link-omniai/api typecheck` — clean.

```bash
git add packages/shared apps/api/src/repositories
git commit -m "feat(api): add PaymentWebhookEvent + order lookup/update by checkoutRef

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: webhook signature helper

**Files:**
- Create: `apps/api/src/services/webhookSignature.ts`
- Test: `apps/api/src/services/__tests__/webhookSignature.test.ts`

**Interfaces:**
- Produces: `signWebhookPayload(rawBody: string, secret: string): string`, `verifyWebhookSignature(rawBody: string, signature: string | undefined, secret: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/__tests__/webhookSignature.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { signWebhookPayload, verifyWebhookSignature } from "../webhookSignature";

const secret = "whsec_test";
const body = JSON.stringify({ type: "payment.succeeded", checkoutRef: "checkout_1" });

describe("webhook signature", () => {
  it("verifies a signature it produced", () => {
    const sig = signWebhookPayload(body, secret);
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });
  it("rejects a tampered body", () => {
    const sig = signWebhookPayload(body, secret);
    expect(verifyWebhookSignature(body + " ", sig, secret)).toBe(false);
  });
  it("rejects a wrong secret", () => {
    const sig = signWebhookPayload(body, secret);
    expect(verifyWebhookSignature(body, sig, "whsec_other")).toBe(false);
  });
  it("rejects a missing or malformed signature without throwing", () => {
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(body, "", secret)).toBe(false);
    expect(verifyWebhookSignature(body, "not-hex-short", secret)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/webhookSignature.test.ts` — FAIL (module not found).

- [ ] **Step 3: Implement**

Create `apps/api/src/services/webhookSignature.ts`:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export function signWebhookPayload(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export function verifyWebhookSignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (typeof signature !== "string" || signature.length === 0) {
    return false;
  }
  const expected = signWebhookPayload(rawBody, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run + commit**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/webhookSignature.test.ts` — PASS.

```bash
git add apps/api/src/services/webhookSignature.ts apps/api/src/services/__tests__/webhookSignature.test.ts
git commit -m "feat(api): add HMAC webhook signature sign/verify helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: topUp reason + paymentWebhookSecret config

**Files:**
- Modify: `apps/api/src/services/creditService.ts`
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/src/services/__tests__/creditService.test.ts`, `apps/api/src/__tests__/config.test.ts`

**Interfaces:**
- Produces: `CreditService.topUp(userId, amount, reference?, reason?)`; `ApiConfig.paymentWebhookSecret?: string`.

- [ ] **Step 1: Write the failing test (topUp reason)**

Add to `apps/api/src/services/__tests__/creditService.test.ts` (the file already has a transactions repo/fake — mirror how existing topUp tests assert on the recorded ledger entry; if the test can read recorded transactions, assert `reason`; otherwise assert balance is unaffected and add a spy-style check consistent with the file):

```typescript
it("records a purchase-reason top-up", async () => {
  const recorded: Array<{ amount: number; reason: string; reference: string | null }> = [];
  const service = createServiceWithRecorder(recorded); // build a service whose transaction repo captures inserts — mirror the file's existing fake/InMemory repo usage
  await service.topUp("user-a", 100, "order_1", "purchase");
  expect(recorded.at(-1)).toMatchObject({ amount: 100, reason: "purchase", reference: "order_1" });
});
```

If the existing test file uses the real `InMemoryCreditTransactionRepository` (no reason readback), instead add the assertion via a small local fake transaction repository that records inserts. Read the file first and follow its established fixture style; the key assertion is that `topUp(..., "purchase")` writes `reason: "purchase"` and the default (no reason arg) still writes `reason: "topup"`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/creditService.test.ts` — FAIL (reason not honored / extra arg).

- [ ] **Step 3: Implement topUp reason**

In `apps/api/src/services/creditService.ts`: change the `CreditService` interface method to `topUp(userId: string, amount: number, reference?: string, reason?: string): Promise<void>;` and the impl body's `reason: "topup"` to `reason: reason ?? "topup"`:

```typescript
  async topUp(userId: string, amount: number, reference?: string, reason?: string): Promise<void> {
    await this.transactions.insert(
      {
        id: this.idGenerator(),
        amount,
        reason: reason ?? "topup",
        reference: reference ?? null,
        createdAt: this.clock.now().toISOString()
      },
      userId
    );
  }
```

(Adding an optional 4th param is backward compatible: existing callers and fakes that implement `topUp(userId, amount, reference)` remain assignable to the wider interface.)

- [ ] **Step 4: Add paymentWebhookSecret to config**

In `apps/api/src/config.ts`: add `paymentWebhookSecret?: string;` to `ApiConfig` (near the optional `databaseUrl?`), and in `loadConfig`'s returned object add:

```typescript
    paymentWebhookSecret: env.GW_LINK_PAYMENT_WEBHOOK_SECRET,
```

In `apps/api/src/__tests__/config.test.ts`: mirror exactly how `databaseUrl` (the existing optional field) is handled in the `toEqual` assertions — if `databaseUrl` appears in them, add `paymentWebhookSecret: undefined` alongside; add a test that `GW_LINK_PAYMENT_WEBHOOK_SECRET=whsec_x` sets `paymentWebhookSecret: "whsec_x"`. Because it is OPTIONAL (like `databaseUrl`), the other `ApiConfig` literals in the suite do NOT need updating.

- [ ] **Step 5: Run + typecheck + commit**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/creditService.test.ts src/__tests__/config.test.ts` — PASS.
Run: `pnpm --filter @gw-link-omniai/api typecheck` — clean.

```bash
git add apps/api/src/services/creditService.ts apps/api/src/config.ts apps/api/src/services/__tests__/creditService.test.ts apps/api/src/__tests__/config.test.ts
git commit -m "feat(api): topUp reason param + paymentWebhookSecret config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: PaymentService

**Files:**
- Create: `apps/api/src/services/paymentService.ts`
- Test: `apps/api/src/services/__tests__/paymentService.test.ts`

**Interfaces:**
- Consumes: `OrderRepository` (getByCheckoutRef/updateStatus), `CreditService` (topUp), `verifyWebhookSignature` (Task 2), `isPaymentWebhookEvent` (Task 1).
- Produces: `PaymentService { handleWebhookEvent(input: { rawBody: string; signature: string | undefined }): Promise<void> }`, `PaymentServiceImpl`, `PaymentServiceError` (has `statusCode`).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/__tests__/paymentService.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { InMemoryOrderRepository } from "../../repositories/memory";
import type { CreditService } from "../creditService";
import { PaymentServiceImpl, PaymentServiceError } from "../paymentService";
import { signWebhookPayload } from "../webhookSignature";

const SECRET = "whsec_test";

function pendingOrder(repo: InMemoryOrderRepository) {
  repo.insert(
    { id: "order_1", packageId: "credits-100", credits: 100, amountCents: 990, currency: "CNY", status: "pending", checkoutRef: "checkout_1", createdAt: "2026-07-03T00:00:00.000Z" },
    "user-a"
  );
}

function fakeCredits() {
  const calls: Array<{ userId: string; amount: number; reference?: string; reason?: string }> = [];
  const service = {
    getBalance: async () => ({ credits: 0, unit: "credit" as const }),
    grantInitial: async () => {},
    deduct: async () => {},
    topUp: async (userId: string, amount: number, reference?: string, reason?: string) => {
      calls.push({ userId, amount, reference, reason });
    }
  } as unknown as CreditService;
  return { service, calls };
}

function event(checkoutRef = "checkout_1", type = "payment.succeeded") {
  return JSON.stringify({ type, checkoutRef });
}

describe("PaymentServiceImpl", () => {
  it("throws 500 when the secret is not configured", async () => {
    const svc = new PaymentServiceImpl(new InMemoryOrderRepository(), fakeCredits().service, {});
    await expect(svc.handleWebhookEvent({ rawBody: event(), signature: "x" })).rejects.toMatchObject({ statusCode: 500 });
  });

  it("throws 401 on an invalid signature", async () => {
    const svc = new PaymentServiceImpl(new InMemoryOrderRepository(), fakeCredits().service, { secret: SECRET });
    await expect(svc.handleWebhookEvent({ rawBody: event(), signature: "bad" })).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 400 on an invalid payload", async () => {
    const svc = new PaymentServiceImpl(new InMemoryOrderRepository(), fakeCredits().service, { secret: SECRET });
    const raw = "not json";
    await expect(svc.handleWebhookEvent({ rawBody: raw, signature: signWebhookPayload(raw, SECRET) })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("ignores a non-succeeded event", async () => {
    const { service, calls } = fakeCredits();
    const svc = new PaymentServiceImpl(new InMemoryOrderRepository(), service, { secret: SECRET });
    const raw = event("checkout_1", "payment.pending");
    await svc.handleWebhookEvent({ rawBody: raw, signature: signWebhookPayload(raw, SECRET) });
    expect(calls).toHaveLength(0);
  });

  it("throws 404 for an unknown order", async () => {
    const svc = new PaymentServiceImpl(new InMemoryOrderRepository(), fakeCredits().service, { secret: SECRET });
    const raw = event("missing");
    await expect(svc.handleWebhookEvent({ rawBody: raw, signature: signWebhookPayload(raw, SECRET) })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("marks the order paid and credits the owner", async () => {
    const repo = new InMemoryOrderRepository();
    pendingOrder(repo);
    const { service, calls } = fakeCredits();
    const svc = new PaymentServiceImpl(repo, service, { secret: SECRET });
    const raw = event();
    await svc.handleWebhookEvent({ rawBody: raw, signature: signWebhookPayload(raw, SECRET) });
    expect(repo.get("user-a", "order_1")?.status).toBe("paid");
    expect(calls).toEqual([{ userId: "user-a", amount: 100, reference: "order_1", reason: "purchase" }]);
  });

  it("is idempotent on redelivery (no double credit)", async () => {
    const repo = new InMemoryOrderRepository();
    pendingOrder(repo);
    const { service, calls } = fakeCredits();
    const svc = new PaymentServiceImpl(repo, service, { secret: SECRET });
    const raw = event();
    const sig = signWebhookPayload(raw, SECRET);
    await svc.handleWebhookEvent({ rawBody: raw, signature: sig });
    await svc.handleWebhookEvent({ rawBody: raw, signature: sig });
    expect(calls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/paymentService.test.ts` — FAIL (module not found).

- [ ] **Step 3: Implement PaymentService**

Create `apps/api/src/services/paymentService.ts`:

```typescript
import { isPaymentWebhookEvent } from "@gw-link-omniai/shared";
import type { OrderRepository } from "../repositories/types";
import type { CreditService } from "./creditService";
import { verifyWebhookSignature } from "./webhookSignature";

export class PaymentServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "PaymentServiceError";
  }
}

export interface PaymentServiceOptions {
  secret?: string;
}

export interface PaymentService {
  handleWebhookEvent(input: { rawBody: string; signature: string | undefined }): Promise<void>;
}

export class PaymentServiceImpl implements PaymentService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly credits: CreditService,
    private readonly options: PaymentServiceOptions = {}
  ) {}

  async handleWebhookEvent(input: { rawBody: string; signature: string | undefined }): Promise<void> {
    const secret = this.options.secret;
    if (!secret) {
      throw new PaymentServiceError("Payment webhook not configured", 500);
    }
    if (!verifyWebhookSignature(input.rawBody, input.signature, secret)) {
      throw new PaymentServiceError("Invalid signature", 401);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      throw new PaymentServiceError("Invalid webhook payload", 400);
    }
    if (!isPaymentWebhookEvent(parsed)) {
      throw new PaymentServiceError("Invalid webhook payload", 400);
    }
    if (parsed.type !== "payment.succeeded") {
      return;
    }
    const found = await this.orders.getByCheckoutRef(parsed.checkoutRef);
    if (!found) {
      throw new PaymentServiceError("Order not found", 404);
    }
    if (found.record.status !== "pending") {
      return; // idempotent: already paid (or otherwise finalized) — do not re-credit
    }
    await this.orders.updateStatus(found.record.id, "paid");
    await this.credits.topUp(found.ownerUserId, found.record.credits, found.record.id, "purchase");
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/paymentService.test.ts` — PASS (7 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @gw-link-omniai/api typecheck` — clean.

```bash
git add apps/api/src/services/paymentService.ts apps/api/src/services/__tests__/paymentService.test.ts
git commit -m "feat(api): add PaymentService (verify + idempotent credit)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: webhook route + raw body + shared-repo wiring

**Files:**
- Create: `apps/api/src/routes/payments.ts`
- Modify: `apps/api/src/server.ts` (raw-body parser, shared order repo, PaymentService default, register route + entrypoint)
- Modify: `apps/api/src/services/appServices.ts` (shared DrizzleOrderRepository, `paymentService` on `AppServices`)
- Test: `apps/api/src/routes/__tests__/payments.test.ts`

**Interfaces:**
- Consumes: `PaymentService` (Task 4), `signWebhookPayload` (Task 2, for tests), `OrderServiceImpl` + `InMemoryOrderRepository`/`DrizzleOrderRepository`.
- Produces: `registerPaymentRoutes(server, paymentService)`; `POST /v1/payments/webhook`.

- [ ] **Step 1: Write the failing route/e2e tests**

Create `apps/api/src/routes/__tests__/payments.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import type { ApiConfig } from "../../config";
import { ConfigPackageCatalog } from "../../services/packageCatalog";
import { signWebhookPayload } from "../../services/webhookSignature";

const SECRET = "whsec_test";
const packageCatalog = new ConfigPackageCatalog({
  packages: [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }]
});

function config(secret?: string): ApiConfig {
  return {
    port: 8787,
    gatewayBaseUrl: "https://gateway.gw-link.local",
    authDevCodesEnabled: true,
    modelConfigPath: "config/models.json",
    packagesConfigPath: "config/credit-packages.json",
    initialCredits: 100,
    publicBaseUrl: "http://localhost:8787",
    devTopupEnabled: false,
    paymentWebhookSecret: secret
  };
}

async function authenticate(server: ReturnType<typeof buildServer>): Promise<string> {
  const start = await server.inject({ method: "POST", url: "/v1/auth/start-login", payload: { destination: "buyer@example.com" } });
  const { challengeId, devCode } = start.json() as { challengeId: string; devCode: string };
  const verify = await server.inject({ method: "POST", url: "/v1/auth/verify-login", payload: { challengeId, code: devCode } });
  return (verify.json() as { token: string }).token;
}

describe("POST /v1/payments/webhook", () => {
  it("rejects a missing signature", async () => {
    const server = buildServer({ config: config(SECRET), packageCatalog });
    const response = await server.inject({
      method: "POST",
      url: "/v1/payments/webhook",
      payload: { type: "payment.succeeded", checkoutRef: "x" }
    });
    expect(response.statusCode).toBe(401);
  });

  it("credits the buyer on a signed payment.succeeded and is idempotent", async () => {
    const server = buildServer({ config: config(SECRET), packageCatalog });
    const token = await authenticate(server);
    const auth = { authorization: `Bearer ${token}` };

    // create the order, capture its checkoutRef
    const created = await server.inject({ method: "POST", url: "/v1/orders", headers: auth, payload: { packageId: "credits-100" } });
    const { order } = created.json() as { order: { checkoutRef: string } };

    const rawBody = JSON.stringify({ type: "payment.succeeded", checkoutRef: order.checkoutRef });
    const signature = signWebhookPayload(rawBody, SECRET);

    const balanceBefore = await server.inject({ method: "GET", url: "/v1/credits/balance", headers: auth });
    const before = (balanceBefore.json() as { balance: { credits: number } }).balance.credits;

    const hook1 = await server.inject({
      method: "POST",
      url: "/v1/payments/webhook",
      headers: { "content-type": "application/json", "x-gw-signature": signature },
      payload: rawBody
    });
    expect(hook1.statusCode).toBe(200);

    const balanceAfter = await server.inject({ method: "GET", url: "/v1/credits/balance", headers: auth });
    expect((balanceAfter.json() as { balance: { credits: number } }).balance.credits).toBe(before + 100);

    // redelivery — no double credit
    const hook2 = await server.inject({
      method: "POST",
      url: "/v1/payments/webhook",
      headers: { "content-type": "application/json", "x-gw-signature": signature },
      payload: rawBody
    });
    expect(hook2.statusCode).toBe(200);
    const balanceFinal = await server.inject({ method: "GET", url: "/v1/credits/balance", headers: auth });
    expect((balanceFinal.json() as { balance: { credits: number } }).balance.credits).toBe(before + 100);
  });
});
```

Note: passing `payload: rawBody` (a pre-stringified string) with `content-type: application/json` makes Fastify receive exactly that raw body, so the signature matches. This test proves the shared-repo wiring end-to-end (order created via `/v1/orders` is found by the webhook).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/routes/__tests__/payments.test.ts` — FAIL (route not registered / rawBody undefined).

- [ ] **Step 3: Implement the route**

Create `apps/api/src/routes/payments.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { PaymentService } from "../services/paymentService";
import { PaymentServiceError } from "../services/paymentService";

export function registerPaymentRoutes(server: FastifyInstance, paymentService: PaymentService): void {
  server.post("/v1/payments/webhook", async (request, reply) => {
    const rawBody = (request as typeof request & { rawBody?: string }).rawBody ?? "";
    const header = request.headers["x-gw-signature"];
    const signature = Array.isArray(header) ? header[0] : header;
    try {
      await paymentService.handleWebhookEvent({ rawBody, signature });
      return reply.status(200).send({ received: true });
    } catch (error) {
      if (error instanceof PaymentServiceError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });
}
```

- [ ] **Step 4: Add the raw-body parser + module augmentation in server.ts**

In `apps/api/src/server.ts`, add a `declare module "fastify"` augmentation for `rawBody?: string` (top-level, like `authGuard.ts` augments `userId`), and register a content-type parser BEFORE routes:

```typescript
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}
```
Inside `buildServer`, after `server.register(cors, ...)`:

```typescript
  server.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as typeof req & { rawBody?: string }).rawBody = body as string;
    if (!body) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      done(error as Error);
    }
  });
```

- [ ] **Step 5: Share one order repository + wire PaymentService (buildServer)**

In `apps/api/src/server.ts`, replace the `const orderService = options.orderService ?? new InMemoryOrderService(getPackageCatalog());` line with an explicit shared repository, and add a defaulted `paymentService`. Import `InMemoryOrderRepository` from `./repositories/memory`, `OrderServiceImpl` from `./services/orderService`, and `PaymentServiceImpl`, `type PaymentService` from `./services/paymentService`. Add `orderService?`, `orderRepository?`, and `paymentService?` to `BuildServerOptions` (orderRepository optional for injection). Then:

```typescript
  const orderRepository = options.orderRepository ?? new InMemoryOrderRepository();
  const orderService = options.orderService ?? new OrderServiceImpl(orderRepository, getPackageCatalog());
  const paymentService =
    options.paymentService ??
    new PaymentServiceImpl(orderRepository, creditService, { secret: options.config?.paymentWebhookSecret });
```

Register the route (public, no auth guard): `registerPaymentRoutes(server, paymentService);` (add the import). `/v1/payments/webhook` is public.

- [ ] **Step 6: Wire the DB path + entrypoint (appServices + server entrypoint)**

In `apps/api/src/services/appServices.ts`: build ONE `const orderRepository = new DrizzleOrderRepository(db)` (DB path) / share the in-memory repo (in-memory path), inject it into `new OrderServiceImpl(orderRepository, packageCatalog, ...)` AND a `new PaymentServiceImpl(orderRepository, creditService, { secret: config.paymentWebhookSecret })`; add `paymentService: PaymentService` to the `AppServices` interface and return it. In `apps/api/src/server.ts` entrypoint's `buildServer({...})` call, pass `paymentService: services.paymentService` (learning from sub-slice A: the entrypoint must thread the DB-backed service).

- [ ] **Step 7: Run tests + typecheck + full workspace**

Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/routes/__tests__/payments.test.ts` — PASS.
Run: `pnpm --filter @gw-link-omniai/api test` — all api green (including existing orders/route tests unaffected by the shared-repo refactor + the new content-type parser).
Run: `pnpm --filter @gw-link-omniai/api typecheck` — clean.
Run: `pnpm test` && `pnpm typecheck` — all green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/payments.ts apps/api/src/server.ts apps/api/src/services/appServices.ts apps/api/src/routes/__tests__/payments.test.ts
git commit -m "feat(api): add POST /v1/payments/webhook + shared order repo wiring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Documentation

**Files:**
- Modify: `README.md`, `docs/architecture/mvp-skeleton.md`, `.env.example`

- [ ] **Step 1: README.md**

Add a "### Payment Webhook (crediting)" section after the Payment Orders section: `POST /v1/payments/webhook` (public, HMAC-SHA256 over the raw body in `x-gw-signature`, gated by `GW_LINK_PAYMENT_WEBHOOK_SECRET`) marks the matching order paid and credits the owner via `topUp` (reason `purchase`); idempotent on redelivery; credit amount comes from the stored order. Note real Stripe/Alipay/WeChat signature formats + concurrency/refunds + client UI are later work. Include a curl example that signs a body (or note the secret must be configured).

- [ ] **Step 2: mvp-skeleton.md**

Add a `## Payment Webhook Slice` paragraph: signature verify (constant-time HMAC), `PaymentService` idempotent `pending → paid` + `topUp("purchase")`, `OrderRepository.getByCheckoutRef`/`updateStatus`, shared order repository across OrderService + PaymentService, raw-body content-type parser, `paymentWebhookSecret` gate (unset → 500). Note the mark-paid-then-credit ordering + the paid-but-uncredited limitation (real fix = DB transaction) and the deferred non-goals.

- [ ] **Step 3: .env.example**

Add a `GW_LINK_PAYMENT_WEBHOOK_SECRET` comment block: enables `/v1/payments/webhook` signature verification; if unset the webhook rejects all events (500); never log or echo it.

- [ ] **Step 4: Full workspace + commit**

Run: `pnpm test` && `pnpm typecheck` — all green.

```bash
git add README.md docs/architecture/mvp-skeleton.md .env.example
git commit -m "docs: document payment webhook credit (Slice 23)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ PaymentWebhookEvent + repo getByCheckoutRef/updateStatus (spec §1,§2) → Task 1
- ✅ webhookSignature constant-time (spec §3) → Task 2
- ✅ topUp reason + paymentWebhookSecret (spec §4) → Task 3
- ✅ PaymentService verify/parse/idempotent/credit + statuses (spec §5) → Task 4
- ✅ route + raw body + shared repo wiring + entrypoint (spec §6,§7) → Task 5
- ✅ docs + .env.example (spec §8) → Task 6
- ✅ security: secret gate 500, 401/400/404, idempotency no-double-credit, catalog-derived amount, constant-time, no secret leak

**Placeholder scan:** Task 1 Step 3 + Task 3 Step 1 instruct reading the existing harness/fixtures rather than pasting them (contract-test harness + creditService fixture must match the file's exact style) — deliberate; all novel logic (signature, PaymentService, route, wiring) has complete code.

**Type consistency:** `getByCheckoutRef → { record, ownerUserId } | null` and `updateStatus(id, status)` identical across types/memory/drizzle/service/tests. `handleWebhookEvent({ rawBody, signature })` consistent across service, route, tests. `topUp(userId, amount, reference?, reason?)` consistent across interface/impl/PaymentService call/test. `PaymentServiceError.statusCode` mapped in the route. `paymentWebhookSecret` consistent across config/appServices/buildServer/PaymentService.
