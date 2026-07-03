# GW-LINK OmniAI Mobile 订单/结账 设计规格

**日期**: 2026-07-03
**Slice**: 26 — Mobile 订单/结账（含订单详情 + 收据）

---

## 摘要

把桌面已有的结账体验搬到 Expo 移动端：列出积分套餐、购买（建单 → dev 完成支付 → 刷新余额与订单）、查看订单详情与已支付收据。订单展示的纯函数（`formatMoney`/`formatDateTime`/`getOrderStatusLabel`/`formatPackagePrice`/`buildReceiptLines`）从桌面提升到 `@gw-link-omniai/shared`，桌面与移动端共用，消除重复。

## 动机

支付子片 A/B/C 与订单详情/收据都已在后端与桌面就位；`apiClient`（在 shared 里）已含 `listPackages`/`createOrder`/`listOrders`/`devCompletePayment`。移动端目前只有登录/生成/资产，尚无结账。本片让移动端用户也能端到端购买并查看订单/收据，复用同一后端与同一展示逻辑。

**非目标（留后续）**：
- 真实支付 provider 结账页/重定向（仍走 dev 完成端点，同桌面）
- 收据导出/打印（后续单独切片）
- `GET /v1/orders/:id` 单条端点（移动端复用 `listOrders` 数据）
- 退款、发票（真实增值税发票）

## 设计

### 关键默认（brainstorm 确认）

- 移动端结账镜像桌面：`buyPackage` = `createOrder` → `devCompletePayment` → 刷新余额 + 订单；`401` → 登出。
- 订单展示纯函数提升到 shared（新 `orderView.ts`）；桌面 `orderModel.ts` 改为再导出，App/测试不动；移动端从 shared 引入。
- 收据仅对 `status === "paid"` 订单展示；详情内联「查看/收起」。

### 1. shared 订单展示模块（`packages/shared/src/orderView.ts`）

把桌面 `apps/desktop/src/orderModel.ts` 的纯函数原样迁入（签名不变）：
```typescript
export function formatMoney(amountCents: number, currency: string): string; // CNY → "¥9.90"，其它 → "9.90 <currency>"
export function formatPackagePrice(pkg: CreditPackage): string;             // 委托 formatMoney
export function getOrderStatusLabel(status: OrderStatus): string;           // pending/paid/failed 中文
export function formatDateTime(iso: string): string;                        // ISO 裁到分钟 "2026-07-03 21:19"
export function buildReceiptLines(order: Order, packageName: string): Array<{ label: string; value: string }>;
```
- 从 `packages/shared/src/index.ts` 再导出这些。
- 新增 shared 单测 `packages/shared/src/__tests__/orderView.test.ts`（迁移桌面 orderModel.test 的断言：formatMoney CNY/非 CNY、formatPackagePrice、getOrderStatusLabel、formatDateTime、buildReceiptLines 六行）。

### 2. 桌面改为消费 shared（`apps/desktop/src/orderModel.ts`）

- `orderModel.ts` 整体改为再导出：`export { formatMoney, formatPackagePrice, getOrderStatusLabel, formatDateTime, buildReceiptLines } from "@gw-link-omniai/shared";`。
- `App.tsx` 的 `import { ... } from "./orderModel"` 不变（仍从本地再导出取）。
- 删除 `apps/desktop/src/__tests__/orderModel.test.ts`（断言已迁至 shared；避免重复测试再导出）。

### 3. 移动端 appModel（`apps/mobile/src/appModel.ts`）

- `MobileAppState` 增：`packages: CreditPackage[]`、`orders: Order[]`、`selectedOrderId: string | null`（初始 `[]`/`[]`/`null`）。
- `loadUserData(token)` 的 `Promise.all` 增 `apiClient.listPackages()` 与 `apiClient.listOrders(token)`，写入 `packages`/`orders`。
- `signOutInternal` 重置 `packages: []`、`orders: []`、`selectedOrderId: null`。
- `MobileAppController` 增方法：
  - `buyPackage(packageId: string): Promise<void>`：
    - 无 token → 返回；`setState({ actionError: null })`。
    - `const order = await apiClient.createOrder(packageId, token)`；`await apiClient.devCompletePayment(order.id, token)`。
    - 刷新：`const [balance, orders] = await Promise.all([getCreditBalance(token), listOrders(token)])`；`setState({ balance: balance.credits, orders })`。
    - `catch`：`ApiError` 且 `401` → `signOutInternal()`；否则 `setState({ actionError: purchaseError(err) })`。
  - `selectOrder(orderId: string | null): void`：`setState({ selectedOrderId: orderId })`（切换/收起由调用方传 null）。
- 新增 `purchaseError(err)`（同风格：`ApiError` → "购买失败，请稍后重试"；否则 "网络错误"）。

### 4. 移动端 UI（`apps/mobile/App.tsx`，typecheck-only）

- signedIn 区新增「积分套餐」：`FlatList data={state.packages}`，每项 `displayName` + `formatPackagePrice(pkg)` + `credits` + `<Button title="购买" onPress={() => void ctrl.buyPackage(pkg.id)} />`。
- 新增「订单」：`FlatList data={state.orders}`，每项 `packageId` + `getOrderStatusLabel(status)` + `<Button title={expanded?"收起":"查看"} onPress={() => ctrl.selectOrder(expanded?null:order.id)} />`；`expanded`（`order.id === state.selectedOrderId`）时展开详情（订单号/套餐名（从 `state.packages` 按 packageId 查，回退 packageId）/积分/金额 `formatMoney`/状态/下单时间 `formatDateTime`/付款时间（有则）/凭证）；`status === "paid"` 再渲染 `buildReceiptLines` 每行 `label: value`（RN `<Text>`）。
- 从 `@gw-link-omniai/shared` 引入 `formatMoney`/`formatDateTime`/`getOrderStatusLabel`/`formatPackagePrice`/`buildReceiptLines` 与类型 `CreditPackage`/`Order`。

### 5. 测试（`apps/mobile/src/__tests__/appModel.test.ts`）

- `createFakeClient` 的 4 个 checkout 桩改真 fake（闭包 `orders`/`balance`）：`listPackages` 返回一个套餐；`createOrder` 建 pending 订单入闭包；`devCompletePayment` 置 paid 并 `balance += credits`；`listOrders` 返回闭包。
- 新增测试：
  - `restore`/`verifyLogin` 后 `packages`/`orders` 载入 state。
  - `buyPackage` → `balance` 增、`orders` 含一条 paid。
  - `buyPackage` 遇 401 → 登出（stage `signedOut`）。
  - `selectOrder(id)` → `selectedOrderId` 设；`selectOrder(null)` → 清。
  - `signOut` 重置 packages/orders/selectedOrderId。

## 错误处理

- `buyPackage`：401 → 登出；其它 → `actionError`。移动端不接触 secret（dev-complete 服务端签名，同桌面）。
- 展开为纯本地 state，无网络。

## 测试策略

- **shared**：`orderView` 单测（迁移桌面断言）；typecheck。
- **桌面**：`orderModel` 再导出后 `App.test` 全绿（无行为变化）；typecheck。
- **移动端**：appModel 新测（buyPackage/selectOrder/加载/登出重置/401）；App.tsx typecheck-only。
- 全量 `pnpm test` + `pnpm typecheck` 全绿。

## 任务分解（约 4 任务）

1. shared `orderView.ts` + index 再导出 + shared 测试；桌面 `orderModel.ts` 改再导出 + 删桌面 orderModel.test（桌面 App.test 保持绿）。
2. 移动端 appModel：`packages`/`orders`/`selectedOrderId` state + `loadUserData` 扩展 + `buyPackage`/`selectOrder` + `purchaseError` + signOut 重置 + fake client 真化 + 测试。
3. 移动端 App.tsx：套餐区 + 订单区（详情 + 收据）+ typecheck。
4. 文档（README + mvp-skeleton）。

## 交付清单

- [ ] shared `orderView` + 再导出 + 测试；桌面 orderModel 再导出（App.test 绿）
- [ ] mobile appModel packages/orders/selectedOrderId + buyPackage/selectOrder + 测试
- [ ] mobile App.tsx 套餐/订单/详情/收据 + typecheck
- [ ] 文档
- [ ] `pnpm test` + `pnpm typecheck` 全绿
