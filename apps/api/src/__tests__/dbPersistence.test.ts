import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiConfig } from "../config";
import type { ModelCatalogConfig } from "../services/modelConfig";
import { buildServer } from "../server";
import { createDbServices } from "../services/appServices";
import { FakeProviderAdapter } from "../services/gatewayClient";
import { InMemoryObjectStore } from "../services/objectStore";
import { ConfigModelCatalog } from "../services/modelCatalog";
import { createPgliteDatabase, type PgliteDatabase } from "../testSupport/pglite";

function smokeConfig(): ApiConfig {
  return {
    port: 8787,
    gatewayBaseUrl: "https://gateway.gw-link.local",
    authDevCodesEnabled: true,
    modelConfigPath: "config/models.json",
    packagesConfigPath: "config/credit-packages.json",
    initialCredits: 100,
    publicBaseUrl: "http://localhost:8787",
    devTopupEnabled: true
  };
}

function modelConfig(): ModelCatalogConfig {
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
          }
        ]
      }
    ]
  };
}

function buildServerForDb(database: PgliteDatabase) {
  const modelCatalog = new ConfigModelCatalog(modelConfig());
  const services = createDbServices(database.db, modelCatalog, {
    authDevCodesEnabled: true,
    initialCredits: 100,
    objectStore: new InMemoryObjectStore(),
    providerAdapter: new FakeProviderAdapter()
  });
  return buildServer({
    config: smokeConfig(),
    modelCatalog,
    authService: services.authService,
    generationService: services.generationService,
    assetService: services.assetService
  });
}

async function login(server: ReturnType<typeof buildServerForDb>, destination: string): Promise<string> {
  const start = await server.inject({ method: "POST", url: "/v1/auth/start-login", payload: { destination } });
  const { challengeId, devCode } = start.json() as { challengeId: string; devCode: string };
  const verify = await server.inject({ method: "POST", url: "/v1/auth/verify-login", payload: { challengeId, code: devCode } });
  return (verify.json() as { token: string }).token;
}

describe("database-backed persistence", () => {
  let database: PgliteDatabase;

  beforeEach(async () => {
    database = await createPgliteDatabase();
  });

  afterEach(async () => {
    await database.close();
  });

  it("isolates tasks and assets between users", async () => {
    const server = buildServerForDb(database);
    const tokenA = await login(server, "alice@example.com");
    const tokenB = await login(server, "bob@example.com");

    await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        mode: "text",
        prompt: "Alice 的任务",
        optimizedPrompt: "Alice 的优化提示。",
        preset: {
          modelId: "gw-text-balanced",
          parameters: { outputFormat: "markdown", tone: "clear" },
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });

    const aliceList = await server.inject({
      method: "GET",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect((aliceList.json() as { tasks: unknown[] }).tasks).toHaveLength(1);

    const bobList = await server.inject({
      method: "GET",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${tokenB}` }
    });
    expect(bobList.json()).toEqual({ tasks: [] });
  });

  it("persists sessions, tasks, and assets across service instances", async () => {
    const first = buildServerForDb(database);
    const token = await login(first, "creator@example.com");
    const auth = { authorization: `Bearer ${token}` };

    await first.inject({
      method: "POST",
      url: "/v1/generations",
      headers: auth,
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

    await first.inject({
      method: "POST",
      url: "/v1/assets",
      headers: auth,
      payload: {
        mode: "text",
        title: "文本资产",
        content: { kind: "text", text: "这是一段可复用的新品推广文案。", format: "markdown" },
        source: { taskId: "generation_task_000001", taskStatus: "succeeded" },
        prompt: "帮我写一个新品发布文案",
        optimizedPrompt: "请生成一段新品推广文案。",
        preset: {
          modelId: "gw-text-balanced",
          parameters: { outputFormat: "markdown", tone: "clear" },
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });

    const second = buildServerForDb(database);
    const sessionResponse = await second.inject({ method: "GET", url: "/v1/auth/session", headers: auth });
    expect(sessionResponse.json()).toMatchObject({ authenticated: true, user: { destination: "creator@example.com" } });

    const tasksResponse = await second.inject({ method: "GET", url: "/v1/generations", headers: auth });
    expect(tasksResponse.json()).toMatchObject({
      tasks: [{ mode: "text", status: "queued", prompt: "帮我写一个新品发布文案" }]
    });

    const assetsResponse = await second.inject({ method: "GET", url: "/v1/assets", headers: auth });
    expect(assetsResponse.json()).toMatchObject({
      assets: [{ mode: "text", title: "文本资产" }]
    });
  });
});
