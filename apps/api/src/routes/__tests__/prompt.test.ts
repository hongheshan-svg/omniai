import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import { LocalPromptOptimizer, type PromptOptimizer } from "../../services/promptOptimizer";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function buildPromptTestServer() {
  return buildServer({
    promptOptimizer: new LocalPromptOptimizer({
      clock: { now: () => fixedNow },
      idGenerator: () => "prompt_opt_000001"
    })
  });
}

describe("prompt routes", () => {
  it("optimizes an image prompt", async () => {
    const server = buildPromptTestServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/prompt/optimize",
      payload: {
        mode: "image",
        prompt: "做一张咖啡店新品海报",
        templateId: "image-poster"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      optimization: {
        id: "prompt_opt_000001",
        mode: "image",
        originalPrompt: "做一张咖啡店新品海报",
        sections: [
          { label: "主体", value: "做一张咖啡店新品海报 的核心主体与视觉焦点" },
          { label: "场景", value: "干净、有生活感、符合商业传播的真实场景" },
          { label: "风格", value: "精致、清晰、适合社媒和营销物料使用" },
          { label: "构图", value: "主体明确，保留标题、卖点或品牌信息空间" },
          { label: "光照和色彩", value: "自然光或柔和棚拍光，色彩统一且不过度饱和" },
          { label: "负向提示词", value: "低清晰度、杂乱背景、文字变形、过曝、主体缺失" }
        ],
        preset: {
          modelId: "recommended-image",
          parameters: {
            template: "image-poster",
            aspectRatio: "4:3",
            quality: "high",
            count: 1
          },
          creditEstimate: { credits: 2, unit: "credit" }
        },
        createdAt: "2026-06-20T00:00:00.000Z"
      }
    });
  });

  it("rejects malformed optimization requests", async () => {
    const server = buildPromptTestServer();
    const invalidPayloads = [
      {},
      { mode: "image" },
      { prompt: "做一张海报" },
      { mode: "image", prompt: 123 },
      { mode: "image", prompt: "做一张海报", templateId: 123 },
      ["image", "做一张海报"]
    ];

    for (const payload of invalidPayloads) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/prompt/optimize",
        payload
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "Invalid prompt optimization request"
      });
    }
  });

  it("maps optimizer domain errors to HTTP responses", async () => {
    const server = buildPromptTestServer();
    const unsupportedMode = await server.inject({
      method: "POST",
      url: "/v1/prompt/optimize",
      payload: {
        mode: "audio",
        prompt: "生成音频"
      }
    });
    const emptyPrompt = await server.inject({
      method: "POST",
      url: "/v1/prompt/optimize",
      payload: {
        mode: "text",
        prompt: " "
      }
    });
    const missingTemplate = await server.inject({
      method: "POST",
      url: "/v1/prompt/optimize",
      payload: {
        mode: "image",
        prompt: "做一张海报",
        templateId: "missing-template"
      }
    });

    expect(unsupportedMode.statusCode).toBe(400);
    expect(unsupportedMode.json()).toEqual({ error: "Unsupported creation mode" });
    expect(emptyPrompt.statusCode).toBe(400);
    expect(emptyPrompt.json()).toEqual({ error: "Prompt is required" });
    expect(missingTemplate.statusCode).toBe(404);
    expect(missingTemplate.json()).toEqual({ error: "Prompt template was not found" });
  });

  it("maps unexpected optimizer errors to a 500 response", async () => {
    const promptOptimizer = {
      listTemplates: () => [],
      optimizePrompt: () => {
        throw new Error("boom");
      }
    } satisfies PromptOptimizer;
    const server = buildServer({ promptOptimizer });
    const response = await server.inject({
      method: "POST",
      url: "/v1/prompt/optimize",
      payload: {
        mode: "text",
        prompt: "帮我写一个新品发布文案"
      }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "Unexpected prompt optimization error"
    });
  });
});
