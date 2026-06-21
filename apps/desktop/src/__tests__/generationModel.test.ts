import { describe, expect, it } from "vitest";
import type { GenerationTask } from "@gw-link-omniai/shared";
import { getGenerationStatusLabel, summarizeGenerationPrompt } from "../generationModel";

describe("generationModel", () => {
  it("returns status labels", () => {
    expect(getGenerationStatusLabel("queued")).toBe("排队中");
    expect(getGenerationStatusLabel("running")).toBe("生成中");
    expect(getGenerationStatusLabel("succeeded")).toBe("已完成");
    expect(getGenerationStatusLabel("failed")).toBe("失败");
  });

  it("summarizes long prompts", () => {
    const task: GenerationTask = {
      id: "task_001",
      mode: "text",
      status: "queued",
      prompt: "这是一段非常长的创作需求，用来验证任务中心里面的摘要不会无限增长影响界面展示",
      optimizedPrompt: "优化后的提示词",
      preset: {
        modelId: "gw-text-balanced",
        parameters: { outputFormat: "markdown" },
        creditEstimate: { credits: 1, unit: "credit" }
      },
      resultPreview: { title: "文本生成任务", description: "任务已排队" },
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z"
    };

    expect(summarizeGenerationPrompt(task, 18)).toBe("这是一段非常长的创作需求，用来验证任...");
  });

  it("returns the full prompt when it fits within maxLength", () => {
    const task: GenerationTask = {
      id: "task_002",
      mode: "image",
      status: "succeeded",
      prompt: "短提示词",
      optimizedPrompt: "短提示词",
      preset: {
        modelId: "gw-image-creative",
        parameters: {},
        creditEstimate: { credits: 2, unit: "credit" }
      },
      resultPreview: { title: "图片生成任务", description: "已完成" },
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z"
    };

    expect(summarizeGenerationPrompt(task)).toBe("短提示词");
  });
});
