import { describe, expect, it } from "vitest";
import type { CreationMode } from "@gw-link-omniai/shared";
import {
  getFixtureOptimization,
  getStudioModeContent,
  getStudioModes,
  getStudioTemplates
} from "../studioModel";

describe("desktop studio model", () => {
  it("lists studio modes in text, image, video order with localized titles", () => {
    const modes = getStudioModes();

    expect(modes.map((mode) => mode.mode)).toEqual(["text", "image", "video"]);
    expect(modes.map((mode) => mode.title)).toEqual(["文本创作", "图片创作", "视频创作"]);
  });

  it("provides mode-specific prompt labels and placeholders", () => {
    expect(getStudioModeContent("text")).toMatchObject({
      promptLabel: "文本创作需求",
      promptPlaceholder: "例如：帮我写一个咖啡店新品发布文案"
    });
    expect(getStudioModeContent("image")).toMatchObject({
      promptLabel: "图片创作需求",
      promptPlaceholder: "例如：做一张咖啡店新品海报"
    });
    expect(getStudioModeContent("video")).toMatchObject({
      promptLabel: "视频创作需求",
      promptPlaceholder: "例如：生成一段咖啡拉花短视频"
    });
  });

  it("falls back to text content for unsupported runtime modes", () => {
    expect(getStudioModeContent("audio" as CreationMode)).toMatchObject({
      mode: "text",
      title: "文本创作"
    });
  });

  it("returns the image poster template for image mode", () => {
    expect(getStudioTemplates("image")).toEqual([
      {
        id: "image-poster",
        mode: "image",
        name: "商业海报",
        description: "拆解主体、场景、风格、构图和负向提示词",
        tags: ["poster", "visual"]
      }
    ]);
  });

  it("provides fixture optimizations for each creation mode", () => {
    const textOptimization = getFixtureOptimization("text");
    expect(textOptimization.mode).toBe("text");
    expect(textOptimization.preset.modelId).toBe("gw-text-balanced");
    expect(textOptimization.preset.creditEstimate).toEqual({ credits: 1, unit: "credit" });

    const imageOptimization = getFixtureOptimization("image");
    expect(imageOptimization.mode).toBe("image");
    expect(imageOptimization.preset.modelId).toBe("gw-image-creative");
    expect(imageOptimization.sections.map((section) => section.label)).toContain("负向提示词");

    const videoOptimization = getFixtureOptimization("video");
    expect(videoOptimization.mode).toBe("video");
    expect(videoOptimization.preset.modelId).toBe("gw-video-motion");
    expect(videoOptimization.preset.creditEstimate).toEqual({ credits: 18, unit: "credit" });
    expect(videoOptimization.sections.map((section) => section.label)).toContain("镜头运动");
  });

  it("returns defensive copies of modes, templates, and fixture optimizations", () => {
    const modes = getStudioModes();
    modes[0].title = "mutated";
    expect(getStudioModes()[0].title).toBe("文本创作");

    const templates = getStudioTemplates("text");
    templates[0].tags.push("mutated");
    expect(getStudioTemplates("text")[0].tags).toEqual(["copywriting", "brief"]);

    const optimization = getFixtureOptimization("video");
    optimization.sections[0].label = "mutated";
    optimization.preset.parameters.durationSeconds = 999;
    optimization.preset.creditEstimate.credits = 999;

    const freshOptimization = getFixtureOptimization("video");
    expect(freshOptimization.sections[0].label).not.toBe("mutated");
    expect(freshOptimization.preset.parameters.durationSeconds).toBe(6);
    expect(freshOptimization.preset.creditEstimate).toEqual({ credits: 18, unit: "credit" });
  });
});
