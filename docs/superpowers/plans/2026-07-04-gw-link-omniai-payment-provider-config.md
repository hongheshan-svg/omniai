# 配置驱动支付 Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make checkout a config-driven provider seam — orders get a `checkoutUrl` from an active payment provider selected by config, with a Fake default and a config-driven HTTP provider that a real provider (Stripe/Alipay/WeChat) plugs into later via env.

**Architecture:** Mirror `config/models.json` + `openAiTextProvider`: `config/payment-providers.json` maps provider ids → protocol/baseUrl/apiKeyEnv; `resolvePaymentProvider` builds `FakeCheckoutProvider` (mock, default) or `HttpCheckoutProvider` (real only when its api-key env is set, else falls back to a mock URL). `OrderService.createOrder` calls the provider and persists `Order.checkoutUrl`. Clients split "购买" (create pending + show 去支付 link) from "（开发）完成支付" (dev-complete).

**Tech Stack:** TypeScript (ESM, strict), Fastify, Drizzle ORM + postgres/pglite, `@gw-link-omniai/shared`, React (desktop) + React Native (mobile), vitest.

## Global Constraints

- Product boundary: `baseUrl`, `apiKeyEnv`, api keys, and webhook secrets NEVER appear in `Order`, API responses, or logs. Clients only ever see `checkoutUrl`.
- Provider is config-driven: `config/payment-providers.json` (`activeProvider` + `providers[]`); `GW_LINK_PAYMENT_PROVIDER` overrides the active id; `GW_LINK_PAYMENT_PROVIDERS_CONFIG_PATH` overrides the path.
- `HttpCheckoutProvider` makes a real HTTP call ONLY when `env[apiKeyEnv]` is set; otherwise it falls back to a deterministic mock URL (no network, no throw) — exactly like `openAiTextProvider` falling back to `queued`.
- `Order.checkoutUrl` / `OrderRecord.checkoutUrl` are optional additive (`checkoutUrl?: string`).
- Time/ids/fetch/env are injected (no inline `Date.now()`/`globalThis.fetch` in logic paths that tests exercise).
- Clients split buy from dev-complete: 购买 creates a pending order (no auto-complete); a separate "（开发）完成支付" action calls `devCompletePayment`.
- Chinese UI copy; code and commit messages in English. Every commit ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: `Order.checkoutUrl` contract + persistence

**Files:** `packages/shared/src/orders.ts`; `apps/api/src/repositories/types.ts`; `apps/api/src/repositories/memory.ts`; `apps/api/src/db/schema.ts`; `apps/api/src/repositories/drizzle.ts`; `apps/api/drizzle/0006_*.sql` (generated); `apps/api/src/services/orderService.ts` (`toOrder`); `apps/api/src/repositories/__tests__/repositoryContract.test.ts`.

**Interfaces:** Produces `Order.checkoutUrl?: string`, `OrderRecord.checkoutUrl?: string`.

- [ ] **Step 1: contract.** In `packages/shared/src/orders.ts` add `checkoutUrl?: string;` to `Order` (after `paidAt`). In `apps/api/src/repositories/types.ts` add `checkoutUrl?: string;` to `OrderRecord` (after `paidAt`).

- [ ] **Step 2: failing contract test.** In `apps/api/src/repositories/__tests__/repositoryContract.test.ts`, extend the existing orders round-trip test (or add a focused one in the same block): insert an order with `checkoutUrl: "https://pay.example/x"` and assert `get(...)?.checkoutUrl === "https://pay.example/x"`; an order inserted without `checkoutUrl` has `checkoutUrl` `undefined`. Use the same repository accessor the neighboring orders test uses.

- [ ] **Step 3: run red.** `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts` → FAIL (checkoutUrl not stored/mapped).

- [ ] **Step 4: memory.** In `apps/api/src/repositories/memory.ts`, `InMemoryOrderRepository.insert` already stores the whole record via `structuredClone` — no change needed if `checkoutUrl` is part of `OrderRecord`. Confirm `insert` clones the full record (it does). No code change unless insert cherry-picks fields (it does not).

- [ ] **Step 5: Drizzle schema + mapping.** In `apps/api/src/db/schema.ts` `orders` table, add after `paidAt`: `checkoutUrl: text("checkout_url")` (nullable). In `apps/api/src/repositories/drizzle.ts`: the insert must include `checkoutUrl: record.checkoutUrl ?? null` (find `DrizzleOrderRepository.insert` and add the field); `mapOrderRow` adds `...(row.checkoutUrl ? { checkoutUrl: row.checkoutUrl } : {})`.

- [ ] **Step 6: migration.** `pnpm --filter @gw-link-omniai/api db:generate` → new `apps/api/drizzle/0006_*.sql` with `ALTER TABLE "orders" ADD COLUMN "checkout_url" text;` (+ meta snapshot). Commit what is generated.

- [ ] **Step 7: toOrder.** In `apps/api/src/services/orderService.ts` `toOrder`, add `...(record.checkoutUrl !== undefined ? { checkoutUrl: record.checkoutUrl } : {})`.

- [ ] **Step 8: run green + typecheck.** `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts` → PASS (memory + pglite). `pnpm --filter @gw-link-omniai/shared typecheck && pnpm --filter @gw-link-omniai/api typecheck` → clean.

- [ ] **Step 9: commit.** `git add` the shared + repo + schema + drizzle dir + orderService + contract test; message `feat(api): add optional Order.checkoutUrl persisted through the order repository`.

---

### Task 2: payment-providers config + loader

**Files:** `config/payment-providers.json` (new); `apps/api/src/services/paymentProviderConfig.ts` (new) + test; `apps/api/src/config.ts`; `apps/api/src/__tests__/config.test.ts` + every full `ApiConfig` literal.

**Interfaces:** Produces `PaymentProviderDefinition`, `PaymentProvidersConfig`, `loadPaymentProvidersConfig(path)`; `ApiConfig.paymentProvidersConfigPath: string`, `ApiConfig.paymentProvider?: string`.

- [ ] **Step 1: config file.** Create `config/payment-providers.json`:

```json
{
  "activeProvider": "fake",
  "providers": [
    { "id": "fake", "displayName": "Mock Checkout", "protocol": "mock", "baseUrl": "", "apiKeyEnv": "", "webhookSecretEnv": "GW_LINK_PAYMENT_WEBHOOK_SECRET" },
    { "id": "stripe", "displayName": "Stripe", "protocol": "http-checkout", "baseUrl": "https://api.stripe.com/v1", "apiKeyEnv": "STRIPE_API_KEY", "webhookSecretEnv": "STRIPE_WEBHOOK_SECRET" }
  ]
}
```

- [ ] **Step 2: loader + types (with failing test).** Create `apps/api/src/services/__tests__/paymentProviderConfig.test.ts` first: `loadPaymentProvidersConfig` parses a valid temp/fixture object (assert `activeProvider` + `providers[0].id`), and throws on a malformed shape (e.g. missing `providers`). Then create `apps/api/src/services/paymentProviderConfig.ts`:

```typescript
import { readFileSync } from "node:fs";

export interface PaymentProviderDefinition {
  id: string;
  displayName: string;
  protocol: string;
  baseUrl: string;
  apiKeyEnv: string;
  webhookSecretEnv?: string;
}
export interface PaymentProvidersConfig {
  activeProvider: string;
  providers: PaymentProviderDefinition[];
}

function isDefinition(value: unknown): value is PaymentProviderDefinition {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.displayName === "string" &&
    typeof v.protocol === "string" &&
    typeof v.baseUrl === "string" &&
    typeof v.apiKeyEnv === "string" &&
    (v.webhookSecretEnv === undefined || typeof v.webhookSecretEnv === "string")
  );
}

export function parsePaymentProvidersConfig(value: unknown): PaymentProvidersConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid payment-providers config: not an object");
  }
  const v = value as Record<string, unknown>;
  if (typeof v.activeProvider !== "string" || !Array.isArray(v.providers) || !v.providers.every(isDefinition)) {
    throw new Error("Invalid payment-providers config: bad shape");
  }
  return { activeProvider: v.activeProvider, providers: v.providers as PaymentProviderDefinition[] };
}

export function loadPaymentProvidersConfig(path: string): PaymentProvidersConfig {
  return parsePaymentProvidersConfig(JSON.parse(readFileSync(path, "utf8")));
}
```

(The test can call `parsePaymentProvidersConfig` directly with objects to avoid filesystem coupling; keep one `loadPaymentProvidersConfig` smoke read against `config/payment-providers.json` via `resolveConfigPath`.)

- [ ] **Step 3: config fields.** In `apps/api/src/config.ts`: add `paymentProvidersConfigPath: string;` and `paymentProvider?: string;` to `ApiConfig`. In `loadConfig`: `paymentProvidersConfigPath: env.GW_LINK_PAYMENT_PROVIDERS_CONFIG_PATH ?? "config/payment-providers.json",` and `paymentProvider: env.GW_LINK_PAYMENT_PROVIDER,`.

- [ ] **Step 4: fix ApiConfig literals.** `grep -rn "packagesConfigPath" apps/api/src --include=*.ts` to find every full `ApiConfig` literal; add `paymentProvidersConfigPath: "config/payment-providers.json"` (and omit `paymentProvider` since it is optional) to each. In `config.test.ts` assert the new defaults.

- [ ] **Step 5: run + commit.** `pnpm --filter @gw-link-omniai/api test && pnpm --filter @gw-link-omniai/api typecheck` → green. Commit: `feat(api): payment-providers config + loader`.

---

### Task 3: PaymentProvider seam (Fake + Http + resolve)

**Files:** `apps/api/src/services/paymentProvider.ts` (new); `apps/api/src/services/fakeCheckoutProvider.ts` (new); `apps/api/src/services/httpCheckoutProvider.ts` (new); tests for each.

**Interfaces:** Produces `PaymentProvider`, `PaymentCheckoutRequest`, `PaymentCheckoutResult`, `PaymentProviderError`, `FakeCheckoutProvider`, `HttpCheckoutProvider`, `resolvePaymentProvider(config, { env, publicBaseUrl, fetch? })`.

- [ ] **Step 1: seam + Fake (with failing tests).** Write `apps/api/src/services/__tests__/fakeCheckoutProvider.test.ts`: `new FakeCheckoutProvider("https://app.test").createCheckout({ checkoutRef: "chk_1", amountCents: 990, currency: "CNY", packageId: "credits-100" })` resolves to `{ checkoutUrl: "https://app.test/checkout/mock?ref=chk_1", providerRef: "chk_1" }`. Then create `apps/api/src/services/paymentProvider.ts`:

```typescript
export interface PaymentCheckoutRequest {
  checkoutRef: string;
  amountCents: number;
  currency: string;
  packageId: string;
}
export interface PaymentCheckoutResult {
  checkoutUrl: string;
  providerRef: string;
}
export interface PaymentProvider {
  createCheckout(request: PaymentCheckoutRequest): Promise<PaymentCheckoutResult>;
}
export class PaymentProviderError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
```

and `apps/api/src/services/fakeCheckoutProvider.ts`:

```typescript
import type { PaymentCheckoutRequest, PaymentCheckoutResult, PaymentProvider } from "./paymentProvider";

export class FakeCheckoutProvider implements PaymentProvider {
  constructor(private readonly publicBaseUrl: string) {}
  async createCheckout(request: PaymentCheckoutRequest): Promise<PaymentCheckoutResult> {
    const base = this.publicBaseUrl.replace(/\/$/, "");
    return { checkoutUrl: `${base}/checkout/mock?ref=${request.checkoutRef}`, providerRef: request.checkoutRef };
  }
}
```

- [ ] **Step 2: Http provider (with failing tests).** Write `apps/api/src/services/__tests__/httpCheckoutProvider.test.ts`:
  - **no key → fallback:** with `env = {}`, `createCheckout` returns the same mock URL as Fake (`{publicBaseUrl}/checkout/mock?ref=chk_1`); `fetch` is NOT called.
  - **with key → real call:** `env = { STRIPE_API_KEY: "sk_test" }`, a `fetch` mock returning `{ url: "https://pay/x", id: "cs_1" }` (200) → result `{ checkoutUrl: "https://pay/x", providerRef: "cs_1" }`; assert the request URL is `${baseUrl}/checkout/sessions`, method POST, `authorization: Bearer sk_test`, body includes `reference: "chk_1"`, `amountCents`, `currency`.
  - **non-2xx → PaymentProviderError(502).**

  Then create `apps/api/src/services/httpCheckoutProvider.ts`:

```typescript
import type { PaymentProviderDefinition } from "./paymentProviderConfig";
import { PaymentProviderError, type PaymentCheckoutRequest, type PaymentCheckoutResult, type PaymentProvider } from "./paymentProvider";

export interface HttpCheckoutProviderOptions {
  definition: PaymentProviderDefinition;
  publicBaseUrl: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export class HttpCheckoutProvider implements PaymentProvider {
  private readonly definition: PaymentProviderDefinition;
  private readonly publicBaseUrl: string;
  private readonly env: Record<string, string | undefined>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpCheckoutProviderOptions) {
    this.definition = options.definition;
    this.publicBaseUrl = options.publicBaseUrl;
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async createCheckout(request: PaymentCheckoutRequest): Promise<PaymentCheckoutResult> {
    const apiKey = this.env[this.definition.apiKeyEnv];
    if (!apiKey) {
      const base = this.publicBaseUrl.replace(/\/$/, "");
      return { checkoutUrl: `${base}/checkout/mock?ref=${request.checkoutRef}`, providerRef: request.checkoutRef };
    }
    const url = `${this.definition.baseUrl.replace(/\/$/, "")}/checkout/sessions`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          reference: request.checkoutRef,
          amountCents: request.amountCents,
          currency: request.currency,
          packageId: request.packageId
        })
      });
    } catch {
      throw new PaymentProviderError("Checkout provider request failed", 502);
    }
    if (!response.ok) {
      throw new PaymentProviderError(`Checkout provider returned ${response.status}`, 502);
    }
    let payload: { url?: unknown; id?: unknown };
    try {
      payload = (await response.json()) as { url?: unknown; id?: unknown };
    } catch {
      throw new PaymentProviderError("Checkout provider returned invalid JSON", 502);
    }
    if (typeof payload.url !== "string" || typeof payload.id !== "string") {
      throw new PaymentProviderError("Checkout provider returned an unexpected shape", 502);
    }
    return { checkoutUrl: payload.url, providerRef: payload.id };
  }
}
```

- [ ] **Step 3: resolver (with failing test).** Add to `apps/api/src/services/paymentProvider.ts` (or a `resolvePaymentProvider.ts`) — put the resolver where it can import both providers without a cycle; a new file `apps/api/src/services/resolvePaymentProvider.ts` is cleanest:

```typescript
import type { PaymentProvidersConfig } from "./paymentProviderConfig";
import type { PaymentProvider } from "./paymentProvider";
import { FakeCheckoutProvider } from "./fakeCheckoutProvider";
import { HttpCheckoutProvider } from "./httpCheckoutProvider";

export function resolvePaymentProvider(
  config: PaymentProvidersConfig,
  options: { env?: Record<string, string | undefined>; publicBaseUrl: string; fetch?: typeof fetch; activeProviderOverride?: string }
): PaymentProvider {
  const activeId = options.activeProviderOverride ?? config.activeProvider;
  const definition = config.providers.find((p) => p.id === activeId);
  if (!definition) {
    throw new Error(`Unknown payment provider: ${activeId}`);
  }
  if (definition.protocol === "mock") {
    return new FakeCheckoutProvider(options.publicBaseUrl);
  }
  return new HttpCheckoutProvider({ definition, publicBaseUrl: options.publicBaseUrl, env: options.env, fetch: options.fetch });
}
```

  Test (`resolvePaymentProvider.test.ts`): active "fake" (protocol mock) → `FakeCheckoutProvider` (instanceof); `activeProviderOverride: "stripe"` → `HttpCheckoutProvider`; unknown id → throws.

- [ ] **Step 4: run green + commit.** Run all four provider test files + `pnpm --filter @gw-link-omniai/api typecheck`. Commit: `feat(api): PaymentProvider seam — Fake + config-driven Http + resolver`.

---

### Task 4: wire the provider into OrderService + server

**Files:** `apps/api/src/services/orderService.ts`; `apps/api/src/server.ts`; `apps/api/src/services/appServices.ts`; `apps/api/src/services/__tests__/orderService.test.ts`.

**Interfaces:** `OrderServiceOptions` gains `paymentProvider?: PaymentProvider`; `createOrder` sets `checkoutUrl` from it.

- [ ] **Step 1: failing test.** In `apps/api/src/services/__tests__/orderService.test.ts`, add: construct `new InMemoryOrderService(catalog, { paymentProvider: new FakeCheckoutProvider("https://app.test"), ...existing idGenerator/checkoutRefGenerator })` with a fixed `checkoutRefGenerator: () => "chk_1"`; `createOrder(...)` returns an order with `checkoutUrl: "https://app.test/checkout/mock?ref=chk_1"`. Add a second: a provider whose `createCheckout` throws `new PaymentProviderError("boom", 502)` → `createOrder` rejects with an `OrderServiceError` whose `statusCode` is 502.

- [ ] **Step 2: run red.** `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/orderService.test.ts` → FAIL.

- [ ] **Step 3: implement.** In `apps/api/src/services/orderService.ts`:
  - import `PaymentProvider`, `PaymentProviderError` from `./paymentProvider` and `FakeCheckoutProvider` from `./fakeCheckoutProvider`.
  - Add to `OrderServiceOptions`: `paymentProvider?: PaymentProvider;` and (optional) `publicBaseUrl?: string;`.
  - In `OrderServiceImpl` add `private readonly paymentProvider: PaymentProvider;` and in the constructor: `this.paymentProvider = options.paymentProvider ?? new FakeCheckoutProvider(options.publicBaseUrl ?? "http://localhost");`.
  - In `createOrder`, after building `record` (with `checkoutRef`) and BEFORE `insert`, add:

```typescript
    try {
      const checkout = await this.paymentProvider.createCheckout({
        checkoutRef: record.checkoutRef,
        amountCents: record.amountCents,
        currency: record.currency,
        packageId: record.packageId
      });
      record.checkoutUrl = checkout.checkoutUrl;
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        throw new OrderServiceError(error.message, error.statusCode);
      }
      throw error;
    }
```

- [ ] **Step 4: run green.** Same command → PASS (new + existing orderService tests).

- [ ] **Step 5: wire buildServer + appServices.** In `apps/api/src/server.ts`: after resolving config, build the provider and pass it to the OrderService. Add a `paymentProvider?: PaymentProvider` option to `BuildServerOptions`; compute `const paymentProvider = options.paymentProvider ?? resolvePaymentProvider(loadPaymentProvidersConfig(resolveConfigPath(getConfig().paymentProvidersConfigPath)), { env: process.env, publicBaseUrl: getConfig().publicBaseUrl, activeProviderOverride: getConfig().paymentProvider });` and pass `{ paymentProvider, publicBaseUrl: getConfig().publicBaseUrl }` into the `OrderServiceImpl` options. In `apps/api/src/services/appServices.ts`, do the same for BOTH the Drizzle and in-memory OrderService construction (resolve the provider once from `config` and pass it in the options), so a production DB build and an in-memory build both get the configured provider.

- [ ] **Step 6: full api suite + typecheck + commit.** `pnpm --filter @gw-link-omniai/api test && pnpm --filter @gw-link-omniai/api typecheck` → green. Commit: `feat(api): OrderService creates a checkout via the configured payment provider`.

---

### Task 5: desktop — split buy from dev-complete + 去支付 link

**Files:** `apps/desktop/src/App.tsx`; `apps/desktop/src/__tests__/App.test.tsx`.

- [ ] **Step 1: rework the failing test.** In `apps/desktop/src/__tests__/App.test.tsx`: make the fake `createOrder` return an order WITH a `checkoutUrl` (e.g. `checkoutUrl: "https://app.test/checkout/mock?ref=checkout-1"`). Rewrite the "buys a credit package" test to the split flow:
  - click 购买 → the order appears **pending** (`待支付`) with a 去支付 link whose href is the checkoutUrl, and the balance is still 100 (no auto-complete);
  - then click "（开发）完成支付" on that order → balance becomes 200 and the order shows `已支付`.

```typescript
  it("buys a package (pending + pay link), then dev-completes it", async () => {
    const client = createFakeClient();
    await signIn(client);
    await screen.findByText("积分：100");

    fireEvent.click(screen.getByRole("button", { name: "购买 100 积分" }));

    const orders = screen.getByLabelText("订单");
    expect(await within(orders).findByText("待支付")).toBeTruthy();
    const payLink = await within(orders).findByRole("link", { name: "去支付" });
    expect(payLink.getAttribute("href")).toBe("https://app.test/checkout/mock?ref=checkout-1");
    expect(screen.getByText("积分：100")).toBeTruthy();

    fireEvent.click(await within(orders).findByRole("button", { name: "（开发）完成支付" }));
    expect(await screen.findByText("积分：200")).toBeTruthy();
    expect(await within(orders).findByText("已支付")).toBeTruthy();
  });
```

  (Set the fake `createOrder`'s returned `checkoutRef`/`checkoutUrl` so the href matches; the fake already numbers orders `order-1`/`checkout-1`.)

- [ ] **Step 2: run red.** `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx -t "buys a package"` → FAIL.

- [ ] **Step 3: implement.** In `apps/desktop/src/App.tsx`:
  - Change `handleBuy` to only create the order and refresh orders (remove the `devCompletePayment` + balance refresh):

```typescript
  async function handleBuy(pkg: CreditPackage) {
    if (!token) {
      return;
    }
    setActionError(undefined);
    try {
      await api.createOrder(pkg.id, token);
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

  - Add a dev-complete handler:

```typescript
  async function handleDevComplete(orderId: string) {
    if (!token) {
      return;
    }
    setActionError(undefined);
    try {
      await api.devCompletePayment(orderId, token);
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

  - In the 订单 list item, for a `pending` order render the pay link + dev-complete button (place inside the order `<article>`, e.g. right after the status `<p>`):

```tsx
              {order.status === "pending" && (
                <p>
                  {order.checkoutUrl ? <a href={order.checkoutUrl}>去支付</a> : null}{" "}
                  <button type="button" onClick={() => void handleDevComplete(order.id)}>（开发）完成支付</button>
                </p>
              )}
```

- [ ] **Step 4: run green + typecheck.** `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx && pnpm --filter @gw-link-omniai/desktop typecheck` → all green (the receipt/detail tests still pass; the buy flow test is the reworked one).

- [ ] **Step 5: commit.** `feat(desktop): split buy from dev-complete; show 去支付 link on pending orders`.

---

### Task 6: mobile — split buy from dev-complete + 去支付

**Files:** `apps/mobile/src/appModel.ts`; `apps/mobile/src/__tests__/appModel.test.ts`; `apps/mobile/App.tsx`.

**Interfaces:** `MobileAppController` gains `devCompleteOrder(orderId: string): Promise<void>`; `buyPackage` no longer auto-completes.

- [ ] **Step 1: failing tests.** In `apps/mobile/src/__tests__/appModel.test.ts`: make the fake `createOrder` return an order with `checkoutUrl` and status `pending` (it already builds a pending order — add `checkoutUrl: "https://app.test/checkout/mock?ref=..."`). Rework/extend:
  - `buyPackage` → `orders` has one **pending** order with a `checkoutUrl`; `balance` unchanged (still 100).
  - a new `devCompleteOrder(order.id)` → `balance` 200 and the order is `paid`.
  - `devCompleteOrder` on a 401 → signs out.

- [ ] **Step 2: run red.** `pnpm --filter @gw-link-omniai/mobile exec vitest run src/__tests__/appModel.test.ts` → FAIL.

- [ ] **Step 3: implement.** In `apps/mobile/src/appModel.ts`:
  - Change `buyPackage` to only create + refresh orders (drop the `devCompletePayment` + balance refresh):

```typescript
    async buyPackage(packageId) {
      const token = state.token;
      if (!token) {
        return;
      }
      setState({ actionError: null });
      try {
        await apiClient.createOrder(packageId, token);
        setState({ orders: await apiClient.listOrders(token) });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await signOutInternal();
          return;
        }
        setState({ actionError: purchaseError(err) });
      }
    },
```

  - Add `devCompleteOrder` to the interface and the returned object:

```typescript
    async devCompleteOrder(orderId) {
      const token = state.token;
      if (!token) {
        return;
      }
      setState({ actionError: null });
      try {
        await apiClient.devCompletePayment(orderId, token);
        const [balance, orders] = await Promise.all([
          apiClient.getCreditBalance(token),
          apiClient.listOrders(token)
        ]);
        setState({ balance: balance.credits, orders });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await signOutInternal();
          return;
        }
        setState({ actionError: purchaseError(err) });
      }
    },
```

  Add `devCompleteOrder(orderId: string): Promise<void>;` to the `MobileAppController` interface.

- [ ] **Step 4: mobile App.tsx.** In the orders `FlatList` renderItem, for a `pending` order add a 去支付 line + a dev-complete button:

```tsx
                  {item.status === "pending" ? (
                    <View>
                      {item.checkoutUrl ? <Text>去支付：{item.checkoutUrl}</Text> : null}
                      <Button title="（开发）完成支付" onPress={() => void ctrl.devCompleteOrder(item.id)} />
                    </View>
                  ) : null}
```

- [ ] **Step 5: run green + typecheck.** `pnpm --filter @gw-link-omniai/mobile exec vitest run src/__tests__/appModel.test.ts && pnpm --filter @gw-link-omniai/mobile typecheck` → green.

- [ ] **Step 6: commit.** `feat(mobile): split buy from dev-complete; show 去支付 on pending orders`.

---

### Task 7: docs + .env.example

**Files:** `README.md`; `docs/architecture/mvp-skeleton.md`; `.env.example`.

- [ ] **Step 1: README** — add `### Payment Provider (config-driven checkout)` after `### Admin Orders Dashboard`: orders get a `checkoutUrl` from the active provider in `config/payment-providers.json` (`GW_LINK_PAYMENT_PROVIDER` selects it); `FakeCheckoutProvider` (default, mock URL) vs `HttpCheckoutProvider` (real POST only when the provider's `apiKeyEnv` is set, else falls back to a mock URL); product boundary (no baseUrl/key/secret leaks); clients split 购买 (pending + 去支付) from （开发）完成支付.

- [ ] **Step 2: mvp-skeleton** — add `## Payment Provider Config Slice` paragraph (the seam, config catalog, Fake/Http/resolve, `Order.checkoutUrl` + migration 0006, OrderService wiring, client split; deferred: provider-specific adapters, redirect return/`payment.failed`/refunds).

- [ ] **Step 3: .env.example** — add a block for `GW_LINK_PAYMENT_PROVIDER` (selects the active provider id from config/payment-providers.json; default `fake`), `GW_LINK_PAYMENT_PROVIDERS_CONFIG_PATH` (default path), and a note that a real provider needs its `*_API_KEY` set (referenced by the provider's `apiKeyEnv`); without a key the provider falls back to a mock checkout URL.

- [ ] **Step 4: full suite + typecheck + commit.** `pnpm test && pnpm typecheck` → all green. Commit: `docs: document config-driven payment provider (Slice 29)`.

---

## Notes for the implementer

- `openAiTextProvider.ts` is the reference for the config-driven "real call only when the key is set, else fall back" pattern — `HttpCheckoutProvider` mirrors it (injectable fetch/env, graceful fallback).
- `Order.checkoutUrl` follows the exact additive-optional + migration pattern used by `Order.paidAt` (Slice 25).
- Adding `paymentProvidersConfigPath` to `ApiConfig` (Task 2) and `paymentProvider` to `OrderServiceOptions` (Task 4) are the two ripples: fix every full `ApiConfig` literal (grep), but `OrderServiceOptions.paymentProvider` is optional with a Fake default so existing OrderService construction points keep compiling.
- Never let `baseUrl`, api keys, or webhook secrets reach `Order`, responses, or logs — only `checkoutUrl` is a product field.
