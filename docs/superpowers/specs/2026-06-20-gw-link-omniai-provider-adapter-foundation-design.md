# GW-LINK OmniAI Provider Adapter Foundation 设计

文档版本：V0.1
文档日期：2026-06-20
文档类型：阶段实现设计
适用阶段：Stage 4 - Product-First Provider Adapter Foundation

## 1. 背景

Stage 1 已完成 Studio Shell + Prompt Optimizer，Stage 2 已完成统一生成任务，Stage 3 已完成本地资产库。当前产品层已经稳定使用 `CreationMode`、`GenerationTaskRequest`、`GenerationTask` 和 `CreationAsset` 表达文字、图片、视频生产流程。

Stage 4 的目标不是把产品改造成模型中转站，也不是直接接真实供应商网络请求，而是在现有产品任务合同后面建立 provider adapter foundation：配置驱动模型目录、内部 provider reference、OpenAI-compatible 与 Anthropic-compatible 协议分派，以及可测试的 fake adapter dry-run。

旧的 `text-model-gateway` 设计只作为素材参考。它的“配置驱动模型目录、产品模型 ID 与 provider model ID 分离、fake protocol dispatch”等思想可复用；但它的 text-only、gateway-first、`{ modelId, capability, prompt }` 请求合同不适合当前主线，不能直接执行。

## 2. 目标

本阶段交付一个产品优先的 provider adapter 底座：

1. 通过 `config/models.json` 配置 text/image/video 产品模型。
2. 支持任意 OpenAI-compatible 与 Anthropic-compatible provider model ID 接入，不在代码里硬编码供应商模型列表。
3. `GET /v1/models` 返回产品侧可见模型，不暴露 provider 内部字段。
4. `POST /v1/generations` 继续使用现有产品合同，不退回 gateway 风格 API。
5. `GenerationService` 在创建任务前校验模型存在、mode 匹配、可见性和维护状态。
6. provider adapter 使用 fake dry-run，不读取真实 API key，不发网络请求。
7. fake adapter 能证明 openai-compatible 与 anthropic-compatible 分派可测试。
8. 文档明确本阶段是文字、图片、视频生产工具的模型接入底座，不是独立中转站产品。

验收标准：默认配置中 text/image/video 模型都能通过 `/v1/models` 以产品字段列出；`POST /v1/generations` 使用当前 `{ mode, prompt, optimizedPrompt, preset }` 请求体创建 queued task；请求中的 `preset.modelId` 会被内部 catalog 校验并通过 fake provider adapter dry-run；全流程不调用真实 OpenAI、Anthropic、GW-LINK 线上网关或外部网络。

## 3. 非目标

本阶段不做：

1. 真实 OpenAI、Anthropic 或其他 provider HTTP 请求。
2. 真实图片、视频生成结果。
3. 流式文本输出。
4. provider API key 读取或密钥校验。
5. 任务持久化、后台 worker、任务状态轮询。
6. 生成成功后自动写入资产库。
7. 点数扣减、退款、订单或套餐权限强校验。
8. 后台动态配置模型。
9. 自动发现 provider 支持的所有模型。
10. 更改桌面端为 HTTP client。

“支持 OpenAI-compatible 和 Anthropic-compatible 的所有模型接入”在本阶段定义为：任意兼容协议的 provider model ID 都可以通过配置声明为产品模型，并走统一 catalog 与 adapter 边界；不是自动爬取供应商模型列表，也不是直接暴露 provider 原始模型给用户。

## 4. 产品行为

产品行为保持 Stage 1-3 的主线：

1. 用户在桌面端选择文本、图片或视频创作模式。
2. Prompt Optimizer 返回产品推荐参数 `preset`，其中包含产品模型 ID。
3. 用户提交生成任务。
4. API 创建 queued `GenerationTask`。
5. 任务仍展示产品 mode、prompt、optimizedPrompt、preset 和 resultPreview。
6. provider 相关字段仅在 API 内部用于 catalog lookup 和 fake adapter dry-run。

本阶段桌面端仍不调用 API。桌面端 fixture 的模型 ID 必须与默认 `config/models.json` 保持一致，以便后续 HTTP client 阶段可以直接接上真实 API。

## 5. API 合同

### 5.1 保持不变的生成任务请求

`POST /v1/generations` 继续接收现有产品请求：

```json
{
  "mode": "image",
  "prompt": "做一张咖啡店新品海报",
  "optimizedPrompt": "制作一张咖啡店新品商业海报。",
  "preset": {
    "modelId": "gw-image-creative",
    "parameters": {
      "aspectRatio": "4:3",
      "quality": "high",
      "count": 1
    },
    "creditEstimate": { "credits": 2, "unit": "credit" }
  }
}
```

成功响应继续返回：

```json
{
  "task": {
    "id": "generation_task_000001",
    "mode": "image",
    "status": "queued",
    "prompt": "做一张咖啡店新品海报",
    "optimizedPrompt": "制作一张咖啡店新品商业海报。",
    "preset": {
      "modelId": "gw-image-creative",
      "parameters": {
        "aspectRatio": "4:3",
        "quality": "high",
        "count": 1
      },
      "creditEstimate": { "credits": 2, "unit": "credit" }
    },
    "resultPreview": {
      "title": "图片生成任务",
      "description": "任务已排队，后续阶段将接入真实图片生成结果。"
    },
    "createdAt": "2026-06-20T00:00:00.000Z",
    "updatedAt": "2026-06-20T00:00:00.000Z"
  }
}
```

不得新增或要求客户端传入 `providerModelId`、`providerId`、`protocol`、`baseUrl`、`apiKeyEnv` 等字段。

### 5.2 模型目录响应

`GET /v1/models` 返回 visible 产品模型：

```json
{
  "models": [
    {
      "id": "gw-image-creative",
      "displayName": "OmniAI Image Creative",
      "capability": "image",
      "tags": ["creative", "high-quality"],
      "visibility": "visible",
      "minimumPlan": "pro",
      "creditUnitCost": 2
    }
  ]
}
```

响应不得包含 provider 内部字段。

## 6. 模型配置

默认配置文件为 `config/models.json`。部署或测试可用 `GW_LINK_MODEL_CONFIG_PATH` 指定绝对路径或相对路径。

配置结构：

```json
{
  "providers": [
    {
      "id": "openai-main",
      "displayName": "OpenAI Main",
      "protocol": "openai-compatible",
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyEnv": "OPENAI_API_KEY",
      "models": [
        {
          "id": "gw-text-balanced",
          "providerModelId": "gpt-4.1-mini",
          "displayName": "OmniAI Text Balanced",
          "capability": "text",
          "tags": ["recommended", "balanced", "openai"],
          "visibility": "visible",
          "minimumPlan": "free",
          "creditUnitCost": 1
        },
        {
          "id": "gw-image-creative",
          "providerModelId": "gpt-image-1",
          "displayName": "OmniAI Image Creative",
          "capability": "image",
          "tags": ["creative", "high-quality", "openai"],
          "visibility": "visible",
          "minimumPlan": "pro",
          "creditUnitCost": 2
        }
      ]
    },
    {
      "id": "anthropic-main",
      "displayName": "Anthropic Main",
      "protocol": "anthropic-compatible",
      "baseUrl": "https://api.anthropic.com",
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "models": [
        {
          "id": "gw-video-motion",
          "providerModelId": "claude-compatible-video-motion",
          "displayName": "OmniAI Video Motion",
          "capability": "video",
          "tags": ["motion", "async-task", "anthropic-compatible"],
          "visibility": "visible",
          "minimumPlan": "studio",
          "creditUnitCost": 3
        }
      ]
    }
  ]
}
```

字段规则：

1. `providers` 必须是非空数组。
2. `provider.id`、`displayName`、`baseUrl`、`apiKeyEnv` 必须是非空字符串。
3. `provider.protocol` 只能是 `openai-compatible` 或 `anthropic-compatible`。
4. `provider.models` 必须是数组。
5. `model.id` 是产品模型 ID，在所有 provider 内必须唯一。
6. `model.providerModelId` 是 provider 协议内部使用的模型 ID，可以是任意兼容模型名。
7. `model.capability` 必须是 `text`、`image` 或 `video`。
8. `model.visibility` 必须是 `visible`、`hidden` 或 `maintenance`。
9. `model.minimumPlan` 必须是 `free`、`pro` 或 `studio`。
10. `model.creditUnitCost` 必须是大于 0 的有限数字。
11. `model.tags` 必须是字符串数组。

## 7. 组件设计

### 7.1 modelConfig

新增 API 内部模块 `apps/api/src/services/modelConfig.ts`。

职责：

1. 读取默认配置路径 `config/models.json`。
2. 支持 `GW_LINK_MODEL_CONFIG_PATH` 覆盖。
3. 从 JSON 文件加载配置。
4. 做 runtime schema 校验。
5. 返回 API 内部类型化配置。

provider config 类型保持在 API 内部，不从 `packages/shared` 导出，避免 provider concern 成为客户端公共合同。

### 7.2 ModelCatalog

升级 `apps/api/src/services/modelCatalog.ts`。

职责：

1. 持有已校验的 provider/model config。
2. `listVisibleModels()` 返回 `ProductModel[]`。
3. `getModelReference(modelId, mode)` 返回内部 `CatalogModelReference`。
4. 隐藏模型按 not found 处理。
5. 维护中模型可返回 reference，但由生成服务映射为维护错误。
6. mode 不匹配返回 mode mismatch 错误。

内部 reference 形态：

```ts
interface CatalogModelReference {
  product: ProductModel;
  provider: {
    id: string;
    displayName: string;
    protocol: "openai-compatible" | "anthropic-compatible";
    baseUrl: string;
    apiKeyEnv: string;
  };
  providerModelId: string;
}
```

该类型只在 API 内部使用。

### 7.3 ProviderAdapter

重塑 `apps/api/src/services/gatewayClient.ts` 为 provider adapter boundary。文件名可暂时保留，避免一次性改动过大；命名在代码中应偏向 `ProviderAdapter`、`ProviderGenerationRequest` 和 `ProviderGenerationResult`。

接口：

```ts
interface ProviderAdapter {
  submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult>;
}
```

输入包含：

1. 产品 mode。
2. 产品模型 ID。
3. provider ID。
4. provider protocol。
5. provider base URL。
6. provider API key env 名称。
7. provider model ID。
8. optimizedPrompt。
9. preset parameters。
10. userId。

fake adapter 行为：

1. 不读取 `process.env[apiKeyEnv]`。
2. 不发网络请求。
3. 根据 protocol 走 openai-compatible 或 anthropic-compatible 分支。
4. 返回 queued dry-run 结果。
5. 返回结果仅供 `GenerationService` 组装产品 `GenerationTask`，不得直接替代产品任务合同。

### 7.4 GenerationService

升级 `apps/api/src/services/generationService.ts`，保留 `GenerationService` 接口的产品语义：

```ts
interface GenerationService {
  createTask(request: GenerationTaskRequest): Promise<GenerationTask> | GenerationTask;
  listTasks(): GenerationTask[];
}
```

职责：

1. 校验 mode、prompt、optimizedPrompt 和 preset。
2. 使用 `preset.modelId` 查询 `ModelCatalog`。
3. 拒绝不存在或 hidden 模型。
4. 拒绝 maintenance 模型。
5. 拒绝模型 capability 与 request.mode 不匹配。
6. 调用 fake provider adapter dry-run。
7. 继续返回 queued `GenerationTask`，并保持 defensive copies。

本阶段 `listTasks()` 仍是 in-memory。

### 7.5 Routes 与 Server

`apps/api/src/routes/models.ts` 改为注入 catalog：

```ts
registerModelRoutes(server, modelCatalog)
```

`apps/api/src/routes/generations.ts` 保持 HTTP 请求体 shape 不变，但应 `await generationService.createTask(...)`，确保未来 async provider adapter error 被路由映射。

`apps/api/src/server.ts` 创建默认组件：

```text
loadConfig()
  -> loadModelCatalogConfig(config.modelConfigPath)
  -> ConfigModelCatalog
  -> FakeProviderAdapter
  -> InMemoryGenerationService(modelCatalog, providerAdapter)
```

注入规则必须保留：

1. 测试可注入 `authService`、`promptOptimizer`、`generationService`、`assetService`。
2. 注入 `generationService` 时不应强制加载 model config。
3. 注入 `modelCatalog` 或 `providerAdapter` 可用于细粒度测试。

## 8. 错误处理

继续使用稳定 JSON error shape：

| 场景 | HTTP | 响应 |
| --- | --- | --- |
| 请求体缺字段或字段类型错误 | 400 | `{ "error": "Invalid generation task request" }` |
| mode 不是 text/image/video | 400 | `{ "error": "Unsupported creation mode" }` |
| prompt 为空字符串 | 400 | `{ "error": "Prompt is required" }` |
| optimizedPrompt 为空字符串 | 400 | `{ "error": "Optimized prompt is required" }` |
| preset 缺字段或字段类型错误 | 400 | `{ "error": "Invalid preset suggestion" }` |
| 模型不存在或 hidden | 404 | `{ "error": "Model was not found" }` |
| 模型 capability 与请求 mode 不匹配 | 400 | `{ "error": "Model does not support this creation mode" }` |
| 模型 maintenance | 409 | `{ "error": "Model is temporarily unavailable" }` |
| provider protocol 不支持 | 502 | `{ "error": "Provider protocol is not supported" }` |
| fake adapter 未知失败 | 502 | `{ "error": "Provider adapter failed" }` |
| service 未知错误 | 500 | `{ "error": "Unexpected generation task error" }` |

## 9. 测试策略

新增或更新测试：

1. `modelConfig.test.ts`
   - 加载默认/临时 JSON 配置。
   - 校验 provider protocol。
   - 校验 model ID 唯一性。
   - 拒绝空 providers、无效 capability、无效 creditUnitCost。
2. `modelCatalog.test.ts`
   - `listVisibleModels()` 只返回 visible 产品字段。
   - 不泄露 provider 字段。
   - `getModelReference()` 返回内部 provider reference。
   - hidden 按 not found。
   - maintenance 可被 service 映射。
   - mode mismatch 可识别。
3. `providerAdapter.test.ts`
   - openai-compatible dry-run。
   - anthropic-compatible dry-run。
   - 不读取 API key env。
   - 不发网络请求。
   - unsupported protocol 映射错误。
4. `generationService.test.ts`
   - text/image/video 均可创建 queued task。
   - 通过 catalog 校验 model。
   - mode mismatch、missing、hidden、maintenance、adapter failure 稳定错误。
   - defensive copies 保持。
5. `routes/models.test.ts` 与 `server.test.ts`
   - `/v1/models` 使用配置 catalog。
   - 响应只含产品字段。
6. `routes/generations.test.ts`
   - 请求合同不变。
   - route await async service。
   - 新领域错误映射正确。
7. 全量：
   - `pnpm test`
   - `pnpm typecheck`

## 10. 文档更新

README 需要新增 Stage 4 说明：

1. 模型目录由 `config/models.json` 驱动。
2. `GW_LINK_MODEL_CONFIG_PATH` 可覆盖路径。
3. OpenAI-compatible 与 Anthropic-compatible provider 目前走 fake dry-run。
4. API key env 名称保存在配置中，但本阶段不读取真实 key。
5. `/v1/generations` 仍是产品任务 API，不是 provider passthrough API。

架构文档需要新增 Provider Adapter Foundation Slice：

1. provider adapter 是产品生成流程后面的内部边界。
2. 产品 API 不泄漏 provider details。
3. Stage 4 为后续真实 HTTP adapter、持久化、计费和资产自动保存做准备。

## 11. 风险与约束

1. 最大风险是 provider concern 泄漏到产品 API。规避方式：`GenerationTaskRequest` 不变，provider 字段只存在于 API 内部。
2. “支持所有模型”容易被误解为自动发现模型。规避方式：明确为任意兼容模型 ID 可配置接入。
3. fake adapter 不能证明真实 provider 可用。规避方式：本阶段只验证边界，下一阶段再接真实 HTTP client。
4. image/video 真实 provider 常是异步任务。规避方式：本阶段只返回 queued product task，不承诺真实结果。
5. 配置错误可能导致启动失败。规避方式：schema 校验和清晰错误测试。

## 12. 验收清单

- [ ] `config/models.json` 声明 text/image/video 产品模型。
- [ ] 配置支持 openai-compatible 与 anthropic-compatible provider。
- [ ] 任意 provider model ID 可通过配置声明，不在代码中硬编码供应商模型列表。
- [ ] `/v1/models` 返回产品字段，不泄露 provider 内部字段。
- [ ] `/v1/generations` 请求体保持 Stage 2 产品合同。
- [ ] `GenerationService` 使用 `preset.modelId` 校验 catalog。
- [ ] hidden/missing/maintenance/mode mismatch/provider failure 返回稳定错误。
- [ ] fake adapter 不读取 API key，不发网络请求。
- [ ] Desktop fixture 模型 ID 与默认配置一致。
- [ ] README 和架构文档说明本阶段不是中转站产品，也不做真实 provider HTTP。
- [ ] `pnpm test` 通过。
- [ ] `pnpm typecheck` 通过。
