# GW-LINK OmniAI 产品优先创作台设计

文档版本：V0.1  
文档日期：2026-06-20  
文档类型：阶段实现设计  
适用阶段：Studio Shell + Prompt Optimizer MVP

## 1. 背景

GW-LINK OmniAI 的产品定位是面向个人创作者和泛内容生产用户的文字、图片、视频生产工具。模型 gateway 和供应商 adapter 是接入手段，不是产品主线。

此前的文本模型 gateway 设计和实现计划已经完成文档化，但该方向偏接入层。自本设计起，后续执行优先围绕创作台、提示词优化、任务、资产、点数与订单展开。`2026-06-20-gw-link-omniai-text-model-gateway-design.md` 和 `2026-06-20-gw-link-omniai-text-model-gateway.md` 仅作为后续 adapter 阶段参考，不作为当前执行计划。

## 2. 借鉴原则

本项目不直接 fork 大型开源产品作为主代码基底。原因是多数成熟项目已经绑定自己的产品形态、权限模型、部署方式、许可证约束和历史包袱。当前策略是自研 GW-LINK OmniAI 产品壳，借鉴优秀项目的模块设计。

参考对象：

1. LibreChat：借鉴文本创作、会话、模型切换、Artifacts、多用户配置体验。许可证 MIT，可作为设计和部分实现风格参考。
2. NextChat：借鉴轻量跨端 AI assistant、桌面端体验、快速输入与会话流。许可证 MIT，可作为产品交互参考。
3. InvokeAI：借鉴图片创作参数面板、生成结果流、参数复用、视觉资产工作流。许可证 Apache-2.0，可作为视觉创作模块参考。
4. ComfyUI：借鉴视频和复杂生成任务的参数化、任务图、异步状态和可复现思想。许可证 GPL-3.0，不直接并入闭源商业代码。
5. Open-Sora 等视频项目：借鉴视频生成能力边界和参数语义，不作为产品应用基底。

不作为主代码基底：

1. Open WebUI：有品牌修改限制。
2. LobeHub/LobeChat：商业二次开发分发需要商业授权。
3. Dify：修改版 Apache，有多租户和前端品牌限制。
4. AUTOMATIC1111、New API：AGPL/GPL 约束不适合作为商业产品主仓代码。

## 3. 产品优先架构

产品主线从创作对象出发：

```text
Workspace
  -> Text Studio
  -> Image Studio
  -> Video Studio
  -> Prompt Optimizer
  -> Generation Task
  -> Asset Library
  -> Credits / Orders
  -> Provider Adapter
```

核心原则：

1. 创作台和资产模型优先，provider adapter 后置。
2. 文本、图片、视频共享一套创作任务和资产抽象。
3. Prompt Optimizer 是三类创作入口的核心能力，不是附属工具。
4. MVP 可以使用本地规则和 fake provider 打通产品闭环，再替换为真实模型。
5. Provider adapter 不应反向污染产品 API 和前端信息架构。

## 4. MVP 分阶段

### 4.1 阶段 1：Studio Shell + Prompt Optimizer MVP

目标：建立文本、图片、视频统一创作入口，并提供三类提示词优化能力。

交付内容：

1. 桌面端首屏展示三入口创作台：文本创作、图片创作、视频创作。
2. 每个入口都有原始 prompt 输入。
3. 每个入口都有“优化提示词”动作。
4. API 提供 `/v1/prompt/optimize`。
5. MVP optimizer 使用本地规则，不调用真实模型。
6. shared 包定义创作模式、模板、优化结果、参数建议等稳定合同。

交付标准：用户能选择创作类型，输入一句话，得到对应场景的优化提示词、结构化拆解、参数建议和预计点数。

### 4.2 阶段 2：统一 Generation Task

目标：三类创作都能提交任务，并在任务中心看到状态。

交付内容：

1. API 提供 `/v1/generations`。
2. text/image/video 使用统一 `CreationTask`。
3. fake provider 返回 queued/succeeded 任务。
4. 桌面端展示任务列表。
5. 不接真实模型，不做资产文件存储。

交付标准：优化后的 prompt 可以提交为任务，任务状态可见。

### 4.3 阶段 3：Asset Library

目标：生成结果进入资产库。

交付内容：

1. 定义 `CreationAsset` 合同。
2. 文本资产展示 markdown/text。
3. 图片/视频使用 fake URL 或 placeholder asset。
4. 桌面资产库支持按 text/image/video 过滤。
5. 支持复用 prompt 和 preset 再次创作。

交付标准：用户能从任务结果进入资产库，并复用提示词和参数。

### 4.4 阶段 4：Provider Adapter 接入

目标：在产品层稳定后接入真实模型或 GW-LINK gateway。

交付内容：

1. OpenAI/Anthropic 文本 adapter。
2. 图片 provider adapter。
3. 视频异步 provider adapter。
4. 错误映射、点数预估、失败退回接口。
5. 真实凭证和 provider 配置。

交付标准：不改变产品层 API，只替换 provider 实现。

## 5. 阶段 1 产品行为

桌面端首屏从简单登录入口升级为创作工作台。

页面结构：

1. 顶部：产品名、当前登录状态入口。
2. 主入口：文本创作、图片创作、视频创作三个模式切换。
3. 输入区：根据当前模式展示原始 prompt 输入。
4. 模板区：展示当前模式下可用提示词模板。
5. 优化动作：点击“优化提示词”生成结构化结果。
6. 结果区：展示优化后 prompt、拆解 sections、推荐参数、预计点数。
7. 下一步动作：展示“提交生成”按钮，但阶段 1 不真正提交任务，可显示待接入状态。

桌面端不在阶段 1 接真实 HTTP client。可以先使用本地 model/fixture 驱动 UI 和测试，API route 独立完成后在后续阶段接入。

## 6. Prompt Optimizer 设计

Prompt Optimizer 是三类创作入口共用模块。它接收创作模式、原始 prompt、可选模板 ID，返回结构化优化结果和参数建议。

### 6.1 Text Studio

借鉴 LibreChat 和 NextChat 的文本创作体验。

能力：

1. 将一句需求扩展为明确写作 brief。
2. 输出目标、受众、语气、格式、约束。
3. 支持文案生成、改写、总结、翻译、短视频脚本、商品描述、社媒标题等模板。
4. 推荐文本模型、输出格式和预计点数。

示例 sections：

1. 写作目标。
2. 目标受众。
3. 语气风格。
4. 输出格式。
5. 关键约束。

### 6.2 Image Studio

借鉴 InvokeAI 的图片参数面板和生成工作流。

能力：

1. 将普通描述拆解为主体、场景、风格、构图、光照、色彩、质量词。
2. 生成负向提示词。
3. 推荐比例、生成张数、质量。
4. 让优化结果和图片 preset 绑定，方便后续复用。

示例 sections：

1. 主体。
2. 场景。
3. 风格。
4. 构图。
5. 光照和色彩。
6. 负向提示词。

### 6.3 Video Studio

借鉴 ComfyUI 的任务参数化和可复现思想。

能力：

1. 将普通需求拆成主体、动作、镜头运动、场景变化、时长、比例、分辨率。
2. 生成负向约束。
3. 输出适合异步任务提交的参数快照。
4. 为后续视频任务中心和资产复用保留参数结构。

示例 sections：

1. 主体。
2. 动作。
3. 镜头运动。
4. 场景变化。
5. 时长和比例。
6. 负向约束。

## 7. Shared 合同

新增或扩展 shared 类型：

```ts
export type CreationMode = "text" | "image" | "video";

export interface PromptTemplate {
  id: string;
  mode: CreationMode;
  name: string;
  description: string;
  tags: string[];
}

export interface PromptOptimizationRequest {
  mode: CreationMode;
  prompt: string;
  templateId?: string;
}

export interface PromptSection {
  label: string;
  value: string;
}

export interface PresetSuggestion {
  modelId: string;
  parameters: Record<string, string | number | boolean>;
  creditEstimate: CreditAmount;
}

export interface PromptOptimization {
  id: string;
  mode: CreationMode;
  originalPrompt: string;
  optimizedPrompt: string;
  sections: PromptSection[];
  preset: PresetSuggestion;
  createdAt: string;
}
```

这些类型应由 `packages/shared/src/index.ts` 导出，供 API、desktop、mobile、admin 共用。

## 8. API 合同

新增：

```text
POST /v1/prompt/optimize
```

请求：

```json
{
  "mode": "image",
  "prompt": "做一张咖啡店新品海报",
  "templateId": "poster"
}
```

成功响应：

```json
{
  "optimization": {
    "id": "prompt_opt_000001",
    "mode": "image",
    "originalPrompt": "做一张咖啡店新品海报",
    "optimizedPrompt": "为咖啡店新品制作一张商业海报，突出新品饮品、温暖店内氛围和清晰促销信息。",
    "sections": [
      { "label": "主体", "value": "咖啡店新品饮品与品牌海报视觉" },
      { "label": "场景", "value": "温暖、干净、有生活感的咖啡店环境" },
      { "label": "风格", "value": "商业海报、精致、适合社媒传播" },
      { "label": "构图", "value": "主体居中，保留标题和价格信息空间" },
      { "label": "光照和色彩", "value": "暖色自然光，咖啡棕与奶油白为主" },
      { "label": "负向提示词", "value": "低清晰度、杂乱背景、文字变形、过曝" }
    ],
    "preset": {
      "modelId": "recommended-image",
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

错误：

| 场景 | HTTP | 响应 |
| --- | --- | --- |
| 请求体缺字段或字段类型错误 | 400 | `{ "error": "Invalid prompt optimization request" }` |
| mode 不是 text/image/video | 400 | `{ "error": "Unsupported creation mode" }` |
| prompt 为空字符串 | 400 | `{ "error": "Prompt is required" }` |
| templateId 不存在 | 404 | `{ "error": "Prompt template was not found" }` |

## 9. API 组件

新增：

1. `apps/api/src/services/promptOptimizer.ts`
   - 持有模板列表。
   - 校验模板与 mode 是否匹配。
   - 为 text/image/video 返回本地规则优化结果。
   - 支持注入 clock 和 ID generator，保证测试稳定。

2. `apps/api/src/routes/prompt.ts`
   - 注册 `/v1/prompt/optimize`。
   - 做 HTTP 请求体基础校验。
   - 调用 prompt optimizer service。
   - 映射领域错误。

3. `apps/api/src/server.ts`
   - 注入并注册 prompt route。
   - 测试可注入 prompt optimizer。

阶段 1 不新增 provider adapter，不调用真实模型。

## 10. Desktop 组件

新增或修改：

1. `apps/desktop/src/studioModel.ts`
   - 定义三种创作模式的文案、模板、默认 prompt placeholder、参数展示模型。
   - 提供纯函数便于测试。

2. `apps/desktop/src/App.tsx`
   - 渲染产品名和登录入口。
   - 渲染三模式切换。
   - 渲染 prompt 输入区。
   - 渲染优化结果 fixture。
   - 展示提交生成的待接入状态。

3. `apps/desktop/src/__tests__/App.test.tsx`
   - 验证三入口存在。
   - 验证切换到 image/video 后展示对应提示词区域。
   - 验证优化结果包含 sections、preset 和 credit estimate。

阶段 1 桌面端可以先用本地 fixture 模拟优化结果，不阻塞 API route 的独立实现。后续阶段再加入 API client 和真实交互。

## 11. 测试设计

新增或更新：

1. shared 测试
   - 三种 `CreationMode` fixture 可用。
   - `PromptOptimization` 包含 sections、preset、credit estimate。

2. API service 测试
   - text/image/video 三种 mode 成功。
   - text 输出写作 brief。
   - image 输出主体、场景、风格、构图、光照、负向提示词。
   - video 输出主体、动作、镜头运动、场景变化、时长比例、负向约束。
   - 空 prompt 报错。
   - 未知 template 报错。
   - template 与 mode 不匹配报错。

3. API route 测试
   - 成功请求返回 `{ optimization }`。
   - 请求体 malformed 返回 `400`。
   - unsupported mode 返回 `400`。
   - 空 prompt 返回 `400`。
   - 未知 template 返回 `404`。

4. desktop 测试
   - 三个 Studio 入口存在。
   - 默认展示 Text Studio。
   - 切换 Image Studio 后显示图片提示词优化区域。
   - 切换 Video Studio 后显示视频提示词优化区域。
   - 优化结果展示 sections、preset、预计点数。

验收命令：

```bash
pnpm test
pnpm typecheck
```

## 12. 成功标准

阶段 1 完成后应满足：

1. 产品入口明确表达文字、图片、视频生产工具，而不是 gateway 管理后台。
2. 桌面端可展示三种创作入口。
3. 三种创作入口都有提示词优化体验。
4. API 可对 text/image/video 返回结构化提示词优化结果。
5. Prompt Optimizer 不依赖真实模型和网络。
6. shared 合同可支撑后续任务、资产、点数和 provider adapter。
7. `pnpm test` 和 `pnpm typecheck` 通过。
