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
