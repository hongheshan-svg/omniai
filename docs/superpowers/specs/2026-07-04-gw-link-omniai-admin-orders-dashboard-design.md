# GW-LINK OmniAI Admin 订单看板 设计规格

**日期**: 2026-07-04
**Slice**: 28 — Admin 订单看板（dev 门控跨用户订单）

---

## 摘要

admin 运营台的「Orders」模块接入真实数据：新增一个 **dev 门控**的 `GET /v1/admin/orders`（生产默认关）返回全部订单；admin 前端拉取并渲染汇总（总数/已付/待付/失败/营收/售出积分）与订单表格。跨用户订单读取通过 `OrderRepository.listAll()`。`Order` 契约不含用户 PII（无 userId/邮箱），故 dev 环境展示无个人信息泄露。真实 admin 角色/鉴权体系留后续（dev-flag 为占位，同 dev-topup/dev-payments 的门控惯例）。

## 动机

admin 目前只有「Model Display」有实体（调公开 `listModels`），「Orders」模块为空。运营需要看订单概览。跨用户订单读取需要一个新端点；完整 admin 角色鉴权是独立的大安全面，故本片沿用项目已批准的 dev-flag 门控（生产关）先让看板跑起来，聚合逻辑（`summarizeOrders`）是可复用核心，真实鉴权落地后可直接复用。

**非目标（留后续）**：
- 真实 admin 角色/鉴权（用户角色、admin 登录、RBAC）——生产启用需要它
- 交易流水（credit_transactions）看板、按用户/时间筛选、分页、导出
- 图表可视化

## 设计

### 关键默认

- 数据源 = dev 门控 `GET /v1/admin/orders`（生产默认关，同 `devPaymentsEnabled` 解析）。公开（admin 台无登录，同 `listModels`），但 dev 门控。
- `Order` 无 PII，dev 展示无泄露；生产关闭时端点 403。
- 聚合纯函数 `summarizeOrders`，可测、可复用。

### 1. 仓储：跨用户列出全部订单

- `OrderRepository.listAll(): Promise<OrderRecord[]> | OrderRecord[]`（`repositories/types.ts`）——返回全部 owner 的订单，按 `createdAt` 升序。
- **内存**（`memory.ts`）：`this.rows.map((r) => structuredClone(r.record))`（可排序保持插入序即可，按 createdAt 升序更稳）。
- **Drizzle**（`drizzle.ts`）：`select().from(orders).orderBy(orders.createdAt)` → `map(mapOrderRow)`。
- 契约测试：不同 owner 各插一单，`listAll()` 返回两者。

### 2. 服务

- `OrderService.listAllOrders(): Promise<Order[]>`（`orderService.ts`）——`(await this.orders.listAll()).map(toOrder)`。

### 3. Config

- `ApiConfig` 加 `devAdminEnabled: boolean`；`parseDevAdminEnabled(env)`（读 `GW_LINK_DEV_ADMIN_ENABLED`，解析同 `parseDevPaymentsEnabled`——生产默认 false、非生产默认 true、显式 `"true"`/`"false"`、其它抛错）；`loadConfig` 填充。

### 4. 路由（`apps/api/src/routes/admin.ts`，新文件）

- `registerAdminRoutes(server, deps: { orderService: OrderService; devAdminEnabled: boolean })`：
  - `GET /v1/admin/orders`：
    - `!deps.devAdminEnabled` → 403 `{ error: "Admin orders are disabled" }`。
    - 否则 → 200 `{ orders: await deps.orderService.listAllOrders() }`。
  - 公开（无 authGuard），dev 门控。
- **server.ts**：`registerAdminRoutes(server, { orderService, devAdminEnabled: options.config?.devAdminEnabled ?? false })`。
- 路由测试：门控关→403；开→返回插入的订单。

### 5. shared apiClient

- `ApiClient` 加 `listAllOrders(): Promise<Order[]>`（`GET /v1/admin/orders`，无 token）→ 解包 `{ orders }`。+ 单测（fetch mock：URL/方法/解包）。
- **接口拓宽波及**：desktop `App.test` 与 mobile `appModel.test` 的完整 fake client 需加抛错桩 `listAllOrders: async () => { throw new Error("unused"); }`（admin 测试用 `as unknown as ApiClient` 部分转型，不受影响）。

### 6. admin 聚合模型（`apps/admin/src/ordersDashboardModel.ts`）

```typescript
export interface OrderDashboardSummary {
  total: number;
  paid: number;
  pending: number;
  failed: number;
  revenueCents: number;   // 仅已付订单 amountCents 之和
  creditsSold: number;    // 仅已付订单 credits 之和
}
export function summarizeOrders(orders: Order[]): OrderDashboardSummary;
```
- 单测：空数组 → 全 0；混合状态 → 各计数正确、营收/积分只计 paid。

### 7. admin OrdersSection（`apps/admin/src/OrdersSection.tsx`）+ appShell 接入

- 客户端组件（同 `ModelCatalogSection` 模式）：`createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL })` 默认，`client.listAllOrders()` 拉取。
- loading「加载中…」/ error「订单加载失败，请稍后重试」。
- 成功：渲染汇总（`summarizeOrders`）——总数/已付/待付/失败/营收（`formatMoney(revenueCents,"CNY")`，来自 shared）/售出积分；再渲染订单表（每单 id、套餐、状态 `getOrderStatusLabel`、金额 `formatMoney`、时间 `formatDateTime`）。
- `appShell.tsx`：「Orders」模块渲染 `<OrdersSection client={client} />`（同 Model Display 接法）。
- 测试：`OrdersSection.test`（注入 fake `listAllOrders` → 汇总数字 + 订单行；error 态）；`appShell.test` 更新（Orders 模块含 section，注入含 `listAllOrders` 的 fake）。

### 8. 文档 + .env.example

- README「### Admin Orders Dashboard」小节。
- mvp-skeleton 段落。
- `.env.example`：`GW_LINK_DEV_ADMIN_ENABLED` 注释（生产默认关；开则暴露跨用户订单只读看板，无 PII；真实 admin 鉴权前绝不在生产开）。

## 错误处理

- 端点：403（门控关）；服务/仓储异常按 500。
- admin 前端：加载失败 → 错误文案，不崩溃。
- `Order` 无 PII；端点生产默认关。

## 测试策略

- **契约**：`listAll` 跨 owner（memory + pglite）。
- **config**：`devAdminEnabled` 解析（生产关/非生产开/显式/非法抛错）。
- **路由**：`GET /v1/admin/orders` 关→403、开→列全部。
- **apiClient**：`listAllOrders` fetch mock（URL/方法/解包）。
- **admin**：`summarizeOrders`（空/混合）；`OrdersSection`（渲染汇总+行、error）；`appShell`（Orders 模块）。
- 全量 `pnpm test` + `pnpm typecheck` 全绿。

## 任务分解（约 6 任务）

1. 仓储 `listAll`（内存 + Drizzle + 契约测试）+ 服务 `listAllOrders`。
2. config `devAdminEnabled` + 路由 `GET /v1/admin/orders`（dev 门控）+ server 接线 + 路由测试。
3. shared apiClient `listAllOrders` + desktop/mobile fake 桩 + apiClient 测试。
4. admin `ordersDashboardModel.summarizeOrders` + 测试。
5. admin `OrdersSection` + appShell 接入 + 测试。
6. 文档 + .env.example。

## 交付清单

- [ ] `OrderRepository.listAll` + `OrderService.listAllOrders` + 契约测试
- [ ] `devAdminEnabled` config + `GET /v1/admin/orders`（403/列全部）+ 接线
- [ ] apiClient `listAllOrders` + fake 桩 + 测试
- [ ] `summarizeOrders` + 测试
- [ ] `OrdersSection` + appShell 接入 + 测试
- [ ] 文档 + .env.example
- [ ] `pnpm test` + `pnpm typecheck` 全绿

---

## 修订：Admin 鉴权（Option A，2026-07-04）

自动化安全审查（两次，HIGH）判定原「公开 + dev 门控」的 `GET /v1/admin/orders` 为**缺失鉴权/越权（跨租户业务数据泄露）**。结论正确：本仓库其它 dev 端点均「鉴权 + dev 门控」，且 `devAdminEnabled` 非生产默认开，等于把跨用户订单端点匿名暴露。故按用户选择改为 **Option A：鉴权 + admin 白名单 + 生产硬拒 + 控制台登录**。

### 鉴权模型

- **admin 邮箱白名单**：config `adminEmails: string[]`（env `GW_LINK_ADMIN_EMAILS`，逗号分隔，解析同 `parseCorsOrigins`，默认 `[]`）。
- **admin guard**（`apps/api/src/routes/adminGuard.ts`）：`createAdminGuard(authService, adminEmails)` preHandler —
  - 读 bearer → `authService.getSession(token)`；未鉴权 → 401 `{ error: "Authentication required" }`。
  - `session.user.destination` 不在 `adminEmails` → 403 `{ error: "Admin access required" }`。
  - 通过 → `request.userId = session.user.id`。
- **路由**：`registerAdminRoutes(server, { orderService, authService, adminEmails, devAdminEnabled })`，`GET /v1/admin/orders` 挂 `createAdminGuard` preHandler；handler 内 `!devAdminEnabled → 403`（kill-switch，鉴权之后），否则 200 列全部。
- **生产硬拒**：`parseDevAdminEnabled` 在 `value==="true" && NODE_ENV==="production"` 时**抛错**（boot 失败），使 stray env 无法在生产暴露端点。dev 门控是额外闸，不是唯一闸。
- **server 接线**：传 `authService`、`adminEmails: config?.adminEmails ?? []`、`devAdminEnabled`。

### 客户端

- `apiClient.listAllOrders(token: string)`：GET `/v1/admin/orders` **带 token**，解包 `{ orders }`。
- admin 控制台加**登录流**（复用 shared 免密 `startLogin`/`verifyLogin`）：appShell 持 token/session；未登录显示登录表单；登录后（admin 邮箱）token 流入 `OrdersSection`（`OrdersSection` 接 `token` prop，`listAllOrders(token)`；无 token 显示「请先登录」；非 admin → 端点 403 → 错误文案）。

### 路由测试（改为断言安全行为）

- 未鉴权 → 401；已登录非 admin → 403；admin 但 `devAdminEnabled=false` → 403；admin + 开 → 200 列全部。
- config：`parseDevAdminEnabled` 生产 + `"true"` → 抛错；`adminEmails` 解析。

### 文档/env

- `.env.example`：`GW_LINK_ADMIN_EMAILS`（admin 白名单）+ 更新 `GW_LINK_DEV_ADMIN_ENABLED` 注释（现为额外 kill-switch，生产恒拒；端点需 admin 鉴权）。
