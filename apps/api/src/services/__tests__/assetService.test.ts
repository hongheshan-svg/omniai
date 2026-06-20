import { describe, expect, it } from "vitest";
import type { CreationAssetRequest } from "@gw-link-omniai/shared";
import { AssetError, InMemoryAssetService } from "../assetService";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function createService() {
  return new InMemoryAssetService({
    clock: { now: () => fixedNow },
    idGenerator: () => "creation_asset_000001"
  });
}

function createImageRequest(): CreationAssetRequest {
  return {
    mode: "image",
    title: "图片资产",
    content: {
      kind: "image",
      url: "https://assets.gw-link.local/placeholders/image-generation.png",
      alt: "咖啡店新品海报占位图"
    },
    source: {
      taskId: "generation_task_000001",
      taskStatus: "succeeded"
    },
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

function expectAssetError(action: () => unknown, message: string, statusCode: number) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(AssetError);
    expect(error).toMatchObject({ message, statusCode });
    return;
  }

  throw new Error("Expected asset error");
}

describe("InMemoryAssetService", () => {
  it("creates an image asset", () => {
    const service = createService();

    expect(service.createAsset(createImageRequest())).toEqual({
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
      preset: {
        modelId: "gw-image-creative",
        parameters: {
          aspectRatio: "4:3",
          quality: "high",
          count: 1
        },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      createdAt: "2026-06-20T00:00:00.000Z"
    });
  });

  it("creates mode-specific text and video previews", () => {
    const service = createService();
    const textAsset = service.createAsset({
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
    });
    const videoAsset = service.createAsset({
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
    });

    expect(textAsset.preview).toEqual({
      title: "文本资产",
      description: "占位文本资产，后续阶段将接入真实文本生成结果。"
    });
    expect(videoAsset.preview).toEqual({
      title: "视频资产",
      description: "占位视频资产，后续阶段将接入真实视频文件。"
    });
  });

  it("lists created assets with defensive copies", () => {
    const service = createService();
    const asset = service.createAsset(createImageRequest());
    asset.preset.parameters.quality = "mutated";
    asset.preset.creditEstimate.credits = 999;
    asset.preview.title = "mutated";
    if (asset.content.kind === "image") {
      asset.content.alt = "mutated";
    }

    const [listedAsset] = service.listAssets();
    expect(listedAsset).toMatchObject({
      preset: {
        parameters: {
          quality: "high"
        },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      preview: {
        title: "图片资产"
      },
      content: {
        kind: "image",
        alt: "咖啡店新品海报占位图"
      }
    });

    listedAsset!.preset.parameters.quality = "changed again";
    listedAsset!.preset.creditEstimate.credits = 123;
    listedAsset!.preview.description = "changed again";
    if (listedAsset!.content.kind === "image") {
      listedAsset!.content.alt = "changed again";
    }

    expect(service.listAssets()[0]).toMatchObject({
      preset: {
        parameters: {
          quality: "high"
        },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      preview: {
        description: "占位图片资产，后续阶段将接入真实图片文件。"
      },
      content: {
        kind: "image",
        alt: "咖啡店新品海报占位图"
      }
    });
  });

  it("rejects unsupported modes", () => {
    const service = createService();
    expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          mode: "audio" as "image"
        }),
      "Unsupported asset mode",
      400
    );
  });

  it("rejects empty titles, prompts, and optimized prompts", () => {
    const service = createService();
    expectAssetError(
      () => service.createAsset({ ...createImageRequest(), title: " " }),
      "Asset title is required",
      400
    );
    expectAssetError(
      () => service.createAsset({ ...createImageRequest(), prompt: " " }),
      "Prompt is required",
      400
    );
    expectAssetError(
      () => service.createAsset({ ...createImageRequest(), optimizedPrompt: " " }),
      "Optimized prompt is required",
      400
    );
  });

  it("rejects invalid preset suggestions", () => {
    const service = createService();
    const request = createImageRequest();

    expectAssetError(
      () =>
        service.createAsset({
          ...request,
          preset: {
            modelId: "",
            parameters: {},
            creditEstimate: { credits: 2, unit: "credit" }
          }
        }),
      "Invalid preset suggestion",
      400
    );
    expectAssetError(
      () =>
        service.createAsset({
          ...request,
          preset: {
            ...request.preset,
            parameters: { quality: Number.POSITIVE_INFINITY }
          }
        }),
      "Invalid preset suggestion",
      400
    );
    expectAssetError(
      () =>
        service.createAsset({
          ...request,
          preset: {
            ...request.preset,
            creditEstimate: { credits: 0, unit: "credit" }
          }
        }),
      "Invalid preset suggestion",
      400
    );
  });

  it("rejects invalid asset content", () => {
    const service = createService();
    expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          content: {
            kind: "text",
            text: "wrong mode",
            format: "plain"
          }
        }),
      "Invalid asset content",
      400
    );
    expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          content: {
            kind: "image",
            url: "",
            alt: "missing url"
          }
        }),
      "Invalid asset content",
      400
    );
  });

  it("rejects invalid asset sources", () => {
    const service = createService();
    expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          source: {
            taskId: "",
            taskStatus: "succeeded"
          }
        }),
      "Invalid asset source",
      400
    );
    expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          source: {
            taskId: "generation_task_000001",
            taskStatus: "queued"
          }
        }),
      "Invalid asset source",
      400
    );
  });

  it("rejects non-object asset requests without TypeError", () => {
    const service = createService();
    expectAssetError(
      () => service.createAsset(null as unknown as CreationAssetRequest),
      "Invalid asset request",
      400
    );
  });
});
