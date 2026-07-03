# GW-LINK OmniAI 订单详情 + 收据 UI 设计规格

**日期**: 2026-07-03
**Slice**: 25 — 订单详情 + 收据 UI

---

## 摘要

桌面订单可内联展开查看完整详情；已支付订单附一份格式化收据。后端仅**追加** `Order.paidAt`（可选，webhook 加分标记 paid 时写入，含一个迁移），收据为**纯客户端渲染**，不新增端点——桌面 `listOrders` 已返回完整订单（含 `paidAt`）。

## 动机

支付三部曲（订单基座 / webhook 加分 / 桌面结账）已让用户能下单并看到余额增长，但「订单」区每单只显示 `packageId · 状态`，无法查看金额、时间、凭证。本片补上订单详情与一份收据视图，闭合「买完能看凭据」的体验。产品仍处假支付阶段，故做**收据（receipt）**而非真实增值税发票（fapiao）。

**非目标（留后续）**：
- `GET /v1/orders/:id` 单条端点（桌面已持有完整订单列表；待 mobile 结账真正需要时再加）
- mobile 订单/收据 UI
- 真实增值税发票、抬头、税号、税额拆分
- 收据 PDF / 打印 / 导出
- 订单快照套餐名（catalog 变更后名称漂移的处理）
- `payment.failed` 时间戳、退款
- 收据时间的时区本地化

## 设计

### 关键默认（brainstorm 确认）

- 范围 = **订单详情 + 收据视图**（不涉税/抬头/税号）。
- 收据含真实**付款时间** → 给 `Order` 加可选 `paidAt`，在 webhook 加分路径写入（含迁移）。
- 桌面**内联展开**呈现（无路由/无 modal），约束 state 最小（`selectedOrderId`）。
- 方案 A：不新增端点，收据纯客户端从已有订单渲染。

### 1. shared 契约（`packages/shared/src/orders.ts`）

`Order` 追加可选字段：
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
  paidAt?: string; // ISO；标记 paid 时写入。未支付/历史订单为 undefined
}
```
向后兼容、追加型；`isCreateOrderRequest`/`PaymentWebhookEvent` 不变。

### 2. 后端 paidAt 持久化（`apps/api`）

- **OrderRecord**（`repositories/types.ts`）加 `paidAt?: string`。
- **OrderRepository.updateStatus** 签名加可选参数：
  `updateStatus(id: string, status: OrderStatus, paidAt?: string): Promise<void> | void`。
  标记 paid 时传入 ISO；不传时不改动 paidAt。
- **内存**（`repositories/memory.ts`）：`updateStatus(id, status, paidAt?)` — 设 `row.record.status = status`，且 `if (paidAt !== undefined) row.record.paidAt = paidAt`。
- **Drizzle**：
  - schema（`db/schema.ts`）`orders` 加可空列
    `paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" })`（**不** `.notNull()`）。
  - `mapOrderRow` 映射 `paidAt: row.paidAt ? row.paidAt.toISOString() : undefined`。
  - `updateStatus(id, status, paidAt?)` — `set({ status, ...(paidAt !== undefined ? { paidAt: new Date(paidAt) } : {}) })`。
  - 迁移：`pnpm --filter @gw-link-omniai/api db:generate` 生成 `db/migrations/0005_*.sql`（`ALTER TABLE "orders" ADD COLUMN "paid_at" timestamp with time zone;`），随代码提交；启动不自动迁移。
- **orderService**（`services/orderService.ts`）：`toOrder` 透传 `paidAt`（`paidAt: record.paidAt`）。
- **契约测试**（`repositories/__tests__/repositoryContract.test.ts`）：
  - `updateStatus("order_1", "paid", "<iso>")` 后 `get("owner-a","order_1")?.paidAt === "<iso>"` 且 `status === "paid"`（memory + pglite）。
  - 现有 `updateStatus("order_1", "paid")`（不传 paidAt）用例仍通过、`paidAt` 保持 undefined。

### 3. PaymentService 写付款时间戳

- `PaymentServiceOptions` 加可选 `clock?: { now(): Date }`；`PaymentServiceImpl` 默认 `{ now: () => new Date() }`。
- `handleWebhookEvent` 标记 paid 处改为：
  `await this.orders.updateStatus(found.record.id, "paid", this.clock.now().toISOString());`
  （其余验签/幂等/加分逻辑不变。）
- **接线**（`server.ts`）：`new PaymentServiceImpl(orderRepository, creditService, { secret: options.config?.paymentWebhookSecret })` 保持不变（clock 走默认）。入口穿线不变。
- 测试：注入固定 clock，`handleWebhookEvent` 后订单 `paidAt` 等于该时刻 ISO；幂等再调不覆盖（第二次因 status 非 pending 直接返回）。

### 4. 桌面展示模型（`apps/desktop/src/orderModel.ts` 扩展）

- `formatMoney(amountCents: number, currency: string): string`
  — `currency === "CNY"` → `` `¥${(amountCents/100).toFixed(2)}` ``（如 `¥9.90`）；否则 `` `${(amountCents/100).toFixed(2)} ${currency}` ``。
  `formatPackagePrice(pkg)` 改为 `return formatMoney(pkg.amountCents, pkg.currency);`。
- `formatDateTime(iso: string): string`
  — 取存储 ISO 裁到分钟：`` `${iso.slice(0,10)} ${iso.slice(11,16)}` `` → `"2026-07-03 21:19"`（UTC、确定性、测试稳定）。
- `buildReceiptLines(order: Order, packageName: string): Array<{ label: string; value: string }>`
  — 返回：
  - `{ label: "收据编号", value: order.id }`
  - `{ label: "日期", value: order.paidAt ? formatDateTime(order.paidAt) : "—" }`
  - `{ label: "项目", value: packageName }`
  - `{ label: "积分", value: `${order.credits}` }`
  - `{ label: "金额", value: formatMoney(order.amountCents, order.currency) }`
  - `{ label: "状态", value: "已支付" }`
- 各加单测（`orderModel.test.ts`）：formatMoney（CNY/非 CNY）、formatDateTime、buildReceiptLines（字段与顺序）。

### 5. 桌面 UI（`apps/desktop/src/App.tsx`）

- 状态：`selectedOrderId: string | null`（默认 `null`）；登出/清数据时重置为 `null`。
- 「订单」区每单：现有 `packageId · <状态>` 行旁加「查看/收起」按钮（`onClick` 切换 `selectedOrderId`，再点同一单则收起）。
- 展开单（`order.id === selectedOrderId`）内联渲染**详情**：
  - 订单号 `order.id`、套餐（`packages.find(p => p.id === order.packageId)?.displayName ?? order.packageId`）、积分 `order.credits`、金额 `formatMoney(...)`、状态 `getOrderStatusLabel(order.status)`、下单时间 `formatDateTime(order.createdAt)`、付款时间（`order.paidAt` 有则 `formatDateTime(order.paidAt)`）、凭证 `order.checkoutRef`。
- `order.status === "paid"` 时额外渲染**收据**块（`aria-label="收据"`），遍历 `buildReceiptLines(order, packageName)` 渲染每行 `label: value`。
- 现有套餐/购买/充值不变。
- App.test（jsdom + @testing-library/react，复用现有 stateful fake）：
  - 点某单「查看」→ 详情可见（订单号/金额/下单时间）。
  - 已支付单展开 → 收据块含「金额」「付款时间」值；未支付单展开 → 有详情、无收据块。
  - 购买流程后（已 dev-complete）该单可展开出收据（可选，复用现有 buy 测试的订单）。

### 6. 文档

- README：「### Order Details & Receipt」小节（详情内联展开、收据仅已支付、`paidAt` 由 webhook 写入、纯客户端渲染、无新端点）。
- `docs/architecture/mvp-skeleton.md`：`## Order Details & Receipt Slice` 段落（`Order.paidAt` 追加字段、`updateStatus` 加 paidAt、PaymentService clock、桌面 orderModel 三 helper + 内联详情/收据；非目标：单条端点/mobile/真实发票）。
- `.env.example`：无改动。

## 错误处理

- 无新端点、无新失败路径。`paidAt` 可选：未支付/历史订单无付款时间、不出收据；`formatDateTime` 只在有值时调用。
- 桌面：展开纯本地状态，不触发网络；无新鉴权面。

## 测试策略

- **shared**：`Order.paidAt` 为追加可选字段，typecheck 通过；apiClient 测试不受影响。
- **api 契约测试**：`updateStatus(id,"paid",iso)` → `paidAt` 往返（memory + pglite）；不传 paidAt 时保持 undefined。
- **PaymentService**：固定 clock，`handleWebhookEvent` 后 `paidAt` 写入；幂等再调不改。
- **desktop orderModel**：formatMoney（CNY/非 CNY）、formatDateTime、buildReceiptLines 字段/顺序。
- **desktop App**：查看展开详情；已支付出收据（金额/付款时间）；未支付无收据。
- 全量 `pnpm test` + `pnpm typecheck` 全绿。

## 任务分解（约 5 任务）

1. shared `Order.paidAt` + 后端持久化：`OrderRecord`、`updateStatus` 签名、内存、Drizzle schema+mapping+updateStatus、迁移、`orderService.toOrder`、契约测试。
2. PaymentService `clock` → 标记 paid 写 `paidAt` + 接线 + 测试。
3. desktop `orderModel`：`formatMoney`/`formatDateTime`/`buildReceiptLines`（+ `formatPackagePrice` 委托）+ 测试。
4. desktop `App.tsx`：`selectedOrderId` + 内联详情 + 收据块 + 测试。
5. 文档（README + mvp-skeleton）。

## 交付清单

- [ ] `Order.paidAt` + `OrderRecord.paidAt` + `updateStatus(id,status,paidAt?)`（内存 + Drizzle + 迁移）+ `toOrder` 透传 + 契约测试
- [ ] PaymentService clock 写 paidAt + 接线 + 测试（含幂等不覆盖）
- [ ] orderModel `formatMoney`/`formatDateTime`/`buildReceiptLines` + 测试
- [ ] App.tsx 内联详情 + 收据（已支付）+ 测试
- [ ] 文档
- [ ] `pnpm test` + `pnpm typecheck` 全绿
