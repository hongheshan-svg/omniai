# GW-LINK OmniAI 真实文本 Provider + 任务状态流转 设计

文档版本：V0.1
文档日期：2026-06-21
文档类型：阶段实现设计
适用阶段：Stage 8 - Real Text Provider（同步，文本先行）

## 1. 背景

Stage 1–7 已打通 持久化 → 鉴权 → 按用户隔离 → 桌面接入 API 的整条链路，但**生成本身仍是假的**：`FakeProviderAdapter.submitGeneration` 不打网络、不读 key，只返回 `{ status: "queued" }`。任务恒为 `queued`、产不出真实内容；`GenerationTask` 合同里也**没有承载生成结果的字段**（只有占位的 `resultPreview { title, description }`）。这也是 Stage 7 推迟「桌面端经 API 创建资产」的根因（API 要求源任务 `succeeded`）。

本阶段让**文本生成变成真实的**：同步调用 openai 兼容的 provider HTTP API，拿到真实文本，任务置 `succeeded` 并携带结果。图片/视频暂仍走假路径（`queued`）。这是产品首次产出真实内容。

provider 边界已就位：模型目录把产品模型映射到 provider 的 `baseUrl`/`apiKeyEnv`/`protocol`/`providerModelId`；适配器只需读 env 中的 key 并调用 `baseUrl`。本阶段在不破坏既有「无 key 即假行为」的前提下，新增真实文本路径。

## 2. 目标

1. 扩展产品合同：`GenerationTask` 增加可选 `result`，可表达文本生成结果；`status` 现可为 `succeeded`。
2. 新增真实文本 provider 适配器：对 text + openai-compatible 且配置了 API key 时，同步调用 provider 并返回真实文本结果（`succeeded`）。
3. 生成服务把适配器返回的 `status`/`result` 落库；provider 真实错误仍抛错、不落任务。
4. 持久化 `generation_tasks.result`（可空 jsonb，迁移）。
5. 配置安全：provider key 仅经 env（`apiKeyEnv`），永不暴露到 `/v1/models` 或返回客户端。
6. 桌面端在任务携带 `result` 时展示生成文本。
7. **向后兼容**：未配置 key 时，文本生成行为与今天一致（`queued`、无 result）；图片/视频不变。

验收标准：配置真实 openai 兼容 key 后，文本生成返回 `succeeded` 且带真实文本（桌面可见）；未配 key 时返回 `queued`（同今天）；图片/视频仍 `queued`；产品合同除新增可选 `result` 外不变；`/v1/models` 不泄露 provider 细节；`pnpm test`、`pnpm typecheck` 全绿。

## 3. 非目标

1. 图片/视频真实生成（仍假）。
2. anthropic-compatible 文本路径（先 openai-compatible；anthropic 留后续）。
3. 异步队列 / worker / 任务状态轮询端点 / 流式输出（本阶段同步）。
4. 失败任务的历史留存（provider 失败时不落任务，返回错误，与现状一致）。
5. 点数扣减 / 配额校验（真实调用会产生 provider 费用，但计费留计费切片）。
6. 桌面端把 `succeeded` 任务存为资产（解锁资产创建留下一切片；本阶段桌面仅展示文本结果）。
7. provider key 的安全存储加固、密钥轮换。
8. 重试 / 超时退避 / 速率限制（仅做一次直连调用 + 基本错误映射）。

## 4. 数据行为

1. 文本生成（text + openai-compatible + 已配 key）：`createTask` 同步调用 provider 的 `chat/completions`，解析首条返回文本 → 任务 `status: "succeeded"`、`result: { kind: "text", text, format: "markdown" }` 落库并返回。
2. 文本生成（未配 key）：适配器回退为假行为 → `status: "queued"`、无 `result`（与今天一致）。
3. 图片/视频：适配器走假路径 → `queued`、无 `result`（不变）。
4. provider 真实错误（缺 baseUrl 不合法 / 非 2xx / 网络异常 / 响应解析失败）：适配器抛 `ProviderAdapterError`，生成服务映射为 `GenerationTaskError`，**不落任务**，按现有状态码返回。
5. 列表/读取：`listTasks` 返回的任务现可能带 `result`；按用户隔离、defensive copy、路由形态均不变（`{ tasks }` / `{ task }`）。
6. key 安全：适配器从注入的 env 读 `provider.apiKeyEnv`；key 不进入任务、不进入 `/v1/models`、不返回客户端、不写日志。

## 5. 数据模型 / 合同

### 5.1 产品合同（`packages/shared`）

新增：

```ts
export type GenerationTaskResult =
  | { kind: "text"; text: string; format: "markdown" | "plain" };
  // image / video 变体留后续切片扩展
```

`GenerationTask` 增加可选字段：

```ts
export interface GenerationTask {
  // ...既有字段不变...
  result?: GenerationTaskResult;
}
```

`status` 取值不变（`queued`/`running`/`succeeded`/`failed`），本阶段实际产生 `queued`（假）与 `succeeded`（真文本）。`GenerationTaskRequest` 不变。新增字段从 `packages/shared/src/index.ts` 导出。

### 5.2 持久化（`generation_tasks`）

新增可空列 `result jsonb`（`$type<GenerationTaskResult>()`）。需要一次增量迁移（drizzle-kit generate）。仓储读写映射该列（null ↔ 省略 `result`）。

## 6. 组件设计

### 6.1 Provider 适配器接口扩展

`ProviderGenerationResult` 扩展以承载真实结果与最终状态：

```ts
export interface ProviderGenerationResult {
  status: GenerationTaskStatus;            // "succeeded"（真文本）或 "queued"（假）
  providerId: string;
  providerProtocol: CatalogProviderReference["protocol"];
  providerModelId: string;
  submittedAt: string;
  result?: GenerationTaskResult;           // 仅 succeeded 文本时存在
}
```

`ProviderAdapter` 接口签名不变（`submitGeneration(req): Promise<ProviderGenerationResult>`）。`FakeProviderAdapter` 升级为返回 `status: "queued"`（不带 result），其余不变——既有依赖它的测试保持绿。

### 6.2 真实文本适配器

新增 `OpenAiCompatibleTextProvider implements ProviderAdapter`（`apps/api/src/services/`，可单独文件）：

```ts
interface OpenAiCompatibleTextProviderOptions {
  fetch?: typeof fetch;                 // 默认全局 fetch；测试注入
  env?: Record<string, string | undefined>; // 默认 process.env；测试注入
  clock?: { now(): Date };
}
```

`submitGeneration(req)`：
1. 若 `req.mode !== "text"` 或 `req.provider.protocol !== "openai-compatible"` → 回退假行为（`queued`，无 result）。
2. 取 `apiKey = env[req.provider.apiKeyEnv]`；若为空 → 回退假行为（`queued`）。
3. 否则 POST `${baseUrl}/chat/completions`，body 为 `{ model: providerModelId, messages: [{ role: "user", content: optimizedPrompt }] }`（**不转发** `preset.parameters`——文本参数如 `outputFormat`/`tone` 并非 provider API 参数）；头含 `Authorization: Bearer <apiKey>`、`content-type: application/json`。
4. 非 2xx → `ProviderAdapterError(message, 502)`（message 取响应体中的错误文案，不含 key）；网络异常 → `ProviderAdapterError("Provider request failed", 502)`。
5. 解析 `choices[0].message.content` 为文本；缺失 → `ProviderAdapterError("Provider returned no content", 502)`。
6. 返回 `{ status: "succeeded", providerId, providerProtocol, providerModelId, submittedAt, result: { kind: "text", text, format: "markdown" } }`。

适配器只构造 provider 请求并解析响应，不读模型目录、不读任务存储。key 仅用于本次请求头，绝不返回。

### 6.3 生成服务

`generationService.createTask` 调整：
1. 仍先做请求校验 + catalog 查询 + maintenance 拦截（不变）。
2. 调 `providerAdapter.submitGeneration(...)` 拿 `ProviderGenerationResult`；真实错误（`ProviderAdapterError`/其他）→ 现有错误映射、不落任务（不变）。
3. 任务的 `status` 取自 `result.status`（之前恒为 `"queued"`），`result` 取自 `result.result`（存在则带上，clone 后落库）。
4. 其余（id/时间/preset/resultPreview clone、insert、返回 clone）不变。`resultPreview` 占位文案保留（作为列表预览标题/描述）。

### 6.4 仓储

`GenerationTask` 现含可选 `result`。内存仓储 `structuredClone` 自动覆盖；Drizzle 仓储 `insert` 写 `result`（存在则 jsonb，否则 null），`list`/map 读 `result`（null → 省略字段）。契约测试加 result 往返用例。

### 6.5 组合与配置

1. `buildServer`/`createServices` 的 provider 适配器默认改为 `OpenAiCompatibleTextProvider`（注入默认 `process.env` + 全局 fetch）。因其在无 key 时回退假行为，既有无 key 测试（含 server e2e、generation 单测注入 FakeProviderAdapter 的除外）保持绿。
2. 生成服务单测继续注入 `FakeProviderAdapter` 或注入带 fake fetch/env 的真实适配器以测两条路径。
3. `.env.example`：补 provider key（如 `OPENAI_API_KEY`）说明——配置后文本走真实，未配则假。
4. 不改 `config/models.json` 的 provider 细节边界；`/v1/models` 仍仅产品字段。

### 6.6 桌面端（最小）

`apps/desktop`：任务中心渲染任务时，若 `task.result?.kind === "text"`，展示 `task.result.text`（受现有 `apiClient` 透传，类型已随合同更新）。无 result 时维持现状。App 集成测增一条「带 result 的任务展示文本」。

## 7. 错误处理

1. provider 缺 key / 非 text / 非 openai → **不是错误**，回退 `queued`（无 result）。
2. provider 非 2xx / 网络 / 解析失败 → `ProviderAdapterError(…, 502)` → `GenerationTaskError` → 不落任务，返回 502，错误体 `{ error }` 不含 key/SQL/内部细节。
3. 既有领域错误与状态码映射不变。
4. key 绝不出现在任何响应、日志、任务、`/v1/models`。

## 8. 测试策略

1. **真实适配器单测**（注入 fake fetch + fake env）：text+openai+key → 正确的 URL/headers(bearer)/body 且解析 `choices[0].message.content` → succeeded+result；非 2xx → ProviderAdapterError(502)；网络 reject → ProviderAdapterError；无 content → 错误；无 key → queued 回退；非 text → queued 回退；非 openai → queued 回退。key 不出现在返回值。
2. **生成服务**：注入「带 key 的真实适配器(fake fetch)」→ text succeeded+result 落库；注入 FakeProviderAdapter → queued 无 result；image/video → queued；provider 真错 → 不落任务、错误透出（既有用例保持）。
3. **仓储契约**（内存 + pglite）：task.result 往返（有/无 result）。
4. **路由/服务 e2e**：`{ task }`/`{ tasks }` 形态不变；带 result 的任务经 GET 列出。
5. **桌面**：apiClient/App 测增「result 文本展示」；既有桌面测保持绿。
6. **既有 API/桌面测保持绿**：默认适配器换成真实适配器后，无 key 环境回退假行为，既有断言（status queued）成立。
7. 全量：`pnpm test`、`pnpm typecheck`。

## 9. 文档更新

1. `.env.example`：provider key（`OPENAI_API_KEY` 等）说明：配置后文本真实生成，未配回退假占位。
2. README：新增「真实文本生成」小节——配 key 的方法、同步行为、图片/视频仍假、未配 key 的回退。
3. `CLAUDE.md`：在 provider 边界小节注明真实文本适配器（openai 兼容、env 取 key、无 key 回退假、key 不外泄）与 `GenerationTask.result` 合同扩展。
4. `docs/architecture/mvp-skeleton.md`：新增「Real Text Provider Slice」小节。

## 10. 风险与约束

1. **真实费用**：配 key 后每次文本生成产生 provider 费用；无配额/计费保护（计费切片再加）。文档提示。
2. **同步延迟**：文本调用阻塞请求；文本通常数秒可接受。慢/超时无退避（YAGNI），失败即 502。
3. **合同扩展**：首次改 `packages/shared`；`result` 为**可选新增**，向后兼容，不破坏既有消费方。
4. **默认适配器切换**：把默认 provider 从假改为真实（带无 key 回退）需确保所有无 key 测试仍绿；以「无 key→queued」回退保证，并保留 `FakeProviderAdapter` 供需要确定性的测试注入。
5. **迁移**：`generation_tasks` 加 `result` 列为增量迁移；pglite 测试经迁移初始化自动覆盖。
6. **provider 响应形态差异**：仅适配 openai 兼容 `choices[0].message.content`；不同实现的差异留扩展，本阶段错误即 502。

## 11. 验收清单

- [ ] `packages/shared`：`GenerationTaskResult` + `GenerationTask.result?` 新增并导出；`GenerationTaskRequest` 不变。
- [ ] `OpenAiCompatibleTextProvider`：注入 fetch+env；text+openai+key→真实调用+succeeded+result；无 key/非 text/非 openai→queued 回退；非 2xx/网络/无 content→ProviderAdapterError；key 不外泄。
- [ ] `FakeProviderAdapter` 返回 queued（不带 result），既有依赖保持绿。
- [ ] 生成服务用 adapter 的 status/result 落库；provider 真错不落任务。
- [ ] `generation_tasks.result` 列 + 迁移 + 内存/Drizzle 仓储映射 + 契约往返。
- [ ] 默认适配器改为真实适配器（无 key 回退）；既有 API/桌面测全绿。
- [ ] 桌面任务中心展示 `task.result.text`。
- [ ] `/v1/models` 与任何响应不泄露 provider key/baseUrl/apiKeyEnv。
- [ ] `.env.example`、README、`CLAUDE.md`、`mvp-skeleton.md` 更新。
- [ ] `pnpm test` 通过。
- [ ] `pnpm typecheck` 通过。
