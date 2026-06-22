import { describe, expect, it } from "vitest";
import type { CreationAsset, GenerationTask } from "@gw-link-omniai/shared";
import {
  buildAssetRequestFromTask,
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

  it("builds a creation-asset request from a succeeded text task", () => {
    const task: GenerationTask = {
      id: "task-1",
      mode: "text",
      status: "succeeded",
      prompt: "帮我写一个新品发布文案",
      optimizedPrompt: "请生成一段新品推广文案。",
      preset: {
        modelId: "gw-text-balanced",
        parameters: { tone: "warm" },
        creditEstimate: { credits: 1, unit: "credit" }
      },
      resultPreview: { title: "文本生成任务", description: "已生成。" },
      result: { kind: "text", text: "新品上市文案", format: "markdown" },
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    };

    const request = buildAssetRequestFromTask(task);

    expect(request).toEqual({
      mode: "text",
      title: "文本资产",
      content: { kind: "text", text: "新品上市文案", format: "markdown" },
      source: { taskId: "task-1", taskStatus: "succeeded" },
      prompt: "帮我写一个新品发布文案",
      optimizedPrompt: "请生成一段新品推广文案。",
      preset: {
        modelId: "gw-text-balanced",
        parameters: { tone: "warm" },
        creditEstimate: { credits: 1, unit: "credit" }
      }
    });

    // deep copy: mutating the request must not touch the task
    request.preset.parameters.tone = "mutated";
    expect(task.preset.parameters.tone).toBe("warm");
  });

  it("builds an image asset request from a succeeded image task", () => {
    const task: GenerationTask = {
      id: "task-img",
      mode: "image",
      status: "succeeded",
      prompt: "一只猫",
      optimizedPrompt: "一只在霓虹城市里的猫",
      preset: {
        modelId: "gw-image-creative",
        parameters: { quality: "high" },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      resultPreview: { title: "图片生成任务", description: "已生成。" },
      result: { kind: "image", url: "data:image/png;base64,aGVsbG8=", alt: "一只在霓虹城市里的猫" },
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    };

    const request = buildAssetRequestFromTask(task);

    expect(request).toEqual({
      mode: "image",
      title: "图片资产",
      content: { kind: "image", url: "data:image/png;base64,aGVsbG8=", alt: "一只在霓虹城市里的猫" },
      source: { taskId: "task-img", taskStatus: "succeeded" },
      prompt: "一只猫",
      optimizedPrompt: "一只在霓虹城市里的猫",
      preset: {
        modelId: "gw-image-creative",
        parameters: { quality: "high" },
        creditEstimate: { credits: 2, unit: "credit" }
      }
    });
  });

  it("throws when the task has no result", () => {
    const queued = {
      id: "t",
      mode: "text",
      status: "queued",
      prompt: "p",
      optimizedPrompt: "op",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
      resultPreview: { title: "t", description: "d" },
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    } as GenerationTask;
    expect(() => buildAssetRequestFromTask(queued)).toThrow();
  });
});
