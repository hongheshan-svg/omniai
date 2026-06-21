# GW-LINK OmniAI 桌面端保存生成结果为资产 设计

文档版本：V0.1
文档日期：2026-06-21
文档类型：阶段实现设计
适用阶段：Stage 9 - Desktop Asset Save（解锁 Stage 3 推迟的资产创建）

## 1. 背景

Stage 3（桌面接入 API）刻意把「桌面端经 API 创建资产」推迟了：API 的资产创建校验要求 `source.taskStatus === "succeeded"`，而当时生成任务恒为 `queued`，无法满足。Stage 8（真实文本 provider）已让文本任务能同步走到 `succeeded` 并携带 `result`（真实文本）。资产创建的前置条件现在满足了。

本阶段把桌面端的「保存到资产库」补回来：在 `succeeded` 且带文本 `result` 的任务上，用任务内容构造资产请求，经现有 `/v1/assets` 创建资产，并刷新资产库。后端资产路由、按用户隔离、鉴权守卫、资产服务与校验都已存在——本阶段**不改后端、不改产品合同**，只在桌面端补上客户端方法与保存流程。

关键契合点：`CreationAssetContent` 的文本变体 `{ kind: "text"; text; format: "markdown" | "plain" }` 与 `GenerationTaskResult` 的文本变体**完全相同**，所以资产内容可直接取自 `task.result`。

## 2. 目标

1. 桌面 API 客户端补回 `createAsset(request, token)`（Stage 3 因资产创建受阻而移除）。
2. 新增框架无关、可单测的 `buildAssetRequestFromTask(task)`：从 `succeeded` 文本任务构造 `CreationAssetRequest`。
3. 桌面端在「`succeeded` 且 `result.kind === "text"`」的任务卡片上提供「保存到资产库」，调用 API 创建资产后刷新资产库。
4. 不改后端、不改 `packages/shared` 合同。

验收标准：登录后提交并得到 `succeeded` 文本任务，点「保存到资产库」，资产出现在本人资产库；图片/视频/`queued` 任务无保存按钮；`pnpm test`、`pnpm typecheck` 全绿。

## 3. 非目标

1. 图片/视频资产保存（它们仍 `queued`、无 `result`，本阶段不可保存）。
2. 后端改动（资产路由/服务/校验已存在）；`packages/shared` 合同改动（内容变体已兼容）。
3. 资产去重 / 编辑 / 删除 / 重命名；资产「复用参数」回填到 Studio。
4. 对象存储（图片/视频文件仍为后续切片）。
5. admin/mobile 的资产保存。
6. 乐观更新 / 离线队列。

## 4. 数据行为

1. 仅当任务 `status === "succeeded"` 且 `result?.kind === "text"` 时，任务卡片显示「保存到资产库」。
2. 点击 → `buildAssetRequestFromTask(task)` 构造请求 → `apiClient.createAsset(req, token)` → 成功后 `apiClient.listAssets(token)` 刷新资产库。
3. `buildAssetRequestFromTask` 映射：`mode = task.mode`；`title = getAssetModeLabel(task.mode)`（如「文本资产」，总非空）；`content = { ...task.result }`（文本，与 `CreationAssetContent` 文本变体一致）；`source = { taskId: task.id, taskStatus: "succeeded" }`；`prompt = task.prompt`；`optimizedPrompt = task.optimizedPrompt`；`preset = task.preset`（深拷贝）。
4. 错误：`createAsset` 抛 `ApiError` → App 显示错误；401 → 回登录态（与现有动作一致）。
5. 资产按用户隔离、列表只读展示——均沿用现状。

## 5. 组件设计

### 5.1 API 客户端

`apps/desktop/src/apiClient.ts`：在 `ApiClient` 接口与 `createApiClient` 实现中补回：

```ts
createAsset(request: CreationAssetRequest, token: string): Promise<CreationAsset>;
```

实现：`POST ${baseUrl}/v1/assets`，带 `Authorization: Bearer <token>` 与 `content-type: application/json`，body 为 `request`，解包响应信封 `{ asset }` 返回 `asset`；非 2xx → `ApiError`（与既有方法一致）。

### 5.2 资产请求构造（框架无关）

`apps/desktop/src/assetModel.ts`：新增

```ts
export function buildAssetRequestFromTask(task: GenerationTask): CreationAssetRequest;
```

要求 `task.status === "succeeded"` 且 `task.result?.kind === "text"`（调用点已通过按钮可见性保证）。返回上面 §4.3 的映射。`content` 深拷贝 `task.result`；`preset` 深拷贝（与现有 clone 习惯一致）。纯函数、vitest 直接单测。

### 5.3 App 改造

`apps/desktop/src/App.tsx`：

1. 任务卡片：当 `task.status === "succeeded" && task.result?.kind === "text"` 时渲染「保存到资产库」按钮。
2. `handleSaveAsset(task)`：`await client.createAsset(buildAssetRequestFromTask(task), token)`，成功后 `setAssets(await client.listAssets(token))`；`catch` 用现有 `errorMessage`/401 处理（401 → `handleSignedOut`）。
3. 资产库继续只读展示（现状）；保存后刷新即可见。

### 5.4 文档

README「Desktop ↔ API」/「Real Text Generation」表述更新：资产创建不再推迟——`succeeded` 文本任务可保存为资产；`docs/architecture/mvp-skeleton.md` 对应小节同步。

## 6. 错误处理

1. `createAsset` 非 2xx → `ApiError` → App 错误位展示 `error.message`；401 → 回登录态。
2. 不向用户泄露后端内部细节（沿用客户端既有映射）。
3. 仅对满足条件的任务暴露保存按钮，避免对无 `result` 的任务发起注定失败的请求。

## 7. 测试策略

1. **apiClient.createAsset 单测**（注入 fake fetch）：正确 URL/方法/bearer 头/body；解包 `{ asset }`；非 2xx → `ApiError`。
2. **buildAssetRequestFromTask 单测**：succeeded 文本任务 → 正确的 mode/title/content(=result)/source(succeeded)/prompt/optimizedPrompt/preset；返回值与 task 不共享可变引用（content/preset 深拷贝）。
3. **App 集成测**（注入 fake client）：succeeded 文本任务显示「保存到资产库」→ 点击 → 资产出现在资产库；queued 任务无该按钮；保存失败（ApiError）显示错误。
4. **既有桌面/接口测保持绿**。
5. 全量：`pnpm test`、`pnpm typecheck`。

## 8. 风险与约束

1. **仅文本可存**：图片/视频无 `result`、仍 `queued`，本阶段不可保存——文档说明，待真实图/视频 provider。
2. **无后端改动**：依赖现有资产校验（`taskStatus === "succeeded"`）；若任务非 succeeded，按钮不出现，从源头避免 400。
3. **合同兼容性**：`content = task.result` 依赖文本变体一致；若未来 `GenerationTaskResult` 与 `CreationAssetContent` 文本变体分叉，需要显式映射（本阶段一致，直接使用）。
4. **资产标题**：用模式标签（同模式资产标题相同，可接受）；更具辨识度的标题留后续。

## 9. 验收清单

- [ ] `apiClient.createAsset(request, token)` 补回 + 单测（bearer、信封解包、ApiError）。
- [ ] `buildAssetRequestFromTask(task)` + 单测（映射正确、深拷贝、succeeded+text）。
- [ ] App 在 succeeded 文本任务上显示「保存到资产库」→ 创建 → 刷新资产库；queued 无按钮；错误/401 处理。
- [ ] 不改后端、不改 `packages/shared`。
- [ ] README、`mvp-skeleton.md` 更新（资产创建不再推迟）。
- [ ] `pnpm test` 通过。
- [ ] `pnpm typecheck` 通过。
