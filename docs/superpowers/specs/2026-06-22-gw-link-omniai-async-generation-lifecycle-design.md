# GW-LINK OmniAI 异步生成生命周期 设计

文档版本：V0.1
文档日期：2026-06-22
文档类型：阶段实现设计
适用阶段：Stage 15 - Async Generation Lifecycle（11a：异步任务机器，fake provider）

## 1. 背景

文本/图片生成同步完成（submit 即 `succeeded`）。真实视频是异步的（提交→`running`→轮询→`succeeded`/`failed`），但当前没有任何东西产生或推进 `running` 状态：`ProviderAdapter` 只有 `submitGeneration`、`GenerationTaskRepository` 只有 `insert`+`list`、生成路由只有 POST + GET 列表。

「真实视频 provider」拆为两片，本片是 **11a：异步生成生命周期（基础设施）**——用确定性的 **fake 异步 provider** 把 `running`→轮询→`succeeded`/`failed` 的整套机器端到端跑通并完整可测，不接真实视频 API（11b）。

关键边界：provider 的**作业引用**（job reference）是隐藏的 provider 细节，必须作**服务端内部列**、不进 `GenerationTask` 产品合同。`GenerationTaskStatus` 已含 `running`/`failed`，故**不改 `packages/shared`**。

## 2. 目标

1. provider 异步能力：`submitGeneration` 可返回 `running` + `providerRef`；`ProviderAdapter` 增可选 `pollGeneration(req)`。
2. `FakeAsyncProvider`（测试/演示）：submit→`running`+ref；poll→第 N 次后 `succeeded`+result。
3. `CompositeProviderAdapter` 增 `video` 槽，submit/poll 按 mode 路由。
4. 仓库存内部 `provider_ref` 列 + `get`/`update`（task 仍按合同返回，省略 ref）。
5. `generationService`：submit `running` → 落库 + 存 ref（不扣费）；`refreshTask(id,userId)` 轮询 running 任务、`running→succeeded` 时扣 `creditUnitCost`、落库。
6. `GET /v1/generations/:id`（守卫、owner 限定）读时重查并返回最新任务。
7. 桌面 `apiClient.getGeneration` + running 任务「刷新状态」按钮。
8. 不改 `packages/shared`；默认生产视频仍 `queued`（11b 接真实异步 provider）。

验收标准：注入 FakeAsyncProvider 提交视频生成 → `running`；`GET /v1/generations/:id` 反复调用直到 `succeeded`（带 result）、余额扣 3；桌面对 running 任务点「刷新状态」更新为已完成；`pnpm test`、`pnpm typecheck` 全绿。

## 3. 非目标

1. 真实视频 API（11b）。
2. 后台 worker / 服务端自动轮询（读时重查；桌面手动刷新）。
3. 桌面自动轮询（setInterval）。
4. 并发原子扣费（沿用既有取舍）。
5. `packages/shared` 改动（状态已存在；providerRef 内部）。
6. 真实图片/文本改异步（仍同步）。

## 4. 数据行为

1. **submit**：`generationService.createTask` 现已用 `providerResult.status`。新增：provider 返回 `running` → 落任务为 `running`、存 `providerRef = providerResult.providerRef ?? null`、**不扣费**；`succeeded` → 扣费 + 落库（沿用）；`queued` → 落库不扣（沿用）。
2. **refreshTask(id, userId)**：
   - `repo.get(userId, id)` → 无 → `GenerationTaskError(404)`。
   - `task.status !== "running"` 或无 `providerRef` → 原样返回（终态/不可轮询）。
   - 否则经 catalog 由 `task.preset.modelId`+`task.mode` 解析 provider，若 `providerAdapter.pollGeneration` 存在 → `pollGeneration({ mode, provider, providerModelId, providerRef })`：
     - 结果 `running` → 原样返回（仍在跑）。
     - `succeeded` → 更新 task（status、result、updatedAt=clock.now）+ `creditService.deduct(userId, creditUnitCost, taskId)`（仅此转移扣一次）+ `repo.update(task, userId, providerRef)` → 返回。
     - `failed` → 更新 task（status=failed、updatedAt）+ `repo.update`（不扣）→ 返回。
   - provider 缺 `pollGeneration` → 原样返回。
3. **providerRef**：服务端内部，存 `generation_tasks.provider_ref`；`list`/`GenerationTask` 不含。
4. **扣费一致性**：扣费只发生在「→succeeded」转移（同步 submit 或异步 refresh），不重复。

## 5. 组件设计

### 5.1 provider 接口与 fake 异步 provider

`apps/api/src/services/gatewayClient.ts`：
- `ProviderGenerationResult` 增 `providerRef?: string`。
- `ProviderAdapter` 增可选方法：`pollGeneration?(request: ProviderPollRequest): Promise<ProviderGenerationResult>`。
- 新增类型 `ProviderPollRequest { mode: CreationMode; provider: CatalogProviderReference; providerModelId: string; providerRef: string }`。

`apps/api/src/services/fakeAsyncProvider.ts`：`FakeAsyncProvider implements ProviderAdapter`，选项 `{ pollsUntilDone?: number; idGenerator?: () => string; clock? }`（默认 `pollsUntilDone=1`）。`submitGeneration` → `{ status:"running", providerRef: idGenerator(), ...base }`，并在内部 Map 记 `ref → 剩余次数`。`pollGeneration({ providerRef })` → 剩余>0 则减一并返回 `running`；归零则返回 `succeeded` + `result`（按 mode：video → `{ kind:"image", url:"data:image/png;base64,dmlkZW8=", alt:"video" }`——注：11a 结果用占位 image 变体，真实视频结果变体由 11b 视需要引入；本片只验证生命周期）。
> 注：为不在 11a 改 `packages/shared`，FakeAsyncProvider 的 succeeded 结果复用现有 `GenerationTaskResult` 变体（image data URL 占位）。视频专属结果变体留 11b 评估。

### 5.2 CompositeProviderAdapter

`compositeProviderAdapter.ts`：`CompositeProviders` 增 `video: ProviderAdapter`。`submitGeneration` 与新增 `pollGeneration` 都按 `request.mode` 路由（`image`→image、`video`→video、否则 text）；`pollGeneration` 若目标 provider 无该方法则抛 `ProviderAdapterError(502, "Provider does not support polling")`（refreshTask 仅在 provider 有 poll 时调用，故正常路径不触发）。默认 video = text provider（对 video 返回 `queued`，生产行为不变）；测试注入 FakeAsyncProvider。

### 5.3 仓库

`db/schema.ts`：`generation_tasks` 加 `provider_ref text`（可空）。迁移 `0003_*.sql`。
`repositories/types.ts` `GenerationTaskRepository`：
```ts
insert(task: GenerationTask, ownerUserId: string, providerRef?: string | null): Promise<void>;
list(ownerUserId: string): Promise<GenerationTask[]>;
get(ownerUserId: string, id: string): Promise<{ task: GenerationTask; providerRef: string | null } | undefined>;
update(task: GenerationTask, ownerUserId: string, providerRef?: string | null): Promise<void>;
```
memory：在行上多存 `providerRef`；`get` 按 owner+id 返回 `{task, providerRef}`（clone）；`update` 按 id 替换（owner 校验）。drizzle：`insert` 写 `providerRef ?? null`；`get` select 一行映射；`update` `set status/result/updatedAt/providerRef where id && owner`。`list` 的 `mapTaskRow` 不变（不含 ref）。契约测试加：insert+get round-trip（含 ref）、update 改 status/result/ref、按 owner 隔离 get。

### 5.4 generationService

`GenerationServiceImpl`：
- `createTask`：provider 返回 `running` → 走新分支（落 running + `insert(task, userId, providerResult.providerRef ?? null)`、不扣费）；其余沿用（succeeded 扣 + insert(…, null)；queued insert(…, null)）。
- 新增 `refreshTask(id: string, userId: string): Promise<GenerationTask>`（见 §4.2）。`GenerationService` 接口加 `refreshTask`。需要 `creditService`（已注入）与 `modelCatalog`（已注入）解析 provider 引用。

### 5.5 路由

`routes/generations.ts`：`server.get("/v1/generations/:id", { preHandler }, ...)` → `readId(params)` → `try { return { task: await generationService.refreshTask(id, request.userId!) } } catch → sendGenerationTaskError`。404 经 `GenerationTaskError(404)`。

### 5.6 桌面

`apiClient.ts`：`getGeneration(id: string, token: string): Promise<GenerationTask>` → `GET /v1/generations/:id`，解包 `{ task }`。
`App.tsx`：任务卡片 `status==="running"` 时显示「刷新状态」按钮 → `handleRefreshTask(task)`：`const updated = await api.getGeneration(task.id, token); setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))`；401 → handleSignedOut；其余 → actionError。
`generationModel.ts`：`getGenerationStatusLabel` 确保覆盖 `running`（如「生成中」）/`failed`（如「失败」）。

### 5.7 文档

README/`mvp-skeleton.md`：异步生命周期（11a，fake provider）；真实视频留 11b。

## 6. 错误处理

1. `GET /:id` 任务不存在或非本人 → 404。
2. poll 时 provider 抛错 → `ProviderAdapterError`→`GenerationTaskError(502)`；任务保持 running，可重试（不误置 failed）。
3. 扣费仅在 running→succeeded 转移一次。
4. 不泄露 providerRef / provider 内部。

## 7. 测试策略

1. **FakeAsyncProvider 单测**：submit→running+ref；pollGeneration `pollsUntilDone` 次后 succeeded+result；未知 ref 行为确定。
2. **CompositeProviderAdapter 单测**：submit/poll 按 mode 路由（video→video、image→image、否则 text）。
3. **仓库契约**（双后端）：insert+get round-trip 含 providerRef；update 改 status/result/ref；get 按 owner 隔离。
4. **generationService 单测**：submit running → 任务 running、未扣、ref 存（经 get 验证）；refreshTask running→succeeded → 扣 cost + 状态/结果更新；→failed 不扣；非 running 原样；404。
5. **server.test e2e**：注入 `CompositeProviderAdapter{ video: FakeAsyncProvider(pollsUntilDone:1) }` + 视频模型 → 提交 → `running` → `GET /:id` → `succeeded`；余额 100→97（视频 3）。
6. **桌面**：`apiClient.getGeneration` 单测；App running 任务显示「刷新状态」→ 点击 → 任务更新为已完成（fake getGeneration 返回 succeeded）。
7. 全量：`pnpm test`、`pnpm typecheck`。

## 8. 风险与约束

1. **占位结果变体**：11a 的 succeeded 结果用现有 image data URL 占位（不改合同）；视频专属变体/真实结果留 11b。
2. **默认视频仍 queued**：11a 只建机器，生产视频不变；FakeAsyncProvider 仅注入于测试/演示。
3. **无自动推进**：读时重查 + 桌面手动刷新；后台 worker / 自动轮询后续。
4. **并发扣费非原子**：沿用既有取舍。
5. **providerRef 内部**：不进合同、不外泄。

## 9. 验收清单

- [ ] `ProviderGenerationResult.providerRef?` + `ProviderAdapter.pollGeneration?` + `ProviderPollRequest` + `FakeAsyncProvider` + 单测。
- [ ] `CompositeProviderAdapter` video 槽 + submit/poll 路由 + 单测。
- [ ] `generation_tasks.provider_ref` 列 + 迁移 0003 + 仓库 insert/get/update + 契约测试。
- [ ] `generationService` submit-running（不扣、存 ref）+ `refreshTask`（轮询、succeeded 扣、failed 不扣、非 running/404）+ 单测。
- [ ] `GET /v1/generations/:id`（守卫、owner、404）+ e2e（running→succeeded、扣 3）。
- [ ] 桌面 `getGeneration` + running「刷新状态」按钮 + 状态标签 + 测试。
- [ ] 不改 `packages/shared`；默认生产视频仍 queued。
- [ ] README、`mvp-skeleton.md` 更新。
- [ ] `pnpm test`、`pnpm typecheck` 通过。
