# GW-LINK OmniAI Studio Prompt Optimizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the product-first Studio Shell and Prompt Optimizer MVP for text, image, and video creation.

**Architecture:** Add shared prompt optimization contracts, implement a deterministic API prompt optimizer service and route, then upgrade the desktop shell into a three-mode creation workspace using local studio view models. This phase does not call real AI providers, does not submit generation tasks, and keeps provider adapter work for a later stage.

**Tech Stack:** TypeScript, Vitest, Fastify, React, Testing Library, pnpm workspaces.

---

## Scope Check

This plan implements only Stage 1 from `docs/superpowers/specs/2026-06-20-gw-link-omniai-product-first-studio-design.md`: Studio Shell + Prompt Optimizer MVP. It intentionally excludes real provider calls, `/v1/generations`, task persistence, asset library storage, billing mutations, streaming, and API client wiring from the desktop app.

## File Structure

- Modify: `packages/shared/src/models.ts` - add creation mode, prompt template, prompt section, preset suggestion, prompt optimization request, and prompt optimization contracts.
- Modify: `packages/shared/src/index.ts` - export the new shared contracts.
- Create: `packages/shared/src/__tests__/prompt.test.ts` - shared prompt contract fixture tests.
- Create: `apps/api/src/services/promptOptimizer.ts` - deterministic local prompt optimizer service and domain errors.
- Create: `apps/api/src/services/__tests__/promptOptimizer.test.ts` - optimizer service tests for text/image/video and errors.
- Create: `apps/api/src/routes/prompt.ts` - Fastify route for `POST /v1/prompt/optimize`.
- Create: `apps/api/src/routes/__tests__/prompt.test.ts` - route tests for success and error mapping.
- Modify: `apps/api/src/server.ts` - inject and register prompt optimizer route.
- Modify: `apps/api/src/__tests__/server.test.ts` - assert the prompt route is available on the product API.
- Create: `apps/desktop/src/studioModel.ts` - desktop studio mode metadata, templates, and local fixture optimization output.
- Create: `apps/desktop/src/__tests__/studioModel.test.ts` - desktop studio model unit tests.
- Modify: `apps/desktop/src/App.tsx` - render three-mode product-first creation shell and local optimization result.
- Modify: `apps/desktop/src/__tests__/App.test.tsx` - update shell tests for Studio UI behavior.
- Modify: `README.md` - document Stage 1 local prompt optimizer behavior and verification commands.
- Modify: `docs/architecture/mvp-skeleton.md` - document product-first Studio Shell boundary.

## Task 1: Shared Prompt Optimization Contracts

**Files:**
- Modify: `packages/shared/src/models.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/prompt.test.ts`

- [ ] **Step 1: Write the failing shared prompt contract tests**

Create `packages/shared/src/__tests__/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PromptOptimization, PromptOptimizationRequest, PromptTemplate } from "../models";

describe("prompt optimization contracts", () => {
  it("represents prompt templates for each creation mode", () => {
    const templates: PromptTemplate[] = [
      {
        id: "text-social-title",
        mode: "text",
        name: "社媒标题",
        description: "生成适合社媒传播的标题",
        tags: ["copywriting", "social"]
      },
      {
        id: "image-poster",
        mode: "image",
        name: "商业海报",
        description: "生成海报视觉提示词",
        tags: ["poster", "visual"]
      },
      {
        id: "video-short",
        mode: "video",
        name: "短视频镜头",
        description: "生成短视频镜头运动提示词",
        tags: ["short-video", "motion"]
      }
    ];

    expect(templates.map((template) => template.mode)).toEqual(["text", "image", "video"]);
  });

  it("represents a prompt optimization request", () => {
    const request: PromptOptimizationRequest = {
      mode: "image",
      prompt: "做一张咖啡店新品海报",
      templateId: "image-poster"
    };

    expect(request.mode).toBe("image");
    expect(request.templateId).toBe("image-poster");
  });

  it("represents structured optimization output with preset and credits", () => {
    const optimization: PromptOptimization = {
      id: "prompt_opt_000001",
      mode: "image",
      originalPrompt: "做一张咖啡店新品海报",
      optimizedPrompt: "为咖啡店新品制作一张商业海报，突出新品饮品、温暖店内氛围和清晰促销信息。",
      sections: [
        { label: "主体", value: "咖啡店新品饮品与品牌海报视觉" },
        { label: "负向提示词", value: "低清晰度、杂乱背景、文字变形、过曝" }
      ],
      preset: {
        modelId: "recommended-image",
        parameters: {
          aspectRatio: "4:3",
          quality: "high",
          count: 1
        },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      createdAt: "2026-06-20T00:00:00.000Z"
    };

    expect(optimization.sections).toContainEqual({
      label: "负向提示词",
      value: "低清晰度、杂乱背景、文字变形、过曝"
    });
    expect(optimization.preset.creditEstimate).toEqual({ credits: 2, unit: "credit" });
  });
});
```

- [ ] **Step 2: Run the shared prompt test to verify it fails**

Run:

```bash
pnpm --filter @gw-link-omniai/shared test -- prompt.test.ts
```

Expected: FAIL with TypeScript errors because `PromptTemplate`, `PromptOptimizationRequest`, and `PromptOptimization` are not defined.

- [ ] **Step 3: Add shared prompt contracts**

Modify `packages/shared/src/models.ts` to this complete content:

```ts
export type ModelCapability = "text" | "image" | "video";

export type CreationMode = ModelCapability;

export type ModelVisibility = "visible" | "hidden" | "maintenance";

export type PlanCode = "free" | "pro" | "studio";

export interface ProductModel {
  id: string;
  displayName: string;
  capability: ModelCapability;
  tags: string[];
  visibility: ModelVisibility;
  minimumPlan: PlanCode;
  creditUnitCost: number;
}

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

export type GenerationTaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface GenerationTask {
  id: string;
  capability: ModelCapability;
  status: GenerationTaskStatus;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  creditEstimate: CreditAmount;
}

export interface CreditAmount {
  credits: number;
  unit: "credit";
}
```

Modify `packages/shared/src/index.ts` to this complete content:

```ts
export type {
  AuthSession,
  LoginChannel,
  LoginStartRequest,
  LoginStartResponse,
  LoginVerifyRequest,
  SessionResponse,
  UserProfile
} from "./auth";
export { inferLoginChannel, maskLoginDestination } from "./auth";
export type {
  CreationMode,
  CreditAmount,
  GenerationTask,
  GenerationTaskStatus,
  ModelCapability,
  ModelVisibility,
  PlanCode,
  PresetSuggestion,
  ProductModel,
  PromptOptimization,
  PromptOptimizationRequest,
  PromptSection,
  PromptTemplate
} from "./models";
export { estimateCreditCost } from "./credits";
export type { CreditEstimateInput } from "./credits";
```

- [ ] **Step 4: Run shared tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/shared test
pnpm --filter @gw-link-omniai/shared typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/models.ts packages/shared/src/index.ts packages/shared/src/__tests__/prompt.test.ts
git commit -m "feat: add shared prompt optimization contracts"
```

## Task 2: Local Prompt Optimizer Service

**Files:**
- Create: `apps/api/src/services/promptOptimizer.ts`
- Create: `apps/api/src/services/__tests__/promptOptimizer.test.ts`

- [ ] **Step 1: Write the failing prompt optimizer service tests**

Create `apps/api/src/services/__tests__/promptOptimizer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LocalPromptOptimizer, PromptOptimizationError } from "../promptOptimizer";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function createOptimizer() {
  return new LocalPromptOptimizer({
    clock: { now: () => fixedNow },
    idGenerator: () => "prompt_opt_000001"
  });
}

describe("LocalPromptOptimizer", () => {
  it("optimizes text prompts into a writing brief", () => {
    const optimizer = createOptimizer();

    expect(
      optimizer.optimizePrompt({
        mode: "text",
        prompt: "帮我写一个新品发布文案",
        templateId: "text-copywriting"
      })
    ).toEqual({
      id: "prompt_opt_000001",
      mode: "text",
      originalPrompt: "帮我写一个新品发布文案",
      optimizedPrompt: "请围绕“帮我写一个新品发布文案”生成清晰、可直接使用的文本内容，明确目标、受众、语气、格式和约束。",
      sections: [
        { label: "写作目标", value: "围绕用户需求完成可发布的文本创作" },
        { label: "目标受众", value: "个人创作者、运营人员或内容生产者" },
        { label: "语气风格", value: "清晰、具体、可执行，避免空泛表达" },
        { label: "输出格式", value: "使用分段结构，必要时包含标题、要点和行动引导" },
        { label: "关键约束", value: "保留用户原始意图：帮我写一个新品发布文案" }
      ],
      preset: {
        modelId: "recommended-text",
        parameters: {
          template: "text-copywriting",
          outputFormat: "markdown",
          tone: "clear"
        },
        creditEstimate: { credits: 1, unit: "credit" }
      },
      createdAt: "2026-06-20T00:00:00.000Z"
    });
  });

  it("optimizes image prompts into visual sections and image preset", () => {
    const optimizer = createOptimizer();
    const optimization = optimizer.optimizePrompt({
      mode: "image",
      prompt: "做一张咖啡店新品海报",
      templateId: "image-poster"
    });

    expect(optimization.mode).toBe("image");
    expect(optimization.sections.map((section) => section.label)).toEqual([
      "主体",
      "场景",
      "风格",
      "构图",
      "光照和色彩",
      "负向提示词"
    ]);
    expect(optimization.preset).toEqual({
      modelId: "recommended-image",
      parameters: {
        template: "image-poster",
        aspectRatio: "4:3",
        quality: "high",
        count: 1
      },
      creditEstimate: { credits: 2, unit: "credit" }
    });
  });

  it("optimizes video prompts into motion sections and video preset", () => {
    const optimizer = createOptimizer();
    const optimization = optimizer.optimizePrompt({
      mode: "video",
      prompt: "生成一段咖啡拉花短视频",
      templateId: "video-short"
    });

    expect(optimization.mode).toBe("video");
    expect(optimization.sections.map((section) => section.label)).toEqual([
      "主体",
      "动作",
      "镜头运动",
      "场景变化",
      "时长和比例",
      "负向约束"
    ]);
    expect(optimization.preset).toEqual({
      modelId: "recommended-video",
      parameters: {
        template: "video-short",
        durationSeconds: 6,
        aspectRatio: "16:9",
        resolution: "1080p"
      },
      creditEstimate: { credits: 3, unit: "credit" }
    });
  });

  it("rejects unsupported modes", () => {
    const optimizer = createOptimizer();

    expect(() =>
      optimizer.optimizePrompt({
        mode: "audio" as "text",
        prompt: "生成一段音频"
      })
    ).toThrow(new PromptOptimizationError("Unsupported creation mode", 400));
  });

  it("rejects empty prompts", () => {
    const optimizer = createOptimizer();

    expect(() =>
      optimizer.optimizePrompt({
        mode: "text",
        prompt: "   "
      })
    ).toThrow(new PromptOptimizationError("Prompt is required", 400));
  });

  it("rejects unknown templates", () => {
    const optimizer = createOptimizer();

    expect(() =>
      optimizer.optimizePrompt({
        mode: "image",
        prompt: "做一张海报",
        templateId: "missing-template"
      })
    ).toThrow(new PromptOptimizationError("Prompt template was not found", 404));
  });

  it("rejects templates that do not match the creation mode", () => {
    const optimizer = createOptimizer();

    expect(() =>
      optimizer.optimizePrompt({
        mode: "video",
        prompt: "生成短视频",
        templateId: "image-poster"
      })
    ).toThrow(new PromptOptimizationError("Prompt template was not found", 404));
  });
});
```

- [ ] **Step 2: Run the prompt optimizer tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- promptOptimizer.test.ts
```

Expected: FAIL because `apps/api/src/services/promptOptimizer.ts` does not exist.

- [ ] **Step 3: Implement the local prompt optimizer**

Create `apps/api/src/services/promptOptimizer.ts`:

```ts
import type {
  CreationMode,
  PromptOptimization,
  PromptOptimizationRequest,
  PromptSection,
  PromptTemplate
} from "@gw-link-omniai/shared";

export class PromptOptimizationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "PromptOptimizationError";
  }
}

export interface PromptOptimizerClock {
  now(): Date;
}

export interface PromptOptimizerOptions {
  clock?: PromptOptimizerClock;
  idGenerator?: () => string;
}

export interface PromptOptimizer {
  listTemplates(mode?: CreationMode): PromptTemplate[];
  optimizePrompt(request: PromptOptimizationRequest): PromptOptimization;
}

const promptTemplates: PromptTemplate[] = [
  {
    id: "text-copywriting",
    mode: "text",
    name: "文案创作",
    description: "把一句需求扩展为可发布的文本 brief",
    tags: ["copywriting", "brief"]
  },
  {
    id: "text-social-title",
    mode: "text",
    name: "社媒标题",
    description: "生成适合社媒传播的标题方向",
    tags: ["social", "title"]
  },
  {
    id: "image-poster",
    mode: "image",
    name: "商业海报",
    description: "生成包含主体、场景、风格和负向词的图片提示词",
    tags: ["poster", "visual"]
  },
  {
    id: "video-short",
    mode: "video",
    name: "短视频镜头",
    description: "生成包含动作、镜头和时长的短视频提示词",
    tags: ["short-video", "motion"]
  }
];

export class LocalPromptOptimizer implements PromptOptimizer {
  private readonly clock: PromptOptimizerClock;
  private readonly idGenerator: () => string;

  constructor(options: PromptOptimizerOptions = {}) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.idGenerator = options.idGenerator ?? createPromptOptimizationId;
  }

  listTemplates(mode?: CreationMode): PromptTemplate[] {
    return promptTemplates.filter((template) => !mode || template.mode === mode).map(cloneTemplate);
  }

  optimizePrompt(request: PromptOptimizationRequest): PromptOptimization {
    if (!isCreationMode(request.mode)) {
      throw new PromptOptimizationError("Unsupported creation mode", 400);
    }

    const prompt = request.prompt.trim();
    if (!prompt) {
      throw new PromptOptimizationError("Prompt is required", 400);
    }

    const template = this.resolveTemplate(request.mode, request.templateId);
    const strategy = modeStrategies[request.mode];

    return {
      id: this.idGenerator(),
      mode: request.mode,
      originalPrompt: prompt,
      optimizedPrompt: strategy.optimizedPrompt(prompt),
      sections: strategy.sections(prompt),
      preset: {
        modelId: strategy.modelId,
        parameters: {
          template: template.id,
          ...strategy.parameters
        },
        creditEstimate: strategy.creditEstimate
      },
      createdAt: this.clock.now().toISOString()
    };
  }

  private resolveTemplate(mode: CreationMode, templateId: string | undefined): PromptTemplate {
    const template = promptTemplates.find((candidate) => candidate.id === (templateId ?? defaultTemplateByMode[mode]));

    if (!template || template.mode !== mode) {
      throw new PromptOptimizationError("Prompt template was not found", 404);
    }

    return template;
  }
}

interface ModeStrategy {
  modelId: string;
  parameters: Record<string, string | number | boolean>;
  creditEstimate: { credits: number; unit: "credit" };
  optimizedPrompt(prompt: string): string;
  sections(prompt: string): PromptSection[];
}

const defaultTemplateByMode: Record<CreationMode, string> = {
  text: "text-copywriting",
  image: "image-poster",
  video: "video-short"
};

const modeStrategies: Record<CreationMode, ModeStrategy> = {
  text: {
    modelId: "recommended-text",
    parameters: {
      outputFormat: "markdown",
      tone: "clear"
    },
    creditEstimate: { credits: 1, unit: "credit" },
    optimizedPrompt: (prompt) =>
      `请围绕“${prompt}”生成清晰、可直接使用的文本内容，明确目标、受众、语气、格式和约束。`,
    sections: (prompt) => [
      { label: "写作目标", value: "围绕用户需求完成可发布的文本创作" },
      { label: "目标受众", value: "个人创作者、运营人员或内容生产者" },
      { label: "语气风格", value: "清晰、具体、可执行，避免空泛表达" },
      { label: "输出格式", value: "使用分段结构，必要时包含标题、要点和行动引导" },
      { label: "关键约束", value: `保留用户原始意图：${prompt}` }
    ]
  },
  image: {
    modelId: "recommended-image",
    parameters: {
      aspectRatio: "4:3",
      quality: "high",
      count: 1
    },
    creditEstimate: { credits: 2, unit: "credit" },
    optimizedPrompt: (prompt) => `为“${prompt}”制作一张商业级视觉图，突出主体、场景氛围、构图和清晰传播信息。`,
    sections: (prompt) => [
      { label: "主体", value: `${prompt} 的核心主体与视觉焦点` },
      { label: "场景", value: "干净、有生活感、符合商业传播的真实场景" },
      { label: "风格", value: "精致、清晰、适合社媒和营销物料使用" },
      { label: "构图", value: "主体明确，保留标题、卖点或品牌信息空间" },
      { label: "光照和色彩", value: "自然光或柔和棚拍光，色彩统一且不过度饱和" },
      { label: "负向提示词", value: "低清晰度、杂乱背景、文字变形、过曝、主体缺失" }
    ]
  },
  video: {
    modelId: "recommended-video",
    parameters: {
      durationSeconds: 6,
      aspectRatio: "16:9",
      resolution: "1080p"
    },
    creditEstimate: { credits: 3, unit: "credit" },
    optimizedPrompt: (prompt) => `围绕“${prompt}”生成一段短视频，明确主体、动作、镜头运动、场景变化和负向约束。`,
    sections: (prompt) => [
      { label: "主体", value: `${prompt} 的主要人物、物体或视觉中心` },
      { label: "动作", value: "动作连续、节奏明确，适合短视频观看" },
      { label: "镜头运动", value: "缓慢推进或平滑横移，避免剧烈抖动" },
      { label: "场景变化", value: "场景保持连贯，突出开始、过程和结束状态" },
      { label: "时长和比例", value: "约 6 秒，16:9 横版，1080p 输出" },
      { label: "负向约束", value: "画面闪烁、主体变形、动作断裂、过度模糊、低清晰度" }
    ]
  }
};

function isCreationMode(value: unknown): value is CreationMode {
  return value === "text" || value === "image" || value === "video";
}

function cloneTemplate(template: PromptTemplate): PromptTemplate {
  return {
    ...template,
    tags: [...template.tags]
  };
}

function createPromptOptimizationId(): string {
  return `prompt_opt_${Date.now().toString(36)}`;
}
```

- [ ] **Step 4: Run prompt optimizer service tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- promptOptimizer.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/promptOptimizer.ts apps/api/src/services/__tests__/promptOptimizer.test.ts
git commit -m "feat: add local prompt optimizer"
```

## Task 3: Prompt Optimization API Route

**Files:**
- Create: `apps/api/src/routes/prompt.ts`
- Create: `apps/api/src/routes/__tests__/prompt.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/server.test.ts`

- [ ] **Step 1: Write the failing prompt route tests**

Create `apps/api/src/routes/__tests__/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import { LocalPromptOptimizer } from "../../services/promptOptimizer";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function buildPromptTestServer() {
  return buildServer({
    promptOptimizer: new LocalPromptOptimizer({
      clock: { now: () => fixedNow },
      idGenerator: () => "prompt_opt_000001"
    })
  });
}

describe("prompt routes", () => {
  it("optimizes an image prompt", async () => {
    const server = buildPromptTestServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/prompt/optimize",
      payload: {
        mode: "image",
        prompt: "做一张咖啡店新品海报",
        templateId: "image-poster"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      optimization: {
        id: "prompt_opt_000001",
        mode: "image",
        originalPrompt: "做一张咖啡店新品海报",
        sections: [
          { label: "主体", value: "做一张咖啡店新品海报 的核心主体与视觉焦点" },
          { label: "场景", value: "干净、有生活感、符合商业传播的真实场景" },
          { label: "风格", value: "精致、清晰、适合社媒和营销物料使用" },
          { label: "构图", value: "主体明确，保留标题、卖点或品牌信息空间" },
          { label: "光照和色彩", value: "自然光或柔和棚拍光，色彩统一且不过度饱和" },
          { label: "负向提示词", value: "低清晰度、杂乱背景、文字变形、过曝、主体缺失" }
        ],
        preset: {
          modelId: "recommended-image",
          parameters: {
            template: "image-poster",
            aspectRatio: "4:3",
            quality: "high",
            count: 1
          },
          creditEstimate: { credits: 2, unit: "credit" }
        },
        createdAt: "2026-06-20T00:00:00.000Z"
      }
    });
  });

  it("rejects malformed optimization requests", async () => {
    const server = buildPromptTestServer();
    const invalidPayloads = [
      {},
      { mode: "image" },
      { prompt: "做一张海报" },
      { mode: "image", prompt: 123 },
      { mode: "image", prompt: "做一张海报", templateId: 123 },
      ["image", "做一张海报"]
    ];

    for (const payload of invalidPayloads) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/prompt/optimize",
        payload
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "Invalid prompt optimization request"
      });
    }
  });

  it("maps optimizer domain errors to HTTP responses", async () => {
    const server = buildPromptTestServer();
    const unsupportedMode = await server.inject({
      method: "POST",
      url: "/v1/prompt/optimize",
      payload: {
        mode: "audio",
        prompt: "生成音频"
      }
    });
    const emptyPrompt = await server.inject({
      method: "POST",
      url: "/v1/prompt/optimize",
      payload: {
        mode: "text",
        prompt: " "
      }
    });
    const missingTemplate = await server.inject({
      method: "POST",
      url: "/v1/prompt/optimize",
      payload: {
        mode: "image",
        prompt: "做一张海报",
        templateId: "missing-template"
      }
    });

    expect(unsupportedMode.statusCode).toBe(400);
    expect(unsupportedMode.json()).toEqual({ error: "Unsupported creation mode" });
    expect(emptyPrompt.statusCode).toBe(400);
    expect(emptyPrompt.json()).toEqual({ error: "Prompt is required" });
    expect(missingTemplate.statusCode).toBe(404);
    expect(missingTemplate.json()).toEqual({ error: "Prompt template was not found" });
  });
});
```

Modify `apps/api/src/__tests__/server.test.ts` by adding this test inside `describe("product API", () => { ... })`:

```ts
  it("registers the prompt optimization route", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/prompt/optimize",
      payload: {
        mode: "text",
        prompt: "帮我写一个新品发布文案"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      optimization: {
        mode: "text",
        originalPrompt: "帮我写一个新品发布文案",
        preset: {
          modelId: "recommended-text",
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });
  });
```

- [ ] **Step 2: Run prompt route tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- prompt.test.ts
pnpm --filter @gw-link-omniai/api test -- server.test.ts
```

Expected: FAIL because `/v1/prompt/optimize` is not registered and `BuildServerOptions.promptOptimizer` does not exist.

- [ ] **Step 3: Implement the prompt route**

Create `apps/api/src/routes/prompt.ts`:

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import type { PromptOptimizationRequest } from "@gw-link-omniai/shared";
import { PromptOptimizationError, type PromptOptimizer } from "../services/promptOptimizer";

export function registerPromptRoutes(server: FastifyInstance, promptOptimizer: PromptOptimizer): void {
  server.post("/v1/prompt/optimize", async (request, reply) => {
    const optimizationRequest = readPromptOptimizationRequest(request.body);

    if (!optimizationRequest) {
      return sendBadRequest(reply);
    }

    try {
      const optimization = promptOptimizer.optimizePrompt(optimizationRequest);
      return { optimization };
    } catch (error) {
      return sendPromptOptimizationError(reply, error);
    }
  });
}

function readPromptOptimizationRequest(body: unknown): PromptOptimizationRequest | undefined {
  if (!isRequestBody(body) || typeof body.mode !== "string" || typeof body.prompt !== "string") {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(body, "templateId") && typeof body.templateId !== "string") {
    return undefined;
  }

  return {
    mode: body.mode as PromptOptimizationRequest["mode"],
    prompt: body.prompt,
    ...(typeof body.templateId === "string" ? { templateId: body.templateId } : {})
  };
}

function isRequestBody(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

function sendBadRequest(reply: FastifyReply) {
  return reply.status(400).send({
    error: "Invalid prompt optimization request"
  });
}

function sendPromptOptimizationError(reply: FastifyReply, error: unknown) {
  if (error instanceof PromptOptimizationError) {
    return reply.status(error.statusCode).send({
      error: error.message
    });
  }

  return reply.status(500).send({
    error: "Unexpected prompt optimization error"
  });
}
```

- [ ] **Step 4: Register prompt routes in the server**

Modify `apps/api/src/server.ts` to this complete content:

```ts
import Fastify from "fastify";
import { loadConfig, type ApiConfig } from "./config";
import { registerAuthRoutes } from "./routes/auth";
import { registerHealthRoute } from "./routes/health";
import { registerModelRoutes } from "./routes/models";
import { registerPromptRoutes } from "./routes/prompt";
import { InMemoryAuthService, type AuthService } from "./services/authService";
import { LocalPromptOptimizer, type PromptOptimizer } from "./services/promptOptimizer";

export interface BuildServerOptions {
  authService?: AuthService;
  config?: ApiConfig;
  promptOptimizer?: PromptOptimizer;
}

export function buildServer(options: BuildServerOptions = {}) {
  const config = options.config ?? loadConfig();
  const server = Fastify({
    logger: false
  });
  const authService =
    options.authService ??
    new InMemoryAuthService({
      devCodesEnabled: config.authDevCodesEnabled
    });
  const promptOptimizer = options.promptOptimizer ?? new LocalPromptOptimizer();

  registerHealthRoute(server);
  registerModelRoutes(server);
  registerPromptRoutes(server, promptOptimizer);
  registerAuthRoutes(server, authService);

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const server = buildServer({ config });

  await server.listen({
    port: config.port,
    host: "0.0.0.0"
  });

  console.log(`GW-LINK OmniAI API listening on ${config.port}`);
}
```

- [ ] **Step 5: Run API route tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- prompt.test.ts
pnpm --filter @gw-link-omniai/api test -- server.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/prompt.ts apps/api/src/routes/__tests__/prompt.test.ts apps/api/src/server.ts apps/api/src/__tests__/server.test.ts
git commit -m "feat: expose prompt optimization API"
```

## Task 4: Desktop Studio View Model

**Files:**
- Create: `apps/desktop/src/studioModel.ts`
- Create: `apps/desktop/src/__tests__/studioModel.test.ts`

- [ ] **Step 1: Write the failing desktop studio model tests**

Create `apps/desktop/src/__tests__/studioModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getFixtureOptimization,
  getStudioModeContent,
  getStudioModes,
  getStudioTemplates
} from "../studioModel";

describe("studioModel", () => {
  it("defines the three product-first studio modes", () => {
    expect(getStudioModes().map((mode) => mode.mode)).toEqual(["text", "image", "video"]);
    expect(getStudioModes().map((mode) => mode.title)).toEqual(["文本创作", "图片创作", "视频创作"]);
  });

  it("returns mode-specific prompt labels and placeholders", () => {
    expect(getStudioModeContent("text")).toMatchObject({
      promptLabel: "文本创作需求",
      promptPlaceholder: "例如：帮我写一个咖啡店新品发布文案"
    });
    expect(getStudioModeContent("image")).toMatchObject({
      promptLabel: "图片创作需求",
      promptPlaceholder: "例如：做一张咖啡店新品海报"
    });
    expect(getStudioModeContent("video")).toMatchObject({
      promptLabel: "视频创作需求",
      promptPlaceholder: "例如：生成一段咖啡拉花短视频"
    });
  });

  it("returns templates for the active mode", () => {
    expect(getStudioTemplates("image")).toEqual([
      {
        id: "image-poster",
        mode: "image",
        name: "商业海报",
        description: "拆解主体、场景、风格、构图和负向提示词",
        tags: ["poster", "visual"]
      }
    ]);
  });

  it("returns a local fixture optimization for each mode", () => {
    expect(getFixtureOptimization("text")).toMatchObject({
      mode: "text",
      preset: {
        modelId: "recommended-text",
        creditEstimate: { credits: 1, unit: "credit" }
      }
    });
    expect(getFixtureOptimization("image").sections.map((section) => section.label)).toContain("负向提示词");
    expect(getFixtureOptimization("video").sections.map((section) => section.label)).toContain("镜头运动");
  });
});
```

- [ ] **Step 2: Run the studio model tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- studioModel.test.ts
```

Expected: FAIL because `apps/desktop/src/studioModel.ts` does not exist.

- [ ] **Step 3: Implement the desktop studio model**

Create `apps/desktop/src/studioModel.ts`:

```ts
import type { CreationMode, PromptOptimization, PromptTemplate } from "@gw-link-omniai/shared";

export interface StudioModeContent {
  mode: CreationMode;
  title: string;
  description: string;
  promptLabel: string;
  promptPlaceholder: string;
}

const studioModes: StudioModeContent[] = [
  {
    mode: "text",
    title: "文本创作",
    description: "借鉴会话式文本创作体验，将想法整理成可发布内容。",
    promptLabel: "文本创作需求",
    promptPlaceholder: "例如：帮我写一个咖啡店新品发布文案"
  },
  {
    mode: "image",
    title: "图片创作",
    description: "借鉴视觉创作参数面板，将一句话拆解成图像提示词和生成参数。",
    promptLabel: "图片创作需求",
    promptPlaceholder: "例如：做一张咖啡店新品海报"
  },
  {
    mode: "video",
    title: "视频创作",
    description: "借鉴任务化视频工作流，将需求整理成动作、镜头和时长参数。",
    promptLabel: "视频创作需求",
    promptPlaceholder: "例如：生成一段咖啡拉花短视频"
  }
];

const studioTemplates: PromptTemplate[] = [
  {
    id: "text-copywriting",
    mode: "text",
    name: "文案创作",
    description: "整理目标、受众、语气、格式和约束",
    tags: ["copywriting", "brief"]
  },
  {
    id: "image-poster",
    mode: "image",
    name: "商业海报",
    description: "拆解主体、场景、风格、构图和负向提示词",
    tags: ["poster", "visual"]
  },
  {
    id: "video-short",
    mode: "video",
    name: "短视频镜头",
    description: "拆解主体、动作、镜头运动、场景变化和负向约束",
    tags: ["short-video", "motion"]
  }
];

const fixtureOptimizations: Record<CreationMode, PromptOptimization> = {
  text: {
    id: "prompt_opt_demo_text",
    mode: "text",
    originalPrompt: "帮我写一个咖啡店新品发布文案",
    optimizedPrompt: "请围绕“咖啡店新品发布”生成清晰、可直接发布的文案，明确目标受众、语气、卖点和行动引导。",
    sections: [
      { label: "写作目标", value: "完成一段可发布的新品宣传文案" },
      { label: "目标受众", value: "附近白领、学生和咖啡爱好者" },
      { label: "语气风格", value: "温暖、清晰、有吸引力" },
      { label: "输出格式", value: "标题、正文、卖点、行动引导" },
      { label: "关键约束", value: "突出新品和到店转化" }
    ],
    preset: {
      modelId: "recommended-text",
      parameters: {
        outputFormat: "markdown",
        tone: "clear"
      },
      creditEstimate: { credits: 1, unit: "credit" }
    },
    createdAt: "2026-06-20T00:00:00.000Z"
  },
  image: {
    id: "prompt_opt_demo_image",
    mode: "image",
    originalPrompt: "做一张咖啡店新品海报",
    optimizedPrompt: "为咖啡店新品制作一张商业海报，突出新品饮品、温暖店内氛围和清晰促销信息。",
    sections: [
      { label: "主体", value: "咖啡店新品饮品与品牌海报视觉" },
      { label: "场景", value: "温暖、干净、有生活感的咖啡店环境" },
      { label: "风格", value: "商业海报、精致、适合社媒传播" },
      { label: "构图", value: "主体居中，保留标题和价格信息空间" },
      { label: "光照和色彩", value: "暖色自然光，咖啡棕与奶油白为主" },
      { label: "负向提示词", value: "低清晰度、杂乱背景、文字变形、过曝" }
    ],
    preset: {
      modelId: "recommended-image",
      parameters: {
        aspectRatio: "4:3",
        quality: "high",
        count: 1
      },
      creditEstimate: { credits: 2, unit: "credit" }
    },
    createdAt: "2026-06-20T00:00:00.000Z"
  },
  video: {
    id: "prompt_opt_demo_video",
    mode: "video",
    originalPrompt: "生成一段咖啡拉花短视频",
    optimizedPrompt: "围绕咖啡拉花过程生成一段短视频，明确主体、动作、镜头推进、场景变化和负向约束。",
    sections: [
      { label: "主体", value: "咖啡杯、拉花手部动作和奶泡纹理" },
      { label: "动作", value: "奶流缓慢注入，形成清晰拉花图案" },
      { label: "镜头运动", value: "从杯口上方缓慢推进到成品特写" },
      { label: "场景变化", value: "从准备动作过渡到成品展示" },
      { label: "时长和比例", value: "约 6 秒，16:9 横版，1080p 输出" },
      { label: "负向约束", value: "画面闪烁、主体变形、动作断裂、低清晰度" }
    ],
    preset: {
      modelId: "recommended-video",
      parameters: {
        durationSeconds: 6,
        aspectRatio: "16:9",
        resolution: "1080p"
      },
      creditEstimate: { credits: 3, unit: "credit" }
    },
    createdAt: "2026-06-20T00:00:00.000Z"
  }
};

export function getStudioModes(): StudioModeContent[] {
  return studioModes.map((mode) => ({ ...mode }));
}

export function getStudioModeContent(mode: CreationMode): StudioModeContent {
  const content = studioModes.find((candidate) => candidate.mode === mode);

  if (!content) {
    return studioModes[0];
  }

  return { ...content };
}

export function getStudioTemplates(mode: CreationMode): PromptTemplate[] {
  return studioTemplates.filter((template) => template.mode === mode).map((template) => ({ ...template, tags: [...template.tags] }));
}

export function getFixtureOptimization(mode: CreationMode): PromptOptimization {
  const optimization = fixtureOptimizations[mode];

  return {
    ...optimization,
    sections: optimization.sections.map((section) => ({ ...section })),
    preset: {
      ...optimization.preset,
      parameters: { ...optimization.preset.parameters },
      creditEstimate: { ...optimization.preset.creditEstimate }
    }
  };
}
```

- [ ] **Step 4: Run desktop studio model tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- studioModel.test.ts
pnpm --filter @gw-link-omniai/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/studioModel.ts apps/desktop/src/__tests__/studioModel.test.ts
git commit -m "feat: add desktop studio model"
```

## Task 5: Desktop Studio Shell UI

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/__tests__/App.test.tsx`

- [ ] **Step 1: Write the failing desktop app tests**

Modify `apps/desktop/src/__tests__/App.test.tsx` to this complete content:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { getDesktopSessionCta } from "../sessionModel";

describe("Desktop App", () => {
  it("renders the product-first studio shell and sign-in entry", () => {
    render(<App />);

    expect(screen.getByText("GW-LINK OmniAI")).toBeTruthy();
    expect(screen.getByRole("button", { name: "文本创作" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "图片创作" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "视频创作" })).toBeTruthy();
    expect(screen.getByText("Sign in")).toBeTruthy();
  });

  it("shows Text Studio by default with prompt optimization result", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "文本创作" })).toBeTruthy();
    expect(screen.getByLabelText("文本创作需求")).toBeTruthy();
    expect(screen.getByText("写作目标")).toBeTruthy();
    expect(screen.getByText("recommended-text")).toBeTruthy();
    expect(screen.getByText("预计点数：1 credit")).toBeTruthy();
  });

  it("switches to Image Studio and shows visual prompt sections", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "图片创作" }));

    expect(screen.getByRole("heading", { name: "图片创作" })).toBeTruthy();
    expect(screen.getByLabelText("图片创作需求")).toBeTruthy();
    expect(screen.getByText("负向提示词")).toBeTruthy();
    expect(screen.getByText("recommended-image")).toBeTruthy();
    expect(screen.getByText("预计点数：2 credits")).toBeTruthy();
  });

  it("switches to Video Studio and shows motion prompt sections", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "视频创作" }));

    const result = screen.getByLabelText("提示词优化结果");
    expect(screen.getByRole("heading", { name: "视频创作" })).toBeTruthy();
    expect(screen.getByLabelText("视频创作需求")).toBeTruthy();
    expect(within(result).getByText("镜头运动")).toBeTruthy();
    expect(within(result).getByText("recommended-video")).toBeTruthy();
    expect(screen.getByRole("button", { name: "提交生成（待接入）" })).toHaveProperty("disabled", true);
  });

  it("summarizes authenticated desktop sessions", () => {
    expect(
      getDesktopSessionCta({
        authenticated: true,
        expiresAt: "2026-06-26T12:00:00.000Z",
        user: {
          id: "user_email_creator_example_com",
          displayName: "creator",
          destination: "creator@example.com",
          channel: "email",
          plan: "free",
          createdAt: "2026-06-19T12:00:00.000Z"
        }
      })
    ).toBe("Signed in as creator");
  });
});
```

- [ ] **Step 2: Run desktop app tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- App.test.tsx
```

Expected: FAIL because the current `App.tsx` still renders the old English mode buttons and no prompt optimization result.

- [ ] **Step 3: Implement the Studio Shell UI**

Modify `apps/desktop/src/App.tsx` to this complete content:

```tsx
import { useMemo, useState } from "react";
import type { CreationMode } from "@gw-link-omniai/shared";
import { getDesktopSessionCta } from "./sessionModel";
import { getFixtureOptimization, getStudioModeContent, getStudioModes, getStudioTemplates } from "./studioModel";

const anonymousSession = {
  authenticated: false,
  user: null,
  expiresAt: null
} as const;

export function App() {
  const [selectedMode, setSelectedMode] = useState<CreationMode>("text");
  const studioModes = getStudioModes();
  const content = getStudioModeContent(selectedMode);
  const templates = getStudioTemplates(selectedMode);
  const optimization = useMemo(() => getFixtureOptimization(selectedMode), [selectedMode]);

  return (
    <main>
      <header>
        <h1>GW-LINK OmniAI</h1>
        <button type="button">{getDesktopSessionCta(anonymousSession)}</button>
      </header>

      <section aria-labelledby="workspace-title">
        <h2 id="workspace-title">全域智能创作台</h2>
        <p>围绕文字、图片、视频生产流程优化提示词，再进入生成任务和资产库。</p>
      </section>

      <nav aria-label="Studio modes">
        {studioModes.map((mode) => (
          <button
            key={mode.mode}
            type="button"
            aria-pressed={mode.mode === selectedMode}
            onClick={() => setSelectedMode(mode.mode)}
          >
            {mode.title}
          </button>
        ))}
      </nav>

      <section aria-labelledby="studio-title">
        <h2 id="studio-title">{content.title}</h2>
        <p>{content.description}</p>

        <label htmlFor="studio-prompt">{content.promptLabel}</label>
        <textarea
          key={selectedMode}
          id="studio-prompt"
          name="prompt"
          placeholder={content.promptPlaceholder}
          defaultValue={optimization.originalPrompt}
        />

        <section aria-label="提示词模板">
          <h3>提示词模板</h3>
          {templates.map((template) => (
            <article key={template.id}>
              <h4>{template.name}</h4>
              <p>{template.description}</p>
              <small>{template.tags.join(" / ")}</small>
            </article>
          ))}
        </section>

        <button type="button">优化提示词</button>
      </section>

      <section aria-label="提示词优化结果">
        <h3>优化结果</h3>
        <p>{optimization.optimizedPrompt}</p>

        <dl>
          {optimization.sections.map((section) => (
            <div key={section.label}>
              <dt>{section.label}</dt>
              <dd>{section.value}</dd>
            </div>
          ))}
        </dl>

        <section aria-label="推荐参数">
          <h3>推荐参数</h3>
          <p>{optimization.preset.modelId}</p>
          <ul>
            {Object.entries(optimization.preset.parameters).map(([key, value]) => (
              <li key={key}>
                {key}: {String(value)}
              </li>
            ))}
          </ul>
          <p>
            预计点数：{optimization.preset.creditEstimate.credits}{" "}
            {optimization.preset.creditEstimate.credits === 1 ? "credit" : "credits"}
          </p>
        </section>

        <button type="button" disabled>
          提交生成（待接入）
        </button>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run desktop app tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- App.test.tsx
pnpm --filter @gw-link-omniai/desktop test
pnpm --filter @gw-link-omniai/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
git commit -m "feat: render studio prompt optimizer shell"
```

## Task 6: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update README**

Add this section to `README.md` near the API or product documentation:

````md
### Studio Shell and Prompt Optimizer

The first product-first slice is the Studio Shell + Prompt Optimizer MVP.

- Desktop exposes three creation modes: text, image, and video.
- Each mode has a prompt optimization experience.
- `POST /v1/prompt/optimize` returns deterministic local optimization output.
- The optimizer does not call real AI providers or external networks in this stage.
- Generation task submission, asset storage, and real provider adapters are later slices.

Example:

```bash
curl -s -X POST http://localhost:8787/v1/prompt/optimize \
  -H 'content-type: application/json' \
  -d '{"mode":"image","prompt":"做一张咖啡店新品海报","templateId":"image-poster"}'
```
````

- [ ] **Step 2: Update architecture documentation**

Add this section to `docs/architecture/mvp-skeleton.md` after `Auth Session Slice`:

```md
## Product-First Studio Slice

The Studio Shell + Prompt Optimizer slice puts the product workflow ahead of provider integration. Desktop users see text, image, and video creation modes, each with mode-specific prompt guidance and deterministic optimization output.

The API exposes `/v1/prompt/optimize` through a local rule-based optimizer. It returns structured sections, a recommended preset, and a credit estimate without calling real AI providers or external networks.

This slice intentionally leaves generation task submission, asset persistence, billing mutations, and real provider adapters for later stages. Gateway integration must plug into the product workflow instead of driving the product architecture.
```

- [ ] **Step 3: Run full workspace verification**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document studio prompt optimizer slice"
```

## Final Review Checklist

- [ ] Shared prompt contracts are exported from `@gw-link-omniai/shared`.
- [ ] API optimizer returns text/image/video structured results without network calls.
- [ ] `/v1/prompt/optimize` returns stable HTTP errors for malformed request, unsupported mode, empty prompt, and missing template.
- [ ] Desktop shell presents text, image, and video creation as the primary product surface.
- [ ] Desktop shell shows sections, preset, and credit estimate for the selected mode.
- [ ] Generation submission is visibly unavailable in Stage 1.
- [ ] Documentation states gateway/provider work is later-stage integration.
- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
