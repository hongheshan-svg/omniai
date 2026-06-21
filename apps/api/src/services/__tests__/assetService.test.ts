import { describe, expect, it, vi } from "vitest";
import type { CreationAssetRequest } from "@gw-link-omniai/shared";
import { AssetError, InMemoryAssetService } from "../assetService";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");
const TEST_USER_ID = "user_email_testowner000000";

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

async function expectAssetError(action: () => unknown, message: string, statusCode: number) {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(AssetError);
    expect(error).toMatchObject({ message, statusCode });
    return;
  }

  throw new Error("Expected asset error");
}

describe("InMemoryAssetService", () => {
  it("creates an image asset", async () => {
    const service = createService();

    expect(await service.createAsset(createImageRequest(), TEST_USER_ID)).toEqual({
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

  it("creates unique increasing default ids per service instance without depending on Date.now", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_782_048_000_000);

    try {
      const first = new InMemoryAssetService({
        clock: { now: () => fixedNow }
      });
      const second = new InMemoryAssetService({
        clock: { now: () => fixedNow }
      });

      const ids = [
        (await first.createAsset(createImageRequest(), TEST_USER_ID)).id,
        (await second.createAsset(createImageRequest(), TEST_USER_ID)).id,
        (await first.createAsset(createImageRequest(), TEST_USER_ID)).id
      ];
      expect(ids).toEqual([
        "creation_asset_000001",
        "creation_asset_000001",
        "creation_asset_000002"
      ]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("creates mode-specific text and video previews", async () => {
    const service = createService();
    const textAsset = await service.createAsset({
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
    }, TEST_USER_ID);
    const videoAsset = await service.createAsset({
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
    }, TEST_USER_ID);

    expect(textAsset.preview).toEqual({
      title: "文本资产",
      description: "占位文本资产，后续阶段将接入真实文本生成结果。"
    });
    expect(videoAsset.preview).toEqual({
      title: "视频资产",
      description: "占位视频资产，后续阶段将接入真实视频文件。"
    });
  });

  it("lists created assets with defensive copies", async () => {
    const service = createService();
    const asset = await service.createAsset(createImageRequest(), TEST_USER_ID);
    asset.preset.parameters.quality = "mutated";
    asset.preset.creditEstimate.credits = 999;
    asset.preview.title = "mutated";
    if (asset.content.kind === "image") {
      asset.content.alt = "mutated";
    }

    const [listedAsset] = await service.listAssets(TEST_USER_ID);
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

    expect((await service.listAssets(TEST_USER_ID))[0]).toMatchObject({
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

  it("normalizes content by dropping fields outside the asset contract", async () => {
    const service = createService();
    const request = {
      ...createImageRequest(),
      content: {
        ...createImageRequest().content,
        metadata: {
          tags: ["original"]
        }
      }
    } as unknown as CreationAssetRequest;

    const asset = await service.createAsset(request, TEST_USER_ID);
    expect(asset.content).toEqual({
      kind: "image",
      url: "https://assets.gw-link.local/placeholders/image-generation.png",
      alt: "咖啡店新品海报占位图"
    });
    expect("metadata" in asset.content).toBe(false);

    (asset.content as typeof asset.content & { metadata?: { tags: string[] } }).metadata?.tags.push(
      "mutated"
    );

    const [listedAsset] = await service.listAssets(TEST_USER_ID);
    expect(listedAsset!.content).toEqual({
      kind: "image",
      url: "https://assets.gw-link.local/placeholders/image-generation.png",
      alt: "咖啡店新品海报占位图"
    });
    expect("metadata" in listedAsset!.content).toBe(false);
  });

  it("rejects unsupported modes", async () => {
    const service = createService();
    await expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          mode: "audio" as "image"
        }, TEST_USER_ID),
      "Unsupported asset mode",
      400
    );
  });

  it("rejects empty titles, prompts, and optimized prompts", async () => {
    const service = createService();
    await expectAssetError(
      () => service.createAsset({ ...createImageRequest(), title: " " }, TEST_USER_ID),
      "Asset title is required",
      400
    );
    await expectAssetError(
      () => service.createAsset({ ...createImageRequest(), prompt: " " }, TEST_USER_ID),
      "Prompt is required",
      400
    );
    await expectAssetError(
      () => service.createAsset({ ...createImageRequest(), optimizedPrompt: " " }, TEST_USER_ID),
      "Optimized prompt is required",
      400
    );
  });

  it("rejects invalid preset suggestions", async () => {
    const service = createService();
    const request = createImageRequest();

    await expectAssetError(
      () =>
        service.createAsset({
          ...request,
          preset: {
            modelId: "",
            parameters: {},
            creditEstimate: { credits: 2, unit: "credit" }
          }
        }, TEST_USER_ID),
      "Invalid preset suggestion",
      400
    );
    await expectAssetError(
      () =>
        service.createAsset({
          ...request,
          preset: {
            ...request.preset,
            parameters: { quality: Number.POSITIVE_INFINITY }
          }
        }, TEST_USER_ID),
      "Invalid preset suggestion",
      400
    );
    await expectAssetError(
      () =>
        service.createAsset({
          ...request,
          preset: {
            ...request.preset,
            creditEstimate: { credits: 0, unit: "credit" }
          }
        }, TEST_USER_ID),
      "Invalid preset suggestion",
      400
    );
  });

  it("rejects invalid asset content", async () => {
    const service = createService();
    await expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          content: {
            kind: "text",
            text: "wrong mode",
            format: "plain"
          }
        }, TEST_USER_ID),
      "Invalid asset content",
      400
    );
    await expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          content: {
            kind: "image",
            url: "",
            alt: "missing url"
          }
        }, TEST_USER_ID),
      "Invalid asset content",
      400
    );
  });

  it("rejects invalid asset sources", async () => {
    const service = createService();
    await expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          source: {
            taskId: "",
            taskStatus: "succeeded"
          }
        }, TEST_USER_ID),
      "Invalid asset source",
      400
    );
    await expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          source: {
            taskId: "generation_task_000001",
            taskStatus: "queued"
          }
        }, TEST_USER_ID),
      "Invalid asset source",
      400
    );
  });

  it("rejects non-object asset requests without TypeError", async () => {
    const service = createService();
    await expectAssetError(
      () => service.createAsset(null as unknown as CreationAssetRequest, TEST_USER_ID),
      "Invalid asset request",
      400
    );
  });

  it("lists only the requesting user's assets", async () => {
    const service = createService();
    await service.createAsset(createImageRequest(), "user-a");

    expect(await service.listAssets("user-a")).toHaveLength(1);
    expect(await service.listAssets("user-b")).toEqual([]);
  });
});
