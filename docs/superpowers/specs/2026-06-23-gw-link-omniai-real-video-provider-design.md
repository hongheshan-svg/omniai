# GW-LINK OmniAI 真实视频 provider 设计

文档版本：V0.1
文档日期：2026-06-23
文档类型：阶段实现设计
适用阶段：Stage 15 - Real Video Provider（11b：把真实异步视频 provider 接到 11a 机器）

## 1. 背景

Slice 11a 建好了异步生成生命周期（submit→`running`+providerRef、`pollGeneration`、`refreshTask`、`GET /v1/generations/:id`、桌面刷新），用 `FakeAsyncProvider` 端到端证明，生产视频仍 `queued`。本阶段（11b）把真实异步视频 provider 接上：让视频真正生成。

没有统一的视频 API 标准、各服务异步作业形状不同、此处无具体凭证——故对准一个**通用异步视频作业 API 形状**（与文本/图片 provider 对准 OpenAI 文档化端点同理），注入式 fetch+env、mock 测；生产由运营方把视频模型 provider 指向真实服务并配置 key。

`GenerationTaskResult` 目前仅 text/image，需加 video 变体（与 `CreationAssetContent` 的 video 变体一致）——**packages/shared 增量改动**。

## 2. 目标

1. 合同 `GenerationTaskResult` 增 video 变体 `{ kind:"video"; url; durationSeconds; posterUrl }`。
2. `AsyncVideoProvider`：视频 + 有 key → submit 调通用视频作业 API（→running+ref）、poll 查状态（completed→succeeded+video result / failed / running）；无 key → queued。
3. composite 默认 video 槽换成 `AsyncVideoProvider`（替换 11a 的 queued 占位）。
4. 桌面渲染 `<video>` 并可保存视频为资产。
5. 不改生成服务/持久化/refreshTask（11a 通用处理）；URL 透传不过对象存储。

验收标准：注入了 fetch 的 AsyncVideoProvider 提交视频生成 → `running`；`GET /v1/generations/:id` 反复调用直到 `succeeded` + `result.kind==="video"`（带 url）、余额扣 3；桌面对 succeeded 视频任务渲染 `<video>` 并可保存；无 key 时视频仍 `queued`；`pnpm test`、`pnpm typecheck` 全绿。

## 3. 非目标

1. 对接某个具体真实视频服务（本片对准通用形状，mock 测；生产配置留运营）。
2. 视频字节进对象存储（透传服务托管 URL；大文件转存后续）。
3. 视频缩略图生成（用 API 的 poster_url，缺则空串）。
4. 后台 worker / 自动轮询（沿用 11a 的读时重查 + 桌面手动刷新）。
5. config/models.json 改动（默认视频仍占位；未配置真实视频服务 key 时 queued）。

## 4. 数据行为

1. **submit**（`AsyncVideoProvider.submitGeneration`）：`mode==="video"` + `env[provider.apiKeyEnv]` → POST `${baseUrl}/videos/generations`，header `Authorization: Bearer <key>` + `content-type: application/json`，body `{ model: providerModelId, prompt: optimizedPrompt }` → 解析 `{ id }`（非空字符串）→ `status:"running"`, `providerRef: id`。无 key/非 video/无 id → 见错误处理 / `queued`。
2. **poll**（`pollGeneration`）：GET `${baseUrl}/videos/generations/${providerRef}`，Bearer → 解析 `{ status, url?, poster_url?, duration_seconds? }`：
   - `status === "completed"`（或 `"succeeded"`）→ `succeeded` + `result = { kind:"video", url, durationSeconds: duration_seconds ?? 0, posterUrl: poster_url ?? "" }`（url 必须非空，否则 502）。
   - `status === "failed"` → `failed`（无 result）。
   - 其余（`in_progress`/`queued`/`processing`/…）→ `running`。
3. **回退**：无 key / 非 video → `queued`（不发请求、无 ref）。
4. **扣费**：视频 `creditUnitCost = 3`；11a 的 `refreshTask` 在 running→succeeded 扣一次（本片不改）。
5. **结果 URL**：直接用视频服务返回的 `url`/`poster_url`（托管 URL），不经对象存储。

## 5. 组件设计

### 5.1 合同（packages/shared）

`packages/shared/src/models.ts` `GenerationTaskResult` 增成员：
```ts
| { kind: "video"; url: string; durationSeconds: number; posterUrl: string }
```
与 `CreationAssetContent` 的 video 变体结构一致。

### 5.2 AsyncVideoProvider

`apps/api/src/services/asyncVideoProvider.ts`：`AsyncVideoProvider implements ProviderAdapter`，选项 `{ fetch?, env?, clock? }`（镜像 `OpenAiCompatibleImageProvider`）。`submitGeneration`/`pollGeneration` 见 §4。`base`（providerId/providerProtocol/providerModelId/submittedAt）同其他 provider。失败/非 2xx/无效响应 → `ProviderAdapterError(502)`，复用从 `openAiTextProvider` 导出的 `readProviderError`。API key 仅入 Authorization 头，绝不写入 result/错误/日志/`/v1/models`。

### 5.3 composite 默认 video 槽

`server.ts` 与 `appServices.ts`（createDbServices + createServices 内存分支）把默认 composite 的 `video` 从文本 provider 占位换成 `new AsyncVideoProvider()`。注入了 `providerAdapter` 的测试不受影响。

### 5.4 生成服务 / 持久化 / refreshTask

**不改**：11a 已通用处理 `running` 落库 + `refreshTask` 轮询/落库/扣费；video 结果经 jsonb `result` 原样存取、`cloneGenerationTaskResult` 浅拷贝可用。

### 5.5 桌面

`App.tsx`：任务中心 `result.kind==="video"` → `<video controls src={result.url} poster={result.posterUrl} />`；资产库卡片 `content.kind==="video"` → 同样 `<video controls>`。`assetModel.ts` `buildAssetRequestFromTask` 增 video 分支：`content = { kind:"video", url, durationSeconds, posterUrl }`。保存按钮已 gated `succeeded && result`，无需改门控。

### 5.6 配置 / 文档

`config/models.json` 不动。`.env.example`/README 注明：生产启用视频需把视频模型的 provider 指向真实异步视频服务（`baseUrl` + `apiKeyEnv`）并配置其 key；默认占位不可直接调用，未配置 key 时视频 `queued`。

## 6. 错误处理

1. provider 请求失败/非 2xx/无效响应/completed 无 url → `ProviderAdapterError(502)`；11a `refreshTask` 把 502 透传（任务保持 running，可重试）；submit 出错则 createTask 不落任务。
2. 无 key → `queued`（不报错）。
3. 扣费仅 running→succeeded 一次（11a）。
4. 不泄露 provider 内部 / key。

## 7. 测试策略

1. **AsyncVideoProvider 单测**（注入 fake fetch + env）：
   - 有 key + video → submit POST `${baseUrl}/videos/generations`、Bearer 头、body `{model,prompt}`、`running`+`providerRef`。
   - poll completed → `succeeded` + `result{kind:"video",url,durationSeconds,posterUrl}`；poster/duration 缺省 → `""`/`0`。
   - poll failed → `failed`；in_progress → `running`。
   - 无 key → `queued`、未请求；非 video → `queued`。
   - 非 2xx → 502；completed 无 url → 502。
   - key 不出现在 result/错误。
2. **composite 默认接线**：默认 composite 的 video 槽为 AsyncVideoProvider（经一个注入 fetch 的 e2e 验证）。
3. **server.test e2e**：注入 `CompositeProviderAdapter{ video: AsyncVideoProvider(fetch mock) }` + 视频模型 → 提交 → `running` → `GET /:id`（poll completed）→ `succeeded` + `result.kind==="video"`；余额 100→97。
4. **桌面**：`buildAssetRequestFromTask` video 单测（content=video、title=视频资产、source succeeded、深拷贝 preset）；App：succeeded 视频任务渲染 `<video>`（按 testid/role 断言）、保存视频任务 → 资产库出现视频资产。
5. **既有测试保持绿**（fake createGeneration 等不受影响）。
6. 全量：`pnpm test`、`pnpm typecheck`。

## 8. 风险与约束

1. **通用形状假设**：对准假定的通用异步视频 API；生产对接具体服务可能需微调字段映射（集中在 AsyncVideoProvider）。
2. **URL 透传**：视频/海报为服务托管 URL，未纳入本系统对象存储（大文件转存留后续）。
3. **默认占位**：未配置真实视频服务 key → 视频 queued；配置错误的 provider + key → 502（运营配置问题，文档说明）。
4. **`<video>` 测试**：jsdom 下 `<video>` 不播放，仅断言元素与 src/poster 属性。

## 9. 验收清单

- [ ] `GenerationTaskResult` 增 video 变体（packages/shared，增量）。
- [ ] `AsyncVideoProvider`（submit/poll 通用形状、completed/failed/running 映射、queued 回退、502、key 安全）+ 单测。
- [ ] composite 默认 video 槽换成 AsyncVideoProvider（buildServer/appServices）。
- [ ] server.test e2e 视频 running→succeeded（video result）+ 扣 3。
- [ ] 桌面渲染 `<video>` + `buildAssetRequestFromTask` video + 资产库 `<video>` + 测试。
- [ ] 不改生成服务/持久化/refreshTask；URL 透传不过对象存储；config/models.json 不动。
- [ ] README、`mvp-skeleton.md`、`.env.example` 更新。
- [ ] `pnpm test`、`pnpm typecheck` 通过。
