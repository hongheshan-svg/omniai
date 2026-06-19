import { describe, expect, it } from "vitest";
import type { PromptOptimization, PromptOptimizationRequest, PromptTemplate } from "../models";

describe("prompt optimization contracts", () => {
  it("represents prompt templates for each creation mode", () => {
    const templates: PromptTemplate[] = [
      {
        id: "text-social-title",
        mode: "text",
        name: "社媒标题",
        description: "生成适合社媒传播的标题",
        tags: ["copywriting", "social"]
      },
      {
        id: "image-poster",
        mode: "image",
        name: "商业海报",
        description: "生成海报视觉提示词",
        tags: ["poster", "visual"]
      },
      {
        id: "video-short",
        mode: "video",
        name: "短视频镜头",
        description: "生成短视频镜头运动提示词",
        tags: ["short-video", "motion"]
      }
    ];

    expect(templates.map((template) => template.mode)).toEqual(["text", "image", "video"]);
  });

  it("represents a prompt optimization request", () => {
    const request: PromptOptimizationRequest = {
      mode: "image",
      prompt: "做一张咖啡店新品海报",
      templateId: "image-poster"
    };

    expect(request.mode).toBe("image");
    expect(request.templateId).toBe("image-poster");
  });

  it("represents structured optimization output with preset and credits", () => {
    const optimization: PromptOptimization = {
      id: "prompt_opt_000001",
      mode: "image",
      originalPrompt: "做一张咖啡店新品海报",
      optimizedPrompt: "为咖啡店新品制作一张商业海报，突出新品饮品、温暖店内氛围和清晰促销信息。",
      sections: [
        { label: "主体", value: "咖啡店新品饮品与品牌海报视觉" },
        { label: "负向提示词", value: "低清晰度、杂乱背景、文字变形、过曝" }
      ],
      preset: {
        modelId: "recommended-image",
        parameters: {
          aspectRatio: "4:3",
          quality: "high",
          count: 1
        },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      createdAt: "2026-06-20T00:00:00.000Z"
    };

    expect(optimization.sections).toContainEqual({
      label: "负向提示词",
      value: "低清晰度、杂乱背景、文字变形、过曝"
    });
    expect(optimization.preset.creditEstimate).toEqual({ credits: 2, unit: "credit" });
  });
});
