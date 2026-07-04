import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import { FakeProviderAdapter } from "../../services/gatewayClient";
import { InMemoryGenerationService, type GenerationService } from "../../services/generationService";
import { ConfigModelCatalog } from "../../services/modelCatalog";
import type { ModelCatalogConfig } from "../../services/modelConfig";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function buildGenerationTestServer() {
  return buildServer({
    config: {
      port: 8787,
      gatewayBaseUrl: "https://gateway.gw-link.local",
      authDevCodesEnabled: true,
      modelConfigPath: "config/models.json",
      packagesConfigPath: "config/credit-packages.json",
      initialCredits: 100,
      publicBaseUrl: "http://localhost:8787",
      devTopupEnabled: true,
      devPaymentsEnabled: true,
      devAdminEnabled: true
    },
    generationService: new InMemoryGenerationService({
      clock: { now: () => fixedNow },
      idGenerator: () => "generation_task_000001",
      modelCatalog: new ConfigModelCatalog(createConfig()),
      providerAdapter: new FakeProviderAdapter()
    })
  });
}

async function authenticate(server: ReturnType<typeof buildGenerationTestServer>): Promise<string> {
  const start = await server.inject({
    method: "POST",
    url: "/v1/auth/start-login",
    payload: { destination: "creator@example.com" }
  });
  const { challengeId, devCode } = start.json() as { challengeId: string; devCode: string };
  const verify = await server.inject({
    method: "POST",
    url: "/v1/auth/verify-login",
    payload: { challengeId, code: devCode }
  });
  return (verify.json() as { token: string }).token;
}

function createConfig(): ModelCatalogConfig {
  return {
    providers: [
      {
        id: "openai-main",
        displayName: "OpenAI Main",
        protocol: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
        models: [
          {
            id: "gw-text-balanced",
            providerModelId: "gpt-4.1-mini",
            displayName: "OmniAI Text Balanced",
            capability: "text",
            tags: ["recommended", "balanced"],
            visibility: "visible",
            minimumPlan: "free",
            creditUnitCost: 1
          },
          {
            id: "gw-image-creative",
            providerModelId: "gpt-image-1",
            displayName: "OmniAI Image Creative",
            capability: "image",
            tags: ["creative", "high-quality"],
            visibility: "visible",
            minimumPlan: "pro",
            creditUnitCost: 2
          },
          {
            id: "gw-text-hidden",
            providerModelId: "gpt-hidden",
            displayName: "Hidden Text",
            capability: "text",
            tags: ["hidden"],
            visibility: "hidden",
            minimumPlan: "pro",
            creditUnitCost: 2
          }
        ]
      },
      {
        id: "anthropic-main",
        displayName: "Anthropic Main",
        protocol: "anthropic-compatible",
        baseUrl: "https://api.anthropic.com",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        models: [
          {
            id: "gw-video-motion",
            providerModelId: "claude-compatible-video-motion",
            displayName: "OmniAI Video Motion",
            capability: "video",
            tags: ["motion", "async-task"],
            visibility: "visible",
            minimumPlan: "studio",
            creditUnitCost: 3
          },
          {
            id: "gw-text-maintenance",
            providerModelId: "claude-maintenance",
            displayName: "Maintenance Text",
            capability: "text",
            tags: ["maintenance"],
            visibility: "maintenance",
            minimumPlan: "pro",
            creditUnitCost: 2
          }
        ]
      }
    ]
  };
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
    const token = await authenticate(server);
    const createResponse = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
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
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({
      tasks: [createResponse.json().task]
    });
  });

  it("rejects malformed generation task requests", async () => {
    const server = buildGenerationTestServer();
    const token = await authenticate(server);
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
        headers: { authorization: `Bearer ${token}` },
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
    const token = await authenticate(server);
    const unsupportedMode = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...createImagePayload(),
        mode: "audio"
      }
    });
    const emptyPrompt = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...createImagePayload(),
        prompt: " "
      }
    });
    const emptyOptimizedPrompt = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...createImagePayload(),
        optimizedPrompt: " "
      }
    });
    const invalidPreset = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
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
      createTask: (_request: unknown, _userId: string) => {
        throw new Error("boom");
      },
      listTasks: (_userId: string) => [],
      refreshTask: (_id: string, _userId: string) => {
        throw new Error("not implemented");
      }
    } satisfies GenerationService;
    const server = buildServer({
      config: {
        port: 8787,
        gatewayBaseUrl: "https://gateway.gw-link.local",
        authDevCodesEnabled: true,
        modelConfigPath: "config/models.json",
        packagesConfigPath: "config/credit-packages.json",
        initialCredits: 100,
        publicBaseUrl: "http://localhost:8787",
        devTopupEnabled: true,
        devPaymentsEnabled: true,
        devAdminEnabled: true
      },
      generationService
    });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: createImagePayload()
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "Unexpected generation task error"
    });
  });

  it("maps async unexpected generation service errors to a 500 response", async () => {
    const generationService = {
      createTask: async (_request: unknown, _userId: string) => {
        throw new Error("boom");
      },
      listTasks: (_userId: string) => [],
      refreshTask: (_id: string, _userId: string) => {
        throw new Error("not implemented");
      }
    } satisfies GenerationService;
    const server = buildServer({
      config: {
        port: 8787,
        gatewayBaseUrl: "https://gateway.gw-link.local",
        authDevCodesEnabled: true,
        modelConfigPath: "config/models.json",
        packagesConfigPath: "config/credit-packages.json",
        initialCredits: 100,
        publicBaseUrl: "http://localhost:8787",
        devTopupEnabled: true,
        devPaymentsEnabled: true,
        devAdminEnabled: true
      },
      generationService
    });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: createImagePayload()
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "Unexpected generation task error"
    });
  });

  it("maps missing model validation errors to a 404 response", async () => {
    const server = buildGenerationTestServer();
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...createImagePayload(),
        preset: {
          ...createImagePayload().preset,
          modelId: "gw-image-missing"
        }
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Model was not found"
    });
  });

  it("maps model mode mismatch validation errors to a 400 response", async () => {
    const server = buildGenerationTestServer();
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...createImagePayload(),
        preset: {
          ...createImagePayload().preset,
          modelId: "gw-text-balanced"
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Model does not support this creation mode"
    });
  });
});
