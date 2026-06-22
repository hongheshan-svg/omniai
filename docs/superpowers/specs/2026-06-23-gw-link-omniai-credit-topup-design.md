# GW-LINK OmniAI 积分充值基础 设计

文档版本：V0.1
文档日期：2026-06-23
文档类型：阶段实现设计
适用阶段：Stage 16 - Credit Top-up Foundation（提供商无关充值，真实支付前置）

## 1. 背景

计费地基（Stage 10）已有账本、注册赠送、生成扣费、余额查询。但用户用完初始积分后无法续费。本阶段加**提供商无关的充值**：开发态可直接入账（无真实支付渠道），为后续真实支付（Stripe / 支付宝 / 微信，由 webhook 驱动入账）铺路。

直接增发积分的端点若在生产暴露，等于任何认证用户都能免费铸币——故 `POST /v1/credits/topup` 受**配置开关**门控（`GW_LINK_DEV_TOPUP_ENABLED`，生产默认关，同 `GW_LINK_AUTH_DEV_CODES_ENABLED` 范式）。真实支付到位后由 webhook 调 `creditService.topUp`，不走此 dev 端点。

## 2. 目标

1. `CreditService.topUp(userId, amount, reference?)` 记一笔正向账本（reason `topup`）。
2. `POST /v1/credits/topup`（authGuard 守卫 + `devTopupEnabled` 门控）直接入账、返回新余额。
3. 配置 `GW_LINK_DEV_TOPUP_ENABLED`（生产默认关）。
4. 桌面「充值」按钮充固定额并刷新余额。
5. 不改 `packages/shared`（余额复用 `CreditAmount`）。

验收标准：启用时已认证用户 POST `{amount:100}` → 余额增加 100、返回新余额；未启用 → 403；非正整数 → 400；未认证 → 401；桌面点「充值」→ 余额刷新增加；`pnpm test`、`pnpm typecheck` 全绿。

## 3. 非目标

1. 真实支付渠道（Stripe/支付宝/微信，webhook 驱动 `topUp` 后续）。
2. 套餐目录 / 定价（任意正整数金额）。
3. 自定义金额输入（桌面先固定额按钮）。
4. 并发原子入账（沿用既有取舍）。
5. `packages/shared` 改动。

## 4. 数据行为

1. **充值**：`creditService.topUp(userId, amount, reference?)` → `transactions.insert({ id: idGenerator(), amount: +amount, reason: "topup", reference: reference ?? null, createdAt: clock.now() }, userId)`。余额 = 账本求和（含此正项）。
2. **端点**（`POST /v1/credits/topup`，authGuard）：
   - `devTopupEnabled` 为 false → 403 `{ error: "Top-up is disabled" }`（不入账）。
   - body 非 `{ amount: <正整数> }` → 400 `{ error: "Invalid top-up amount" }`。
   - 否则 `await creditService.topUp(request.userId!, amount)` → 返回 `{ balance: await creditService.getBalance(request.userId!) }`。
3. **门控来源**：`devTopupEnabled` 在 buildServer 注册路由时传入（取自注入的 `config?.devTopupEnabled ?? false`，**不在构造期调用 `loadConfig`**，以保「注入服务时不读 env 配置」测试绿）；生产入口经 `loadConfig` 传 `config`。
4. **桌面**：「充值」按钮 → `apiClient.topUpCredits(100, token)` → 新余额 `setBalance`；401 → `handleSignedOut`。

## 5. 组件设计

### 5.1 配置

`apps/api/src/config.ts`：`ApiConfig` 增 `devTopupEnabled: boolean`；`loadConfig` 用 `parseFlag(env.GW_LINK_DEV_TOPUP_ENABLED, env)`，语义同 `parseAuthDevCodesEnabled`（未设：`NODE_ENV==="production"` → false，否则 true；`"true"`/`"false"` 显式；其它 → 抛错）。可复用/抽出一个通用 flag 解析（或仿写一个 `parseDevTopupEnabled`）。同步给所有 `ApiConfig` 字面量补 `devTopupEnabled`（测试中的字面量站点：appServices.test baseConfig、dbPersistence smokeConfig、server.test 两处、assets.test、generations.test 三处；config.test 的两处 `toEqual` 加 `devTopupEnabled: true`）。

### 5.2 CreditService.topUp

`apps/api/src/services/creditService.ts`：接口加 `topUp(userId: string, amount: number, reference?: string): Promise<void>`；`CreditServiceImpl.topUp` 记正向账本（reason `topup`），用注入的 idGenerator/clock。

### 5.3 路由

`apps/api/src/routes/credits.ts`：`registerCreditRoutes(server, creditService, authService, options: { devTopupEnabled: boolean })`（新增第四参）。新增 `server.post("/v1/credits/topup", { preHandler }, ...)`：见 §4.2。保留 `GET /v1/credits/balance` 不变。

### 5.4 接线

`apps/api/src/server.ts`：`BuildServerOptions.config?.devTopupEnabled` 已随 `config` 提供；buildServer 内 `const devTopupEnabled = options.config?.devTopupEnabled ?? false;` 传给 `registerCreditRoutes(server, creditService, authService, { devTopupEnabled })`（不调用 `getConfig()`）。生产入口 `buildServer({ config, ... })` 已传 config，故 dev 端点按 `loadConfig` 的 `devTopupEnabled` 门控。

### 5.5 桌面

`apps/desktop/src/apiClient.ts`：`topUpCredits(amount: number, token: string): Promise<CreditAmount>` → `POST /v1/credits/topup` body `{ amount }`、解包 `{ balance }`。
`apps/desktop/src/App.tsx`：余额展示旁「充值」按钮 → `handleTopUp()`：`const updated = await api.topUpCredits(100, token); setBalance(updated);`，401 → `handleSignedOut`，其余 → `actionError`。仅登录态显示。

### 5.6 文档

`.env.example`/README/`mvp-skeleton.md`：`GW_LINK_DEV_TOPUP_ENABLED`（生产默认关，绝不在生产开启——会暴露免费铸币）；充值为开发态直接入账，真实支付后续。

## 6. 错误处理

1. 未启用 → 403；金额非正整数 → 400；未认证 → 401。
2. dev 端点生产默认关；真实支付经 webhook 调 `topUp`（不走此端点）。
3. 不泄露内部；扣费/入账非原子沿用既有取舍。

## 7. 测试策略

1. **config 单测**：`devTopupEnabled` 默认（生产外 true / production false）、`"true"`/`"false"` 显式、非法值抛错。
2. **CreditService.topUp 单测**：topUp 后余额增加；多笔求和；与 deduct 混合正确。
3. **credits 路由测试**：启用 + 正整数 → 入账 + 返回新余额；未启用 → 403；非正整数（0/负/小数/缺）→ 400；未认证 → 401。
4. **桌面**：`apiClient.topUpCredits` 单测（URL/方法/bearer/body/解包）；App「充值」按钮点击 → 余额刷新（fake topUpCredits 返回更高余额）。
5. **既有测试保持绿**（ApiConfig 字面量补 `devTopupEnabled`；fake ApiClient 补 `topUpCredits`）。
6. 全量：`pnpm test`、`pnpm typecheck`。

## 8. 风险与约束

1. **免费铸币风险**：dev 端点必须生产默认关；文档强调绝不在生产开启。
2. **真实支付留后续**：本片仅开发态直接入账；Stripe/支付宝/微信经 webhook 驱动 `topUp`。
3. **固定额 UI**：桌面先固定 100；自定义金额输入留后续。
4. **并发非原子**：沿用既有取舍。

## 9. 验收清单

- [ ] `ApiConfig.devTopupEnabled` + `GW_LINK_DEV_TOPUP_ENABLED`（生产默认关）+ config 单测；ApiConfig 字面量补齐。
- [ ] `CreditService.topUp` + 单测。
- [ ] `POST /v1/credits/topup`（门控 403 / 400 / 401 / 入账返回余额）+ registerCreditRoutes 第四参 + buildServer 接线（不触发 loadConfig）+ 路由测试。
- [ ] 桌面 `apiClient.topUpCredits` + 「充值」按钮 + 测试。
- [ ] 不改 `packages/shared`。
- [ ] README、`mvp-skeleton.md`、`.env.example` 更新。
- [ ] `pnpm test`、`pnpm typecheck` 通过。
