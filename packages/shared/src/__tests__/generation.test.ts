import { describe, expect, it } from "vitest";
import type { GenerationTask, GenerationTaskRequest, PresetSuggestion } from "..";

const imagePreset: PresetSuggestion = {
  modelId: "gw-image-creative",
  parameters: {
    aspectRatio: "4:3",
    quality: "high",
    count: 1
  },
  creditEstimate: { credits: 2, unit: "credit" }
};

describe("generation task contracts", () => {
  it("represents a generation task request for each creation mode", () => {
    const requests: GenerationTaskRequest[] = [
      {
        mode: "text",
        prompt: "帮我写一个新品发布文案",
        optimizedPrompt: "请生成一段可发布的新品推广文案。",
        preset: {
          modelId: "gw-text-balanced",
          parameters: { outputFormat: "markdown", tone: "clear" },
          creditEstimate: { credits: 1, unit: "credit" }
        }
      },
      {
        mode: "image",
        prompt: "做一张咖啡店新品海报",
        optimizedPrompt: "制作一张咖啡店新品商业海报。",
        preset: imagePreset
      },
      {
        mode: "video",
        prompt: "生成一段咖啡拉花短视频",
        optimizedPrompt: "生成一段展示咖啡拉花过程的短视频。",
        preset: {
          modelId: "gw-video-motion",
          parameters: { durationSeconds: 6, aspectRatio: "16:9", resolution: "1080p" },
          creditEstimate: { credits: 18, unit: "credit" }
        }
      }
    ];

    expect(requests.map((request) => request.mode)).toEqual(["text", "image", "video"]);
    expect(requests.map((request) => request.preset.modelId)).toEqual([
      "gw-text-balanced",
      "gw-image-creative",
      "gw-video-motion"
    ]);
  });

  it("represents a queued product generation task", () => {
    const task: GenerationTask = {
      id: "generation_task_000001",
      mode: "image",
      status: "queued",
      prompt: "做一张咖啡店新品海报",
      optimizedPrompt: "制作一张咖啡店新品商业海报。",
      preset: imagePreset,
      resultPreview: {
        title: "图片生成任务",
        description: "任务已排队，后续阶段将接入真实图片生成结果。"
      },
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z"
    };

    expect(task).toMatchObject({
      mode: "image",
      status: "queued",
      preset: {
        modelId: "gw-image-creative",
        creditEstimate: { credits: 2, unit: "credit" }
      },
      resultPreview: {
        title: "图片生成任务"
      }
    });
  });
});
