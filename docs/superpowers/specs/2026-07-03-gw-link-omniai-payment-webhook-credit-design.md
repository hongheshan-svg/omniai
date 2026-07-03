# GW-LINK OmniAI 支付 Webhook 加分设计规格（支付子片 B）

**日期**: 2026-07-03
**Slice**: 23 — 支付 Webhook → 加分（Payment sub-slice B）

---

## 摘要

支付系统的安全核心：`POST /v1/payments/webhook`（公开、HMAC 验签、幂等）在 `payment.succeeded` 事件到达时，按 `checkoutRef` 找到子片 A 建的订单，标记为 `paid` 并给订单 owner 加分（`topUp`，reason `"purchase"`）。真实 Stripe/Alipay/WeChat 签名格式、并发/事务、客户端 UI 留后续。

## 动机

子片 A 立了订单契约（pending 订单 + `checkoutRef`）。子片 B 让支付回调真正加分——这是唯一会给账户加分的自动路径，因此必须验签（防伪造）、幂等（防重复加分）、并且加分额度取自服务端订单（非事件）。

**非目标（留后续）**：
- 真实 Stripe/Alipay/WeChat 的具体签名格式（本片定义通用 HMAC 方案）
- 并发/行锁事务保证（in-memory + 非事务仓库）；`payment.failed → failed`；退款；重试队列
- 客户端结账 UI（子片 C）

## 设计

### 关键默认（brainstorm 确认）

- HMAC-SHA256 签**原始请求体**（realistic、面向未来）。
- 加分复用 `creditService.topUp`，加可选 `reason`（默认 `"topup"`，向后兼容），webhook 传 `"purchase"`。
- Webhook 由 `GW_LINK_PAYMENT_WEBHOOK_SECRET` 门控；**未配置则拒收（500），绝不接受未签名事件**。
- `OrderService` 与 `PaymentService` 共享同一 `OrderRepository` 实例（否则 webhook 看不到已建订单）。

### 1. 事件契约（`packages/shared/src/orders.ts` 追加，index 导出）

```typescript
export interface PaymentWebhookEvent {
  type: string; // e.g. "payment.succeeded"
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

### 2. OrderRepository 扩展（types + memory + drizzle + 契约测试）

```typescript
export interface OrderRepository {
  insert(record: OrderRecord, ownerUserId: string): Promise<void> | void;
  listByOwner(ownerUserId: string): Promise<OrderRecord[]> | OrderRecord[];
  get(ownerUserId: string, id: string): Promise<OrderRecord | null> | OrderRecord | null;
  getByCheckoutRef(checkoutRef: string): Promise<{ record: OrderRecord; ownerUserId: string } | null> | { record: OrderRecord; ownerUserId: string } | null;
  updateStatus(id: string, status: OrderStatus): Promise<void> | void;
}
```

- `getByCheckoutRef` **非 owner-scoped**（webhook 无用户上下文，全局按 checkoutRef 查，返回 record + ownerUserId）。
- `updateStatus` 按订单 id 改 status。
- memory：遍历 rows 查 checkoutRef；updateStatus 改对应 row 的 record.status（存储边界仍 clone）。
- drizzle：`select ... where checkout_ref = ?` 取一行含 owner_user_id；`update orders set status = ? where id = ?`。
- 契约测试（双后端）：getByCheckoutRef 命中返 { record, ownerUserId }、未命中 null；updateStatus 改状态后 get 反映。

### 3. 验签 helper（`apps/api/src/services/webhookSignature.ts`）

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

- `signWebhookPayload` 供 dev/测试产出有效签名（B 的 Fake provider seam）。
- `verifyWebhookSignature` constant-time；长度/类型不符安全返 false。

### 4. creditService.topUp 加 reason + config

- `CreditService.topUp(userId: string, amount: number, reference?: string, reason?: string)`；实现里 `reason: reason ?? "topup"`。向后兼容（现有调用与实现 topUp 的 fake 无需改——可选参数）。
- `ApiConfig` 加 `paymentWebhookSecret?: string`（env `GW_LINK_PAYMENT_WEBHOOK_SECRET`，可选 string，同 `databaseUrl` 风格）。

### 5. PaymentService（`apps/api/src/services/paymentService.ts`）

```typescript
interface PaymentService {
  handleWebhookEvent(input: { rawBody: string; signature: string | undefined }): Promise<void>;
}
```
`PaymentServiceImpl(orderRepository, creditService, options: { secret?: string; clock? })`：
- `secret` 未配置（undefined/空）→ 抛 `PaymentServiceError("Payment webhook not configured", 500)`。
- `verifyWebhookSignature(rawBody, signature, secret)` false → 抛 401 `"Invalid signature"`。
- `JSON.parse(rawBody)` 失败或 `!isPaymentWebhookEvent(parsed)` → 抛 400 `"Invalid webhook payload"`。
- `event.type !== "payment.succeeded"` → return（忽略，路由 200）。
- `getByCheckoutRef(event.checkoutRef)` null → 抛 404 `"Order not found"`。
- `record.status !== "pending"` → return（幂等：已 paid / 或 failed 都不重复加分）。
- `record.status === "pending"` → **先** `updateStatus(record.id, "paid")` **再** `creditService.topUp(ownerUserId, record.credits, record.id, "purchase")` → return。
  - 排序理由：先标 paid 保证重复投递走幂等分支、**不重复加分**（保护收入）。极少数"标 paid 但 topUp 抛错"→ paid-but-uncredited（需人工对账；真实修复=DB 事务，留后续，明确记为限制）。
- `PaymentServiceError` 带 `statusCode`。

### 6. 路由 + raw body 捕获（`apps/api/src/routes/payments.ts`）

- buildServer 注册全局 `application/json` content-type parser：存 `request.rawBody`（string）后 `JSON.parse`（空体 → undefined）；`declare module "fastify"` augment `rawBody?: string`（同 authGuard 的 userId 手法）。行为与默认 JSON 解析兼容（现有路由不受影响，全量测试兜底）。
- `registerPaymentRoutes(server, paymentService)`：`POST /v1/payments/webhook`（**公开**，无 authGuard）：取 `request.rawBody ?? ""` + `request.headers["x-gw-signature"]` → `paymentService.handleWebhookEvent(...)` → 成功 `200 { received: true }`；catch `PaymentServiceError` → `reply.status(err.statusCode).send({ error: err.message })`。`/v1/payments/webhook` 加入公开路由。

### 7. 共享 repo 接线

- buildServer 显式建**一个** `OrderRepository`（默认 `new InMemoryOrderRepository()`，可注入），注入 `OrderServiceImpl(orderRepository, packageCatalog, ...)` **和** `PaymentServiceImpl(orderRepository, creditService, { secret: options.config?.paymentWebhookSecret, ... })`。不再用 `InMemoryOrderService` 私建 repo。
- `createServices`（DB 路径）同理：一个 `DrizzleOrderRepository(db)` 注入 orderService + paymentService；`AppServices` 加 `paymentService`；入口 `buildServer({...})` 传 `paymentService`（吸取子片 A 的教训——入口漏传 = 生产用错实现）。

### 8. 文档 + .env.example

- README "### Payment Webhook (crediting)" 小节。
- mvp-skeleton 段落。
- `.env.example`：`GW_LINK_PAYMENT_WEBHOOK_SECRET` 注释（不配置则 webhook 拒收；绝不在日志/响应回显）。

## 错误处理 / 状态码

500 未配置 secret / 401 验签失败 / 400 非法 payload / 404 无此订单 / 200（忽略非 succeeded、幂等已处理、成功加分）。响应不泄露内部；secret 不出现在任何响应或日志。

## 测试策略

- **OrderRepository 契约**（双后端）：getByCheckoutRef 命中/未命中、updateStatus 生效、跨 owner。
- **webhookSignature**：sign/verify 往返、篡改 body → false、错 secret → false、空/非法签名 → false、constant-time（长度不符不抛）。
- **PaymentService**：未配置 500；无效签名 401；非法 JSON/事件 400；非 succeeded 忽略；未知订单 404；pending → 标 paid + 加分（余额增 credits）；**重复投递（同签名）幂等——余额不再增**；paid 订单直接幂等。
- **路由**：`POST /v1/payments/webhook` 无 `x-gw-signature` → 401；用 `signWebhookPayload` 造有效签名 → 200 + 订单变 paid + 用户余额增；重复投递 → 200 + 余额不变。
- **creditService**：topUp 带 reason="purchase" 写对 reason；默认仍 "topup"。
- **config**：paymentWebhookSecret 解析（有/无）。
- **共享 repo**：建订单（POST /v1/orders）后 webhook 能按 checkoutRef 找到并加分（端到端，同一 server 实例）。
- 全量 `pnpm test` + `pnpm typecheck` 全绿。

## 任务分解（约 6 任务）

1. shared `PaymentWebhookEvent` + 守卫；OrderRepository `getByCheckoutRef` + `updateStatus`（memory+drizzle+契约测试）。
2. `webhookSignature.ts`（sign/verify constant-time）+ 测试。
3. `creditService.topUp` reason 参数 + `paymentWebhookSecret` config（+ 穿过 ApiConfig 测试字面量）。
4. `PaymentService`（验签+解析+幂等+加分）+ 测试。
5. `POST /v1/payments/webhook` + raw-body parser + 共享 repo 接线（buildServer + createServices + 入口）+ 路由/端到端测试。
6. 文档 + .env.example。

## 交付清单

- [ ] PaymentWebhookEvent 契约 + OrderRepository getByCheckoutRef/updateStatus（含契约测试）
- [ ] webhookSignature sign/verify（constant-time）+ 测试
- [ ] topUp reason 参数 + paymentWebhookSecret config
- [ ] PaymentService（500/401/400/404/忽略/幂等/加分）+ 测试
- [ ] POST /v1/payments/webhook + raw-body + 共享 repo 接线（含入口）+ 路由/端到端测试
- [ ] 文档 + .env.example
- [ ] `pnpm test` + `pnpm typecheck` 全绿
