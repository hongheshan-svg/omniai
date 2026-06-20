import { describe, expect, it } from "vitest";
import type { GenerationTaskRequest } from "@gw-link-omniai/shared";
import { GenerationTaskError, InMemoryGenerationService } from "../generationService";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function createService() {
  return new InMemoryGenerationService({
    clock: { now: () => fixedNow },
    idGenerator: () => "generation_task_000001"
  });
}

function createImageRequest(): GenerationTaskRequest {
  return {
    mode: "image",
    prompt: "做一张咖啡店新品海报",
    optimizedPrompt: "制作一张咖啡店新品商业海报。",
    preset: {
      modelId: "gw-image-creative",
      parameters: {
        aspectRatio: "4:3",
        quality: "high",
        count: 1
      },
      creditEstimate: { credits: 2, unit: "credit" }
    }
  };
}

function expectGenerationError(action: () => unknown, message: string, statusCode: number) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(GenerationTaskError);
    expect(error).toMatchObject({ message, statusCode });
    return;
  }

  throw new Error("Expected generation task error");
}

describe("InMemoryGenerationService", () => {
  it("creates a queued image generation task", () => {
    const service = createService();

    expect(service.createTask(createImageRequest())).toEqual({
      id: "generation_task_000001",
      mode: "image",
      status: "queued",
      prompt: "做一张咖啡店新品海报",
      optimizedPrompt: "制作一张咖啡店新品商业海报。",
      preset: {
        modelId: "gw-image-creative",
        parameters: {
          aspectRatio: "4:3",
          quality: "high",
          count: 1
        },
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

  it("creates mode-specific text and video previews", () => {
    const service = createService();
    const textTask = service.createTask({
      mode: "text",
      prompt: "帮我写一个新品发布文案",
      optimizedPrompt: "请生成一段新品推广文案。",
      preset: {
        modelId: "gw-text-balanced",
        parameters: { outputFormat: "markdown", tone: "clear" },
        creditEstimate: { credits: 1, unit: "credit" }
      }
    });
    const videoTask = service.createTask({
      mode: "video",
      prompt: "生成一段咖啡拉花短视频",
      optimizedPrompt: "生成一段展示咖啡拉花过程的短视频。",
      preset: {
        modelId: "gw-video-motion",
        parameters: { durationSeconds: 6, aspectRatio: "16:9", resolution: "1080p" },
        creditEstimate: { credits: 18, unit: "credit" }
      }
    });

    expect(textTask.resultPreview).toEqual({
      title: "文本生成任务",
      description: "任务已排队，后续阶段将接入真实文本生成结果。"
    });
    expect(videoTask.resultPreview).toEqual({
      title: "视频生成任务",
      description: "任务已排队，后续阶段将接入真实视频生成结果。"
    });
  });

  it("lists created tasks with defensive copies", () => {
    const service = createService();
    const task = service.createTask(createImageRequest());
    task.preset.parameters.quality = "mutated";
    task.preset.creditEstimate.credits = 999;
    task.resultPreview.title = "mutated";

    const [listedTask] = service.listTasks();
    expect(listedTask).toMatchObject({
      preset: {
        parameters: {
          quality: "high"
        },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      resultPreview: {
        title: "图片生成任务"
      }
    });

    listedTask!.preset.parameters.quality = "changed again";
    expect(service.listTasks()[0]!.preset.parameters.quality).toBe("high");
  });

  it("rejects unsupported modes", () => {
    const service = createService();
    expectGenerationError(
      () =>
        service.createTask({
          ...createImageRequest(),
          mode: "audio" as "image"
        }),
      "Unsupported creation mode",
      400
    );
  });

  it("rejects empty prompts", () => {
    const service = createService();
    expectGenerationError(
      () =>
        service.createTask({
          ...createImageRequest(),
          prompt: " "
        }),
      "Prompt is required",
      400
    );
  });

  it("rejects empty optimized prompts", () => {
    const service = createService();
    expectGenerationError(
      () =>
        service.createTask({
          ...createImageRequest(),
          optimizedPrompt: " "
        }),
      "Optimized prompt is required",
      400
    );
  });

  it("rejects invalid preset suggestions", () => {
    const service = createService();
    expectGenerationError(
      () =>
        service.createTask({
          ...createImageRequest(),
          preset: {
            modelId: "",
            parameters: { quality: "high" },
            creditEstimate: { credits: 2, unit: "credit" }
          }
        }),
      "Invalid preset suggestion",
      400
    );
  });
});
