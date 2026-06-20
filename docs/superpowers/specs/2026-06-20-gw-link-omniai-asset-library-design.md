# GW-LINK OmniAI Asset Library 设计

文档版本：V0.1
文档日期：2026-06-20
文档类型：阶段实现设计
适用阶段：Stage 3 - Asset Library MVP

## 1. 背景

Stage 2 已经完成统一生成任务闭环：文字、图片、视频可以共享 `GenerationTask` 合同，API 可以创建和列出 queued task，桌面端可以把当前 Studio 结果提交到本地任务中心。

Stage 3 的目标是把“任务结果”推进到“资产库”。资产库是文字、图片、视频生产工具的核心产品层能力：用户需要看到生成结果、沉淀结果、按类型筛选，并复用 prompt 和参数继续创作。真实 OpenAI、Anthropic、图片或视频 provider 仍属于后续接入层；本阶段继续使用 fake asset 内容稳定产品合同和 UI 行为。

## 2. 目标

本阶段交付一个统一的本地资产库闭环：

1. Shared 包定义 `CreationAsset` 合同，覆盖 text/image/video。
2. API 提供 in-memory asset 创建和列表接口。
3. Desktop 可以把当前任务保存为 fake asset。
4. Desktop 展示资产库，并支持 all/text/image/video 过滤。
5. 资产条目展示类型、模型、点数、prompt 摘要和可复用参数入口。

验收标准：用户在桌面端提交任一创作模式任务后，可以把任务保存到资产库；资产库出现对应 text/image/video 资产；切换过滤器可以看到对应资产；API 可以独立创建和列出资产；全流程不调用真实 provider、外部网络、持久化存储或真实文件服务。

## 3. 非目标

本阶段不做：

1. 真实 provider 输出落库。
2. 数据库、对象存储、CDN 或真实文件 URL 生命周期。
3. 桌面端 HTTP client、auth token 或跨端同步。
4. 资产编辑、删除、批量操作或收藏夹。
5. 真实 markdown 渲染器、图片预览组件或视频播放器。
6. 点数扣减、退款、订单或计费流水。
7. 复杂复用动作，例如一键回填编辑器状态或重新生成。

这些能力将在后续持久化、资产管理和 provider adapter 阶段继续扩展。

## 4. 产品行为

桌面端在现有 Studio、优化结果和任务中心基础上增加资产库：

1. 用户选择文本、图片或视频创作模式。
2. 用户点击“提交生成”，任务中心新增 queued task。
3. 任务条目提供“保存到资产库”动作。
4. 点击后，桌面端根据任务生成 fake `CreationAsset`。
5. 资产库展示该资产。
6. 用户可以用过滤器查看全部、文本、图片或视频资产。
7. 资产条目展示：
   - 创作类型。
   - 资产标题。
   - 模型 ID。
   - 预计点数。
   - prompt 摘要。
   - 内容预览。
   - “复用参数”入口文案。

过滤器文案：

| filter | 中文展示 |
| --- | --- |
| all | 全部 |
| text | 文本 |
| image | 图片 |
| video | 视频 |

本阶段桌面端不调用 `/v1/assets`。Desktop 使用本地 model/state 模拟资产保存，以便先稳定 UI 行为和资产合同。API route 独立完成合同、服务和测试。

## 5. Shared 合同

新增 `CreationAsset` 相关类型：

```ts
export type CreationAssetContent =
  | {
      kind: "text";
      text: string;
      format: "markdown" | "plain";
    }
  | {
      kind: "image";
      url: string;
      alt: string;
    }
  | {
      kind: "video";
      url: string;
      durationSeconds: number;
      posterUrl: string;
    };

export interface CreationAssetPreview {
  title: string;
  description: string;
}

export interface CreationAssetSource {
  taskId: string;
  taskStatus: GenerationTaskStatus;
}

export interface CreationAsset {
  id: string;
  mode: CreationMode;
  title: string;
  content: CreationAssetContent;
  preview: CreationAssetPreview;
  source: CreationAssetSource;
  prompt: string;
  optimizedPrompt: string;
  preset: PresetSuggestion;
  createdAt: string;
}
```

合同原则：

1. `mode` 继续使用产品创作类型，不暴露 provider capability 或 adapter 字段。
2. `content` 是产品可展示内容，不代表真实存储实现。
3. `source` 记录资产来自哪个 generation task，后续可扩展 lineage。
4. `preset` 复用任务中的推荐参数，确保模型、参数和点数估算可复用。
5. 资产不包含真实 provider response 或凭证信息。

## 6. API 合同

新增：

```text
POST /v1/assets
GET /v1/assets
```

### 6.1 POST /v1/assets

请求：

```json
{
  "mode": "image",
  "title": "图片资产",
  "content": {
    "kind": "image",
    "url": "https://assets.gw-link.local/placeholders/image-generation.png",
    "alt": "咖啡店新品海报占位图"
  },
  "source": {
    "taskId": "generation_task_000001",
    "taskStatus": "succeeded"
  },
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

成功响应：

```json
{
  "asset": {
    "id": "creation_asset_000001",
    "mode": "image",
    "title": "图片资产",
    "content": {
      "kind": "image",
      "url": "https://assets.gw-link.local/placeholders/image-generation.png",
      "alt": "咖啡店新品海报占位图"
    },
    "preview": {
      "title": "图片资产",
      "description": "占位图片资产，后续阶段将接入真实图片文件。"
    },
    "source": {
      "taskId": "generation_task_000001",
      "taskStatus": "succeeded"
    },
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
    "createdAt": "2026-06-20T00:00:00.000Z"
  }
}
```

### 6.2 GET /v1/assets

成功响应：

```json
{
  "assets": [
    {
      "id": "creation_asset_000001",
      "mode": "image",
      "title": "图片资产",
      "content": {
        "kind": "image",
        "url": "https://assets.gw-link.local/placeholders/image-generation.png",
        "alt": "咖啡店新品海报占位图"
      },
      "preview": {
        "title": "图片资产",
        "description": "占位图片资产，后续阶段将接入真实图片文件。"
      },
      "source": {
        "taskId": "generation_task_000001",
        "taskStatus": "succeeded"
      },
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
      "createdAt": "2026-06-20T00:00:00.000Z"
    }
  ]
}
```

### 6.3 错误合同

| 场景 | HTTP | 响应 |
| --- | --- | --- |
| 请求体缺字段或字段类型错误 | 400 | `{ "error": "Invalid asset request" }` |
| mode 不是 text/image/video | 400 | `{ "error": "Unsupported asset mode" }` |
| title 为空字符串 | 400 | `{ "error": "Asset title is required" }` |
| prompt 为空字符串 | 400 | `{ "error": "Prompt is required" }` |
| optimizedPrompt 为空字符串 | 400 | `{ "error": "Optimized prompt is required" }` |
| preset 缺字段或字段类型错误 | 400 | `{ "error": "Invalid preset suggestion" }` |
| content 与 mode 不匹配或字段无效 | 400 | `{ "error": "Invalid asset content" }` |
| source 缺字段或字段类型错误 | 400 | `{ "error": "Invalid asset source" }` |
| service 未知错误 | 500 | `{ "error": "Unexpected asset error" }` |

## 7. API 组件

新增 `apps/api/src/services/assetService.ts`：

1. 暴露 `AssetService` 接口。
2. 实现 `InMemoryAssetService`。
3. `createAsset(request)` 校验 mode、title、content、source、prompt、optimizedPrompt 和 preset。
4. 根据 mode 生成 preview 文案。
5. `listAssets()` 返回资产列表。
6. 支持注入 `clock` 和 `idGenerator`。
7. 返回 defensive copies，防止调用方修改内存状态。

新增 `apps/api/src/routes/assets.ts`：

1. 注册 `POST /v1/assets`。
2. 注册 `GET /v1/assets`。
3. 做 HTTP body shape 校验。
4. 映射领域错误为稳定 HTTP 响应。

修改 `apps/api/src/server.ts`：

1. `BuildServerOptions` 支持注入 `assetService`。
2. 默认使用 `InMemoryAssetService`。
3. 注册 asset routes。
4. 不改变 authService、promptOptimizer 和 generationService 的注入行为。

## 8. Desktop 组件

新增 `apps/desktop/src/assetModel.ts`：

1. 定义本地资产 helper。
2. 将 `GenerationTask` 转为 `CreationAsset`。
3. 生成 fake text/image/video content。
4. 提供资产过滤 helper。
5. 提供资产类型中文文案。
6. 支持 deterministic id/clock 输入，保证测试稳定。
7. 返回 defensive copies。

修改 `apps/desktop/src/App.tsx`：

1. 增加 `creationAssets` 本地 state。
2. 任务条目增加“保存到资产库”按钮。
3. 点击后把任务转为本地资产并加入资产库。
4. 展示“资产库”区域。
5. 资产库支持 all/text/image/video 过滤。
6. 资产列表展示 mode label、title、modelId、creditEstimate、prompt summary 和 preview description。
7. 展示“复用参数”入口文案，本阶段不回填编辑器状态。

本阶段桌面端不直接调用 `/v1/assets`。API 和 Desktop 分别验证合同与交互，后续 HTTP client 阶段再连接。

## 9. 数据流

```text
Desktop Task Center
  -> save local generation task as fake asset
  -> local asset library
  -> filter by all/text/image/video

API Client
  -> POST /v1/assets
  -> InMemoryAssetService.createAsset()
  -> CreationAsset
  -> GET /v1/assets
```

Stage 3 的 Desktop 和 API 共享 `CreationAsset`、`CreationAssetContent`、`PresetSuggestion` 等合同，但不直接进行网络联调。

## 10. 测试策略

### 10.1 Shared

新增 `packages/shared/src/__tests__/asset.test.ts`：

1. 表示 text/image/video 资产。
2. 断言 `source.taskId` 和 `preset.creditEstimate` 保留。
3. 断言 content discriminated union 能表达 text/image/video。

### 10.2 API Service

新增 `apps/api/src/services/__tests__/assetService.test.ts`：

1. 创建 text/image/video asset。
2. preview 按 mode 生成。
3. listAssets 返回 defensive copies。
4. invalid mode、empty title、empty prompt、empty optimizedPrompt、invalid preset、invalid content、invalid source 返回领域错误。

### 10.3 API Route

新增 `apps/api/src/routes/__tests__/assets.test.ts`：

1. POST 创建 asset 成功。
2. GET 返回 asset 列表。
3. malformed request 返回 400。
4. domain error 映射稳定。
5. unknown service error 返回 500。

更新 `apps/api/src/__tests__/server.test.ts`：

1. 确认 `/v1/assets` 已注册。
2. 确认注入 `assetService` 不触发无关配置读取。

### 10.4 Desktop

新增 `apps/desktop/src/__tests__/assetModel.test.ts`：

1. `createLocalCreationAsset` 从 task 生成 asset。
2. text/image/video fake content 正确。
3. 资产过滤 helper 正确。
4. 类型中文文案正确。
5. 返回对象是 defensive copy。

更新 `apps/desktop/src/__tests__/App.test.tsx`：

1. 提交任务后可以保存到资产库。
2. 资产库展示 title、类型、modelId、点数、prompt 摘要。
3. text/image/video 资产可以被过滤器筛选。
4. 切换 Studio mode 不清空已保存资产。
5. 展示“复用参数”入口文案。

### 10.5 全量验证

每个任务完成后运行相关 package 测试和 typecheck。全部完成后运行：

```bash
pnpm test
pnpm typecheck
```

## 11. 实施顺序

1. Shared CreationAsset contracts。
2. API InMemoryAssetService。
3. API asset routes。
4. Desktop asset model。
5. Desktop asset library UI。
6. README 和架构文档补充。
7. 全量测试和最终 review。

## 12. 后续阶段

Stage 4：Provider Adapter。接入真实 OpenAI、Anthropic、图片和视频 provider。Provider adapter 生成真实任务结果后，可以落到本阶段定义的 `CreationAsset` 合同，不改变桌面端资产库主流程。

Stage 5：Persistence and Sync。将 `GenerationTask` 和 `CreationAsset` 从内存迁移到持久化存储，补齐用户隔离、跨端同步、资产删除、文件生命周期和权限策略。
