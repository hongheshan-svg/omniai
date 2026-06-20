import { describe, expect, it } from "vitest";
import type { CreationAsset, CreationMode, GenerationTask } from "@gw-link-omniai/shared";
import {
  createLocalCreationAsset,
  filterCreationAssets,
  getAssetFilterLabel,
  getAssetModeLabel,
  summarizeAssetPrompt
} from "../assetModel";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function createTask(mode: CreationMode): GenerationTask {
  return {
    id: `generation_task_${mode}`,
    mode,
    status: "queued",
    prompt:
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
              parameters: { durationSeconds: 8, aspectRatio: "16:9", resolution: "1080p" },
              creditEstimate: { credits: 18, unit: "credit" }
            },
    resultPreview: {
      title: `${mode} generation task`,
      description: "Existing task preview should not leak into the asset preview."
    },
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z"
  };
}

describe("assetModel", () => {
  it("creates a local image asset from a generation task", () => {
    const asset = createLocalCreationAsset(createTask("image"), {
      clock: { now: () => fixedNow },
      idGenerator: () => "desktop_creation_asset_000001"
    });

    expect(asset).toEqual({
      id: "desktop_creation_asset_000001",
      mode: "image",
      title: "图片资产",
      content: {
        kind: "image",
        url: "https://assets.gw-link.local/placeholders/image-generation.png",
        alt: "做一张咖啡店新品海报"
      },
      preview: {
        title: "图片资产",
        description: "占位图片资产，后续阶段将接入真实图片文件。"
      },
      source: {
        taskId: "generation_task_image",
        taskStatus: "succeeded"
      },
      prompt: "做一张咖啡店新品海报",
      optimizedPrompt: "制作一张咖啡店新品商业海报。",
      preset: {
        modelId: "gw-image-creative",
        parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      createdAt: "2026-06-20T00:00:00.000Z"
    });
  });

  it("creates fake content for text, image, and video assets", () => {
    expect(createLocalCreationAsset(createTask("text")).content).toEqual({
      kind: "text",
      text: "请生成一段新品推广文案。",
      format: "markdown"
    });
    expect(createLocalCreationAsset(createTask("image")).content).toEqual({
      kind: "image",
      url: "https://assets.gw-link.local/placeholders/image-generation.png",
      alt: "做一张咖啡店新品海报"
    });
    expect(createLocalCreationAsset(createTask("video")).content).toEqual({
      kind: "video",
      url: "https://assets.gw-link.local/placeholders/video-generation.mp4",
      durationSeconds: 8,
      posterUrl: "https://assets.gw-link.local/placeholders/video-poster.png"
    });
  });

  it("filters creation assets by mode or returns all assets", () => {
    const textAsset = createLocalCreationAsset(createTask("text"));
    const imageAsset = createLocalCreationAsset(createTask("image"));
    const videoAsset = createLocalCreationAsset(createTask("video"));
    const assets: CreationAsset[] = [textAsset, imageAsset, videoAsset];

    expect(filterCreationAssets(assets, "all")).toBe(assets);
    expect(filterCreationAssets(assets, "text")).toEqual([textAsset]);
    expect(filterCreationAssets(assets, "image")).toEqual([imageAsset]);
    expect(filterCreationAssets(assets, "video")).toEqual([videoAsset]);
  });

  it("returns Chinese labels for filters and asset modes", () => {
    expect(getAssetFilterLabel("all")).toBe("全部");
    expect(getAssetFilterLabel("text")).toBe("文本");
    expect(getAssetFilterLabel("image")).toBe("图片");
    expect(getAssetFilterLabel("video")).toBe("视频");

    expect(getAssetModeLabel("text")).toBe("文本资产");
    expect(getAssetModeLabel("image")).toBe("图片资产");
    expect(getAssetModeLabel("video")).toBe("视频资产");
  });

  it("summarizes long prompts", () => {
    const asset = createLocalCreationAsset({
      ...createTask("text"),
      prompt: "  这是一段非常长的创作需求，用来验证资产库里面的摘要不会无限增长影响界面展示  "
    });

    expect(summarizeAssetPrompt(asset, 18)).toBe("这是一段非常长的创作需求，用来验证资...");
  });

  it("returns defensive copies of task preset data", () => {
    const task = createTask("video");
    const asset = createLocalCreationAsset(task);

    task.preset.parameters.resolution = "720p";
    task.preset.parameters.durationSeconds = 3;
    task.preset.creditEstimate.credits = 999;
    task.resultPreview.title = "Mutated preview";
    task.resultPreview.description = "Mutated description";

    expect(asset.preset).not.toBe(task.preset);
    expect(asset.preset.parameters).not.toBe(task.preset.parameters);
    expect(asset.preset.creditEstimate).not.toBe(task.preset.creditEstimate);
    expect(asset.preset.parameters).toEqual({
      durationSeconds: 8,
      aspectRatio: "16:9",
      resolution: "1080p"
    });
    expect(asset.preset.creditEstimate).toEqual({ credits: 18, unit: "credit" });
    expect(asset.preview).toEqual({
      title: "视频资产",
      description: "占位视频资产，后续阶段将接入真实视频文件。"
    });
  });
});
