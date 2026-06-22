import { describe, expect, it } from "vitest";
import { buildServer } from "../server";
import type { AssetService } from "../services/assetService";
import type { AuthService } from "../services/authService";
import type { GenerationService } from "../services/generationService";
import { FakeProviderAdapter } from "../services/gatewayClient";
import { ConfigModelCatalog } from "../services/modelCatalog";
import type { ModelCatalog } from "../services/modelCatalog";
import type { ModelCatalogConfig } from "../services/modelConfig";
import { OpenAiCompatibleTextProvider } from "../services/openAiTextProvider";
import { OpenAiCompatibleImageProvider } from "../services/openAiImageProvider";
import { CompositeProviderAdapter } from "../services/compositeProviderAdapter";
import { InMemoryObjectStore } from "../services/objectStore";
import { FakeAsyncProvider } from "../services/fakeAsyncProvider";

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

  async function authenticate(server: ReturnType<typeof buildServer>): Promise<string> {
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

  it("registers the generation routes", async () => {
    const server = buildServer({ providerAdapter: new FakeProviderAdapter() });
    const token = await authenticate(server);
    const createResponse = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
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
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` }
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

  it("rejects unauthenticated generation requests", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        mode: "text",
        prompt: "帮我写一个新品发布文案",
        optimizedPrompt: "请生成一段新品推广文案。",
        preset: {
          modelId: "gw-text-balanced",
          parameters: { outputFormat: "markdown", tone: "clear" },
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Authentication required" });
  });

  it("returns a succeeded text task with a result when a provider key is configured", async () => {
    const modelConfig: ModelCatalogConfig = {
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
            }
          ]
        }
      ]
    };
    const fetchMock = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "真实生成文案" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    const server = buildServer({
      modelCatalog: new ConfigModelCatalog(modelConfig),
      providerAdapter: new OpenAiCompatibleTextProvider({
        fetch: fetchMock as unknown as typeof fetch,
        env: { OPENAI_API_KEY: "sk-test" }
      })
    });
    const token = await authenticate(server);

    const response = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: "text",
        prompt: "帮我写一个新品发布文案",
        optimizedPrompt: "请生成一段新品推广文案。",
        preset: {
          modelId: "gw-text-balanced",
          parameters: { outputFormat: "markdown", tone: "clear" },
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      task: { status: "succeeded", result: { kind: "text", text: "真实生成文案" } }
    });
  });

  it("returns a succeeded image task with a data-url result when a provider key is configured", async () => {
    const modelConfig: ModelCatalogConfig = {
      providers: [
        {
          id: "openai-main",
          displayName: "OpenAI Main",
          protocol: "openai-compatible",
          baseUrl: "https://api.openai.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
          models: [
            {
              id: "gw-image-creative",
              providerModelId: "gpt-image-1",
              displayName: "OmniAI Image Creative",
              capability: "image",
              tags: ["creative"],
              visibility: "visible",
              minimumPlan: "free",
              creditUnitCost: 2
            }
          ]
        }
      ]
    };
    const imageFetch = async () =>
      new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    const server = buildServer({
      modelCatalog: new ConfigModelCatalog(modelConfig),
      providerAdapter: new CompositeProviderAdapter({
        text: new OpenAiCompatibleTextProvider(),
        image: new OpenAiCompatibleImageProvider({
          fetch: imageFetch as unknown as typeof fetch,
          env: { OPENAI_API_KEY: "sk-test" }
        }),
        video: new OpenAiCompatibleTextProvider()
      })
    });
    const token = await authenticate(server);

    const response = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: "image",
        prompt: "一只猫",
        optimizedPrompt: "一只在霓虹城市里的猫",
        preset: {
          modelId: "gw-image-creative",
          parameters: { quality: "high" },
          creditEstimate: { credits: 2, unit: "credit" }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      task: { status: "succeeded", result: { kind: "image", url: "data:image/png;base64,aGVsbG8=" } }
    });

    const balanceResponse = await server.inject({
      method: "GET",
      url: "/v1/credits/balance",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(balanceResponse.json()).toEqual({ balance: { credits: 98, unit: "credit" } });
  });

  it("registers the asset routes", async () => {
    const server = buildServer();
    const token = await authenticate(server);
    const createResponse = await server.inject({
      method: "POST",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${token}` },
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
      url: "/v1/assets",
      headers: { authorization: `Bearer ${token}` }
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

  it("rejects unauthenticated asset requests", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/v1/assets"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Authentication required" });
  });

  it("returns the authenticated user's credit balance", async () => {
    const server = buildServer();
    const token = await authenticate(server);
    const response = await server.inject({
      method: "GET",
      url: "/v1/credits/balance",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ balance: { credits: 100, unit: "credit" } });
  });

  it("rejects unauthenticated credit balance requests", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/v1/credits/balance" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Authentication required" });
  });

  it("stores a generated image and serves it from /files", async () => {
    const modelConfig: ModelCatalogConfig = {
      providers: [
        {
          id: "openai-main",
          displayName: "OpenAI Main",
          protocol: "openai-compatible",
          baseUrl: "https://api.openai.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
          models: [
            {
              id: "gw-image-creative",
              providerModelId: "gpt-image-1",
              displayName: "OmniAI Image Creative",
              capability: "image",
              tags: ["creative"],
              visibility: "visible",
              minimumPlan: "free",
              creditUnitCost: 2
            }
          ]
        }
      ]
    };
    const imageFetch = async () =>
      new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    const objectStore = new InMemoryObjectStore({ publicBaseUrl: "http://localhost:8787" });
    const server = buildServer({
      objectStore,
      modelCatalog: new ConfigModelCatalog(modelConfig),
      providerAdapter: new CompositeProviderAdapter({
        text: new OpenAiCompatibleTextProvider(),
        image: new OpenAiCompatibleImageProvider({
          fetch: imageFetch as unknown as typeof fetch,
          env: { OPENAI_API_KEY: "sk-test" },
          objectStore
        }),
        video: new OpenAiCompatibleTextProvider()
      })
    });
    const token = await authenticate(server);

    const createResponse = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: "image",
        prompt: "一只猫",
        optimizedPrompt: "一只在霓虹城市里的猫",
        preset: {
          modelId: "gw-image-creative",
          parameters: { quality: "high" },
          creditEstimate: { credits: 2, unit: "credit" }
        }
      }
    });

    const url = (createResponse.json() as { task: { result: { url: string } } }).task.result.url;
    expect(url).toMatch(/^http:\/\/localhost:8787\/files\/.+\.png$/);

    const fileResponse = await server.inject({ method: "GET", url: url.replace("http://localhost:8787", "") });
    expect(fileResponse.statusCode).toBe(200);
    expect(fileResponse.headers["content-type"]).toContain("image/png");
    expect(fileResponse.body).toBe("hello");
  });

  it("advances a running task to succeeded via GET /v1/generations/:id", async () => {
    const modelConfig: ModelCatalogConfig = {
      providers: [
        {
          id: "video-main",
          displayName: "Video Main",
          protocol: "anthropic-compatible",
          baseUrl: "https://video",
          apiKeyEnv: "VIDEO_KEY",
          models: [
            {
              id: "gw-video-motion",
              providerModelId: "claude-video",
              displayName: "OmniAI Video Motion",
              capability: "video",
              tags: ["motion"],
              visibility: "visible",
              minimumPlan: "free",
              creditUnitCost: 3
            }
          ]
        }
      ]
    };
    const textProvider = new OpenAiCompatibleTextProvider();
    const server = buildServer({
      modelCatalog: new ConfigModelCatalog(modelConfig),
      providerAdapter: new CompositeProviderAdapter({
        text: textProvider,
        image: textProvider,
        video: new FakeAsyncProvider({ pollsUntilDone: 1 })
      })
    });
    const token = await authenticate(server);

    const create = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: "video",
        prompt: "一段短视频",
        optimizedPrompt: "生成一段短视频。",
        preset: { modelId: "gw-video-motion", parameters: {}, creditEstimate: { credits: 3, unit: "credit" } }
      }
    });
    expect(create.json()).toMatchObject({ task: { status: "running" } });
    const id = (create.json() as { task: { id: string } }).task.id;

    const running = await server.inject({
      method: "GET",
      url: `/v1/generations/${id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(running.json()).toMatchObject({ task: { status: "running" } });

    const done = await server.inject({
      method: "GET",
      url: `/v1/generations/${id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(done.json()).toMatchObject({ task: { status: "succeeded", result: { kind: "image" } } });

    const balance = await server.inject({
      method: "GET",
      url: "/v1/credits/balance",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(balance.json()).toEqual({ balance: { credits: 97, unit: "credit" } });
  });

  it("serves a stored file at /files/:id", async () => {
    const store = new InMemoryObjectStore({ publicBaseUrl: "http://localhost:8787", idGenerator: () => "obj1" });
    const { id } = await store.put(new TextEncoder().encode("hello"), "image/png");
    const server = buildServer({ objectStore: store });

    const response = await server.inject({ method: "GET", url: `/files/${id}` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.body).toBe("hello");
  });

  it("returns 404 for an unknown file id", async () => {
    const server = buildServer({ objectStore: new InMemoryObjectStore() });
    const response = await server.inject({ method: "GET", url: "/files/missing.png" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "File not found" });
  });

  it("reflects the request origin via CORS headers", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/v1/models",
      headers: { origin: "http://localhost:1420" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:1420");
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
      createTask: (_request: unknown, _userId: string) => {
        throw new Error("not implemented");
      },
      listTasks: (_userId: string) => [],
      refreshTask: (_id: string, _userId: string) => {
        throw new Error("not implemented");
      }
    } satisfies GenerationService;
    const fakeAssetService = {
      createAsset: (_request: unknown, _userId: string) => {
        throw new Error("not implemented");
      },
      listAssets: (_userId: string) => []
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
        modelConfigPath: "config/models.json",
        initialCredits: 100,
        publicBaseUrl: "http://localhost:8787"
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
        modelConfigPath: "config/models.json",
        initialCredits: 100,
        publicBaseUrl: "http://localhost:8787"
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
