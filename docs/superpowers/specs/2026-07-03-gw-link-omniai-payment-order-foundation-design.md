# GW-LINK OmniAI 支付订单基础设计规格（支付子片 A）

**日期**: 2026-07-03
**Slice**: 22 — 支付订单 + 套餐基础（Payment sub-slice A）

---

## 摘要

支付渠道拆分的第一个子片：立起**订单契约**——积分套餐目录 + 订单服务/仓库 + 建单/列单路由。用户可为某套餐创建一个 `pending` 订单（带生成的 `checkoutRef`，供后续 webhook 关联），但**本子片不加分、无 webhook、无真实支付 HTTP**（加分在子片 B）。

## 动机

Slice 12 的 `creditService.topUp` 已能记 `topup` 账本——真实支付的终点就是它。但支付是多子系统；本子片先立稳定的订单契约（套餐、订单、状态、checkoutRef），沿用本仓库"契约 + Fake/InMemory、真实外部 HTTP 延后"的一贯做法。子片 B 加 webhook（验签+幂等+加分），子片 C 加客户端结账 UI。

**非目标（留后续子片）**：
- webhook 端点、HMAC 验签、幂等、`pending→paid` 状态流转、加分（子片 B）
- 真实 Stripe/Alipay/WeChat、checkout URL/重定向、客户端 UI（子片 B/C）
- 退款、订单取消、发票

## 设计

### 1. shared 契约（`packages/shared/src/orders.ts`，re-export from `index.ts`）

```typescript
export interface CreditPackage {
  id: string;
  displayName: string;
  credits: number;
  amountCents: number;
  currency: string;
}

export type OrderStatus = "pending" | "paid" | "failed";

export interface Order {
  id: string;
  packageId: string;
  credits: number;
  amountCents: number;
  currency: string;
  status: OrderStatus;
  checkoutRef: string;
  createdAt: string;
}

export interface CreateOrderRequest {
  packageId: string;
}
```

价格用整数 `amountCents`（避免浮点）；`currency` 为 ISO 代码（如 `"CNY"`）。`Order` 是产品形状——不含 `owner_user_id`（服务器内部）。

### 2. 套餐目录

- `config/credit-packages.json`（`GW_LINK_PACKAGES_CONFIG_PATH` 可覆盖，默认 `config/credit-packages.json`）：
  ```json
  {
    "packages": [
      { "id": "credits-100", "displayName": "100 积分", "credits": 100, "amountCents": 990, "currency": "CNY" },
      { "id": "credits-500", "displayName": "500 积分", "credits": 500, "amountCents": 4500, "currency": "CNY" },
      { "id": "credits-1200", "displayName": "1200 积分", "credits": 1200, "amountCents": 9900, "currency": "CNY" }
    ]
  }
  ```
- `PackageCatalog` 服务（`apps/api/src/services/packageCatalog.ts`，镜像 `ConfigModelCatalog`）：
  ```typescript
  interface PackageCatalog {
    listPackages(): CreditPackage[];
    getPackage(id: string): CreditPackage; // throws PackageCatalogError(404) if unknown
  }
  ```
  `ConfigPackageCatalog` 从 config 路径加载；`PackageCatalogError` 带 `statusCode`。
- config：`ApiConfig` 加 `packagesConfigPath: string`（默认 `config/credit-packages.json`，env `GW_LINK_PACKAGES_CONFIG_PATH`）。

### 3. OrderRepository（仓库 seam，memory + drizzle + 契约测试）

`repositories/types.ts` 新增：
```typescript
export interface OrderRecord {
  id: string;
  packageId: string;
  credits: number;
  amountCents: number;
  currency: string;
  status: OrderStatus;
  checkoutRef: string;
  createdAt: string;
}

export interface OrderRepository {
  insert(record: OrderRecord, ownerUserId: string): Promise<void> | void;
  listByOwner(ownerUserId: string): Promise<OrderRecord[]> | OrderRecord[];
  get(ownerUserId: string, id: string): Promise<OrderRecord | null> | OrderRecord | null;
}
```
- `repositories/memory.ts`：`InMemoryOrderRepository`（`structuredClone` 存储边界；按 owner 过滤）。
- `repositories/drizzle.ts`：`DrizzleOrderRepository`；`db/schema.ts` 加 `orders` 表（`id` pk、`owner_user_id`、`package_id`、`credits`、`amount_cents`、`currency`、`status`、`checkout_ref`、`created_at`；`owner_user_id` FK → users CASCADE）。
- migration：`db:generate` 生成新 SQL（`orders` 表）。
- 跨后端契约测试（`repositories/__tests__/repositoryContract.test.ts`）：orders insert/listByOwner/get + owner 隔离，跑 memory + pglite。

### 4. OrderService

`apps/api/src/services/orderService.ts`（interface + `OrderServiceImpl`）：
```typescript
interface OrderService {
  createOrder(userId: string, packageId: string): Promise<Order>;
  listOrders(userId: string): Promise<Order[]>;
}
```
- 注入 `PackageCatalog`、`OrderRepository`、`idGenerator`（默认 `order_${uuid}`）、`checkoutRefGenerator`（默认 `checkout_${uuid}`）、`clock`。
- `createOrder`：`catalog.getPackage(packageId)`（未知 → 抛 `OrderError`/catalog 404）→ 建 `OrderRecord`（status `"pending"`，credits/amountCents/currency 取自套餐，checkoutRef 生成，createdAt=clock）→ `insert(record, userId)` → 返回 clone 的 `Order`（防御性 clone，不泄露内部引用）。
- `listOrders`：`listByOwner(userId)` → clone 数组。
- `OrderServiceError` 带 `statusCode`（路由映射）。
- `InMemoryOrderService` 薄子类（wire InMemoryOrderRepository），保留构造签名；`createServices(config)` 按 `databaseUrl` 选 Drizzle vs 内存，并注入 PackageCatalog。

### 5. 路由（`apps/api/src/routes/orders.ts`，`registerOrderRoutes(server, { orderService, packageCatalog, authService })`）

- `GET /v1/packages`（**公开**）→ `{ packages: packageCatalog.listPackages() }`。
- `POST /v1/orders`（**鉴权** via `createAuthGuard(authService)`）：手写守卫解析 body `{ packageId: string }`（非法 → 400 `{ error: "Invalid order request" }`）→ `orderService.createOrder(request.userId, packageId)` → `201 { order }`；未知套餐 → 404 `{ error }`（catalog/order 错误的 statusCode）。
- `GET /v1/orders`（**鉴权**）→ `{ orders: orderService.listOrders(request.userId) }`（仅本人）。
- `buildServer` 注册：packages 公开、orders 经 authGuard；`/v1/packages` 加入公开路由白名单（同 `/v1/models`）。

### 6. 文档 / 配置

- `apps/api/src/config.ts`：`packagesConfigPath`。
- README：新增"Payment Orders (foundation)"小节（套餐目录 + 建/列订单，明确不加分/无 webhook）。
- mvp-skeleton：新增段落。
- `.env.example`：`GW_LINK_PACKAGES_CONFIG_PATH` 注释。

## 错误处理

- 未知 `packageId` → 404 `{ error }`（PackageCatalogError/OrderServiceError 的 statusCode）。
- 未鉴权（POST/GET /v1/orders）→ 401 `{ error: "Authentication required" }`。
- 请求体非法（POST /v1/orders）→ 400 `{ error: "Invalid order request" }`。
- 订单只列/查本人（owner 过滤，应用层，与 generation/asset 一致）。
- 不泄露内部：`Order` 不含 owner_user_id。

## 测试策略

- **PackageCatalog**（`services/__tests__`）：config 加载、listPackages、getPackage 已知/未知（404）。
- **OrderRepository 契约测试**：orders insert → listByOwner（按 owner 过滤、其它 owner 看不到）、get 命中/未命中，memory + pglite 双跑。
- **OrderService**（`services/__tests__`）：createOrder 返回 pending 订单（credits/amountCents/currency 取自套餐、checkoutRef 非空、status pending）、未知套餐抛 statusCode 404、listOrders 按 owner、注入 idGenerator/checkoutRefGenerator 决定性、防御性 clone（改返回值不影响存储）。
- **路由**（`routes/__tests__/orders.test.ts`）：`GET /v1/packages` 公开返回套餐；`POST /v1/orders` 未鉴权 401、非法 body 400、未知套餐 404、成功 201 + pending order；`GET /v1/orders` 鉴权 + owner 隔离（用户 A 看不到用户 B 的订单）。
- **config**：packagesConfigPath 解析（默认 + env 覆盖）。
- 全量 `pnpm test`（含新 db 迁移/契约测试）+ `pnpm typecheck` 全绿。

## 任务分解（约 6 任务）

1. shared 契约（`orders.ts`：CreditPackage/Order/OrderStatus/CreateOrderRequest）+ index 导出。
2. 套餐 config + `packagesConfigPath` config + `ConfigPackageCatalog` + `GET /v1/packages` 路由 + 测试。
3. `OrderRepository`（types + InMemory + Drizzle + `orders` schema + migration + 契约测试）。
4. `OrderService`（+ `InMemoryOrderService` + `createServices`/`buildServer` 接线）+ 测试。
5. 路由 `POST /v1/orders` + `GET /v1/orders`（authGuard、404、隔离）+ 测试。
6. 文档 + `.env.example`。

## 交付清单

- [ ] shared `orders.ts` 契约 + 导出
- [ ] `config/credit-packages.json` + `packagesConfigPath` + `ConfigPackageCatalog` + `GET /v1/packages`
- [ ] `OrderRepository`（memory + drizzle + migration + 契约测试）
- [ ] `OrderService` + createServices/buildServer 接线
- [ ] `POST /v1/orders` + `GET /v1/orders`（401/400/404/隔离）
- [ ] 文档 + `.env.example`
- [ ] `pnpm test` + `pnpm typecheck` 全绿
