# Mobile 订单/结账 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the desktop checkout experience (packages, buy, order detail, receipt) to the Expo mobile app, sharing one set of order-presentation helpers.

**Architecture:** Promote the pure order-presentation helpers from `apps/desktop/src/orderModel.ts` into `@gw-link-omniai/shared` (`orderView.ts`) so desktop and mobile consume one source. Extend the mobile framework-free controller (`appModel.ts`) with packages/orders/selectedOrderId state and `buyPackage`/`selectOrder`, mirroring the desktop flow (`createOrder` → `devCompletePayment` → refresh). The mobile `App.tsx` (typecheck-only) renders the sections.

**Tech Stack:** TypeScript (ESM, strict), `@gw-link-omniai/shared`, Expo 51 / React Native 0.74, vitest.

## Global Constraints

- Order-presentation helpers live in ONE place: `@gw-link-omniai/shared`. No duplication in mobile.
- Mobile buy flow mirrors desktop: `buyPackage` = `createOrder(packageId, token)` → `devCompletePayment(order.id, token)` → refresh balance + orders. `401` → sign out; other errors → `actionError`. The client never holds the webhook secret (dev-complete signs server-side).
- `apps/mobile/App.tsx` is typecheck-only (React Native cannot render under vite-node); tests target `appModel.ts`.
- Framework-free controller pattern: `setState(patch)` merges; methods are `async` where they call the API; no `Date.now()` inline.
- Receipt is shown only for `status === "paid"`; it is a receipt, not a tax invoice.
- Chinese UI copy; code and commit messages in English. Every commit ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: Promote order helpers to shared

**Files:**
- Create: `packages/shared/src/orderView.ts`
- Modify: `packages/shared/src/index.ts` (re-export)
- Create: `packages/shared/src/__tests__/orderView.test.ts`
- Modify: `apps/desktop/src/orderModel.ts` (becomes a re-export)
- Delete: `apps/desktop/src/__tests__/orderModel.test.ts`

**Interfaces:**
- Produces (from `@gw-link-omniai/shared`): `formatMoney(amountCents: number, currency: string): string`, `formatPackagePrice(pkg: CreditPackage): string`, `getOrderStatusLabel(status: OrderStatus): string`, `formatDateTime(iso: string): string`, `buildReceiptLines(order: Order, packageName: string): Array<{ label: string; value: string }>`.

- [ ] **Step 1: Create the shared module**

Create `packages/shared/src/orderView.ts`:

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

- [ ] **Step 2: Re-export from the shared barrel**

In `packages/shared/src/index.ts`, add after the orders exports at the end:

```typescript
export {
  formatMoney,
  formatPackagePrice,
  getOrderStatusLabel,
  formatDateTime,
  buildReceiptLines
} from "./orderView.js";
```

- [ ] **Step 3: Write the shared test**

Create `packages/shared/src/__tests__/orderView.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { Order } from "@gw-link-omniai/shared";
import {
  buildReceiptLines,
  formatDateTime,
  formatMoney,
  formatPackagePrice,
  getOrderStatusLabel
} from "@gw-link-omniai/shared";

describe("orderView", () => {
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

- [ ] **Step 4: Run the shared test (red→green)**

Run: `pnpm --filter @gw-link-omniai/shared exec vitest run src/__tests__/orderView.test.ts`
Expected: PASS (the module + re-export make it green immediately; this is a promotion, not new behavior).

- [ ] **Step 5: Convert desktop orderModel to a re-export**

Replace the entire contents of `apps/desktop/src/orderModel.ts` with:

```typescript
export {
  formatMoney,
  formatPackagePrice,
  getOrderStatusLabel,
  formatDateTime,
  buildReceiptLines
} from "@gw-link-omniai/shared";
```

- [ ] **Step 6: Delete the desktop orderModel test**

The assertions now live in the shared test. Delete `apps/desktop/src/__tests__/orderModel.test.ts`:

```bash
git rm apps/desktop/src/__tests__/orderModel.test.ts
```

- [ ] **Step 7: Verify desktop still passes**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run && pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: PASS — `App.tsx` imports the same names from `./orderModel` (now a re-export); App render tests (including the receipt test) still green.

- [ ] **Step 8: Typecheck shared**

Run: `pnpm --filter @gw-link-omniai/shared typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/orderView.ts packages/shared/src/index.ts packages/shared/src/__tests__/orderView.test.ts apps/desktop/src/orderModel.ts
git add -A apps/desktop/src/__tests__/orderModel.test.ts
git commit -m "refactor(shared): promote order-presentation helpers to shared/orderView

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Mobile controller — packages, orders, buy, select

**Files:**
- Modify: `apps/mobile/src/appModel.ts`
- Test: `apps/mobile/src/__tests__/appModel.test.ts`

**Interfaces:**
- Consumes: `apiClient.listPackages()`, `apiClient.createOrder(id, token)`, `apiClient.devCompletePayment(orderId, token)`, `apiClient.listOrders(token)`; `CreditPackage`, `Order` types.
- Produces: `MobileAppState` gains `packages: CreditPackage[]`, `orders: Order[]`, `selectedOrderId: string | null`; `MobileAppController` gains `buyPackage(packageId: string): Promise<void>` and `selectOrder(orderId: string | null): void`.

- [ ] **Step 1: Make the fake client's checkout methods real + write failing tests**

In `apps/mobile/src/__tests__/appModel.test.ts`, replace the four throwing checkout stubs in `createFakeClient`'s `base` object:

```typescript
    listPackages: async () => { throw new Error("unused"); },
    createOrder: async () => { throw new Error("unused"); },
    listOrders: async () => { throw new Error("unused"); },
    devCompletePayment: async () => { throw new Error("unused"); }
```

with a stateful implementation (declare `let orders: Order[] = [];` alongside the existing `let balance`/`let tasks`/`let assets` at the top of `createFakeClient`, and import the `Order`/`CreditPackage` types):

```typescript
    listPackages: async () => [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }],
    createOrder: async (packageId: string) => {
      const order: Order = {
        id: `order-${orders.length + 1}`,
        packageId,
        credits: 100,
        amountCents: 990,
        currency: "CNY",
        status: "pending",
        checkoutRef: `checkout-${orders.length + 1}`,
        createdAt: "2026-07-03T00:00:00.000Z"
      };
      orders = [order, ...orders];
      return order;
    },
    listOrders: async () => orders,
    devCompletePayment: async (orderId: string) => {
      orders = orders.map((o) => (o.id === orderId ? { ...o, status: "paid" as const, paidAt: "2026-07-03T02:30:00.000Z" } : o));
      balance += 100;
      return orders.find((o) => o.id === orderId)!;
    }
```

Update the import at the top of the test file to add the `Order` type (only `Order` is referenced in the fake — do not add `CreditPackage`, which would be an unused import):

```typescript
import type { ApiClient, AuthSession, CreationAsset, CreationAssetRequest, GenerationTask, LoginStartResponse, Order, SessionResponse } from "@gw-link-omniai/shared";
```

Then add these tests inside the top-level `describe`:

```typescript
it("loads packages and orders after verifyLogin", async () => {
  const controller = createMobileAppController({ apiClient: createFakeClient(), tokenStore: createFakeTokenStore() });
  await controller.startLogin("test@example.com");
  await controller.verifyLogin("000000");
  expect(controller.getState().packages).toHaveLength(1);
  expect(controller.getState().orders).toEqual([]);
});

it("buys a package: balance grows and a paid order appears", async () => {
  const controller = createMobileAppController({ apiClient: createFakeClient(), tokenStore: createFakeTokenStore() });
  await controller.startLogin("test@example.com");
  await controller.verifyLogin("000000");
  await controller.buyPackage("credits-100");
  const state = controller.getState();
  expect(state.balance).toBe(200);
  expect(state.orders).toHaveLength(1);
  expect(state.orders[0]?.status).toBe("paid");
});

it("signs out when buyPackage hits 401", async () => {
  const client = createFakeClient({
    createOrder: async () => { throw new ApiError("Authentication required", 401); }
  });
  const controller = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
  await controller.startLogin("test@example.com");
  await controller.verifyLogin("000000");
  await controller.buyPackage("credits-100");
  expect(controller.getState().stage).toBe("signedOut");
});

it("selects and clears the expanded order", () => {
  const controller = createMobileAppController({ apiClient: createFakeClient(), tokenStore: createFakeTokenStore() });
  controller.selectOrder("order-1");
  expect(controller.getState().selectedOrderId).toBe("order-1");
  controller.selectOrder(null);
  expect(controller.getState().selectedOrderId).toBeNull();
});

it("resets checkout state on sign out", async () => {
  const controller = createMobileAppController({ apiClient: createFakeClient(), tokenStore: createFakeTokenStore() });
  await controller.startLogin("test@example.com");
  await controller.verifyLogin("000000");
  await controller.buyPackage("credits-100");
  await controller.signOut();
  const state = controller.getState();
  expect(state.packages).toEqual([]);
  expect(state.orders).toEqual([]);
  expect(state.selectedOrderId).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @gw-link-omniai/mobile exec vitest run src/__tests__/appModel.test.ts`
Expected: FAIL — `packages`/`orders`/`selectedOrderId` and `buyPackage`/`selectOrder` do not exist.

- [ ] **Step 3: Extend `MobileAppState` and the controller interface**

In `apps/mobile/src/appModel.ts`, update the imports to include `CreditPackage`, `Order`:

```typescript
import { ApiError, buildAssetRequestFromTask, type ApiClient, type CreationAsset, type CreationMode, type CreditPackage, type GenerationTask, type Order, type PresetSuggestion } from "@gw-link-omniai/shared";
```

Add to `MobileAppState`:

```typescript
  packages: CreditPackage[];
  orders: Order[];
  selectedOrderId: string | null;
```

Add to `MobileAppController`:

```typescript
  buyPackage(packageId: string): Promise<void>;
  selectOrder(orderId: string | null): void;
```

- [ ] **Step 4: Initialize the new state**

In `createMobileAppController`, extend the initial `state`:

```typescript
  let state: MobileAppState = {
    stage: "signedOut",
    challengeId: null,
    token: null,
    balance: null,
    tasks: [],
    assets: [],
    packages: [],
    orders: [],
    selectedOrderId: null,
    actionError: null
  };
```

- [ ] **Step 5: Load packages + orders; reset on sign out; add a purchase error mapper**

In `loadUserData`, extend the `Promise.all`:

```typescript
  async function loadUserData(token: string): Promise<void> {
    const [balance, tasks, assets, packages, orders] = await Promise.all([
      apiClient.getCreditBalance(token),
      apiClient.listGenerations(token),
      apiClient.listAssets(token),
      apiClient.listPackages(),
      apiClient.listOrders(token)
    ]);
    setState({ balance: balance.credits, tasks, assets, packages, orders });
  }
```

In `signOutInternal`, reset the new fields:

```typescript
  async function signOutInternal(): Promise<void> {
    stopPolling();
    await tokenStore.clear();
    setState({ token: null, stage: "signedOut", balance: null, tasks: [], assets: [], packages: [], orders: [], selectedOrderId: null, challengeId: null });
  }
```

Add a purchase error mapper next to the other `*Error` helpers (top of file):

```typescript
function purchaseError(err: unknown): string {
  if (err instanceof ApiError) {
    return "购买失败，请稍后重试";
  }
  return "网络错误";
}
```

- [ ] **Step 6: Implement `buyPackage` and `selectOrder`**

In the returned controller object (e.g. after `saveAsset`), add:

```typescript
    async buyPackage(packageId) {
      const token = state.token;
      if (!token) {
        return;
      }
      setState({ actionError: null });
      try {
        const order = await apiClient.createOrder(packageId, token);
        await apiClient.devCompletePayment(order.id, token);
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
    selectOrder(orderId) {
      setState({ selectedOrderId: orderId });
    },
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @gw-link-omniai/mobile exec vitest run src/__tests__/appModel.test.ts`
Expected: PASS (new tests + all existing mobile appModel tests).

- [ ] **Step 8: Typecheck mobile**

Run: `pnpm --filter @gw-link-omniai/mobile typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/appModel.ts apps/mobile/src/__tests__/appModel.test.ts
git commit -m "feat(mobile): checkout state — packages, orders, buyPackage, selectOrder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Mobile UI — packages, orders, detail, receipt

**Files:**
- Modify: `apps/mobile/App.tsx`

**Interfaces:**
- Consumes: `state.packages`, `state.orders`, `state.selectedOrderId`, `ctrl.buyPackage`, `ctrl.selectOrder` (Task 2); `formatMoney`, `formatDateTime`, `getOrderStatusLabel`, `formatPackagePrice`, `buildReceiptLines` (Task 1).

- [ ] **Step 1: Import the helpers**

In `apps/mobile/App.tsx`, extend the `@gw-link-omniai/shared` import to add the five order helpers. Do NOT add `CreditPackage`/`Order` type imports — `item` inside each `FlatList` renderItem is inferred from the controller's typed `state.packages`/`state.orders`, so the types are not referenced by name in this file (adding them would be unused imports):

```typescript
import { createApiClient, type ApiClient, type CreationMode, filterCreationAssets, getAssetFilterLabel, getAssetModeLabel, summarizeAssetPrompt, type AssetFilter, formatMoney, formatDateTime, formatPackagePrice, getOrderStatusLabel, buildReceiptLines } from "@gw-link-omniai/shared";
```

- [ ] **Step 2: Render the 套餐 (packages) section**

Inside the `state.stage === "signedIn"` block, after the tasks `FlatList` and before the asset section, add a packages list:

```tsx
          <View style={styles.assetHeader}>
            <Text>积分套餐</Text>
          </View>
          <FlatList
            data={state.packages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.task}>
                <Text>{item.displayName} · {formatPackagePrice(item)} · {item.credits} 积分</Text>
                <Button title="购买" onPress={() => void ctrl.buyPackage(item.id)} />
              </View>
            )}
          />
```

- [ ] **Step 3: Render the 订单 (orders) section with inline detail + receipt**

After the packages list, add:

```tsx
          <View style={styles.assetHeader}>
            <Text>订单</Text>
          </View>
          <FlatList
            data={state.orders}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const expanded = item.id === state.selectedOrderId;
              const packageName = state.packages.find((p) => p.id === item.packageId)?.displayName ?? item.packageId;
              return (
                <View style={styles.task}>
                  <Text>{item.packageId} · {getOrderStatusLabel(item.status)}</Text>
                  <Button title={expanded ? "收起" : "查看"} onPress={() => ctrl.selectOrder(expanded ? null : item.id)} />
                  {expanded ? (
                    <View>
                      <Text>订单号：{item.id}</Text>
                      <Text>套餐：{packageName}</Text>
                      <Text>积分：{item.credits}</Text>
                      <Text>金额：{formatMoney(item.amountCents, item.currency)}</Text>
                      <Text>状态：{getOrderStatusLabel(item.status)}</Text>
                      <Text>下单时间：{formatDateTime(item.createdAt)}</Text>
                      {item.paidAt ? <Text>付款时间：{formatDateTime(item.paidAt)}</Text> : null}
                      <Text>凭证：{item.checkoutRef}</Text>
                      {item.status === "paid"
                        ? buildReceiptLines(item, packageName).map((line) => (
                            <Text key={line.label}>{line.label}：{line.value}</Text>
                          ))
                        : null}
                    </View>
                  ) : null}
                </View>
              );
            }}
          />
```

- [ ] **Step 4: Typecheck mobile**

Run: `pnpm --filter @gw-link-omniai/mobile typecheck`
Expected: clean. (`App.tsx` is typecheck-only; there is no render test.)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/App.tsx
git commit -m "feat(mobile): packages, orders, detail and receipt UI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: README**

In `README.md`, after the `### Order Details & Receipt` section, add:

```markdown
### Mobile Checkout

The Expo mobile app mirrors the desktop checkout: it lists credit packages,
"购买" creates an order and completes it in dev via the same
`devCompletePayment` path (server-side signed webhook; the client never holds
the secret), then refreshes balance and orders. Each order has a 查看/收起
toggle showing inline detail and, for paid orders, a receipt. The
order-presentation helpers (`formatMoney`, `formatDateTime`,
`getOrderStatusLabel`, `formatPackagePrice`, `buildReceiptLines`) live in
`@gw-link-omniai/shared` and are shared by desktop and mobile.
```

- [ ] **Step 2: mvp-skeleton**

In `docs/architecture/mvp-skeleton.md`, at the end, add:

```markdown

## Mobile Checkout Slice

The order-presentation helpers move from `apps/desktop/src/orderModel.ts`
into `@gw-link-omniai/shared` (`orderView.ts`); the desktop `orderModel.ts`
becomes a thin re-export so its imports are unchanged, and both desktop and
mobile consume one source. The mobile controller (`appModel.ts`) gains
`packages`/`orders`/`selectedOrderId` state, loads packages + orders in
`loadUserData`, and adds `buyPackage` (createOrder → devCompletePayment →
refresh balance + orders; 401 → sign out) and `selectOrder`. `App.tsx`
(typecheck-only) renders a packages list, an orders list with an inline
查看/收起 detail block, and a receipt for paid orders. Deferred: real
payment-provider checkout, receipt export/print.
```

- [ ] **Step 3: Full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all packages green, typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document mobile checkout (Slice 26)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- The promotion in Task 1 is behavior-preserving: `orderView.ts` is a verbatim copy of the current desktop `orderModel.ts` body; the desktop file becomes a re-export so `App.tsx` and its tests are untouched.
- Mobile `App.tsx` has no render test — Task 3 is validated by typecheck only. Do not add a render test (React Native cannot render under vite-node in this repo).
- When editing the mobile test's `createFakeClient`, keep the existing non-checkout methods intact; only replace the four throwing checkout stubs and add the `let orders` closure variable.
