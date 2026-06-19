# GW-LINK OmniAI 文本模型目录与 Gateway Adapter 设计

文档版本：V0.1  
文档日期：2026-06-20  
文档类型：阶段实现设计  
适用阶段：模型目录 + 文本生成任务提交薄切片

## 1. 背景

当前 API 已有 `/v1/models`、`modelCatalog.ts` 和 `gatewayClient.ts`，但模型目录仍是硬编码产品模型，gateway client 仍是本地 stub。下一阶段需要支持 OpenAI-compatible 与 Anthropic-compatible 的文本模型接入，并给前端提供可验证的模型选择与任务提交链路。

本阶段不直接调用真实供应商或 GW-LINK 线上网关。目标是先建立稳定的配置合同、产品模型目录、provider adapter 边界和本地 fake gateway 行为，后续真实 HTTP client 可以在同一接口后替换。

## 2. 本阶段范围

本阶段实现：

1. 通过配置文件声明 OpenAI-compatible 和 Anthropic-compatible provider。
2. 通过 provider 配置声明任意文本模型，不在代码里硬编码供应商模型列表。
3. `GET /v1/models` 返回产品侧可见文本模型。
4. `POST /v1/generations` 提交文本生成任务，返回 `queued` 状态的 `GenerationTask`。
5. 通过 fake gateway adapter 模拟 OpenAI-compatible 和 Anthropic-compatible 提交流程。
6. 建立可测试的 `ModelCatalog`、`GenerationService`、`GatewayClient` 边界。

本阶段不实现：

1. 真实 HTTP 请求到 OpenAI、Anthropic 或 GW-LINK 线上网关。
2. 图片和视频模型的 provider adapter 接入。
3. 任务状态查询、任务持久化、生成结果保存。
4. 额度扣减、订单支付、套餐权限强校验。
5. 后台管理动态配置模型。
6. 文本流式输出、多轮会话上下文、停止生成。

## 3. 架构边界

核心链路：

```text
config/models.json
  -> modelConfig
  -> ModelCatalog
  -> GET /v1/models
  -> POST /v1/generations
  -> GenerationService
  -> GatewayClient
  -> fake OpenAI-compatible / fake Anthropic-compatible adapter
  -> GenerationTask(status: "queued")
```

关键约束：

1. `ProductModel.id` 是产品侧模型 ID，不直接等同 provider 原始模型 ID。
2. provider 原始模型 ID 保存在内部配置字段 `providerModelId`。
3. API 响应不暴露 `providerModelId`、`baseUrl`、`apiKeyEnv` 等内部字段。
4. 本阶段只允许提交 `capability: "text"` 的生成任务。
5. `image` 和 `video` 类型可以继续保留在 shared 类型中，但不纳入本阶段 provider adapter。

## 4. 模型配置

默认配置文件路径为 `config/models.json`。生产或测试环境可通过 `GW_LINK_MODEL_CONFIG_PATH` 覆盖路径。

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
          "id": "gw-text-gpt-4.1",
          "providerModelId": "gpt-4.1",
          "displayName": "GPT-4.1",
          "capability": "text",
          "visibility": "visible",
          "minimumPlan": "pro",
          "creditUnitCost": 2,
          "tags": ["openai", "reasoning"]
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
          "id": "gw-text-claude-sonnet",
          "providerModelId": "claude-sonnet-4-5",
          "displayName": "Claude Sonnet",
          "capability": "text",
          "visibility": "visible",
          "minimumPlan": "pro",
          "creditUnitCost": 2,
          "tags": ["anthropic", "writing"]
        }
      ]
    }
  ]
}
```

字段规则：

1. `providers` 必须是非空数组。
2. `provider.id`、`provider.displayName`、`provider.baseUrl`、`provider.apiKeyEnv` 必须是非空字符串。
3. `provider.protocol` 只能是 `openai-compatible` 或 `anthropic-compatible`。
4. `provider.models` 必须是数组，可以为空。
5. `model.id` 是产品侧模型 ID，在所有 provider 内必须唯一。
6. `model.providerModelId` 是供应商协议内使用的模型 ID。
7. `model.capability` 本阶段只能是 `text`。
8. `model.visibility` 使用现有 `visible`、`hidden`、`maintenance`。
9. `model.minimumPlan` 使用现有 `free`、`pro`、`studio`。
10. `model.creditUnitCost` 必须是大于 0 的数字。
11. `model.tags` 必须是字符串数组。

## 5. API 合同

### 5.1 GET /v1/models

返回所有 `visibility: "visible"` 的产品模型。

响应示例：

```json
{
  "models": [
    {
      "id": "gw-text-gpt-4.1",
      "displayName": "GPT-4.1",
      "capability": "text",
      "tags": ["openai", "reasoning"],
      "visibility": "visible",
      "minimumPlan": "pro",
      "creditUnitCost": 2
    }
  ]
}
```

接口不得返回 provider 内部字段。

### 5.2 POST /v1/generations

请求体：

```json
{
  "modelId": "gw-text-gpt-4.1",
  "capability": "text",
  "prompt": "写一个产品介绍"
}
```

成功响应：

```json
{
  "task": {
    "id": "task_text_gw-text-gpt-4.1_000001",
    "capability": "text",
    "status": "queued",
    "modelId": "gw-text-gpt-4.1",
    "createdAt": "2026-06-20T00:00:00.000Z",
    "updatedAt": "2026-06-20T00:00:00.000Z",
    "creditEstimate": {
      "credits": 2,
      "unit": "credit"
    }
  }
}
```

本阶段继续使用固定开发 `userId`。后续接入 auth guard 时，`GenerationService` 的调用方改为从 bearer session 获取真实用户 ID。

## 6. 错误处理

领域错误由 service 抛出稳定错误类型，路由负责映射 HTTP 状态码。

| 场景 | HTTP | 响应 |
| --- | --- | --- |
| 请求体缺字段或字段类型错误 | 400 | `{ "error": "Invalid generation request" }` |
| `capability` 不是 `text` | 400 | `{ "error": "Unsupported generation capability" }` |
| 模型不存在或为 `hidden` | 404 | `{ "error": "Model was not found" }` |
| 模型为 `maintenance` | 409 | `{ "error": "Model is temporarily unavailable" }` |
| provider protocol 不支持 | 502 | `{ "error": "Provider protocol is not supported" }` |
| gateway 提交失败 | 502 | `{ "error": "Generation gateway failed" }` |

## 7. 组件设计

### 7.1 modelConfig

职责：

1. 解析默认配置路径与 `GW_LINK_MODEL_CONFIG_PATH`。
2. 从 JSON 文件加载配置。
3. 对配置做基础 schema 校验。
4. 向调用方返回类型化配置对象。

测试可以直接注入内存配置，避免所有 service 测试依赖文件系统。

### 7.2 ModelCatalog

职责：

1. 持有已校验的 provider/model 配置。
2. 提供 `listVisibleModels()`。
3. 提供 `getTextModel(modelId)`，返回包含 provider 信息的内部模型引用。
4. 对外只暴露 `ProductModel` 字段。

模型查找规则：

1. `hidden` 模型按不存在处理。
2. `maintenance` 模型可以被内部查到，但提交时返回维护错误。
3. 非文本模型不在本阶段允许提交。

### 7.3 GatewayClient

统一接口：

```ts
interface GatewayClient {
  submitGeneration(request: GatewayGenerationRequest): Promise<GenerationTask>;
}
```

内部请求应包含：

1. 产品侧模型 ID。
2. provider ID。
3. provider protocol。
4. provider base URL。
5. provider API key env 名称。
6. provider 原始模型 ID。
7. prompt。
8. userId。
9. credit estimate。

fake adapter 行为：

1. 不读取真实 API key。
2. 不发网络请求。
3. 根据 provider protocol 走不同 fake 分支，保证协议分派可测试。
4. 返回 `queued` 状态任务。
5. `creditEstimate.credits` 使用产品模型的 `creditUnitCost`。

### 7.4 GenerationService

职责：

1. 校验生成请求的业务字段。
2. 从 `ModelCatalog` 查找产品模型和 provider 引用。
3. 拒绝非文本 capability。
4. 拒绝不存在、隐藏、维护中的模型。
5. 调用 `GatewayClient.submitGeneration()`。
6. 将 gateway 异常转换为领域错误。

### 7.5 routes/generations.ts

职责：

1. 注册 `POST /v1/generations`。
2. 检查请求体基础结构。
3. 调用 `GenerationService`。
4. 将领域错误映射为 HTTP 响应。

路由不直接读取 provider 配置，不直接计算模型可见性，不直接分派协议 adapter。

## 8. 测试设计

新增或更新以下测试：

1. shared 类型导出测试：确认 provider/config 相关类型可导出。
2. `modelConfig` 测试：默认配置解析、路径覆盖、无效 JSON、schema 错误、重复模型 ID。
3. `ModelCatalog` 测试：可见模型过滤、内部 provider 字段不泄露、hidden 视为不存在、maintenance 可识别。
4. `GatewayClient` 测试：OpenAI-compatible 与 Anthropic-compatible fake adapter 都返回 queued task，并使用正确 credit estimate。
5. `GenerationService` 测试：成功提交、请求无效、capability 不支持、模型不存在、模型维护中、gateway 失败。
6. route 测试：`GET /v1/models` 返回配置驱动模型；`POST /v1/generations` 返回成功和主要错误状态。

验收命令：

```bash
pnpm test
pnpm typecheck
```

## 9. 实施顺序建议

1. 增加 shared 类型：provider protocol、provider 配置、内部 catalog 引用、generation request。
2. 增加默认 `config/models.json`。
3. 实现 `modelConfig` 与 `ModelCatalog`。
4. 实现 fake `GatewayClient` 协议分派。
5. 实现 `GenerationService`。
6. 注册 `POST /v1/generations`。
7. 更新 README 或架构文档中的本地配置说明。
8. 运行测试与 typecheck。

## 10. 成功标准

1. 通过配置文件增加 OpenAI-compatible 或 Anthropic-compatible 文本模型时，不需要改业务代码。
2. `/v1/models` 只返回可见产品模型，不泄露 provider 内部字段。
3. `/v1/generations` 能用配置模型提交文本任务并返回 queued task。
4. hidden、maintenance、无效 capability、无效请求、gateway 失败都有稳定错误响应。
5. fake gateway 不依赖真实网络和 API key。
6. `pnpm test` 与 `pnpm typecheck` 通过。
