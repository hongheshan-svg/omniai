# GW-LINK OmniAI Prompt Scenario Studio Design

适用阶段：Stage 5 - Prompt Scenario Studio

## 1. Background

Stage 1 已完成 Studio Shell + Prompt Optimizer，Stage 2 已完成统一生成任务，Stage 3 已完成资产库，Stage 4 已完成产品优先的 provider adapter foundation。当前产品已经可以围绕文字、图片、视频完成本地提示词优化、提交生成任务、保存资产，并通过配置目录接入 OpenAI-compatible 与 Anthropic-compatible provider model。

Stage 5 的目标是提升“优化提示词场景”的产品能力。用户明确要求 GW-LINK OmniAI 是文字、图片、视频生产工具，provider gateway 只是接入手段。因此本阶段不继续扩展 provider plumbing，而是把提示词优化从简单 mode strategy 升级为可复用、可解释、可在桌面端选择的场景工作台。

本设计借鉴优秀项目的模块思想，而不是复制实现：

- `linshenkx/prompt-optimizer`：模板来源、变量管理、测试/评估、保存为可复用 prompt asset 的产品思路。
- `langfuse/langfuse` 与 `Agenta-AI/agenta`：prompt management、版本化、playground、evaluation 的概念边界。
- `rockbenben/img-prompt`：图片/视频提示词按对象、属性、标签和示例组织的维度化思路。

Stage 5 只取适合当前产品阶段的轻量能力：场景模板、变量槽位、示例输入、结构化优化结果、推荐参数和桌面选择体验。不引入完整 LLMOps、多人协作、自动评测平台或大型图片标签库。

## 2. Goals

1. 为 text/image/video 提供共享的 `PromptScenario` 场景目录，替代 API 与 Desktop 各自硬编码的模板列表。
2. 每个场景描述变量槽位、示例输入、输出结构、推荐模型和参数，使提示词优化更像生产工具，而不是固定字符串扩写。
3. 保持 `PromptOptimizationRequest` 兼容现有 `mode/prompt/templateId` 合同，不引入 provider 字段，不改变生成任务与资产合同。
4. 让 Desktop 创作台展示场景卡片、变量槽位、示例提示和推荐参数，帮助用户理解不同生产场景如何写 prompt。
5. 让 API 的 `LocalPromptOptimizer` 从共享场景目录生成优化结果，确保 text/image/video 三类能力同步增强。
6. 保持本阶段不调用真实 AI provider、不读 API key、不发网络请求。

## 3. Non-Goals

1. 不做完整 prompt 版本发布流、环境管理、分支管理或多人协作。
2. 不做自动评测、LLM-as-judge、A/B test、trace observability 或 dataset runs。
3. 不导入 5000+ 图片标签库，不做大型多语言标签检索。
4. 不改变 Stage 4 的 provider adapter 接线，不实现真实 OpenAI/Anthropic HTTP 调用。
5. 不把 Desktop 改成真实 API HTTP client；桌面端仍使用本地 fixture/workflow 证明产品体验。
6. 不新增持久化数据库；场景目录先作为代码内共享数据提供。

## 4. Product Experience

### 4.1 Studio Flow

Desktop 仍保留当前主流程：

1. 用户选择创作模式：文本、图片或视频。
2. 用户选择当前模式下的提示词场景。
3. 用户查看该场景的变量槽位、示例输入、推荐参数和优化结构。
4. 用户输入创作需求并点击“优化提示词”。
5. 产品展示结构化优化结果和推荐 preset。
6. 用户继续提交生成任务、保存资产。

本阶段仍然是本地交互，不要求 Desktop 真的调用 API。Desktop 的目标是把场景化提示词生产体验跑顺。

### 4.2 Scenario Card

场景卡片应呈现：

- 场景名称与说明。
- 场景 tags。
- 变量槽位摘要，例如“受众、语气、渠道、长度”。
- 示例输入，帮助用户从空白状态开始。
- 推荐模型与关键参数。

用户切换场景后，优化结果 fixture、模板说明和推荐参数应随场景更新。

### 4.3 First Scenario Set

首批场景以覆盖三模态生产的常用场景为目标：

Text:

- `text-product-launch`：新品发布文案。
- `text-social-title`：社媒标题。
- `text-live-script`：直播脚本。

Image:

- `image-commercial-poster`：商业海报。
- `image-product-hero`：产品主图。
- `image-social-visual`：社媒视觉。

Video:

- `video-short-shot`：短视频镜头。
- `video-product-demo`：产品展示。
- `video-atmosphere-clip`：氛围片段。

## 5. Shared Contracts

### 5.1 PromptScenario

新增共享合同：

```ts
export interface PromptScenario {
  id: string;
  mode: CreationMode;
  name: string;
  description: string;
  tags: string[];
  variables: PromptScenarioVariable[];
  examples: PromptScenarioExample[];
  sectionBlueprints: PromptSectionBlueprint[];
  defaultPreset: PresetSuggestion;
}
```

### 5.2 PromptScenarioVariable

变量槽位描述用户在该场景里需要补充的信息。它用于 UI 展示和本地优化，不要求本阶段提供独立表单输入。

```ts
export interface PromptScenarioVariable {
  id: string;
  label: string;
  description: string;
  required: boolean;
  placeholder: string;
}
```

### 5.3 PromptScenarioExample

示例输入帮助用户理解该场景适合什么问题，也用于测试场景目录可读性。

```ts
export interface PromptScenarioExample {
  input: string;
  note: string;
}
```

### 5.4 PromptSectionBlueprint

优化结果的结构段落从场景蓝图生成。每个段落有固定 label 和 mode-specific guidance。

```ts
export interface PromptSectionBlueprint {
  label: string;
  guidance: string;
}
```

### 5.5 PromptTemplate Compatibility

现有 `PromptTemplate` 合同保留，但应从 `PromptScenario` 派生：

```ts
export interface PromptTemplate {
  id: string;
  mode: CreationMode;
  name: string;
  description: string;
  tags: string[];
}
```

`templateId` 在 Stage 5 中等同于 `scenarioId`。为了兼容现有 API，不新增 `scenarioId` 请求字段；代码内部可使用“scenario”命名。

## 6. Scenario Catalog

新增共享场景目录模块，建议位于 `packages/shared/src/promptScenarios.ts`。它负责：

1. 定义首批 9 个场景。
2. 导出 `listPromptScenarios(mode?: CreationMode): PromptScenario[]`。
3. 导出 `getPromptScenario(id: string): PromptScenario | undefined`。
4. 导出 `getDefaultPromptScenario(mode: CreationMode): PromptScenario`。
5. 返回 defensive copies，避免 API 或 Desktop 侧突变共享数据。

默认场景：

- text -> `text-product-launch`
- image -> `image-commercial-poster`
- video -> `video-short-shot`

场景目录中的 `defaultPreset.modelId` 必须使用 Stage 4 默认 visible model IDs：

- text -> `gw-text-balanced`
- image -> `gw-image-creative`
- video -> `gw-video-motion`

## 7. API Changes

### 7.1 LocalPromptOptimizer

`LocalPromptOptimizer` 应移除本地 `promptTemplates` 与 `modeStrategies` 的重复硬编码，改为依赖共享 scenario catalog。

行为保持兼容：

- `listTemplates(mode?)` 返回从 scenario 派生的 `PromptTemplate[]`。
- `optimizePrompt(request)` 接受现有 `mode/prompt/templateId`。
- 未传 `templateId` 时使用该 mode 的默认 scenario。
- `templateId` 不存在或 mode 不匹配时返回 `Prompt template was not found`，HTTP status 404。
- mode 不支持时返回 `Unsupported creation mode`，HTTP status 400。
- prompt 为空时返回 `Prompt is required`，HTTP status 400。

优化结果生成规则：

1. `optimizedPrompt` 根据 scenario 的 mode、name、description、变量槽位和用户 prompt 生成稳定的本地字符串。
2. `sections` 根据 `sectionBlueprints` 生成，段落 value 必须包含用户原始意图或与场景变量相关的具体指导。
3. `preset` 使用 scenario 的 `defaultPreset`，并在 parameters 中包含 `scenario: scenario.id`。
4. 保留当前 credit estimate 行为，由 scenario default preset 提供。

本阶段仍然是 rule-based local optimizer，不调用真实模型。

## 8. Desktop Changes

### 8.1 Studio Model

`apps/desktop/src/studioModel.ts` 应从共享 scenario catalog 构建：

- `getStudioTemplates(mode)` 返回场景派生模板。
- 新增 `getStudioScenarios(mode)` 返回桌面可展示的场景数据。
- `getFixtureOptimization(mode)` 使用默认 scenario。
- 新增 `getFixtureOptimizationForScenario(mode, scenarioId)` 支持测试和 UI。

桌面模型应继续返回 defensive copies。

### 8.2 App UI

`apps/desktop/src/App.tsx` 的“提示词模板”区升级为“提示词场景”区：

- 展示场景 name/description/tags。
- 展示变量槽位列表。
- 展示示例输入。
- 展示推荐参数摘要。
- 用户可点击选择当前场景。

`textarea` 的默认值应来自当前场景的第一个 example input；切换 mode 或 scenario 时应更新。

优化结果区域应展示当前场景生成的 fixture optimization。

本阶段 UI 可以保持当前朴素 HTML 风格，不要求引入复杂设计系统。重点是场景信息完整、测试可断言、三模态都可用。

## 9. Data Flow

API:

```text
POST /v1/prompt/optimize
  -> read PromptOptimizationRequest
  -> LocalPromptOptimizer.resolveScenario(mode, templateId)
  -> build optimizedPrompt from scenario + prompt
  -> build sections from scenario.sectionBlueprints
  -> clone scenario.defaultPreset + parameters.scenario
  -> return PromptOptimization
```

Desktop:

```text
selectedMode + selectedScenarioId
  -> getStudioScenarios(selectedMode)
  -> getFixtureOptimizationForScenario(selectedMode, selectedScenarioId)
  -> render scenario card, variables, examples, preset, sections
  -> submit local GenerationTask
  -> save local CreationAsset
```

## 10. Error Handling

API errors remain stable:

| Condition | Status | Message |
| --- | --- | --- |
| Invalid request body | 400 | `Invalid prompt optimization request` |
| Unsupported mode | 400 | `Unsupported creation mode` |
| Empty prompt | 400 | `Prompt is required` |
| Missing or mismatched template/scenario | 404 | `Prompt template was not found` |
| Unknown optimizer error | 500 | `Unexpected prompt optimization error` |

Desktop scenario helpers should gracefully fall back to the default scenario for the selected mode when given an unknown scenario id. API should not silently fall back for explicit unknown `templateId`; it should return 404.

## 11. Testing Strategy

Shared package tests:

- Scenario catalog has exactly the expected first 9 scenario ids.
- Filtering by mode returns only that mode.
- Default scenarios map to text/image/video defaults.
- Returned scenarios are defensive copies.
- Derived templates preserve `id/mode/name/description/tags`.

API service tests:

- `listTemplates()` returns scenario-derived templates.
- `listTemplates("image")` filters image scenarios.
- `optimizePrompt()` uses default scenario when templateId is absent.
- `optimizePrompt()` uses explicit scenario when templateId is present.
- Unknown or mode-mismatched scenario returns 404.
- Optimized result includes `parameters.scenario`.
- Sections come from scenario blueprints and include the user prompt.

API route/server tests:

- Existing `/v1/prompt/optimize` route keeps response shape.
- Missing template route error remains 404.
- Server prompt route remains registered.

Desktop tests:

- `getStudioScenarios(mode)` returns the right scenario cards.
- Switching scenario changes fixture prompt, sections, and preset `parameters.scenario`.
- App renders scenario variables, examples, and selected scenario output.
- Text/image/video modes still submit generation tasks and save assets.

Full verification:

```bash
pnpm test
pnpm typecheck
```

## 12. Documentation

README should gain a short Stage 5 section after Provider Adapter Foundation:

- Prompt Scenario Studio adds reusable text/image/video prompt scenarios.
- Scenarios include variables, examples, output sections and recommended presets.
- API and Desktop share the same scenario catalog.
- This is still local/rule-based; real provider execution and prompt evaluation remain later slices.

Architecture docs should add a Prompt Scenario Studio slice section describing how scenario catalog sits above provider adapters and below Studio UX.

## 13. Implementation Notes

Recommended task order:

1. Add shared scenario contracts and catalog.
2. Refactor API prompt optimizer to use scenario catalog.
3. Add route/server coverage for scenario-derived optimizer behavior.
4. Upgrade Desktop studio model and UI to render scenarios.
5. Update docs and run full verification.

The implementation should use TDD and commit each task separately. The shared catalog should be product-facing and must not include provider URLs, API key env names, or provider model IDs.

## 14. Acceptance Criteria

1. Shared `PromptScenario` contracts exist and are exported.
2. Shared scenario catalog contains 9 scenarios across text/image/video.
3. API prompt templates are derived from scenarios, not duplicated hardcoded arrays.
4. API optimization result includes scenario-specific sections and `preset.parameters.scenario`.
5. Desktop displays scenario cards with variables, examples and recommended presets.
6. Switching Desktop mode and scenario updates the prompt fixture and optimization output.
7. Generation task and asset flows still work after scenario UI changes.
8. No provider fields leak into shared scenario contracts or Desktop scenario UI.
9. README and architecture docs describe Stage 5.
10. `pnpm test` and `pnpm typecheck` pass.

## 15. References

- https://github.com/linshenkx/prompt-optimizer
- https://github.com/langfuse/langfuse
- https://github.com/Agenta-AI/agenta
- https://github.com/rockbenben/img-prompt
