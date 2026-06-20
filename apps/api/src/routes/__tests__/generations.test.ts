import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import { InMemoryGenerationService, type GenerationService } from "../../services/generationService";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function buildGenerationTestServer() {
  return buildServer({
    generationService: new InMemoryGenerationService({
      clock: { now: () => fixedNow },
      idGenerator: () => "generation_task_000001"
    })
  });
}

function createImagePayload() {
  return {
    mode: "image",
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

describe("generation routes", () => {
  it("creates and lists generation tasks", async () => {
    const server = buildGenerationTestServer();
    const createResponse = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: createImagePayload()
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toEqual({
      task: {
        id: "generation_task_000001",
        mode: "image",
        status: "queued",
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
        resultPreview: {
          title: "图片生成任务",
          description: "任务已排队，后续阶段将接入真实图片生成结果。"
        },
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z"
      }
    });

    const listResponse = await server.inject({
      method: "GET",
      url: "/v1/generations"
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({
      tasks: [createResponse.json().task]
    });
  });

  it("rejects malformed generation task requests", async () => {
    const server = buildGenerationTestServer();
    const invalidPayloads = [
      {},
      { mode: "image" },
      { mode: "image", prompt: "做一张海报" },
      { mode: "image", prompt: "做一张海报", optimizedPrompt: "优化结果" },
      { mode: "image", prompt: 123, optimizedPrompt: "优化结果", preset: {} },
      ["image", "做一张海报"]
    ];

    for (const payload of invalidPayloads) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/generations",
        payload
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "Invalid generation task request"
      });
    }
  });

  it("maps generation domain errors to HTTP responses", async () => {
    const server = buildGenerationTestServer();
    const unsupportedMode = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        ...createImagePayload(),
        mode: "audio"
      }
    });
    const emptyPrompt = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        ...createImagePayload(),
        prompt: " "
      }
    });
    const emptyOptimizedPrompt = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        ...createImagePayload(),
        optimizedPrompt: " "
      }
    });
    const invalidPreset = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        ...createImagePayload(),
        preset: {
          modelId: "",
          parameters: {},
          creditEstimate: { credits: 2, unit: "credit" }
        }
      }
    });

    expect(unsupportedMode.statusCode).toBe(400);
    expect(unsupportedMode.json()).toEqual({ error: "Unsupported creation mode" });
    expect(emptyPrompt.statusCode).toBe(400);
    expect(emptyPrompt.json()).toEqual({ error: "Prompt is required" });
    expect(emptyOptimizedPrompt.statusCode).toBe(400);
    expect(emptyOptimizedPrompt.json()).toEqual({ error: "Optimized prompt is required" });
    expect(invalidPreset.statusCode).toBe(400);
    expect(invalidPreset.json()).toEqual({ error: "Invalid preset suggestion" });
  });

  it("maps unexpected generation service errors to a 500 response", async () => {
    const generationService = {
      createTask: () => {
        throw new Error("boom");
      },
      listTasks: () => []
    } satisfies GenerationService;
    const server = buildServer({ generationService });
    const response = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: createImagePayload()
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "Unexpected generation task error"
    });
  });
});
