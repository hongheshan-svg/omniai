# GW-LINK OmniAI Prompt Scenario Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared Prompt Scenario Studio so text, image, and video prompt optimization use reusable production scenarios with variables, examples, section blueprints, and recommended presets.

**Architecture:** Add product-facing prompt scenario contracts and a shared scenario catalog in `packages/shared`, then refactor the API `LocalPromptOptimizer` and Desktop Studio to consume that catalog. Keep existing `PromptOptimizationRequest` compatible by treating `templateId` as the scenario id, and keep all provider details behind Stage 4 provider adapter boundaries.

**Tech Stack:** TypeScript, React, Fastify, Vitest, pnpm workspaces.

---

## Scope Check

This plan implements Stage 5 from `docs/superpowers/specs/2026-06-20-gw-link-omniai-prompt-scenario-studio-design.md`.

It deliberately does not implement real model calls, prompt evaluation, prompt version publishing, collaboration, persistence, HTTP client wiring for Desktop, or a large multilingual visual tag library.

## File Structure

- Modify: `packages/shared/src/models.ts` - add prompt scenario contracts.
- Create: `packages/shared/src/promptScenarios.ts` - shared first-party scenario catalog and defensive-copy helpers.
- Modify: `packages/shared/src/index.ts` - export scenario contracts and helpers.
- Create: `packages/shared/src/__tests__/promptScenarios.test.ts` - catalog behavior and defensive-copy tests.
- Modify: `packages/shared/src/__tests__/prompt.test.ts` - contract coverage for scenario-shaped prompt optimization.
- Modify: `apps/api/src/services/promptOptimizer.ts` - derive templates and optimization output from shared scenarios.
- Modify: `apps/api/src/services/__tests__/promptOptimizer.test.ts` - scenario-derived optimizer tests.
- Modify: `apps/api/src/routes/__tests__/prompt.test.ts` - route coverage for scenario-derived results.
- Modify: `apps/api/src/__tests__/server.test.ts` - server route expectation includes scenario parameter.
- Modify: `apps/desktop/src/studioModel.ts` - use shared scenarios for templates and fixture optimizations.
- Modify: `apps/desktop/src/__tests__/studioModel.test.ts` - desktop scenario helper tests.
- Modify: `apps/desktop/src/App.tsx` - render scenario cards, variables, examples, and scenario-specific output.
- Modify: `apps/desktop/src/__tests__/App.test.tsx` - scenario UI and flow tests.
- Modify: `README.md` - document Stage 5.
- Modify: `docs/architecture/mvp-skeleton.md` - document Prompt Scenario Studio slice.

## Task 1: Shared Prompt Scenario Catalog

**Files:**
- Modify: `packages/shared/src/models.ts`
- Create: `packages/shared/src/promptScenarios.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/promptScenarios.test.ts`
- Modify: `packages/shared/src/__tests__/prompt.test.ts`

- [ ] **Step 1: Write failing shared catalog tests**

Create `packages/shared/src/__tests__/promptScenarios.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getDefaultPromptScenario,
  getPromptScenario,
  listPromptScenarioTemplates,
  listPromptScenarios
} from "../promptScenarios";

const expectedScenarioIds = [
  "text-product-launch",
  "text-social-title",
  "text-live-script",
  "image-commercial-poster",
  "image-product-hero",
  "image-social-visual",
  "video-short-shot",
  "video-product-demo",
  "video-atmosphere-clip"
];

describe("prompt scenario catalog", () => {
  it("lists the first text, image, and video prompt scenarios", () => {
    expect(listPromptScenarios().map((scenario) => scenario.id)).toEqual(expectedScenarioIds);
  });

  it("filters scenarios by creation mode", () => {
    expect(listPromptScenarios("image").map((scenario) => scenario.id)).toEqual([
      "image-commercial-poster",
      "image-product-hero",
      "image-social-visual"
    ]);
    expect(listPromptScenarios("image").every((scenario) => scenario.mode === "image")).toBe(true);
  });

  it("returns default scenarios for each creation mode", () => {
    expect(getDefaultPromptScenario("text")).toMatchObject({
      id: "text-product-launch",
      defaultPreset: {
        modelId: "gw-text-balanced",
        parameters: {
          outputFormat: "markdown",
          tone: "warm",
          channel: "launch"
        },
        creditEstimate: { credits: 1, unit: "credit" }
      }
    });
    expect(getDefaultPromptScenario("image")).toMatchObject({
      id: "image-commercial-poster",
      defaultPreset: {
        modelId: "gw-image-creative",
        parameters: {
          aspectRatio: "4:3",
          quality: "high",
          count: 1
        },
        creditEstimate: { credits: 2, unit: "credit" }
      }
    });
    expect(getDefaultPromptScenario("video")).toMatchObject({
      id: "video-short-shot",
      defaultPreset: {
        modelId: "gw-video-motion",
        parameters: {
          durationSeconds: 6,
          aspectRatio: "16:9",
          resolution: "1080p"
        },
        creditEstimate: { credits: 18, unit: "credit" }
      }
    });
  });

  it("returns undefined for unknown scenario ids", () => {
    expect(getPromptScenario("missing-scenario")).toBeUndefined();
  });

  it("derives prompt templates from scenarios", () => {
    expect(listPromptScenarioTemplates("text")).toEqual([
      {
        id: "text-product-launch",
        mode: "text",
        name: "新品发布文案",
        description: "整理卖点、受众、语气和发布渠道，生成可直接使用的新品发布内容。",
        tags: ["copywriting", "launch", "brief"]
      },
      {
        id: "text-social-title",
        mode: "text",
        name: "社媒标题",
        description: "为社媒内容生成多个清晰、有传播力且不过度夸张的标题方向。",
        tags: ["social", "title", "hook"]
      },
      {
        id: "text-live-script",
        mode: "text",
        name: "直播脚本",
        description: "把直播主题拆成开场、卖点、互动、转化和收尾脚本。",
        tags: ["live", "script", "conversion"]
      }
    ]);
  });

  it("returns defensive copies", () => {
    const scenario = getDefaultPromptScenario("image");
    scenario.tags.push("mutated");
    scenario.variables[0]!.label = "mutated";
    scenario.examples[0]!.input = "mutated";
    scenario.sectionBlueprints[0]!.guidance = "mutated";
    scenario.defaultPreset.parameters.quality = "mutated";
    scenario.defaultPreset.creditEstimate.credits = 999;

    const freshScenario = getDefaultPromptScenario("image");
    expect(freshScenario.tags).toEqual(["poster", "visual", "marketing"]);
    expect(freshScenario.variables[0]).toMatchObject({ id: "subject", label: "主体" });
    expect(freshScenario.examples[0]).toMatchObject({ input: "做一张咖啡店新品海报" });
    expect(freshScenario.sectionBlueprints[0]).toMatchObject({ label: "主体" });
    expect(freshScenario.defaultPreset.parameters).toMatchObject({ quality: "high" });
    expect(freshScenario.defaultPreset.creditEstimate).toEqual({ credits: 2, unit: "credit" });
  });
});
```

Modify `packages/shared/src/__tests__/prompt.test.ts` with a scenario contract test:

```ts
import type {
  PromptOptimization,
  PromptOptimizationRequest,
  PromptScenario,
  PromptTemplate
} from "..";
```

Add:

```ts
  it("represents reusable prompt scenarios with variables and examples", () => {
    const scenario: PromptScenario = {
      id: "image-commercial-poster",
      mode: "image",
      name: "商业海报",
      description: "把视觉目标拆成主体、场景、构图、光照和负向约束。",
      tags: ["poster", "visual", "marketing"],
      variables: [
        {
          id: "subject",
          label: "主体",
          description: "画面中最重要的人、物或产品。",
          required: true,
          placeholder: "例如：新品咖啡杯与拉花"
        }
      ],
      examples: [{ input: "做一张咖啡店新品海报", note: "适合新品营销视觉" }],
      sectionBlueprints: [{ label: "主体", guidance: "明确核心视觉焦点" }],
      defaultPreset: {
        modelId: "gw-image-creative",
        parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
        creditEstimate: { credits: 2, unit: "credit" }
      }
    };

    expect(scenario.variables[0].required).toBe(true);
    expect(scenario.examples[0].input).toBe("做一张咖啡店新品海报");
    expect(scenario.defaultPreset.modelId).toBe("gw-image-creative");
  });
```

- [ ] **Step 2: Run shared tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/shared test -- promptScenarios.test.ts prompt.test.ts
```

Expected: FAIL because `promptScenarios.ts` and `PromptScenario` exports do not exist.

- [ ] **Step 3: Add shared contracts**

Modify `packages/shared/src/models.ts` after `PromptTemplate`:

```ts
export interface PromptScenarioVariable {
  id: string;
  label: string;
  description: string;
  required: boolean;
  placeholder: string;
}

export interface PromptScenarioExample {
  input: string;
  note: string;
}

export interface PromptSectionBlueprint {
  label: string;
  guidance: string;
}

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

- [ ] **Step 4: Add scenario catalog implementation**

Create `packages/shared/src/promptScenarios.ts`:

```ts
import type {
  CreationMode,
  PromptScenario,
  PromptScenarioExample,
  PromptScenarioVariable,
  PromptSectionBlueprint,
  PromptTemplate,
  PresetSuggestion
} from "./models";

const promptScenarios: PromptScenario[] = [
  {
    id: "text-product-launch",
    mode: "text",
    name: "新品发布文案",
    description: "整理卖点、受众、语气和发布渠道，生成可直接使用的新品发布内容。",
    tags: ["copywriting", "launch", "brief"],
    variables: [
      {
        id: "audience",
        label: "目标受众",
        description: "这段内容要影响的人群。",
        required: true,
        placeholder: "例如：喜欢精品咖啡与社交分享的年轻消费者"
      },
      {
        id: "sellingPoint",
        label: "核心卖点",
        description: "新品最值得被记住的一句话。",
        required: true,
        placeholder: "例如：冷萃咖啡加入季节限定果香"
      },
      {
        id: "tone",
        label: "语气",
        description: "文案读起来应该像什么品牌人格。",
        required: false,
        placeholder: "例如：温暖、轻盈、有画面感"
      }
    ],
    examples: [
      { input: "帮我写一个咖啡店新品发布文案", note: "适合新品上市、门店活动和社媒发布" }
    ],
    sectionBlueprints: [
      { label: "写作目标", guidance: "说明这段内容要完成的传播任务" },
      { label: "目标受众", guidance: "明确最应该被打动的人群" },
      { label: "核心卖点", guidance: "提炼新品最重要的购买理由" },
      { label: "语气风格", guidance: "约束文案的品牌口吻和表达密度" },
      { label: "输出格式", guidance: "给出标题、正文和行动引导结构" }
    ],
    defaultPreset: {
      modelId: "gw-text-balanced",
      parameters: { outputFormat: "markdown", tone: "warm", channel: "launch" },
      creditEstimate: { credits: 1, unit: "credit" }
    }
  },
  {
    id: "text-social-title",
    mode: "text",
    name: "社媒标题",
    description: "为社媒内容生成多个清晰、有传播力且不过度夸张的标题方向。",
    tags: ["social", "title", "hook"],
    variables: [
      {
        id: "platform",
        label: "发布平台",
        description: "标题要适配的内容平台。",
        required: true,
        placeholder: "例如：小红书、公众号、短视频封面"
      },
      {
        id: "angle",
        label: "传播角度",
        description: "标题要主打的信息角度。",
        required: true,
        placeholder: "例如：新品尝鲜、限时优惠、真实体验"
      },
      {
        id: "constraint",
        label: "约束",
        description: "标题需要避免或遵守的规则。",
        required: false,
        placeholder: "例如：不要标题党，控制在 18 字以内"
      }
    ],
    examples: [
      { input: "给咖啡店新品活动写 5 个小红书标题", note: "适合社媒封面、笔记标题和活动预热" }
    ],
    sectionBlueprints: [
      { label: "平台语境", guidance: "说明标题适配的渠道和阅读场景" },
      { label: "标题方向", guidance: "输出不同传播角度的标题候选" },
      { label: "情绪钩子", guidance: "说明每个标题吸引点击的原因" },
      { label: "合规约束", guidance: "避免夸大、虚假承诺或过度营销" }
    ],
    defaultPreset: {
      modelId: "gw-text-balanced",
      parameters: { outputFormat: "list", tone: "clear", variants: 5 },
      creditEstimate: { credits: 1, unit: "credit" }
    }
  },
  {
    id: "text-live-script",
    mode: "text",
    name: "直播脚本",
    description: "把直播主题拆成开场、卖点、互动、转化和收尾脚本。",
    tags: ["live", "script", "conversion"],
    variables: [
      {
        id: "product",
        label: "产品",
        description: "直播要介绍的商品或服务。",
        required: true,
        placeholder: "例如：咖啡店季节限定饮品"
      },
      {
        id: "offer",
        label: "优惠机制",
        description: "直播间用户可以获得的行动理由。",
        required: false,
        placeholder: "例如：前 50 单赠送甜点"
      },
      {
        id: "duration",
        label: "脚本长度",
        description: "直播话术希望覆盖的时间。",
        required: false,
        placeholder: "例如：3 分钟开场话术"
      }
    ],
    examples: [
      { input: "给咖啡店新品写一段 3 分钟直播开场脚本", note: "适合直播带货、门店活动和新品介绍" }
    ],
    sectionBlueprints: [
      { label: "开场吸引", guidance: "快速说明直播主题和用户利益" },
      { label: "卖点展开", guidance: "按用户关心的问题组织产品卖点" },
      { label: "互动设计", guidance: "加入评论、提问或投票提示" },
      { label: "转化引导", guidance: "给出清晰但不过度催促的行动指令" },
      { label: "收尾提醒", guidance: "总结优惠、时间和下一步动作" }
    ],
    defaultPreset: {
      modelId: "gw-text-balanced",
      parameters: { outputFormat: "script", tone: "energetic", durationMinutes: 3 },
      creditEstimate: { credits: 1, unit: "credit" }
    }
  },
  {
    id: "image-commercial-poster",
    mode: "image",
    name: "商业海报",
    description: "把视觉目标拆成主体、场景、构图、光照和负向约束。",
    tags: ["poster", "visual", "marketing"],
    variables: [
      {
        id: "subject",
        label: "主体",
        description: "画面中最重要的人、物或产品。",
        required: true,
        placeholder: "例如：新品咖啡杯与拉花"
      },
      {
        id: "scene",
        label: "场景",
        description: "主体所在的空间和背景。",
        required: true,
        placeholder: "例如：明亮咖啡店吧台或木质桌面"
      },
      {
        id: "layout",
        label: "版式",
        description: "是否需要为标题、卖点或品牌信息预留空间。",
        required: false,
        placeholder: "例如：顶部预留标题区域"
      }
    ],
    examples: [
      { input: "做一张咖啡店新品海报", note: "适合新品营销、社媒传播和门店物料" }
    ],
    sectionBlueprints: [
      { label: "主体", guidance: "明确核心主体与视觉焦点" },
      { label: "场景", guidance: "描述背景空间、材质和环境氛围" },
      { label: "构图", guidance: "说明主体位置、留白和信息层级" },
      { label: "光照和色彩", guidance: "给出光源、色调和商业质感" },
      { label: "负向提示词", guidance: "列出需要避免的画面问题" }
    ],
    defaultPreset: {
      modelId: "gw-image-creative",
      parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
      creditEstimate: { credits: 2, unit: "credit" }
    }
  },
  {
    id: "image-product-hero",
    mode: "image",
    name: "产品主图",
    description: "为商品详情页或广告位生成干净、可信、突出质感的产品主图提示词。",
    tags: ["product", "hero", "ecommerce"],
    variables: [
      {
        id: "product",
        label: "产品",
        description: "需要被突出展示的产品。",
        required: true,
        placeholder: "例如：玻璃瓶装冷萃咖啡"
      },
      {
        id: "surface",
        label: "承载环境",
        description: "产品放置的台面、背景或道具。",
        required: false,
        placeholder: "例如：浅色石材台面和少量咖啡豆"
      },
      {
        id: "style",
        label: "视觉风格",
        description: "希望呈现的商业摄影风格。",
        required: false,
        placeholder: "例如：高级、干净、棚拍质感"
      }
    ],
    examples: [
      { input: "生成一张冷萃咖啡产品主图", note: "适合商品详情页、广告首图和投放素材" }
    ],
    sectionBlueprints: [
      { label: "产品焦点", guidance: "突出产品形态、包装和质感" },
      { label: "背景道具", guidance: "控制背景元素，避免抢主体" },
      { label: "摄影质感", guidance: "说明镜头、光照和商业摄影语言" },
      { label: "画面用途", guidance: "说明适合广告位或商品页的留白需求" },
      { label: "负向提示词", guidance: "避免变形、污渍、错误文字和廉价质感" }
    ],
    defaultPreset: {
      modelId: "gw-image-creative",
      parameters: { aspectRatio: "1:1", quality: "high", count: 1 },
      creditEstimate: { credits: 2, unit: "credit" }
    }
  },
  {
    id: "image-social-visual",
    mode: "image",
    name: "社媒视觉",
    description: "生成适合信息流浏览的社媒配图，强调识别度、情绪和传播语境。",
    tags: ["social", "visual", "feed"],
    variables: [
      {
        id: "topic",
        label: "主题",
        description: "这张图要表达的内容主题。",
        required: true,
        placeholder: "例如：周末咖啡放松时刻"
      },
      {
        id: "emotion",
        label: "情绪",
        description: "图像希望激发的情绪。",
        required: true,
        placeholder: "例如：松弛、温暖、想收藏"
      },
      {
        id: "platform",
        label: "平台",
        description: "图片主要发布的平台。",
        required: false,
        placeholder: "例如：小红书信息流"
      }
    ],
    examples: [
      { input: "做一张周末咖啡主题的小红书配图", note: "适合内容封面、活动预热和社媒氛围图" }
    ],
    sectionBlueprints: [
      { label: "内容主题", guidance: "明确图像传递的核心信息" },
      { label: "情绪氛围", guidance: "描述色彩、表情和场景情绪" },
      { label: "社媒构图", guidance: "保证缩略图识别度和主体清晰" },
      { label: "风格标签", guidance: "给出可复用的视觉风格词" },
      { label: "负向提示词", guidance: "避免信息过载、低清晰度和视觉噪音" }
    ],
    defaultPreset: {
      modelId: "gw-image-creative",
      parameters: { aspectRatio: "4:5", quality: "high", count: 1 },
      creditEstimate: { credits: 2, unit: "credit" }
    }
  },
  {
    id: "video-short-shot",
    mode: "video",
    name: "短视频镜头",
    description: "把短视频想法拆成主体、动作、镜头运动、场景变化和负向约束。",
    tags: ["short-video", "motion", "shot"],
    variables: [
      {
        id: "subject",
        label: "主体",
        description: "视频里持续被观看的对象。",
        required: true,
        placeholder: "例如：咖啡师双手和拉花图案"
      },
      {
        id: "action",
        label: "动作",
        description: "视频中发生的连续动作。",
        required: true,
        placeholder: "例如：牛奶缓慢注入，拉花自然形成"
      },
      {
        id: "camera",
        label: "镜头运动",
        description: "相机如何移动或保持稳定。",
        required: false,
        placeholder: "例如：从杯口近景缓慢推进"
      }
    ],
    examples: [
      { input: "生成一段咖啡拉花短视频", note: "适合短视频素材、产品氛围和过程展示" }
    ],
    sectionBlueprints: [
      { label: "主体", guidance: "明确视频中的视觉中心" },
      { label: "动作", guidance: "描述连续动作和节奏" },
      { label: "镜头运动", guidance: "指定推拉摇移或固定镜头" },
      { label: "场景变化", guidance: "描述开始、过程和结束状态" },
      { label: "负向约束", guidance: "避免闪烁、变形、断裂和低清晰度" }
    ],
    defaultPreset: {
      modelId: "gw-video-motion",
      parameters: { durationSeconds: 6, aspectRatio: "16:9", resolution: "1080p" },
      creditEstimate: { credits: 18, unit: "credit" }
    }
  },
  {
    id: "video-product-demo",
    mode: "video",
    name: "产品展示",
    description: "围绕产品外观、使用过程和关键卖点生成稳定的展示视频提示词。",
    tags: ["product", "demo", "video"],
    variables: [
      {
        id: "product",
        label: "产品",
        description: "视频中展示的商品或服务。",
        required: true,
        placeholder: "例如：瓶装冷萃咖啡"
      },
      {
        id: "feature",
        label: "重点卖点",
        description: "视频要重点呈现的产品特性。",
        required: true,
        placeholder: "例如：开瓶、倒入杯中、冰块和气泡"
      },
      {
        id: "ending",
        label: "结束状态",
        description: "视频最后停留的画面。",
        required: false,
        placeholder: "例如：产品与包装并排定格"
      }
    ],
    examples: [
      { input: "生成一段瓶装冷萃咖啡产品展示视频", note: "适合商品介绍、广告素材和电商详情页" }
    ],
    sectionBlueprints: [
      { label: "展示目标", guidance: "说明产品要被如何理解" },
      { label: "动作流程", guidance: "组织产品出现、使用和定格过程" },
      { label: "镜头设计", guidance: "约束镜头稳定性和特写节奏" },
      { label: "卖点呈现", guidance: "让关键特性在画面里可见" },
      { label: "负向约束", guidance: "避免产品变形、文字错乱和动作跳帧" }
    ],
    defaultPreset: {
      modelId: "gw-video-motion",
      parameters: { durationSeconds: 8, aspectRatio: "16:9", resolution: "1080p" },
      creditEstimate: { credits: 24, unit: "credit" }
    }
  },
  {
    id: "video-atmosphere-clip",
    mode: "video",
    name: "氛围片段",
    description: "生成强调情绪、空间、光影和缓慢运动的氛围视频提示词。",
    tags: ["atmosphere", "mood", "clip"],
    variables: [
      {
        id: "mood",
        label: "氛围",
        description: "视频最重要的情绪感受。",
        required: true,
        placeholder: "例如：雨天咖啡店的安静松弛感"
      },
      {
        id: "environment",
        label: "环境",
        description: "情绪发生的空间。",
        required: true,
        placeholder: "例如：窗边座位、暖光、玻璃雨滴"
      },
      {
        id: "motion",
        label: "运动节奏",
        description: "画面运动的速度和方式。",
        required: false,
        placeholder: "例如：缓慢横移，几乎静止"
      }
    ],
    examples: [
      { input: "生成一段雨天咖啡店氛围短片", note: "适合品牌情绪片、社媒背景和氛围素材" }
    ],
    sectionBlueprints: [
      { label: "情绪目标", guidance: "明确视频要传递的感受" },
      { label: "空间环境", guidance: "描述空间、天气、道具和光影" },
      { label: "镜头节奏", guidance: "控制运动速度和观看舒适度" },
      { label: "声音联想", guidance: "用视觉语言暗示环境声音或质感" },
      { label: "负向约束", guidance: "避免闪烁、突兀转场和低清晰度" }
    ],
    defaultPreset: {
      modelId: "gw-video-motion",
      parameters: { durationSeconds: 6, aspectRatio: "16:9", resolution: "1080p" },
      creditEstimate: { credits: 18, unit: "credit" }
    }
  }
];

const defaultScenarioByMode: Record<CreationMode, string> = {
  text: "text-product-launch",
  image: "image-commercial-poster",
  video: "video-short-shot"
};

export function listPromptScenarios(mode?: CreationMode): PromptScenario[] {
  return promptScenarios.filter((scenario) => mode === undefined || scenario.mode === mode).map(cloneScenario);
}

export function getPromptScenario(id: string): PromptScenario | undefined {
  const scenario = promptScenarios.find((candidate) => candidate.id === id);
  return scenario === undefined ? undefined : cloneScenario(scenario);
}

export function getDefaultPromptScenario(mode: CreationMode): PromptScenario {
  const scenario = promptScenarios.find((candidate) => candidate.id === defaultScenarioByMode[mode]);
  if (scenario === undefined) {
    throw new Error(`Default prompt scenario is not configured for mode: ${mode}`);
  }

  return cloneScenario(scenario);
}

export function listPromptScenarioTemplates(mode?: CreationMode): PromptTemplate[] {
  return listPromptScenarios(mode).map((scenario) => ({
    id: scenario.id,
    mode: scenario.mode,
    name: scenario.name,
    description: scenario.description,
    tags: [...scenario.tags]
  }));
}

function cloneScenario(scenario: PromptScenario): PromptScenario {
  return {
    ...scenario,
    tags: [...scenario.tags],
    variables: scenario.variables.map(cloneVariable),
    examples: scenario.examples.map(cloneExample),
    sectionBlueprints: scenario.sectionBlueprints.map(cloneSectionBlueprint),
    defaultPreset: clonePreset(scenario.defaultPreset)
  };
}

function cloneVariable(variable: PromptScenarioVariable): PromptScenarioVariable {
  return { ...variable };
}

function cloneExample(example: PromptScenarioExample): PromptScenarioExample {
  return { ...example };
}

function cloneSectionBlueprint(section: PromptSectionBlueprint): PromptSectionBlueprint {
  return { ...section };
}

function clonePreset(preset: PresetSuggestion): PresetSuggestion {
  return {
    modelId: preset.modelId,
    parameters: { ...preset.parameters },
    creditEstimate: { ...preset.creditEstimate }
  };
}
```

- [ ] **Step 5: Export contracts and helpers**

Modify `packages/shared/src/index.ts` so the `./models` export list includes:

```ts
  PromptScenario,
  PromptScenarioExample,
  PromptScenarioVariable,
  PromptSectionBlueprint,
```

Add exports after the credits exports:

```ts
export {
  getDefaultPromptScenario,
  getPromptScenario,
  listPromptScenarioTemplates,
  listPromptScenarios
} from "./promptScenarios";
```

- [ ] **Step 6: Run Task 1 verification**

Run:

```bash
pnpm --filter @gw-link-omniai/shared test -- promptScenarios.test.ts prompt.test.ts
pnpm --filter @gw-link-omniai/shared typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/shared/src/models.ts packages/shared/src/promptScenarios.ts packages/shared/src/index.ts packages/shared/src/__tests__/promptScenarios.test.ts packages/shared/src/__tests__/prompt.test.ts
git commit -m "feat: add shared prompt scenarios"
```

## Task 2: API Prompt Optimizer Scenario Refactor

**Files:**
- Modify: `apps/api/src/services/promptOptimizer.ts`
- Modify: `apps/api/src/services/__tests__/promptOptimizer.test.ts`

- [ ] **Step 1: Write failing API optimizer tests**

Modify `apps/api/src/services/__tests__/promptOptimizer.test.ts`.

Replace the first text optimization expectation with:

```ts
  it("optimizes text prompts through the default product launch scenario", () => {
    const optimizer = createOptimizer();

    expect(
      optimizer.optimizePrompt({
        mode: "text",
        prompt: "帮我写一个新品发布文案"
      })
    ).toEqual({
      id: "prompt_opt_000001",
      mode: "text",
      originalPrompt: "帮我写一个新品发布文案",
      optimizedPrompt:
        "围绕“帮我写一个新品发布文案”，按“新品发布文案”场景生成可直接用于生产的提示词，重点覆盖目标受众、核心卖点、语气风格。",
      sections: [
        { label: "写作目标", value: "说明这段内容要完成的传播任务：帮我写一个新品发布文案" },
        { label: "目标受众", value: "明确最应该被打动的人群：帮我写一个新品发布文案" },
        { label: "核心卖点", value: "提炼新品最重要的购买理由：帮我写一个新品发布文案" },
        { label: "语气风格", value: "约束文案的品牌口吻和表达密度：帮我写一个新品发布文案" },
        { label: "输出格式", value: "给出标题、正文和行动引导结构：帮我写一个新品发布文案" }
      ],
      preset: {
        modelId: "gw-text-balanced",
        parameters: {
          scenario: "text-product-launch",
          outputFormat: "markdown",
          tone: "warm",
          channel: "launch"
        },
        creditEstimate: { credits: 1, unit: "credit" }
      },
      createdAt: "2026-06-20T00:00:00.000Z"
    });
  });
```

Replace the image test with:

```ts
  it("optimizes image prompts through an explicit commercial poster scenario", () => {
    const optimizer = createOptimizer();
    const optimization = optimizer.optimizePrompt({
      mode: "image",
      prompt: "做一张咖啡店新品海报",
      templateId: "image-commercial-poster"
    });

    expect(optimization.mode).toBe("image");
    expect(optimization.optimizedPrompt).toBe(
      "围绕“做一张咖啡店新品海报”，按“商业海报”场景生成可直接用于生产的提示词，重点覆盖主体、场景、版式。"
    );
    expect(optimization.sections.map((section) => section.label)).toEqual([
      "主体",
      "场景",
      "构图",
      "光照和色彩",
      "负向提示词"
    ]);
    expect(optimization.sections[0]!.value).toBe("明确核心主体与视觉焦点：做一张咖啡店新品海报");
    expect(optimization.preset).toEqual({
      modelId: "gw-image-creative",
      parameters: {
        scenario: "image-commercial-poster",
        aspectRatio: "4:3",
        quality: "high",
        count: 1
      },
      creditEstimate: { credits: 2, unit: "credit" }
    });
  });
```

Replace the video test with:

```ts
  it("optimizes video prompts through the default short-shot scenario", () => {
    const optimizer = createOptimizer();
    const optimization = optimizer.optimizePrompt({
      mode: "video",
      prompt: "生成一段咖啡拉花短视频"
    });

    expect(optimization.mode).toBe("video");
    expect(optimization.sections.map((section) => section.label)).toEqual([
      "主体",
      "动作",
      "镜头运动",
      "场景变化",
      "负向约束"
    ]);
    expect(optimization.preset).toEqual({
      modelId: "gw-video-motion",
      parameters: {
        scenario: "video-short-shot",
        durationSeconds: 6,
        aspectRatio: "16:9",
        resolution: "1080p"
      },
      creditEstimate: { credits: 18, unit: "credit" }
    });
  });
```

Replace the template tag copy test expectation:

```ts
    const [secondTemplate] = optimizer.listTemplates("image");
    expect(secondTemplate!.tags).toEqual(["poster", "visual", "marketing"]);
```

Add a template-list test:

```ts
  it("lists scenario-derived templates for each mode", () => {
    const optimizer = createOptimizer();

    expect(optimizer.listTemplates("text").map((template) => template.id)).toEqual([
      "text-product-launch",
      "text-social-title",
      "text-live-script"
    ]);
    expect(optimizer.listTemplates("image").map((template) => template.id)).toEqual([
      "image-commercial-poster",
      "image-product-hero",
      "image-social-visual"
    ]);
    expect(optimizer.listTemplates("video").map((template) => template.id)).toEqual([
      "video-short-shot",
      "video-product-demo",
      "video-atmosphere-clip"
    ]);
  });
```

Update unknown/mismatched template tests to use scenario ids:

```ts
        templateId: "missing-scenario"
```

```ts
        templateId: "image-commercial-poster"
```

- [ ] **Step 2: Run optimizer tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- promptOptimizer.test.ts
```

Expected: FAIL because `LocalPromptOptimizer` still uses hardcoded `promptTemplates` and `modeStrategies`.

- [ ] **Step 3: Refactor LocalPromptOptimizer**

Modify imports in `apps/api/src/services/promptOptimizer.ts`:

```ts
import {
  getDefaultPromptScenario,
  getPromptScenario,
  listPromptScenarioTemplates,
  type CreditAmount,
  type CreationMode,
  type PromptOptimization,
  type PromptOptimizationRequest,
  type PromptScenario,
  type PromptSection,
  type PromptTemplate
} from "@gw-link-omniai/shared";
```

Remove:

- `estimateCreditCost` import.
- local `promptTemplates`.
- `ModeStrategy` interface.
- `defaultTemplateByMode`.
- `modeStrategies`.
- `cloneTemplate`.

Update `listTemplates`:

```ts
  listTemplates(mode?: CreationMode): PromptTemplate[] {
    if (mode !== undefined && !isCreationMode(mode)) {
      throw new PromptOptimizationError("Unsupported creation mode", 400);
    }

    return listPromptScenarioTemplates(mode);
  }
```

Update `optimizePrompt`:

```ts
  optimizePrompt(request: PromptOptimizationRequest): PromptOptimization {
    if (!isCreationMode(request.mode)) {
      throw new PromptOptimizationError("Unsupported creation mode", 400);
    }

    const prompt = request.prompt.trim();
    if (!prompt) {
      throw new PromptOptimizationError("Prompt is required", 400);
    }

    const scenario = this.resolveScenario(request.mode, request.templateId);

    return {
      id: this.idGenerator(),
      mode: request.mode,
      originalPrompt: prompt,
      optimizedPrompt: buildOptimizedPrompt(scenario, prompt),
      sections: buildSections(scenario, prompt),
      preset: {
        modelId: scenario.defaultPreset.modelId,
        parameters: {
          scenario: scenario.id,
          ...scenario.defaultPreset.parameters
        },
        creditEstimate: { ...scenario.defaultPreset.creditEstimate }
      },
      createdAt: this.clock.now().toISOString()
    };
  }

  private resolveScenario(mode: CreationMode, templateId: string | undefined): PromptScenario {
    const scenario = templateId === undefined ? getDefaultPromptScenario(mode) : getPromptScenario(templateId);

    if (!scenario || scenario.mode !== mode) {
      throw new PromptOptimizationError("Prompt template was not found", 404);
    }

    return scenario;
  }
```

Add helpers before `isCreationMode`:

```ts
function buildOptimizedPrompt(scenario: PromptScenario, prompt: string): string {
  const variableLabels = scenario.variables.slice(0, 3).map((variable) => variable.label).join("、");
  return `围绕“${prompt}”，按“${scenario.name}”场景生成可直接用于生产的提示词，重点覆盖${variableLabels}。`;
}

function buildSections(scenario: PromptScenario, prompt: string): PromptSection[] {
  return scenario.sectionBlueprints.map((section) => ({
    label: section.label,
    value: `${section.guidance}：${prompt}`
  }));
}
```

- [ ] **Step 4: Run Task 2 verification**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- promptOptimizer.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/api/src/services/promptOptimizer.ts apps/api/src/services/__tests__/promptOptimizer.test.ts
git commit -m "feat: derive prompt optimization from scenarios"
```

## Task 3: API Route and Server Scenario Coverage

**Files:**
- Modify: `apps/api/src/routes/__tests__/prompt.test.ts`
- Modify: `apps/api/src/__tests__/server.test.ts`

- [ ] **Step 1: Write failing route/server expectations**

Modify `apps/api/src/routes/__tests__/prompt.test.ts` image optimization payload:

```ts
        templateId: "image-commercial-poster"
```

Update response expectation inside `preset.parameters`:

```ts
            scenario: "image-commercial-poster",
            aspectRatio: "4:3",
            quality: "high",
            count: 1
```

Update sections expectation:

```ts
        sections: [
          { label: "主体", value: "明确核心主体与视觉焦点：做一张咖啡店新品海报" },
          { label: "场景", value: "描述背景空间、材质和环境氛围：做一张咖啡店新品海报" },
          { label: "构图", value: "说明主体位置、留白和信息层级：做一张咖啡店新品海报" },
          { label: "光照和色彩", value: "给出光源、色调和商业质感：做一张咖啡店新品海报" },
          { label: "负向提示词", value: "列出需要避免的画面问题：做一张咖啡店新品海报" }
        ],
```

Modify `apps/api/src/__tests__/server.test.ts` prompt route expectation:

```ts
        preset: {
          modelId: "gw-text-balanced",
          parameters: {
            scenario: "text-product-launch"
          },
          creditEstimate: { credits: 1, unit: "credit" }
        }
```

- [ ] **Step 2: Run route/server tests**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- prompt.test.ts server.test.ts
```

Expected: PASS if Task 2 is complete. If it fails because expectations still point at old template ids, update only the test expectations listed in Step 1.

- [ ] **Step 3: Run Task 3 verification**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- prompt.test.ts server.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit Task 3**

```bash
git add apps/api/src/routes/__tests__/prompt.test.ts apps/api/src/__tests__/server.test.ts
git commit -m "test: cover scenario prompt routes"
```

## Task 4: Desktop Studio Scenario Model

**Files:**
- Modify: `apps/desktop/src/studioModel.ts`
- Modify: `apps/desktop/src/__tests__/studioModel.test.ts`

- [ ] **Step 1: Write failing desktop model tests**

Modify imports in `apps/desktop/src/__tests__/studioModel.test.ts`:

```ts
import {
  getFixtureOptimization,
  getFixtureOptimizationForScenario,
  getStudioModeContent,
  getStudioModes,
  getStudioScenarios,
  getStudioTemplates
} from "../studioModel";
```

Replace the image template test:

```ts
  it("returns scenario-derived templates for image mode", () => {
    expect(getStudioTemplates("image").map((template) => template.id)).toEqual([
      "image-commercial-poster",
      "image-product-hero",
      "image-social-visual"
    ]);
  });
```

Add:

```ts
  it("returns scenario cards with variables and examples", () => {
    const scenarios = getStudioScenarios("text");

    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "text-product-launch",
      "text-social-title",
      "text-live-script"
    ]);
    expect(scenarios[0]).toMatchObject({
      name: "新品发布文案",
      variables: [
        {
          id: "audience",
          label: "目标受众",
          placeholder: "例如：喜欢精品咖啡与社交分享的年轻消费者"
        }
      ],
      examples: [{ input: "帮我写一个咖啡店新品发布文案" }]
    });
  });
```

Replace the fixture optimization test:

```ts
  it("provides fixture optimizations for default scenarios in each creation mode", () => {
    const textOptimization = getFixtureOptimization("text");
    expect(textOptimization.mode).toBe("text");
    expect(textOptimization.originalPrompt).toBe("帮我写一个咖啡店新品发布文案");
    expect(textOptimization.preset.modelId).toBe("gw-text-balanced");
    expect(textOptimization.preset.parameters.scenario).toBe("text-product-launch");

    const imageOptimization = getFixtureOptimization("image");
    expect(imageOptimization.mode).toBe("image");
    expect(imageOptimization.preset.modelId).toBe("gw-image-creative");
    expect(imageOptimization.preset.parameters.scenario).toBe("image-commercial-poster");
    expect(imageOptimization.sections.map((section) => section.label)).toContain("负向提示词");

    const videoOptimization = getFixtureOptimization("video");
    expect(videoOptimization.mode).toBe("video");
    expect(videoOptimization.preset.modelId).toBe("gw-video-motion");
    expect(videoOptimization.preset.parameters.scenario).toBe("video-short-shot");
    expect(videoOptimization.sections.map((section) => section.label)).toContain("镜头运动");
  });
```

Add:

```ts
  it("changes fixture optimization when selecting another scenario", () => {
    const optimization = getFixtureOptimizationForScenario("image", "image-product-hero");

    expect(optimization.originalPrompt).toBe("生成一张冷萃咖啡产品主图");
    expect(optimization.preset.parameters).toMatchObject({
      scenario: "image-product-hero",
      aspectRatio: "1:1"
    });
    expect(optimization.sections.map((section) => section.label)).toEqual([
      "产品焦点",
      "背景道具",
      "摄影质感",
      "画面用途",
      "负向提示词"
    ]);
  });
```

Update defensive copy test:

```ts
    const scenarios = getStudioScenarios("text");
    scenarios[0].variables[0]!.label = "mutated";
    expect(getStudioScenarios("text")[0].variables[0]!.label).toBe("目标受众");

    const templates = getStudioTemplates("text");
    templates[0].tags.push("mutated");
    expect(getStudioTemplates("text")[0].tags).toEqual(["copywriting", "launch", "brief"]);
```

- [ ] **Step 2: Run desktop model tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- studioModel.test.ts
```

Expected: FAIL because `getStudioScenarios` and `getFixtureOptimizationForScenario` do not exist and templates still use old ids.

- [ ] **Step 3: Refactor desktop studio model**

Modify imports in `apps/desktop/src/studioModel.ts`:

```ts
import {
  getDefaultPromptScenario,
  getPromptScenario,
  listPromptScenarioTemplates,
  listPromptScenarios,
  type CreationMode,
  type PromptOptimization,
  type PromptScenario,
  type PromptSection,
  type PromptTemplate
} from "@gw-link-omniai/shared";
```

Remove local `promptTemplates` and `fixtureOptimizations`.

Add helpers after `getStudioModeContent`:

```ts
export function getStudioTemplates(mode: CreationMode): PromptTemplate[] {
  return listPromptScenarioTemplates(mode);
}

export function getStudioScenarios(mode: CreationMode): PromptScenario[] {
  return listPromptScenarios(mode);
}

export function getFixtureOptimization(mode: CreationMode): PromptOptimization {
  return getFixtureOptimizationForScenario(mode, getDefaultPromptScenario(mode).id);
}

export function getFixtureOptimizationForScenario(mode: CreationMode, scenarioId: string): PromptOptimization {
  const scenario = getPromptScenario(scenarioId);
  const resolvedScenario = scenario !== undefined && scenario.mode === mode ? scenario : getDefaultPromptScenario(mode);
  const example = resolvedScenario.examples[0];
  const prompt = example?.input ?? getStudioModeContent(mode).promptPlaceholder.replace("例如：", "");

  return {
    id: `fixture-${resolvedScenario.id}-optimization`,
    mode,
    originalPrompt: prompt,
    optimizedPrompt: buildFixtureOptimizedPrompt(resolvedScenario, prompt),
    sections: buildFixtureSections(resolvedScenario, prompt),
    preset: {
      modelId: resolvedScenario.defaultPreset.modelId,
      parameters: {
        scenario: resolvedScenario.id,
        ...resolvedScenario.defaultPreset.parameters
      },
      creditEstimate: { ...resolvedScenario.defaultPreset.creditEstimate }
    },
    createdAt: "2026-06-19T00:00:00.000Z"
  };
}
```

Add these helper functions before `cloneModeContent`:

```ts
function buildFixtureOptimizedPrompt(scenario: PromptScenario, prompt: string): string {
  const variableLabels = scenario.variables.slice(0, 3).map((variable) => variable.label).join("、");
  return `围绕“${prompt}”，按“${scenario.name}”场景生成可直接用于生产的提示词，重点覆盖${variableLabels}。`;
}

function buildFixtureSections(scenario: PromptScenario, prompt: string): PromptSection[] {
  return scenario.sectionBlueprints.map((section) => ({
    label: section.label,
    value: `${section.guidance}：${prompt}`
  }));
}
```

Remove `cloneTemplate` and `cloneOptimization`; keep `cloneModeContent`.

- [ ] **Step 4: Run Task 4 verification**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- studioModel.test.ts
pnpm --filter @gw-link-omniai/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/desktop/src/studioModel.ts apps/desktop/src/__tests__/studioModel.test.ts
git commit -m "feat: add desktop prompt scenarios"
```

## Task 5: Desktop Scenario Studio UI

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/__tests__/App.test.tsx`

- [ ] **Step 1: Write failing Desktop App tests**

Modify `apps/desktop/src/__tests__/App.test.tsx`.

Add after the default Text Studio test:

```ts
  it("renders prompt scenario cards with variables and examples", () => {
    render(<App />);

    const scenarioRegion = screen.getByLabelText("提示词场景");
    expect(within(scenarioRegion).getByRole("button", { name: "新品发布文案" })).toBeTruthy();
    expect(within(scenarioRegion).getByRole("button", { name: "社媒标题" })).toBeTruthy();
    expect(within(scenarioRegion).getByRole("button", { name: "直播脚本" })).toBeTruthy();
    expect(within(scenarioRegion).getByText("目标受众")).toBeTruthy();
    expect(within(scenarioRegion).getByText("例如：喜欢精品咖啡与社交分享的年轻消费者")).toBeTruthy();
    expect(within(scenarioRegion).getByText("帮我写一个咖啡店新品发布文案")).toBeTruthy();
  });
```

Add after the image-mode test:

```ts
  it("switches image scenarios and updates prompt output", () => {
    render(<App />);

    const modeNavigation = screen.getByRole("navigation", { name: "Studio modes" });
    fireEvent.click(within(modeNavigation).getByRole("button", { name: "图片创作" }));

    const scenarioRegion = screen.getByLabelText("提示词场景");
    fireEvent.click(within(scenarioRegion).getByRole("button", { name: "产品主图" }));

    expect((screen.getByLabelText("图片创作需求") as HTMLTextAreaElement).value).toBe(
      "生成一张冷萃咖啡产品主图"
    );
    expect(within(scenarioRegion).getByText("产品")).toBeTruthy();
    expect(within(scenarioRegion).getByText("例如：玻璃瓶装冷萃咖啡")).toBeTruthy();

    const optimizationResult = screen.getByLabelText("提示词优化结果");
    expect(within(optimizationResult).getByText("产品焦点")).toBeTruthy();
    expect(within(optimizationResult).getByText("image-product-hero")).toBeTruthy();
    expect(within(optimizationResult).getByText("aspectRatio")).toBeTruthy();
    expect(within(optimizationResult).getByText("1:1")).toBeTruthy();
  });
```

Update existing tests that rely on current template ids:

- In default text test, additionally expect `text-product-launch`.
- In image test, additionally expect `image-commercial-poster`.
- In video test, additionally expect `video-short-shot`.

Example:

```ts
    expect(within(optimizationResult).getByText("text-product-launch")).toBeTruthy();
```

- [ ] **Step 2: Run Desktop App tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- App.test.tsx
```

Expected: FAIL because App still renders the old “提示词模板” list and has no scenario selection state.

- [ ] **Step 3: Update Desktop App imports and state**

Modify `apps/desktop/src/App.tsx` imports from `./studioModel`:

```ts
import {
  getFixtureOptimizationForScenario,
  getStudioModeContent,
  getStudioModes,
  getStudioScenarios
} from "./studioModel";
```

Add state after `selectedMode`:

```ts
  const scenarios = useMemo(() => getStudioScenarios(selectedMode), [selectedMode]);
  const [selectedScenarioIdByMode, setSelectedScenarioIdByMode] = useState<Record<CreationMode, string>>({
    text: "text-product-launch",
    image: "image-commercial-poster",
    video: "video-short-shot"
  });
  const selectedScenarioId = selectedScenarioIdByMode[selectedMode];
  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? scenarios[0];
```

Replace current `templates` and `optimization` memos:

```ts
  const optimization = useMemo(
    () => getFixtureOptimizationForScenario(selectedMode, selectedScenario?.id ?? selectedScenarioId),
    [selectedMode, selectedScenario?.id, selectedScenarioId]
  );
```

Add handler:

```ts
  function handleSelectScenario(scenarioId: string) {
    setSelectedScenarioIdByMode((current) => ({
      ...current,
      [selectedMode]: scenarioId
    }));
  }
```

- [ ] **Step 4: Replace template UI with scenario UI**

Replace the current `<section aria-label="提示词模板">...</section>` block with:

```tsx
        <section aria-label="提示词场景">
          <h3>提示词场景</h3>
          <ul>
            {scenarios.map((scenario) => (
              <li key={scenario.id}>
                <article>
                  <button
                    type="button"
                    aria-pressed={selectedScenario?.id === scenario.id}
                    onClick={() => handleSelectScenario(scenario.id)}
                  >
                    {scenario.name}
                  </button>
                  <p>{scenario.description}</p>
                  <ul>
                    {scenario.tags.map((tag) => (
                      <li key={tag}>{tag}</li>
                    ))}
                  </ul>
                </article>
              </li>
            ))}
          </ul>

          {selectedScenario ? (
            <article aria-label="当前提示词场景">
              <h4>{selectedScenario.name}</h4>
              <p>{selectedScenario.description}</p>
              <section aria-label="场景变量">
                <h5>变量槽位</h5>
                <dl>
                  {selectedScenario.variables.map((variable) => (
                    <div key={variable.id}>
                      <dt>{variable.label}</dt>
                      <dd>{variable.description}</dd>
                      <dd>{variable.placeholder}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section aria-label="场景示例">
                <h5>示例输入</h5>
                <ul>
                  {selectedScenario.examples.map((example) => (
                    <li key={example.input}>
                      <strong>{example.input}</strong>
                      <span>{example.note}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </article>
          ) : null}
        </section>
```

Update textarea:

```tsx
            key={`${selectedMode}-${selectedScenario?.id ?? "default"}`}
            id={promptInputId}
            name={`${selectedMode}Prompt`}
            placeholder={content.promptPlaceholder}
            defaultValue={optimization.originalPrompt}
```

- [ ] **Step 5: Run Task 5 verification**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- App.test.tsx
pnpm --filter @gw-link-omniai/desktop typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
git commit -m "feat: render desktop prompt scenarios"
```

## Task 6: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update README**

Add this section after `### Provider Adapter Foundation` and before `## Validation`:

```md
### Prompt Scenario Studio

The fifth product-first slice upgrades prompt optimization into reusable text, image, and video production scenarios.

- `packages/shared/src/promptScenarios.ts` defines the shared scenario catalog.
- Each scenario includes variables, examples, output sections, and a recommended preset.
- The API prompt optimizer derives templates and structured optimization output from the shared catalog.
- Desktop Studio shows scenario cards, variable slots, example inputs, and scenario-specific recommended parameters.
- This stage remains local and rule-based. Real provider execution, prompt evaluation, version publishing, and collaboration remain later slices.
```

- [ ] **Step 2: Update architecture documentation**

Add this section after `## Provider Adapter Foundation Slice` and before `## First Implementation Slice` in `docs/architecture/mvp-skeleton.md`:

```md
## Prompt Scenario Studio Slice

The Prompt Scenario Studio slice turns prompt optimization from fixed mode strategies into reusable production scenarios for text, image, and video creation. The shared scenario catalog describes variables, examples, output section blueprints, and recommended presets without exposing provider details.

The API derives `/v1/prompt/optimize` templates and rule-based optimization output from this catalog. Desktop Studio renders the same scenarios as selectable cards so users can understand what information each production workflow needs before submitting a generation task.

This keeps provider adapters as an execution detail while improving the product's core creation workflow. Prompt evaluation, version publishing, collaboration, persistence, and real provider execution remain later slices.
```

- [ ] **Step 3: Run full workspace verification**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit Task 6**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document prompt scenario studio"
```

## Final Review Checklist

- [ ] `PromptScenario`, `PromptScenarioVariable`, `PromptScenarioExample`, and `PromptSectionBlueprint` are product-facing shared contracts.
- [ ] Shared scenario catalog contains exactly 9 first-party scenarios across text/image/video.
- [ ] Scenario helpers return defensive copies.
- [ ] API prompt optimizer no longer duplicates local template arrays or mode strategies.
- [ ] `templateId` remains compatible and maps to scenario id.
- [ ] Explicit unknown or mismatched `templateId` returns 404.
- [ ] Optimization results include `preset.parameters.scenario`.
- [ ] Desktop renders scenario cards, variables, examples, and scenario-specific recommended parameters.
- [ ] Desktop mode switching and scenario switching update fixture prompt and sections.
- [ ] Generation task and asset flows still work.
- [ ] Shared contracts do not contain provider URLs, API key env names, provider ids, or provider model ids.
- [ ] README and architecture docs describe Stage 5.
- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
