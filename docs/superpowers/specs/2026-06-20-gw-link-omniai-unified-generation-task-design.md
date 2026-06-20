# GW-LINK OmniAI 统一生成任务设计

文档版本：V0.1  
文档日期：2026-06-20  
文档类型：阶段实现设计  
适用阶段：Stage 2 - Unified Generation Task MVP

## 1. 背景

Stage 1 已经完成 Studio Shell + Prompt Optimizer MVP。桌面端现在有文本、图片、视频三类创作入口，用户可以得到优化后的 prompt、结构化拆解、推荐参数和点数估算。

Stage 2 的目标是把“提示词优化结果”推进到“生成任务提交”。本阶段仍然坚持产品优先：先稳定统一任务合同、任务 API 和桌面端任务中心，再接入真实 OpenAI、Anthropic、图片或视频 provider。Gateway 和 provider adapter 仍是后续接入手段，不驱动产品架构。

## 2. 目标

本阶段交付一个统一的本地生成任务闭环：

1. 文本、图片、视频使用同一套 `GenerationTask` 合同。
2. API 提供任务提交和任务列表接口。
3. Fake generation service 返回可测试、可展示的任务状态。
4. 桌面端可以从当前 Studio mode 提交生成任务。
5. 桌面端展示任务列表，让用户看到任务状态、模型、点数和提示词摘要。

验收标准：用户在任一创作模式下点击“提交生成”，界面中出现一条排队中的任务；API 可以独立创建和列出 text/image/video 任务；全流程不调用真实 provider 或外部网络。

## 3. 非目标

本阶段不做：

1. 真实 OpenAI 或 Anthropic adapter。
2. 真实图片、视频 provider adapter。
3. 资产库和文件存储。
4. 数据库持久化。
5. 真实点数扣减、退款、订单或支付。
6. 任务轮询、通知、后台 worker。
7. 桌面端 HTTP client、auth token 管理或跨端同步。

这些能力将在后续阶段基于稳定的 `GenerationTask` 和 `CreationAsset` 合同继续扩展。

## 4. 产品行为

桌面端保留 Stage 1 的创作台结构：

1. 用户选择文本创作、图片创作或视频创作。
2. 用户查看当前模式的优化提示词和推荐参数。
3. “提交生成（待接入）”按钮改为可用的“提交生成”。
4. 点击后，本地任务列表新增一条任务。
5. 任务展示：
   - 创作类型。
   - 状态。
   - 模型 ID。
   - 预计点数。
   - 原始需求或优化提示词摘要。

状态文案：

| 状态 | 中文展示 |
| --- | --- |
| queued | 排队中 |
| running | 生成中 |
| succeeded | 已完成 |
| failed | 失败 |

本阶段桌面端不调用 API。桌面端使用本地 view model/state 模拟提交，以便先稳定 UI 行为和任务展示。API route 独立完成合同、服务和测试。

## 5. Shared 合同

Stage 1 已有 `CreationMode`、`PromptOptimization`、`PresetSuggestion` 和旧的 `GenerationTask`。Stage 2 需要将任务合同从 provider/gateway 语义调整为产品创作任务语义。

建议 shared 类型：

```ts
export type GenerationTaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface GenerationTaskRequest {
  mode: CreationMode;
  prompt: string;
  optimizedPrompt: string;
  preset: PresetSuggestion;
}

export interface GenerationTaskResultPreview {
  title: string;
  description: string;
}

export interface GenerationTask {
  id: string;
  mode: CreationMode;
  status: GenerationTaskStatus;
  prompt: string;
  optimizedPrompt: string;
  preset: PresetSuggestion;
  resultPreview: GenerationTaskResultPreview;
  createdAt: string;
  updatedAt: string;
}
```

合同原则：

1. 使用 `mode`，不再在产品任务中使用 gateway 风格的 `capability` 字段。
2. `preset` 直接复用 Prompt Optimizer 输出，确保 modelId、parameters 和 creditEstimate 不漂移。
3. `resultPreview` 是阶段性展示字段，不代表真实资产。
4. 任务不包含真实文件 URL。资产库阶段再引入 `CreationAsset`。

## 6. API 合同

新增：

```text
POST /v1/generations
GET /v1/generations
```

### 6.1 POST /v1/generations

请求：

```json
{
  "mode": "image",
  "prompt": "做一张咖啡店新品海报",
  "optimizedPrompt": "为“做一张咖啡店新品海报”制作一张商业级视觉图，突出主体、场景氛围、构图和清晰传播信息。",
  "preset": {
    "modelId": "gw-image-creative",
    "parameters": {
      "template": "image-poster",
      "aspectRatio": "4:3",
      "quality": "high",
      "count": 1
    },
    "creditEstimate": { "credits": 2, "unit": "credit" }
  }
}
```

成功响应：

```json
{
  "task": {
    "id": "generation_task_000001",
    "mode": "image",
    "status": "queued",
    "prompt": "做一张咖啡店新品海报",
    "optimizedPrompt": "为“做一张咖啡店新品海报”制作一张商业级视觉图，突出主体、场景氛围、构图和清晰传播信息。",
    "preset": {
      "modelId": "gw-image-creative",
      "parameters": {
        "template": "image-poster",
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

### 6.2 GET /v1/generations

成功响应：

```json
{
  "tasks": [
    {
      "id": "generation_task_000001",
      "mode": "image",
      "status": "queued",
      "prompt": "做一张咖啡店新品海报",
      "optimizedPrompt": "为“做一张咖啡店新品海报”制作一张商业级视觉图，突出主体、场景氛围、构图和清晰传播信息。",
      "preset": {
        "modelId": "gw-image-creative",
        "parameters": {
          "template": "image-poster",
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
  ]
}
```

### 6.3 错误合同

| 场景 | HTTP | 响应 |
| --- | --- | --- |
| 请求体缺字段或字段类型错误 | 400 | `{ "error": "Invalid generation task request" }` |
| mode 不是 text/image/video | 400 | `{ "error": "Unsupported creation mode" }` |
| prompt 为空字符串 | 400 | `{ "error": "Prompt is required" }` |
| optimizedPrompt 为空字符串 | 400 | `{ "error": "Optimized prompt is required" }` |
| preset 缺字段或字段类型错误 | 400 | `{ "error": "Invalid preset suggestion" }` |
| service 未知错误 | 500 | `{ "error": "Unexpected generation task error" }` |

## 7. API 组件

新增 `apps/api/src/services/generationService.ts`：

1. 暴露 `GenerationService` 接口。
2. 实现 `InMemoryGenerationService`。
3. `createTask(request)` 校验 mode、prompt、optimizedPrompt 和 preset。
4. 默认返回 `queued` 状态。
5. `listTasks()` 返回任务列表。
6. 支持注入 `clock` 和 `idGenerator`。
7. 返回 defensive copies，防止调用方修改内存状态。

新增 `apps/api/src/routes/generations.ts`：

1. 注册 `POST /v1/generations`。
2. 注册 `GET /v1/generations`。
3. 做 HTTP body shape 校验。
4. 映射领域错误为稳定 HTTP 响应。

修改 `apps/api/src/server.ts`：

1. `BuildServerOptions` 支持注入 `generationService`。
2. 默认使用 `InMemoryGenerationService`。
3. 注册 generation routes。
4. 不改变 authService 和 promptOptimizer 的注入行为。

## 8. Desktop 组件

新增 `apps/desktop/src/generationModel.ts`：

1. 定义本地任务提交 helper。
2. 将 `PromptOptimization` 转为 `GenerationTask`。
3. 生成本地任务 preview 文案。
4. 提供状态中文文案。
5. 支持 deterministic id/clock 输入，保证测试稳定。

修改 `apps/desktop/src/App.tsx`：

1. 将提交按钮改为可用的“提交生成”。
2. 点击后把当前 `optimization` 转成任务并放入本地任务列表。
3. 展示“任务中心”区域。
4. 任务列表展示 mode title、status label、modelId、creditEstimate、prompt summary。
5. 切换 Studio mode 不清空已提交任务。

本阶段桌面端不直接调用 `/v1/generations`。API 和 Desktop 分别验证合同与交互，后续 HTTP client 阶段再连接。

## 9. 数据流

```text
Desktop Studio Mode
  -> getFixtureOptimization(mode)
  -> submit local generation task
  -> local task list

API Client
  -> POST /v1/generations
  -> InMemoryGenerationService.createTask()
  -> queued GenerationTask
  -> GET /v1/generations
```

Stage 2 的 Desktop 和 API 共享 `GenerationTaskRequest`、`GenerationTask`、`PresetSuggestion` 等合同，但不直接进行网络联调。

## 10. 测试策略

### 10.1 Shared

新增或更新 `packages/shared/src/__tests__/generation.test.ts`：

1. 表示 text/image/video 任务请求。
2. 表示 queued 任务。
3. 断言 `preset.creditEstimate` 仍保留产品点数合同。

### 10.2 API Service

新增 `apps/api/src/services/__tests__/generationService.test.ts`：

1. 创建 text/image/video 任务。
2. 默认状态为 queued。
3. resultPreview 按 mode 生成。
4. listTasks 返回 defensive copies。
5. invalid mode、empty prompt、empty optimizedPrompt、invalid preset 返回领域错误。

### 10.3 API Route

新增 `apps/api/src/routes/__tests__/generations.test.ts`：

1. POST 创建任务成功。
2. GET 返回任务列表。
3. malformed request 返回 400。
4. domain error 映射稳定。
5. unknown service error 返回 500。

更新 `apps/api/src/__tests__/server.test.ts`：

1. 确认 `/v1/generations` 已注册。
2. 确认注入 `generationService` 不触发无关配置读取。

### 10.4 Desktop

新增 `apps/desktop/src/__tests__/generationModel.test.ts`：

1. `createLocalGenerationTask` 从 optimization 生成 queued task。
2. text/image/video preview 文案正确。
3. 状态中文文案正确。
4. 返回对象是 defensive copy。

更新 `apps/desktop/src/__tests__/App.test.tsx`：

1. 提交按钮可点击。
2. 默认 text mode 点击后任务中心出现 text task。
3. 切到 image/video 后提交，任务中心追加对应 task。
4. 任务显示模型 ID、点数和排队中。

### 10.5 全量验证

每个任务完成后运行相关 package 测试和 typecheck。全部完成后运行：

```bash
pnpm test
pnpm typecheck
```

## 11. 实施顺序

1. Shared Generation Task contracts。
2. API InMemoryGenerationService。
3. API generations route。
4. Desktop generation model。
5. Desktop task center UI。
6. README 和架构文档补充。
7. 全量测试和最终 review。

## 12. 后续阶段

Stage 3：Asset Library。把 succeeded task 转为 `CreationAsset`，支持文本、图片、视频资产展示和复用。

Stage 4：Provider Adapter。接入真实 OpenAI、Anthropic、图片和视频 provider。Provider adapter 必须实现产品任务合同，不改变 `/v1/generations` 和桌面端主流程。
