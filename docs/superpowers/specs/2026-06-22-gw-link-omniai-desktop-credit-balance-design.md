# GW-LINK OmniAI 桌面端积分余额 + 402 设计

文档版本：V0.1
文档日期：2026-06-22
文档类型：阶段实现设计
适用阶段：Stage 11 - Desktop Credit Balance（补齐计费地基的前端闭环）

## 1. 背景

Stage 10（积分/计费基础）建立了服务端积分账本：新用户注册赠送初始积分、生成成功扣减、`GET /v1/credits/balance` 暴露余额、余额不足时 `POST /v1/generations` 返回 402。该片刻意「后端为主」，桌面端的余额显示与 402 处理留作后续。

本阶段补齐前端闭环：桌面端在顶部常驻显示积分余额，登录与每次生成后刷新，并对余额不足（402）给出友好中文提示。**纯前端（桌面），不改后端、不改 `packages/shared`**。

## 2. 目标

1. `apiClient` 增 `getCreditBalance(token)` 拉取本人余额。
2. 框架无关 `formatCreditBalance(balance)` 格式化为「积分：N」。
3. 桌面端顶部常驻显示余额；登录时加载、每次提交生成后刷新；登出清空。
4. 生成遇 402 时显示友好中文提示「积分不足，无法生成」。
5. 不改后端、不改 `packages/shared`。

验收标准：登录后顶部显示「积分：100」；提交文本生成成功后余额刷新（减少）；余额不足时提交显示「积分不足，无法生成」且不签出；`pnpm test`、`pnpm typecheck` 全绿。

## 3. 非目标

1. 后端 / `packages/shared` 改动（余额接口与 `CreditAmount` 已存在）。
2. 提前禁用「提交生成」按钮（客户端 `preset.creditEstimate` 估算与服务端实扣 `creditUnitCost` 可能不一致，避免误导）。
3. admin / mobile 的余额显示。
4. 充值 / 购买积分入口（无支付渠道，后续）。
5. 余额变动动画 / 乐观更新 / 离线缓存。

## 4. 数据行为

1. **加载**：`handleVerifyLogin` 成功后，与 tasks/assets 一同 `Promise.all` 拉取 `getCreditBalance(token)`，`setBalance`。
2. **刷新**：`handleSubmitGeneration` 成功路径在 `setTasks(...)` 后 `setBalance(await api.getCreditBalance(token))`。queued（无扣费）与 succeeded（扣费）都覆盖；资产保存不刷新（不扣费）。
3. **402**：`handleSubmitGeneration` 的 catch 中，在既有 `401 → handleSignedOut` 分支后增加 `402 → setActionError("积分不足，无法生成")` 并 return；其余错误沿用 `errorMessage`。402 不签出、不刷新余额（无扣费、余额不变）。
4. **登出清理**：`handleSignedOut` 复位 `setBalance(undefined)`（与 `setTasks([])`/`setAssets([])` 一致）。
5. **展示**：登录态 header 在 `balance` 存在时渲染 `formatCreditBalance(balance)`；未登录或未加载时不显示。

## 5. 组件设计

### 5.1 API 客户端

`apps/desktop/src/apiClient.ts`：
- 从 `@gw-link-omniai/shared` 引入 `CreditAmount`。
- `ApiClient` 接口增 `getCreditBalance(token: string): Promise<CreditAmount>;`。
- 实现：
  ```ts
  async getCreditBalance(token) {
    const { balance } = await send<{ balance: CreditAmount }>("/v1/credits/balance", { token });
    return balance;
  }
  ```
  非 2xx → `ApiError`（沿用 `send`）。

### 5.2 余额格式化（框架无关）

新增 `apps/desktop/src/creditModel.ts`：
```ts
import type { CreditAmount } from "@gw-link-omniai/shared";

export function formatCreditBalance(balance: CreditAmount): string {
  return `积分：${balance.credits}`;
}
```
纯函数，vitest 直接单测。

### 5.3 App 改造

`apps/desktop/src/App.tsx`：
1. 引入 `CreditAmount`（type）与 `formatCreditBalance`。
2. 新增 `const [balance, setBalance] = useState<CreditAmount | undefined>(undefined);`。
3. `handleSignedOut` 中加 `setBalance(undefined);`。
4. `handleVerifyLogin`：`Promise.all` 增加 `api.getCreditBalance(authSession.token)`，解构后 `setBalance`。
5. `handleSubmitGeneration` 成功路径：`setTasks(await api.listGenerations(token));` 后 `setBalance(await api.getCreditBalance(token));`。catch 增加 402 分支（在 401 分支之后）：
   ```ts
   if (error instanceof ApiError && error.status === 402) {
     setActionError("积分不足，无法生成");
     return;
   }
   ```
6. 登录态 header：在 CTA/登出旁渲染 `{balance ? <p>{formatCreditBalance(balance)}</p> : null}`。

### 5.4 文档

README「Credit Foundation」补一句：桌面端顶部显示余额、生成后刷新、余额不足友好提示；`docs/architecture/mvp-skeleton.md` 对应小节同步（计费前端闭环）。

## 6. 错误处理

1. 生成 402 → 友好中文提示「积分不足，无法生成」，不签出、不刷新余额。
2. 生成 401 → 既有 `handleSignedOut("登录已失效，请重新登录")`（不变）。
3. `getCreditBalance` 在登录 `Promise.all` 中失败 → 与 tasks/assets 一致报到 `authError`（不单独阻断，不泄露后端细节）。
4. 生成成功后 `getCreditBalance` 刷新失败 → 走 `handleSubmitGeneration` 的 catch（非 401/402 → `errorMessage`）；任务已提交、余额暂不更新，下次生成或登录再同步。

## 7. 测试策略

1. **apiClient.getCreditBalance 单测**（注入 fake fetch）：URL `/v1/credits/balance`、bearer 头、解包 `{ balance }`；非 2xx → `ApiError`。
2. **formatCreditBalance 单测**：`{ credits: 100, unit: "credit" }` → 「积分：100」。
3. **App 集成测**（注入 fake client，`createFakeClient` 补 `getCreditBalance`）：
   - 登录后 header 显示「积分：100」。
   - 提交生成成功后余额刷新（fake 第二次返回不同值 → header 更新）。
   - 提交触发 402（fake `createGeneration` 抛 `ApiError("Insufficient credits", 402)`）→ 显示「积分不足，无法生成」且仍在登录态。
4. **既有桌面测试保持绿**：`createFakeClient` 补 `getCreditBalance` 满足接口；既有用例不受影响。
5. 全量：`pnpm test`、`pnpm typecheck`。

## 8. 风险与约束

1. **估算 vs 实扣**：不提前禁用提交按钮，避免客户端 `creditEstimate` 与服务端 `creditUnitCost` 不一致造成误导；以服务端 402 为准（反应式）。
2. **刷新时机**：仅登录 + 生成后刷新；并发多端余额变动不实时同步（可接受，下次操作刷新）。
3. **纯前端**：不改后端、不改 `packages/shared`；余额接口与 `CreditAmount` 合同已就绪。

## 9. 验收清单

- [ ] `apiClient.getCreditBalance(token)` + 单测（bearer、信封解包、ApiError）。
- [ ] `formatCreditBalance(balance)` + 单测。
- [ ] App 顶部常驻余额；登录加载、生成后刷新、登出清空。
- [ ] 生成 402 → 「积分不足，无法生成」，不签出。
- [ ] `createFakeClient` 补 `getCreditBalance`，既有桌面测试保持绿。
- [ ] 不改后端、不改 `packages/shared`。
- [ ] README、`mvp-skeleton.md` 更新。
- [ ] `pnpm test`、`pnpm typecheck` 通过。
