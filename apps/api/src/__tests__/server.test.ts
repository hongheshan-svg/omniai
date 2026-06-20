import { describe, expect, it } from "vitest";
import { buildServer } from "../server";
import type { AssetService } from "../services/assetService";
import type { AuthService } from "../services/authService";
import type { GenerationService } from "../services/generationService";
import type { ModelCatalog } from "../services/modelCatalog";

describe("product API", () => {
  it("returns service health", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: "gw-link-omniai-api",
      status: "ok"
    });
  });

  it("returns product-facing model catalog", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/v1/models" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      models: [
        {
          id: "gw-text-balanced",
          displayName: "OmniAI Text Balanced",
          capability: "text",
          tags: ["recommended", "balanced"],
          visibility: "visible",
          minimumPlan: "free",
          creditUnitCost: 1
        },
        {
          id: "gw-image-creative",
          displayName: "OmniAI Image Creative",
          capability: "image",
          tags: ["creative", "high-quality"],
          visibility: "visible",
          minimumPlan: "pro",
          creditUnitCost: 2
        },
        {
          id: "gw-video-motion",
          displayName: "OmniAI Video Motion",
          capability: "video",
          tags: ["motion", "async-task"],
          visibility: "visible",
          minimumPlan: "studio",
          creditUnitCost: 3
        }
      ]
    });
  });

  it("registers the prompt optimization route", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/prompt/optimize",
      payload: {
        mode: "text",
        prompt: "帮我写一个新品发布文案"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      optimization: {
        mode: "text",
        originalPrompt: "帮我写一个新品发布文案",
        preset: {
          modelId: "gw-text-balanced",
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });
  });

  it("registers the generation routes", async () => {
    const server = buildServer();
    const createResponse = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        mode: "text",
        prompt: "帮我写一个新品发布文案",
        optimizedPrompt: "请生成一段新品推广文案。",
        preset: {
          modelId: "gw-text-balanced",
          parameters: {
            outputFormat: "markdown",
            tone: "clear"
          },
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });
    const listResponse = await server.inject({
      method: "GET",
      url: "/v1/generations"
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({
      task: {
        mode: "text",
        status: "queued",
        preset: {
          modelId: "gw-text-balanced",
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      tasks: [
        {
          mode: "text",
          status: "queued"
        }
      ]
    });
  });

  it("registers the asset routes", async () => {
    const server = buildServer();
    const createResponse = await server.inject({
      method: "POST",
      url: "/v1/assets",
      payload: {
        mode: "text",
        title: "文本资产",
        content: {
          kind: "text",
          text: "这是一段可复用的新品推广文案。",
          format: "markdown"
        },
        source: {
          taskId: "generation_task_000001",
          taskStatus: "succeeded"
        },
        prompt: "帮我写一个新品发布文案",
        optimizedPrompt: "请生成一段新品推广文案。",
        preset: {
          modelId: "gw-text-balanced",
          parameters: {
            outputFormat: "markdown",
            tone: "clear"
          },
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });
    const listResponse = await server.inject({
      method: "GET",
      url: "/v1/assets"
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({
      asset: {
        mode: "text",
        title: "文本资产",
        content: {
          kind: "text"
        },
        preset: {
          modelId: "gw-text-balanced",
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      assets: [
        {
          mode: "text",
          title: "文本资产"
        }
      ]
    });
  });

  it("does not load environment config when an auth service is injected", () => {
    const originalPort = process.env.PORT;
    const fakeAuthService = {
      startLogin: () => ({
        challengeId: "challenge_1",
        channel: "email",
        maskedDestination: "c***@example.com",
        expiresAt: "2026-06-20T00:00:00.000Z"
      }),
      verifyLogin: () => {
        throw new Error("not implemented");
      },
      getSession: () => ({
        authenticated: false,
        user: null,
        expiresAt: null
      }),
      logout: () => false
    } satisfies AuthService;
    const fakeGenerationService = {
      createTask: () => {
        throw new Error("not implemented");
      },
      listTasks: () => []
    } satisfies GenerationService;
    const fakeAssetService = {
      createAsset: () => {
        throw new Error("not implemented");
      },
      listAssets: () => []
    } satisfies AssetService;
    const fakeModelCatalog = {
      listVisibleModels: () => [],
      getModelReference: () => {
        throw new Error("not implemented");
      }
    } satisfies ModelCatalog;

    try {
      process.env.PORT = "abc";

      expect(() =>
        buildServer({
          authService: fakeAuthService,
          generationService: fakeGenerationService,
          assetService: fakeAssetService,
          modelCatalog: fakeModelCatalog
        })
      ).not.toThrow();
    } finally {
      if (originalPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = originalPort;
      }
    }
  });

  it("includes auth dev codes when the default auth service is configured for local development", async () => {
    const server = buildServer({
      config: {
        port: 8787,
        gatewayBaseUrl: "https://gateway.gw-link.local",
        authDevCodesEnabled: true,
        modelConfigPath: "config/models.json"
      }
    });
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/start-login",
      payload: {
        destination: "creator@example.com"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      challengeId: expect.any(String),
      channel: "email",
      maskedDestination: "c***@example.com",
      expiresAt: expect.any(String),
      devCode: expect.stringMatching(/^\d{6}$/)
    });
  });

  it("omits auth dev codes when the default auth service is configured for production", async () => {
    const server = buildServer({
      config: {
        port: 8787,
        gatewayBaseUrl: "https://gateway.gw-link.local",
        authDevCodesEnabled: false,
        modelConfigPath: "config/models.json"
      }
    });
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/start-login",
      payload: {
        destination: "creator@example.com"
      }
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      challengeId: expect.any(String),
      channel: "email",
      maskedDestination: "c***@example.com",
      expiresAt: expect.any(String)
    });
    expect(body).not.toHaveProperty("devCode");
  });
});
