import { describe, expect, it } from "vitest";
import type { PromptOptimization } from "@gw-link-omniai/shared";
import {
  createLocalGenerationTask,
  getGenerationStatusLabel,
  summarizeGenerationPrompt
} from "../generationModel";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function createOptimization(mode: PromptOptimization["mode"]): PromptOptimization {
  return {
    id: `optimization_${mode}`,
    mode,
    originalPrompt:
      mode === "text"
        ? "帮我写一个咖啡店新品发布文案"
        : mode === "image"
          ? "做一张咖啡店新品海报"
          : "生成一段咖啡拉花短视频",
    optimizedPrompt:
      mode === "text"
        ? "请生成一段新品推广文案。"
        : mode === "image"
          ? "制作一张咖啡店新品商业海报。"
          : "生成一段展示咖啡拉花过程的短视频。",
    sections: [],
    preset:
      mode === "text"
        ? {
            modelId: "gw-text-balanced",
            parameters: { outputFormat: "markdown", tone: "clear" },
            creditEstimate: { credits: 1, unit: "credit" }
          }
        : mode === "image"
          ? {
              modelId: "gw-image-creative",
              parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
              creditEstimate: { credits: 2, unit: "credit" }
            }
          : {
              modelId: "gw-video-motion",
              parameters: { durationSeconds: 6, aspectRatio: "16:9", resolution: "1080p" },
              creditEstimate: { credits: 18, unit: "credit" }
            },
    createdAt: "2026-06-20T00:00:00.000Z"
  };
}

describe("generationModel", () => {
  it("creates a queued local generation task from an optimization", () => {
    const task = createLocalGenerationTask(createOptimization("image"), {
      clock: { now: () => fixedNow },
      idGenerator: () => "desktop_generation_task_000001"
    });

    expect(task).toEqual({
      id: "desktop_generation_task_000001",
      mode: "image",
      status: "queued",
      prompt: "做一张咖啡店新品海报",
      optimizedPrompt: "制作一张咖啡店新品商业海报。",
      preset: {
        modelId: "gw-image-creative",
        parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      resultPreview: {
        title: "图片生成任务",
        description: "任务已排队，后续阶段将接入真实图片生成结果。"
      },
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z"
    });
  });

  it("creates mode-specific previews", () => {
    expect(createLocalGenerationTask(createOptimization("text")).resultPreview).toEqual({
      title: "文本生成任务",
      description: "任务已排队，后续阶段将接入真实文本生成结果。"
    });
    expect(createLocalGenerationTask(createOptimization("image")).resultPreview).toEqual({
      title: "图片生成任务",
      description: "任务已排队，后续阶段将接入真实图片生成结果。"
    });
    expect(createLocalGenerationTask(createOptimization("video")).resultPreview).toEqual({
      title: "视频生成任务",
      description: "任务已排队，后续阶段将接入真实视频生成结果。"
    });
  });

  it("returns status labels", () => {
    expect(getGenerationStatusLabel("queued")).toBe("排队中");
    expect(getGenerationStatusLabel("running")).toBe("生成中");
    expect(getGenerationStatusLabel("succeeded")).toBe("已完成");
    expect(getGenerationStatusLabel("failed")).toBe("失败");
  });

  it("summarizes long prompts", () => {
    const task = createLocalGenerationTask({
      ...createOptimization("text"),
      originalPrompt: "这是一段非常长的创作需求，用来验证任务中心里面的摘要不会无限增长影响界面展示"
    });

    expect(summarizeGenerationPrompt(task, 18)).toBe("这是一段非常长的创作需求，用来验证任...");
  });

  it("returns defensive copies of preset data", () => {
    const optimization = createOptimization("video");
    const task = createLocalGenerationTask(optimization);

    optimization.preset.parameters.resolution = "720p";
    optimization.preset.creditEstimate.credits = 999;

    expect(task.preset).not.toBe(optimization.preset);
    expect(task.preset.parameters).not.toBe(optimization.preset.parameters);
    expect(task.preset.creditEstimate).not.toBe(optimization.preset.creditEstimate);
    expect(task.preset.parameters.resolution).toBe("1080p");
    expect(task.preset.creditEstimate).toEqual({ credits: 18, unit: "credit" });
  });
});
