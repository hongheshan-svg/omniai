# 收据导出（复制到剪贴板）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let desktop users copy a paid order's receipt as plain text to the clipboard.

**Architecture:** A pure `buildReceiptText(order, packageName)` in `@gw-link-omniai/shared` formats the receipt (reusing `buildReceiptLines`); the desktop `App.tsx` adds a "复制收据" button that calls an injectable `copyText` side effect (default `navigator.clipboard.writeText`) and shows a "已复制收据" status.

**Tech Stack:** TypeScript (ESM, strict), `@gw-link-omniai/shared`, React 18 + Vite (desktop, jsdom render tests), vitest.

## Global Constraints

- `buildReceiptText` reuses `buildReceiptLines` (same fields/order as the on-screen receipt); output is `"收据"` followed by one `label：value` line per receipt line, joined by `\n`.
- The copy side effect is INJECTABLE: `App` takes `copyText?: (text: string) => Promise<void>`, default `(text) => navigator.clipboard.writeText(text)`. Tests inject a fake; production uses the clipboard.
- The "复制收据" button appears only inside the paid-order receipt block.
- Copy success → a `role="status"` "已复制收据"; failure → `actionError` "复制失败，请重试" (no crash).
- Desktop-only; PDF/print/file export are out of scope.
- Chinese UI copy; code and commit messages in English. Every commit ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: `buildReceiptText` in shared

**Files:**
- Modify: `packages/shared/src/orderView.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/orderView.test.ts`

**Interfaces:**
- Consumes: existing `buildReceiptLines(order, packageName)`.
- Produces: `buildReceiptText(order: Order, packageName: string): string`.

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/__tests__/orderView.test.ts`, add `buildReceiptText` to the import from `../orderView`, and add this test inside the `describe`:

```typescript
  it("builds a plain-text receipt", () => {
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
    expect(buildReceiptText(order, "100 积分")).toBe(
      ["收据", "收据编号：order_1", "日期：2026-07-03 02:30", "项目：100 积分", "积分：100", "金额：¥9.90", "状态：已支付"].join("\n")
    );
  });
```

The import line at the top becomes:

```typescript
import {
  buildReceiptLines,
  buildReceiptText,
  formatDateTime,
  formatMoney,
  formatPackagePrice,
  getOrderStatusLabel
} from "../orderView";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/shared exec vitest run src/__tests__/orderView.test.ts`
Expected: FAIL — `buildReceiptText` is not exported.

- [ ] **Step 3: Implement `buildReceiptText`**

In `packages/shared/src/orderView.ts`, add at the end:

```typescript
export function buildReceiptText(order: Order, packageName: string): string {
  return ["收据", ...buildReceiptLines(order, packageName).map((line) => `${line.label}：${line.value}`)].join("\n");
}
```

- [ ] **Step 4: Re-export from the barrel**

In `packages/shared/src/index.ts`, add `buildReceiptText` to the existing `orderView` re-export block:

```typescript
export {
  formatMoney,
  formatPackagePrice,
  getOrderStatusLabel,
  formatDateTime,
  buildReceiptLines,
  buildReceiptText
} from "./orderView.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @gw-link-omniai/shared exec vitest run src/__tests__/orderView.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck shared**

Run: `pnpm --filter @gw-link-omniai/shared typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/orderView.ts packages/shared/src/index.ts packages/shared/src/__tests__/orderView.test.ts
git commit -m "feat(shared): buildReceiptText plain-text receipt formatter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Desktop "复制收据" button

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `buildReceiptText` (Task 1); existing receipt block, `orders`/`packages`/`selectedOrderId` state.
- Produces: an injectable `copyText` prop and a "复制收据" action with a "已复制收据" status.

- [ ] **Step 1: Write the failing test**

In `apps/desktop/src/__tests__/App.test.tsx`, add a test that copies a paid order's receipt. The file already defines `createFakeClient(overrides)` and `signIn(client)` and imports `render`, `screen`, `within`, `fireEvent`, `vi`, and the `Order` type. Add:

```typescript
it("copies a paid order's receipt to the clipboard", async () => {
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
  const copyText = vi.fn(async () => undefined);
  render(<App client={client} copyText={copyText} />);
  // sign in (mirror signIn but with our custom render above)
  fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
  await screen.findByText("开发验证码：123456");
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
  await screen.findByRole("button", { name: "Signed in as creator" });

  const ordersSection = screen.getByLabelText("订单");
  fireEvent.click(await within(ordersSection).findByRole("button", { name: "查看" }));
  fireEvent.click(await within(ordersSection).findByRole("button", { name: "复制收据" }));

  await screen.findByText("已复制收据");
  expect(copyText).toHaveBeenCalledWith(
    ["收据", "收据编号：order_seed", "日期：2026-07-03 02:30", "项目：100 积分", "积分：100", "金额：¥9.90", "状态：已支付"].join("\n")
  );
});
```

(Note: this test renders `<App>` itself with the `copyText` prop instead of using the `signIn` helper, since `signIn` renders without the prop.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx -t "copies a paid order"`
Expected: FAIL — no "复制收据" button.

- [ ] **Step 3: Add the `copyText` prop and copy state**

In `apps/desktop/src/App.tsx`, change the signature and add the resolved `copy` helper:

```typescript
export function App({ client, tokenStore, copyText }: { client?: ApiClient; tokenStore?: TokenStore; copyText?: (text: string) => Promise<void> } = {}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const store = useMemo(() => tokenStore ?? createLocalStorageTokenStore(), [tokenStore]);
  const copy = useMemo(() => copyText ?? ((text: string) => navigator.clipboard.writeText(text)), [copyText]);
```

Add copy-notice state next to `selectedOrderId`:

```typescript
  const [copyNotice, setCopyNotice] = useState<string | undefined>(undefined);
```

Import `buildReceiptText` — update the orderModel import line in `App.tsx` (it currently imports from `./orderModel`, which re-exports shared):

```typescript
import { buildReceiptLines, buildReceiptText, formatDateTime, formatMoney, formatPackagePrice, getOrderStatusLabel } from "./orderModel";
```

- [ ] **Step 4: Add the copy handler and reset on sign-out**

Add the handler (place it with the other `handle*` functions, e.g. near `handleBuy`):

```typescript
  async function handleCopyReceipt(order: Order, packageName: string) {
    setActionError(undefined);
    try {
      await copy(buildReceiptText(order, packageName));
      setCopyNotice("已复制收据");
    } catch {
      setActionError("复制失败，请重试");
    }
  }
```

In `handleSignedOut`, reset the notice alongside `setSelectedOrderId(null)`:

```typescript
    setCopyNotice(undefined);
```

- [ ] **Step 5: Render the button + status in the receipt block**

In the receipt block, after the `</dl>` closing tag (still inside the `order.status === "paid" && (...)` region), add the button; and render the notice. Replace:

```tsx
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
```

with:

```tsx
                  {order.status === "paid" && (
                    <>
                      <dl aria-label="收据">
                        {buildReceiptLines(order, packageName).map((line) => (
                          <div key={line.label}>
                            <dt>{line.label}</dt>
                            <dd>{line.value}</dd>
                          </div>
                        ))}
                      </dl>
                      <button type="button" onClick={() => void handleCopyReceipt(order, packageName)}>复制收据</button>
                    </>
                  )}
```

And render the copy notice — add it right after the existing `actionError` line (`{actionError ? <p role="alert">{actionError}</p> : null}`):

```tsx
      {copyNotice ? <p role="status">{copyNotice}</p> : null}
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
git commit -m "feat(desktop): copy paid-order receipt to clipboard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: README**

In `README.md`, after the `### Mobile Checkout` section, add:

```markdown
### Receipt Export

A paid order's receipt on the desktop has a "复制收据" button that copies the
receipt as plain text to the clipboard (`buildReceiptText` in
`@gw-link-omniai/shared` formats it from the same `buildReceiptLines`). The
clipboard write is an injectable side effect (`copyText`, default
`navigator.clipboard.writeText`), so it is unit-tested with a fake. On success
the UI shows "已复制收据"; on failure it shows "复制失败，请重试". PDF export
and system print are later work.
```

- [ ] **Step 2: mvp-skeleton**

In `docs/architecture/mvp-skeleton.md`, at the end, add:

```markdown

## Receipt Export Slice

`@gw-link-omniai/shared` adds `buildReceiptText(order, packageName)` — a
plain-text receipt built from `buildReceiptLines` (`"收据"` + one
`label：value` line each). The desktop `App.tsx` gains an injectable
`copyText` prop (default `navigator.clipboard.writeText`) and a "复制收据"
button inside the paid-order receipt block; success shows a `role="status"`
"已复制收据", failure sets `actionError`. Desktop-only; PDF/print/file export
deferred.
```

- [ ] **Step 3: Full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all packages green, typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document receipt export (Slice 27)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- `buildReceiptText` must reuse `buildReceiptLines` — do not re-list the fields; the test pins the exact string.
- The desktop copy test renders `<App client={...} copyText={vi.fn()} />` directly (not via the `signIn` helper) so it can inject the fake clipboard; mirror the login steps inline as shown.
- Keep `navigator.clipboard.writeText` only as the DEFAULT inside the component; never call it directly in a code path a test exercises.
