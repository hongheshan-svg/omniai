# GW-LINK OmniAI 真实图片 provider 设计

文档版本：V0.1
文档日期：2026-06-22
文档类型：阶段实现设计
适用阶段：Stage 12 - Real Image Provider（图片端到端真实生成；对象存储留后续）

## 1. 背景

文本生成已真实（Stage 8）、计费地基与桌面余额已就绪（Stage 10/11）。图片仍恒为 `queued`、无结果。本阶段让**图片真实生成并端到端显示/保存**。

「真实图片 provider + 对象存储」跨两个子系统，已决定**拆分**：本片只做真实图片生成，结果以**内联 base64 data URL** 承载（无新基础设施）；对象存储（把图片字节落到存储、result 改携真实 URL）留作后续聚焦片。

关键契合点：图片生成 API（gpt-image-1，openai-compatible）返回 base64 图片字节；`CreationAssetContent` 已有 image 变体 `{ kind:"image"; url; alt }`，与本片要新增的 `GenerationTaskResult` image 变体结构一致 → 保存图片任务为资产复用文本套路。

## 2. 目标

1. 合同扩展 `GenerationTaskResult` 增 image 变体 `{ kind:"image"; url; alt }`（增量并集成员）。
2. `OpenAiCompatibleImageProvider`：图片 + openai-compatible + 有 key → 调 `/images/generations` 同步返回 `succeeded` + image 结果（b64 → data URL）；否则 `queued` 回退。
3. `CompositeProviderAdapter` 按 mode 路由（image→图片 provider，其余→文本 provider），作默认适配器。
4. 桌面端任务中心渲染生成的图片；扩展保存使 succeeded 图片任务可保存为资产；资产库渲染图片资产。
5. 不引入对象存储。

验收标准：配置图片模型 provider key 后，提交图片生成返回 `succeeded` 且 `result={kind:"image",url:"data:image/...",alt}`、扣 2 点；无 key 时图片仍 `queued`；桌面任务中心显示图片、可保存为资产并在资产库显示；`pnpm test`、`pnpm typecheck` 全绿。

## 3. 非目标

1. 对象存储 / 文件服务 / 签名 URL（后续片；本片内联 data URL）。
2. 视频真实生成（仍 `queued`、无结果）。
3. 异步队列/worker（图片同步生成，与文本一致）。
4. 图片参数透传（尺寸/质量/张数等高级参数）——本片只传 prompt；参数透传留后续。
5. admin/mobile 图片展示。

## 4. 数据行为

1. **图片生成**：`mode==="image"` + provider `openai-compatible` + `env[apiKeyEnv]` 存在 → POST `${baseUrl}/images/generations`，body `{ model: providerModelId, prompt: optimizedPrompt }`。
2. **结果解析**：响应 `{ data: [{ b64_json?, url? }] }`：
   - 有 `b64_json`（非空字符串）→ `url = "data:image/png;base64," + b64_json`；
   - 否则有 `url`（非空字符串）→ 直接用该 `url`（provider 返回 URL 的情形）；
   - 都无 → `ProviderAdapterError(502)`。
   → `result = { kind:"image", url, alt: optimizedPrompt }`，`status: "succeeded"`。
3. **回退**：无 key / 非图片 / 非 openai-compatible → `status: "queued"`，不发请求、无 result（与文本一致）。
4. **扣费**：图片 `creditUnitCost = 2`；预检余额 ≥ 2，succeeded 后扣 2（既有生成服务逻辑，无需改）。
5. **持久化**：`GenerationTask.result` 的 image 变体经现有 jsonb `result` 列与 `cloneGenerationTaskResult`（浅拷贝）原样存取，无需改。
6. **保存为资产**：桌面对 succeeded 图片任务构造 `CreationAssetRequest`，`content = { kind:"image", url, alt }`（取自 `task.result`），`title = getAssetModeLabel("image")` =「图片资产」，`source.taskStatus = "succeeded"`，经现有 `/v1/assets` 创建。

## 5. 组件设计

### 5.1 合同（packages/shared）

`packages/shared/src/models.ts`：
```ts
export type GenerationTaskResult =
  | { kind: "text"; text: string; format: "markdown" | "plain" }
  | { kind: "image"; url: string; alt: string };
```
增量改动；image 变体与 `CreationAssetContent` 的 image 变体一致。`src/index.ts` 已再导出 `GenerationTaskResult`，无需新增导出。

### 5.2 图片 provider

`apps/api/src/services/openAiImageProvider.ts`：`OpenAiCompatibleImageProvider implements ProviderAdapter`，构造选项 `{ fetch?, env?, clock? }`（镜像 `OpenAiCompatibleTextProvider`）。`submitGeneration` 见 §4.1–4.3。失败/无效响应 → `ProviderAdapterError(502)`，复用 `readProviderError`（从 `openAiTextProvider.ts` 导出）。API key 仅入 `Authorization: Bearer` 头，绝不写入 result/错误/日志/`/v1/models`。

### 5.3 Composite 适配器

`apps/api/src/services/compositeProviderAdapter.ts`：
```ts
export class CompositeProviderAdapter implements ProviderAdapter {
  constructor(private readonly providers: { text: ProviderAdapter; image: ProviderAdapter }) {}
  submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    return (request.mode === "image" ? this.providers.image : this.providers.text).submitGeneration(request);
  }
}
```
默认适配器（`buildServer` 与 `appServices` 的 `createDbServices`/`createServices`）从 `new OpenAiCompatibleTextProvider()` 改为 `new CompositeProviderAdapter({ text: new OpenAiCompatibleTextProvider(), image: new OpenAiCompatibleImageProvider() })`。注入了 `providerAdapter` 的测试不受影响。

### 5.4 生成服务 / 持久化

**不改**。`createTask` 已通用透传 `providerResult.status`/`result`；积分预检/扣减用 `creditUnitCost`。视频经 composite→文本 provider→`queued`（不变）。

### 5.5 桌面端

`apps/desktop/src/App.tsx`：
1. 任务中心 `<article>` 增图片分支（在文本分支旁）：`{task.result?.kind === "image" ? <img src={task.result.url} alt={task.result.alt} /> : null}`。
2. 保存按钮门控：`task.status === "succeeded" && task.result != null`（文本或图片均可保存）。
3. 资产库卡片：`{asset.content.kind === "image" ? <img src={asset.content.url} alt={asset.content.alt} /> : null}`。

`apps/desktop/src/assetModel.ts` `buildAssetRequestFromTask`：扩展为按 `task.result.kind` 构造 content：
- `text` → `{ kind:"text", text, format }`（不变）；
- `image` → `{ kind:"image", url, alt }`；
- 其它 → 抛错（保持「仅 succeeded 且有 result」前置）。

### 5.6 文档

README 增「Real Image Generation」小节；`docs/architecture/mvp-skeleton.md` 同步（图片内联 data URL、对象存储后续）。

## 6. 错误处理

1. 图片 provider 请求失败 / 非 2xx / 无效响应 / 无图片数据 → `ProviderAdapterError(502)`，不落任务（既有生成服务在 provider 抛错时不持久化）。
2. 无 key → `queued` 回退（不报错）。
3. 余额不足（图片 2 点）→ 402（既有预检）。
4. 不泄露 provider 内部 / key。

## 7. 测试策略

1. **OpenAiCompatibleImageProvider 单测**（注入 fake fetch + env）：
   - 有 key + image → POST `/images/generations`、succeeded、`result.url` 为 `data:image/png;base64,<b64>`、`alt` 为 optimizedPrompt；请求头含 `Authorization: Bearer`。
   - 响应仅含 `url` → 透传该 url。
   - 无 key → queued、未发请求。
   - 非 image（text）→ queued。
   - 非 2xx / 无 data → 502。
   - key 不出现在 result/错误。
2. **CompositeProviderAdapter 单测**：image → 调 image provider；text/video → 调 text provider（用 spy 双桩验证路由）。
3. **server.test e2e**：注入 `CompositeProviderAdapter`（image provider mock fetch 返回 b64）+ 图片模型目录 → 登录（赠 100）→ 提交图片生成 → `succeeded` + `result.kind==="image"` + 余额 98（扣 2）。
4. **仓库契约**：image result round-trip（memory + pglite）一例。
5. **桌面**：`buildAssetRequestFromTask` image 单测（content=image、title=图片资产、source succeeded、深拷贝 preset）；App 测试：图片任务渲染 `<img>`、保存图片任务 → 资产库出现图片资产（`createFakeClient` 的 `createGeneration` 支持 image 模式返回 image result）。
6. 全量：`pnpm test`、`pnpm typecheck`。

## 8. 风险与约束

1. **内联 data URL 体积**：base64 图片较大，进 DB jsonb 与 API 响应较重；对象存储片替换为真实 URL。
2. **gpt-image-1 返回 b64_json**；若配置的 provider 返回 `url` 则透传——两种都支持。
3. **同步生成**：图片同步调用，响应时间取决于 provider；异步队列留后续。
4. **合同增量**：image 变体为新并集成员；既有只读 `result.kind==="text"` 的代码用类型收窄，需覆盖 image 分支（桌面已在本片处理）。

## 9. 验收清单

- [ ] `GenerationTaskResult` 增 image 变体（packages/shared，增量）。
- [ ] `OpenAiCompatibleImageProvider`（images/generations、b64→data URL、url 透传、queued 回退、502、key 安全）+ 单测。
- [ ] `CompositeProviderAdapter`（按 mode 路由）+ 单测 + 默认适配器接线（buildServer/appServices）。
- [ ] server.test e2e 图片 succeeded + 扣 2；仓库契约 image round-trip。
- [ ] 桌面任务中心渲染图片；保存门控含图片；`buildAssetRequestFromTask` 处理 image；资产库渲染图片 + 单测/集成测。
- [ ] 不引入对象存储；视频仍 queued。
- [ ] README、`mvp-skeleton.md` 更新。
- [ ] `pnpm test`、`pnpm typecheck` 通过。
