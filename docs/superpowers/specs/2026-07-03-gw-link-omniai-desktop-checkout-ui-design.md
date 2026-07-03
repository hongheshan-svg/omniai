# GW-LINK OmniAI 桌面结账 UI 设计规格（支付子片 C）

**日期**: 2026-07-03
**Slice**: 24 — 桌面结账 UI（Payment sub-slice C）

---

## 摘要

支付三部曲收尾：桌面新增套餐结账。apiClient 补 `listPackages`/`createOrder`/`listOrders`/`devCompletePayment`；后端加一个 **dev 门控**的 `POST /v1/payments/dev-complete`（服务端用配置 secret 签名 `payment.succeeded` 事件并喂入真实 `PaymentService`，走已审计的验签+幂等+加分路径）；桌面渲染套餐卡，"购买"→ 建订单 → dev 完成支付 → 余额刷新 + 订单列表。生产（flag 关）dev-complete 拒绝——真实支付走 provider 的真实 webhook（子片 B）。

## 动机

子片 A 立了订单、B 立了 webhook 加分。C 让桌面用户能端到端走一遍：选套餐、下单、（dev 环境）完成支付、看到余额增长。真实 provider 的结账页/重定向留后续；本片用 dev 完成端点驱动演示，且它复用 B 的真实验签路径（客户端永不接触 secret）。

**非目标（留后续）**：
- 真实 Stripe/Alipay/WeChat 结账页 / 重定向（B 的真实 webhook 已就位，接真实 provider 是后续）
- mobile 结账、退款 UI、订单详情页、发票

## 设计

### 关键默认（brainstorm 确认）

- dev 完成支付 = dev 门控端点**服务端签名 + 喂入真实 PaymentService**（走真实 webhook 路径）。门控 `GW_LINK_DEV_PAYMENTS_ENABLED`（生产默认关，同 `devTopupEnabled`）。
- 保留现有固定"充值"按钮（dev-topup），新增套餐结账区。

### 1. shared apiClient（`packages/shared/src/apiClient.ts`）

`ApiClient` 接口新增：
```typescript
listPackages(): Promise<CreditPackage[]>;
createOrder(packageId: string, token: string): Promise<Order>;
listOrders(token: string): Promise<Order[]>;
devCompletePayment(orderId: string, token: string): Promise<Order>;
```
实现：
- `listPackages` → `GET /v1/packages`（无 token）→ 解包 `{ packages }`。
- `createOrder` → `POST /v1/orders { packageId }`（token）→ 解包 `{ order }`。
- `listOrders` → `GET /v1/orders`（token）→ 解包 `{ orders }`。
- `devCompletePayment` → `POST /v1/payments/dev-complete { orderId }`（token）→ 解包 `{ order }`。
`CreditPackage`/`Order` 从 `@gw-link-omniai/shared` 导入。+ 单测（fetch mock：URL/方法/token/解包）。

### 2. 后端 dev 完成端点

- **config**：`ApiConfig` 加 `devPaymentsEnabled: boolean`（env `GW_LINK_DEV_PAYMENTS_ENABLED`；解析同 `parseDevTopupEnabled`——生产默认 false、非生产默认 true、`"true"`/`"false"`、其它抛错）。
- **OrderService**：加 `getOrder(userId: string, orderId: string): Promise<Order | null>`（用 repo.get(owner,id) → toOrder 或 null）。
- **路由**（`apps/api/src/routes/payments.ts`，把 `registerPaymentRoutes` 改为 deps 对象）：`registerPaymentRoutes(server, { paymentService, orderService, authService, secret, devPaymentsEnabled })`：
  - 保留 `POST /v1/payments/webhook`（公开，用 paymentService）。
  - 新增 `POST /v1/payments/dev-complete`（**鉴权** via authGuard）：
    - `!devPaymentsEnabled` → 403 `{ error: "Dev payment completion is disabled" }`。
    - body 守卫 `{ orderId: string }` 非法 → 400 `{ error: "Invalid dev-complete request" }`。
    - `order = await orderService.getOrder(request.userId!, orderId)`；null → 404 `{ error: "Order not found" }`。
    - `rawBody = JSON.stringify({ type: "payment.succeeded", checkoutRef: order.checkoutRef })`；`signature = secret ? signWebhookPayload(rawBody, secret) : undefined`。
    - `await paymentService.handleWebhookEvent({ rawBody, signature })`（走真实验签+幂等+加分；secret 未配置 → PaymentService 抛 500，catch `PaymentServiceError` → 该 statusCode）。
    - 成功 → 重取 `updated = await orderService.getOrder(request.userId!, orderId)` → 200 `{ order: updated }`。
- **buildServer/appServices 接线**：dev-complete 需要 orderService + paymentService + `config.paymentWebhookSecret` + `config.devPaymentsEnabled`；`registerPaymentRoutes` 传全。`devPaymentsEnabled` 从 `options.config?.devPaymentsEnabled ?? false` 取（不触发 loadConfig，同 devTopupEnabled）。入口穿线不变（services 已含 paymentService/orderService）。

### 3. 桌面套餐结账区（`apps/desktop/src/App.tsx`）

- 状态：`packages: CreditPackage[]`、`orders: Order[]`（signedIn 时加载：`listPackages` + `listOrders`）。
- "套餐"section（signedIn，充值按钮附近）：渲染每个套餐卡（`displayName` + `amountCents/100` 价格 + `credits` 积分 + "购买"按钮）。
- `handleBuy(pkg)`：`createOrder(pkg.id, token)` → `devCompletePayment(order.id, token)` → 刷新 `getCreditBalance` + `listOrders`；401 → 登出；其它 → actionError。
- 订单列表：每单显示 id / 套餐 / status（`getOrderStatusLabel`——新增小 helper 或内联）。
- 现有"充值"按钮不变。
- framework-free helper（`apps/desktop/src/orderModel.ts` 或复用）：`formatPackagePrice(pkg): string`（如 `"¥9.90"`）、`getOrderStatusLabel(status): string`（pending/paid/failed 中文）。+ 单测。

### 4. 文档 + .env.example

- README "### Desktop Checkout" 小节。
- mvp-skeleton 段落。
- `.env.example`：`GW_LINK_DEV_PAYMENTS_ENABLED` 注释（生产默认关；开则暴露 dev 完成支付，绕过真实 provider——绝不在生产开）。

## 错误处理

- dev-complete：403 关 / 401 未鉴权 / 400 非法 body / 404 非本人或无订单 / 500 secret 未配置（PaymentService）。
- 桌面：401 → 登出；其它 → actionError；客户端不接触 secret。

## 测试策略

- **apiClient**：4 方法 fetch mock（listPackages 无 token；createOrder/listOrders/devCompletePayment 带 token；URL/方法/解包）。
- **config**：devPaymentsEnabled 解析（默认生产关/非生产开、显式、非法抛错）。
- **OrderService.getOrder**：命中返 Order、未命中/他人 → null。
- **dev-complete 路由**：关→403、未鉴权→401、非法 body→400、他人订单→404、成功→订单 paid + 用户余额增、幂等（再调余额不变）；secret 未配置→500。
- **桌面**（jsdom+@testing-library/react，fake client）：套餐渲染、购买 → 余额增 + 订单显示"已支付"；orderModel helper 单测。
- 全量 `pnpm test` + `pnpm typecheck` 全绿。

## 任务分解（约 4 任务）

1. shared apiClient `listPackages`/`createOrder`/`listOrders`/`devCompletePayment` + 测试。
2. 后端：`devPaymentsEnabled` config + `OrderService.getOrder` + `POST /v1/payments/dev-complete`（签名+喂 webhook）+ `registerPaymentRoutes` 改 deps + buildServer 接线 + 测试。
3. 桌面：`orderModel`（formatPackagePrice/getOrderStatusLabel）+ 套餐结账区（拉套餐/购买/dev完成/刷新）+ 测试。
4. 文档 + .env.example。

## 交付清单

- [ ] apiClient 4 方法 + 测试
- [ ] devPaymentsEnabled config + OrderService.getOrder + POST /v1/payments/dev-complete（403/401/400/404/500/成功/幂等）+ 接线
- [ ] 桌面套餐结账区 + orderModel helper + 测试
- [ ] 文档 + .env.example
- [ ] `pnpm test` + `pnpm typecheck` 全绿
