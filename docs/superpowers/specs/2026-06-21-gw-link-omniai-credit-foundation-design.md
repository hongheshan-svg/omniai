# GW-LINK OmniAI 积分/计费基础 设计

文档版本：V0.1
文档日期：2026-06-21
文档类型：阶段实现设计
适用阶段：Stage 10 - Credit Foundation（生成扣费 + 用户余额，为后续真实支付铺路）

## 1. 背景

产品目标是「可发布」的多模态创作工具，计费是硬前置。目前代码库**完全没有余额/账本概念**：`UserProfile.plan`（`free` | `pro` | `studio`）存在，`CreditAmount`、`estimateCreditCost()`、模型的 `creditUnitCost`（text=1 / image=2 / video=3）都有，但用户没有余额字段，生成流程也不扣费。

本阶段建立计费**地基**：服务端按用户记账（追加式账本）、生成成功时扣减点数、提供余额查询、新用户注册赠送初始积分。真实支付渠道（Stripe / 支付宝 / 微信）是后续阶段，本阶段**不引入外部支付、不引入新基础设施**。

## 2. 目标

1. 追加式账本表 `credit_transactions`，余额 = 交易金额求和。
2. `CreditService`：余额查询、初始赠送、扣减。
3. 生成流程集成：调 provider **前**预检余额（不足 → 402），生成 `succeeded` 后扣减按模型 `creditUnitCost`；`queued` 不扣费。
4. 新用户注册时赠送初始积分（可配置，默认 100）。
5. `GET /v1/credits/balance` 返回本人余额。
6. 后端为主：本阶段不接入桌面端（余额显示 / 402 处理留作后续小片）。

验收标准：新用户登录后余额 = 初始赠送额；余额充足时文本生成成功并扣减对应点数、余额减少；余额不足时生成返回 402 且不落任务、不调 provider；`queued` 生成不扣费；`GET /v1/credits/balance` 返回正确余额、未认证 401；`pnpm test`、`pnpm typecheck` 全绿。

## 3. 非目标

1. 真实支付/充值/退款/对账（外部渠道）——后续阶段。
2. 桌面/admin/mobile 的余额显示与 402 前端处理——后续小片。
3. 并发原子扣减（行锁/事务）——基础片接受非原子，见 §8 风险。
4. `creditEstimate`（UI 估算）与实扣 `creditUnitCost` 的精确对齐——本片以服务端 `creditUnitCost` 为权威。
5. 按 plan 区分赠送额、套餐升级、积分过期。
6. Postgres RLS（隔离仍在应用层按 owner）。

## 4. 数据行为

1. **余额** = 该用户 `credit_transactions.amount` 的求和（`SUM`）。`amount` 带符号：grant 为正、deduct 为负。
2. **初始赠送**：`AuthServiceImpl.findOrCreateUser` 在**新建**用户分支后，记一笔 `+initialCredits`（reason `signup_grant`）。老用户登录不重复赠送。
3. **扣费金额**：服务端权威，= 该模型 `creditUnitCost`（来自 catalog，不信任客户端 `preset.creditEstimate`）。
4. **生成流程**（`GenerationServiceImpl.createTask`）：
   1. 校验请求 + `modelCatalog.getModelReference(modelId, mode)`，取 `cost = creditUnitCost`。
   2. 预检：`getBalance(userId).credits < cost` → 抛 `InsufficientCreditsError`（statusCode 402），**不调 provider、不落任务、不记账**。
   3. 调 `providerAdapter.submitGeneration(...)`。
   4. 落任务（`tasks.insert`）。
   5. provider 返回 `succeeded` → 记一笔 `−cost`（reason `generation`，reference = 任务 id）；返回非 `succeeded`（如 `queued`）→ **不扣费**。
5. **向后兼容**：`GenerationServiceImpl` 的 `creditService` 为**可选**依赖；未注入时跳过预检与扣减（既有直接构造 generationService 的单测不受影响）。生产组装始终注入。
6. 余额、账本均按 `owner_user_id` 隔离（应用层 owner 过滤），与 tasks/assets 一致。

## 5. 组件设计

### 5.1 数据库 schema

`apps/api/src/db/schema.ts` 新增 `credit_transactions`：

| 列 | 类型 / 约束 |
|---|---|
| `id` | TEXT PK |
| `owner_user_id` | TEXT NOT NULL，FK→`users(id)` **ON DELETE CASCADE** |
| `amount` | INTEGER NOT NULL（带符号：grant>0，deduct<0） |
| `reason` | TEXT NOT NULL |
| `reference` | TEXT NULL（扣减存任务 id；grant 为 null） |
| `created_at` | TIMESTAMP WITH TIME ZONE NOT NULL |

索引：`(owner_user_id)`（余额求和）。新增迁移 `apps/api/drizzle/0002_*.sql`（`db:generate` 产出）+ 更新 `meta/_journal.json`（idx 2）。删除用户用 CASCADE 清账本（与 sessions 一致；余额按 owner 求和，孤儿账本无意义，故不取 tasks/assets 的 SET NULL）。

### 5.2 产品合同（packages/shared）

**不新增类型**。余额复用现有 `CreditAmount { credits: number; unit: "credit" }`。`GET /v1/credits/balance` 响应信封 `{ balance: CreditAmount }`。402 错误沿用现有 `{ error: string }` 形态（如 `"Insufficient credits"`）。本片**不改 packages/shared**。

### 5.3 仓库层

`apps/api/src/repositories/types.ts` 新增 api 内部记录类型与仓库接口：

```ts
export interface CreditTransactionRecord {
  id: string;
  amount: number;      // signed
  reason: string;
  reference: string | null;
  createdAt: string;
}

export interface CreditTransactionRepository {
  insert(record: CreditTransactionRecord, ownerUserId: string): void | Promise<void>;
  balance(ownerUserId: string): number | Promise<number>;   // SUM(amount), 空 = 0
}
```

`InMemoryCreditTransactionRepository`（`memory.ts`，`structuredClone` 存储边界）+ `DrizzleCreditTransactionRepository`（`drizzle.ts`，`SUM(amount)` 聚合，空表返回 0）。纳入 `RepositoryBundle` 与跨后端契约测试 `repositoryContract.test.ts`（grant+deduct→余额求和；按 owner 隔离；空余额=0），双后端（memory + pglite）。

### 5.4 CreditService

`apps/api/src/services/creditService.ts`：

```ts
export interface CreditService {
  getBalance(userId: string): Promise<CreditAmount>;
  grantInitial(userId: string): Promise<void>;
  deduct(userId: string, amount: number, reference: string): Promise<void>;
}
```

`CreditServiceImpl(repo: CreditTransactionRepository, options: { initialCredits, idGenerator, clock })`：
- `getBalance` → `{ credits: await repo.balance(userId), unit: "credit" }`。
- `grantInitial` → `repo.insert({ id: idGenerator(), amount: +initialCredits, reason: "signup_grant", reference: null, createdAt: clock.now().toISOString() }, userId)`（`initialCredits <= 0` 时可记 0 或跳过——见 §6 边界）。
- `deduct` → `repo.insert({ id, amount: -amount, reason: "generation", reference, createdAt }, userId)`。
- `InMemoryCreditService` 薄子类，wire 内存仓库（与其他服务一致）。

### 5.5 生成流程集成

`GenerationServiceImpl` 构造选项新增可选 `creditService?: CreditService`。`createTask`（见 §4.4）：取 `cost = creditUnitCost`（从 `getModelReference` 返回的引用取；若引用未携带 `creditUnitCost` 则为其补上该字段），预检不足抛 `InsufficientCreditsError`（`statusCode: 402`），succeeded 后 `deduct`。`creditService` 未注入则整段跳过。新增错误类型 `InsufficientCreditsError`（携带 `statusCode = 402`），生成路由沿用 `error.statusCode` 映射透传。

### 5.6 初始赠送接线

`AuthServiceImpl` 构造选项新增可选 `creditGranter?: { grantInitial(userId: string): Promise<void> | void }`（缺省 no-op）。`findOrCreateUser` 在 `users.insert(user)` 之后、仅新建分支调用 `creditGranter.grantInitial(user.id)`。生产组装注入 `creditService`。`InMemoryAuthService` 保持原构造签名（granter 经 options 传入，测试可注入或省略）。

### 5.7 路由

`apps/api/src/routes/credits.ts`：`registerCreditRoutes(server, creditService, authService)`，`preHandler = createAuthGuard(authService)`：

```ts
server.get("/v1/credits/balance", { preHandler }, async (request) => {
  return { balance: await creditService.getBalance(request.userId!) };
});
```

`/v1/credits/*` 经 authGuard 守卫（未认证 401）；`/health`、`/v1/models`、`/v1/prompt/*`、`/v1/auth/*` 仍公开。

### 5.8 配置

`apps/api/src/config.ts` `loadConfig` 新增 `initialCredits: number`，读 `GW_LINK_INITIAL_CREDITS`（默认 100；解析为非负整数，非法值回退默认或抛配置错误——见 §6）。

### 5.9 组装根

- `createServices`（`appServices.ts`）：`creditTransactionRepo` 入 `RepositoryBundle`（memory + Drizzle 两路）；构造 `creditService`；接入 `generationService`（预检+扣减）与 `authService`（初始赠送）。`createDbServices` 与无 DB 内存分支均接。
- `AppServices` 接口新增 `creditService`。
- `buildServer` 选项新增可选 `creditService`（缺省真实实现）；注册 `registerCreditRoutes`。
- 时间/ID 经注入（`clock`、`idGenerator`），不内联 `Date.now()`/随机。

## 6. 错误处理与边界

1. **余额不足** → `InsufficientCreditsError`（402），不调 provider、不落任务、不记账。
2. **未认证访问 `/v1/credits/*`** → 401（authGuard）。
3. **`initialCredits` 配置非法**（非数字/负数）→ `loadConfig` 抛配置错误（与现有 config 校验风格一致）；合法 0 表示不赠送（`grantInitial` 记 0 或跳过，余额为 0）。
4. **provider 失败**（真实文本 provider 502）→ 既有行为不变（不落任务）；因扣减在 succeeded 之后，失败不扣费。
5. **不泄露内部细节**：余额接口仅返回 `CreditAmount`；不暴露账本明细、provider/gateway 内部。

## 7. 测试策略

1. **账本契约测试**（双后端 memory+pglite）：insert grant + deduct → `balance` = 求和；空余额 = 0；按 owner 隔离。
2. **CreditService 单测**：空余额=0；`grantInitial` 后余额=initialCredits；`deduct` 后余额减少；多笔求和。
3. **GenerationService 单测**：
   - 预检不足 → 抛 402，**未落任务**（list 为空）、**未调 provider**（注入的 fake provider 未被调用）。
   - 余额充足 + provider succeeded → 落任务 + 余额减少 cost。
   - 余额充足 + provider queued → 落任务 + 余额不变。
   - 未注入 creditService → 行为同今（不预检/不扣，既有测试兼容）。
4. **Credits 路由测试**：`GET /v1/credits/balance` 返回余额；未认证 401。
5. **AuthService 测试**：新用户经注入 granter，余额 = initialCredits；老用户再次登录不重复赠送。
6. **server.test**：注册 credits 路由；e2e 登录→生成天然有余额（注册赠送），succeeded 扣减。
7. **既有测试保持绿**：凡直接构造 generationService 的单测，按需注入足额 creditService 或预充值；e2e 经注册赠送自然有余额。
8. 全量：`pnpm test`、`pnpm typecheck`。

## 8. 风险与约束

1. **并发双花**：`getBalance` 后 `deduct` 非原子；Postgres 高并发下可能超扣。基础片接受；真实计费需行锁/事务（后续）。
2. **估算 vs 实扣**：UI `creditEstimate` 与实扣 `creditUnitCost` 可能不一致；本片以服务端 `creditUnitCost` 为权威，对齐留后续。
3. **CASCADE 清账本**：删用户级联删其账本（与 tasks/assets 的 SET NULL 不同），因余额按 owner 求和、孤儿账本无意义。
4. **生成测试充值依赖**：新增预检会让「无余额用户」的生成返回 402；既有生成测试须经注册赠送或显式充值，计划按任务逐步处理，保证每步绿。

## 9. 验收清单

- [ ] `credit_transactions` 表 + 迁移 `0002` + `_journal` 更新。
- [ ] `CreditTransactionRepository`（memory + Drizzle）+ 契约测试（求和、隔离、空=0）。
- [ ] `CreditService`（getBalance/grantInitial/deduct）+ 单测。
- [ ] 生成预检 402（不落任务/不调 provider）+ succeeded 扣减 + queued 不扣 + 未注入兼容 + 单测。
- [ ] 注册初始赠送（仅新建一次）+ authService 测试。
- [ ] `GET /v1/credits/balance`（余额 + 401）+ 路由测试。
- [ ] `loadConfig.initialCredits`（`GW_LINK_INITIAL_CREDITS` 默认 100）。
- [ ] 组装根接线（repo/service/buildServer/appServices，DB 与内存两路）。
- [ ] 不改 packages/shared（余额复用 `CreditAmount`）。
- [ ] README / `mvp-skeleton.md` 更新（计费地基）。
- [ ] `pnpm test`、`pnpm typecheck` 全绿。
