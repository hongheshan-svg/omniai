import { describe, expect, it } from "vitest";
import type { CreationAsset } from "@gw-link-omniai/shared";
import {
  filterCreationAssets,
  getAssetFilterLabel,
  getAssetModeLabel,
  summarizeAssetPrompt
} from "../assetModel";

function makeAsset(overrides: Partial<CreationAsset> & Pick<CreationAsset, "mode">): CreationAsset {
  return {
    id: `asset_${overrides.mode}`,
    title: overrides.mode === "text" ? "文本资产" : overrides.mode === "image" ? "图片资产" : "视频资产",
    content: overrides.content ?? { kind: "text", text: "placeholder", format: "markdown" },
    preview: { title: "资产预览", description: "预览描述" },
    source: { taskId: `task_${overrides.mode}`, taskStatus: "succeeded" },
    prompt: overrides.prompt ?? "默认提示词",
    optimizedPrompt: "优化后的提示词",
    preset: {
      modelId: "gw-text-balanced",
      parameters: {},
      creditEstimate: { credits: 1, unit: "credit" }
    },
    createdAt: "2026-06-20T00:00:00.000Z",
    ...overrides
  };
}

describe("assetModel", () => {
  it("filters creation assets by mode or returns all assets", () => {
    const textAsset = makeAsset({ mode: "text" });
    const imageAsset = makeAsset({ mode: "image" });
    const videoAsset = makeAsset({ mode: "video" });
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
    const asset = makeAsset({
      mode: "text",
      prompt: "  这是一段非常长的创作需求，用来验证资产库里面的摘要不会无限增长影响界面展示  "
    });

    expect(summarizeAssetPrompt(asset, 18)).toBe("这是一段非常长的创作需求，用来验证资...");
  });

  it("returns the full prompt when it fits within maxLength", () => {
    const asset = makeAsset({ mode: "image", prompt: "短提示词" });

    expect(summarizeAssetPrompt(asset)).toBe("短提示词");
  });
});
