import { describe, expect, it } from "vitest";
import type { CreationAsset, CreationAssetRequest, PresetSuggestion } from "..";

const imagePreset: PresetSuggestion = {
  modelId: "gw-image-creative",
  parameters: {
    aspectRatio: "4:3",
    quality: "high",
    count: 1
  },
  creditEstimate: { credits: 2, unit: "credit" }
};

describe("creation asset contracts", () => {
  it("represents asset creation requests for text, image, and video", () => {
    const requests: CreationAssetRequest[] = [
      {
        mode: "text",
        title: "文本资产",
        content: {
          kind: "text",
          text: "这是一段可复用的新品推广文案。",
          format: "markdown"
        },
        source: {
          taskId: "generation_task_text",
          taskStatus: "succeeded"
        },
        prompt: "帮我写一个咖啡店新品发布文案",
        optimizedPrompt: "请生成一段新品推广文案。",
        preset: {
          modelId: "gw-text-balanced",
          parameters: { outputFormat: "markdown", tone: "warm" },
          creditEstimate: { credits: 1, unit: "credit" }
        }
      },
      {
        mode: "image",
        title: "图片资产",
        content: {
          kind: "image",
          url: "https://assets.gw-link.local/placeholders/image-generation.png",
          alt: "咖啡店新品海报占位图"
        },
        source: {
          taskId: "generation_task_image",
          taskStatus: "succeeded"
        },
        prompt: "做一张咖啡店新品海报",
        optimizedPrompt: "制作一张咖啡店新品商业海报。",
        preset: imagePreset
      },
      {
        mode: "video",
        title: "视频资产",
        content: {
          kind: "video",
          url: "https://assets.gw-link.local/placeholders/video-generation.mp4",
          durationSeconds: 6,
          posterUrl: "https://assets.gw-link.local/placeholders/video-poster.png"
        },
        source: {
          taskId: "generation_task_video",
          taskStatus: "succeeded"
        },
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
    expect(requests.map((request) => request.content.kind)).toEqual(["text", "image", "video"]);
    expect(requests.map((request) => request.source.taskStatus)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded"
    ]);
  });

  it("represents a reusable product creation asset", () => {
    const asset: CreationAsset = {
      id: "creation_asset_000001",
      mode: "image",
      title: "图片资产",
      content: {
        kind: "image",
        url: "https://assets.gw-link.local/placeholders/image-generation.png",
        alt: "咖啡店新品海报占位图"
      },
      preview: {
        title: "图片资产",
        description: "占位图片资产，后续阶段将接入真实图片文件。"
      },
      source: {
        taskId: "generation_task_000001",
        taskStatus: "succeeded"
      },
      prompt: "做一张咖啡店新品海报",
      optimizedPrompt: "制作一张咖啡店新品商业海报。",
      preset: imagePreset,
      createdAt: "2026-06-20T00:00:00.000Z"
    };

    expect(asset).toMatchObject({
      mode: "image",
      title: "图片资产",
      content: {
        kind: "image"
      },
      source: {
        taskId: "generation_task_000001"
      },
      preset: {
        modelId: "gw-image-creative",
        creditEstimate: { credits: 2, unit: "credit" }
      }
    });
  });
});
