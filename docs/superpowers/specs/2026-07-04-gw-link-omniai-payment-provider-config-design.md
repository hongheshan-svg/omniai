# GW-LINK OmniAI 配置驱动支付 Provider 设计规格

**日期**: 2026-07-04
**Slice**: 29 — 配置驱动的支付 Provider（结账）

---

## 摘要

把「真实支付」做成**配置驱动的接缝**：下单时由活跃支付 provider 创建结账会话并返回重定向 URL（`Order.checkoutUrl`）。provider 经 `config/payment-providers.json` 配置、`GW_LINK_PAYMENT_PROVIDER` 选活跃项，完全复用 `config/models.json` + `openAiTextProvider` 的「有 key→真实调用 / 无 key→优雅回退」模式。内置 `FakeCheckoutProvider`（默认、无网络）与通用 `HttpCheckoutProvider`（配置驱动）。真实 Stripe/支付宝/微信由使用者后续配 env 接入，无需现在提供凭据。客户端「购买」与「（开发）完成支付」拆分：购买建单并显示「去支付」链接，dev 完成为独立动作。

## 动机

支付三部曲（订单/webhook 加分/桌面结账）与订单详情/收据/mobile 结账/admin 看板已就位，但「购买」目前直接调 dev 完成端点，缺少真实结账重定向。本片补上「下单→provider 创建结账会话→拿到重定向 URL」这一真实支付的入口，并按项目一贯做法把 provider 细节藏在 config 后、用 Fake 顶替，使真实渠道可后续纯配置接入。

**非目标（留后续）**：
- 真实 Stripe/支付宝/微信的 provider-specific 适配（本片提供通用 HTTP 接缝，按 `protocol` 加实现类即可）
- 结账成功回跳/取消回跳的真实处理、`payment.failed`、退款
- mock 结账页的真实渲染（占位 URL 即可）
- 客户端真正打开外部浏览器/系统重定向（显示可点链接即可）

## 设计

### 关键默认（brainstorm 确认）

- 配置机制 = JSON 目录 `config/payment-providers.json`（仿 models.json）。
- 客户端拆分「购买」与「（开发）完成支付」：购买建 pending 单 + 显示「去支付」链接；dev 完成为独立按钮。
- 产品边界：`baseUrl`/`apiKeyEnv`/webhook secret 绝不外泄，客户端只见 `checkoutUrl`。

### 1. shared 契约（`packages/shared/src/orders.ts`）

`Order` 追加可选 `checkoutUrl?: string`（下单时由 provider 生成的结账重定向 URL；追加、向后兼容）。

### 2. 配置（`config/payment-providers.json` + loader）

文件（示例）：
```json
{
  "activeProvider": "fake",
  "providers": [
    { "id": "fake", "displayName": "Mock Checkout", "protocol": "mock", "baseUrl": "", "apiKeyEnv": "", "webhookSecretEnv": "GW_LINK_PAYMENT_WEBHOOK_SECRET" },
    { "id": "stripe", "displayName": "Stripe", "protocol": "http-checkout", "baseUrl": "https://api.stripe.com/v1", "apiKeyEnv": "STRIPE_API_KEY", "webhookSecretEnv": "STRIPE_WEBHOOK_SECRET" }
  ]
}
```
- 类型：`PaymentProviderDefinition = { id; displayName; protocol; baseUrl; apiKeyEnv; webhookSecretEnv?; }`；`PaymentProvidersConfig = { activeProvider: string; providers: PaymentProviderDefinition[] }`。
- loader（`apps/api/src/services/paymentProviderConfig.ts`）：`loadPaymentProvidersConfig(path)`（读文件 + 校验形状，非法抛错）；复用现有 `resolveConfigPath`。
- config（`apps/api/src/config.ts`）：`paymentProvidersConfigPath`（env `GW_LINK_PAYMENT_PROVIDERS_CONFIG_PATH`，默认 `config/payment-providers.json`）；`paymentProvider`（env `GW_LINK_PAYMENT_PROVIDER`，覆盖文件的 `activeProvider`，可选）。

### 3. Provider 接缝（`apps/api/src/services/paymentProvider.ts`）

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
export class PaymentProviderError extends Error { constructor(message: string, public readonly statusCode: number) { ... } }
```

- **FakeCheckoutProvider**（`services/fakeCheckoutProvider.ts`）：构造带 `publicBaseUrl`；`createCheckout` 返回 `{ checkoutUrl: \`${publicBaseUrl}/checkout/mock?ref=${checkoutRef}\`, providerRef: checkoutRef }`。确定性、无网络。
- **HttpCheckoutProvider**（`services/httpCheckoutProvider.ts`）：注入 `{ definition, env, fetch?, publicBaseUrl, clock? }`。`createCheckout`：
  - `apiKey = env[definition.apiKeyEnv]`；**无 key** → 回退：返回同 Fake 的占位 `checkoutUrl`（安全、无凭据可用）。
  - 有 key → POST `${baseUrl}/checkout/sessions`，body `{ reference: checkoutRef, amountCents, currency, packageId }`，header `authorization: Bearer ${apiKey}`；解析 `{ url, id }` → `{ checkoutUrl: url, providerRef: id }`；非 2xx/解析失败 → `PaymentProviderError(502)`。
  - API key 只入请求头，绝不写入 Order/响应。
- **resolvePaymentProvider(config, { env, publicBaseUrl, fetch? }): PaymentProvider**（`services/paymentProvider.ts` 或 loader）：按 `activeProvider`（env 覆盖）取 definition（找不到 → 抛错）；`protocol === "mock"` → `FakeCheckoutProvider`；否则 `HttpCheckoutProvider`（其自身在无 key 时回退）。

### 4. 持久化 checkoutUrl（追加字段）

- `OrderRecord.checkoutUrl?: string`（`repositories/types.ts`）。
- 内存/Drizzle：insert 时写入（record 已带 `checkoutUrl`）；Drizzle schema 加可空列 `checkout_url`（迁移 `0006`）；`mapOrderRow` 映射。
- `orderService.toOrder` 透传 `checkoutUrl`。
- 契约测试：insert 带 `checkoutUrl` 的订单 → `get`/`listByOwner`/`listAll` 往返；无则 undefined。

### 5. OrderService 接线 provider

- `OrderServiceImpl` 构造增 `paymentProvider: PaymentProvider`；`createOrder` 建 pending record（含 checkoutRef）后：
  ```
  const checkout = await this.paymentProvider.createCheckout({ checkoutRef, amountCents, currency, packageId });
  record.checkoutUrl = checkout.checkoutUrl;
  ```
  provider 抛 `PaymentProviderError` → 转 `OrderServiceError(statusCode)`。
- `InMemoryOrderService` 构造增 `paymentProvider`（保持薄子类）。
- **buildServer/appServices 接线**：从 config 解析 provider（`resolvePaymentProvider(loadPaymentProvidersConfig(resolveConfigPath(config.paymentProvidersConfigPath)), { env: process.env, publicBaseUrl: config.publicBaseUrl })`），注入 OrderService；`buildServer` 增可选 `paymentProvider` 注入项（测试注 Fake）。默认 Fake（activeProvider "fake"）。
- **接口拓宽波及**：`OrderServiceImpl`/`InMemoryOrderService` 构造签名变 → 更新所有构造点（orderService 测试、appServices、server 等）。

### 6. 客户端：拆分购买与 dev 完成（桌面 + mobile）

- `createOrder` 返回的 Order 现带 `checkoutUrl`（apiClient 无需改，已透传）。
- **桌面**（`App.tsx`）：`handleBuy` 改为仅 `createOrder(pkg.id, token)` → 刷新订单（pending 单出现，带 checkoutUrl）；**不再自动 dev 完成**。pending 订单渲染：「去支付」链接（`<a href={order.checkoutUrl}>去支付</a>`）+「（开发）完成支付」按钮 → `devCompletePayment(order.id, token)` → 刷新余额+订单。
- **mobile**（`appModel.ts` + `App.tsx`）：`buyPackage` 改为仅 `createOrder` → 刷新订单（不自动完成）；新增 `devCompleteOrder(orderId)`（devCompletePayment → 刷新余额+订单，401→登出）；App.tsx pending 订单显示 checkoutUrl（`<Text>去支付：{url}</Text>` 或可点）+「（开发）完成支付」按钮。
- fake client 的 `createOrder` 返回带 `checkoutUrl` 的订单；测试更新：购买 → pending 单 + 去支付链接；dev 完成 → 余额增 + 已支付。

### 7. 文档 + 配置示例 + .env.example

- `config/payment-providers.json`（fake 默认 + stripe 示例）随仓库提交。
- README「### Payment Provider (config-driven checkout)」小节。
- mvp-skeleton 段落。
- `.env.example`：`GW_LINK_PAYMENT_PROVIDER`、`GW_LINK_PAYMENT_PROVIDERS_CONFIG_PATH`、真实 provider 的 `*_API_KEY`/`*_WEBHOOK_SECRET` 说明。

## 错误处理

- provider 创建结账失败（真实 HTTP 非 2xx / 解析失败）→ `PaymentProviderError(502)` → `createOrder` 转 `OrderServiceError(502)` → 路由 502。
- 无 key → 回退占位 URL（不报错）。
- 客户端：购买失败 → actionError；dev 完成 401→登出。
- 产品边界：baseUrl/apiKeyEnv/secret 不进 Order/响应/日志。

## 测试策略

- **provider**：Fake 确定性 URL；Http 有 key → fetch mock 断言 URL/header/body/解析；无 key → 回退占位；非 2xx → 502。
- **config**：`loadPaymentProvidersConfig` 解析 + 非法抛错；`resolvePaymentProvider` 按活跃项/env 覆盖选 Fake/Http；缺 provider → 抛错。
- **契约**：`checkoutUrl` 往返（memory + pglite）。
- **OrderService**：`createOrder` 写 `checkoutUrl`（注入 Fake provider）；provider 抛错 → OrderServiceError。
- **桌面/mobile**：购买 → pending + 去支付链接（无自动完成）；dev 完成 → 加分 + 已支付。
- 全量 `pnpm test` + `pnpm typecheck` 全绿。

## 任务分解（约 7 任务）

1. shared `Order.checkoutUrl` + 持久化（`OrderRecord.checkoutUrl` + 内存 + Drizzle schema + 迁移 0006 + mapOrderRow + `toOrder` + 契约测试）。
2. config：`paymentProvidersConfigPath`/`paymentProvider` + `loadPaymentProvidersConfig` + 类型 + config 测试 + `config/payment-providers.json`。
3. provider 接缝：`PaymentProvider` + `FakeCheckoutProvider` + `HttpCheckoutProvider` + `resolvePaymentProvider` + 测试。
4. `OrderService` 接线 provider（createOrder 写 checkoutUrl）+ buildServer/appServices 接线 + 构造点更新 + 测试。
5. 桌面：拆分购买/去支付链接/dev 完成 + 测试。
6. mobile：`buyPackage` 拆分 + `devCompleteOrder` + App.tsx 去支付/dev 完成 + 测试。
7. 文档 + .env.example。

## 交付清单

- [ ] `Order.checkoutUrl` + 持久化 + 迁移 0006 + 契约测试
- [ ] config + loader + `config/payment-providers.json` + 测试
- [ ] `PaymentProvider` + Fake + Http + resolve + 测试
- [ ] `OrderService` 接线 provider + 接线/构造点 + 测试
- [ ] 桌面拆分购买/去支付/dev 完成 + 测试
- [ ] mobile 拆分 + 测试
- [ ] 文档 + .env.example
- [ ] `pnpm test` + `pnpm typecheck` 全绿
