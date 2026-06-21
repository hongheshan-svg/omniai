import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiConfig } from "../config";
import type { ModelCatalogConfig } from "../services/modelConfig";
import { buildServer } from "../server";
import { createDbServices } from "../services/appServices";
import { ConfigModelCatalog } from "../services/modelCatalog";
import { createPgliteDatabase, type PgliteDatabase } from "../testSupport/pglite";

function smokeConfig(): ApiConfig {
  return {
    port: 8787,
    gatewayBaseUrl: "https://gateway.gw-link.local",
    authDevCodesEnabled: true,
    modelConfigPath: "config/models.json"
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
  const services = createDbServices(database.db, modelCatalog, { authDevCodesEnabled: true });
  return buildServer({
    config: smokeConfig(),
    modelCatalog,
    authService: services.authService,
    generationService: services.generationService,
    assetService: services.assetService
  });
}

describe("database-backed persistence", () => {
  let database: PgliteDatabase;

  beforeEach(async () => {
    database = await createPgliteDatabase();
  });

  afterEach(async () => {
    await database.close();
  });

  it("persists sessions, tasks, and assets across service instances", async () => {
    const first = buildServerForDb(database);

    const startResponse = await first.inject({
      method: "POST",
      url: "/v1/auth/start-login",
      payload: { destination: "creator@example.com" }
    });
    const { challengeId, devCode } = startResponse.json() as { challengeId: string; devCode: string };

    const verifyResponse = await first.inject({
      method: "POST",
      url: "/v1/auth/verify-login",
      payload: { challengeId, code: devCode }
    });
    const { token } = verifyResponse.json() as { token: string };

    await first.inject({
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

    await first.inject({
      method: "POST",
      url: "/v1/assets",
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

    // Simulate a process restart: brand-new server + services over the SAME database.
    const second = buildServerForDb(database);

    const sessionResponse = await second.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(sessionResponse.json()).toMatchObject({
      authenticated: true,
      user: { destination: "creator@example.com" }
    });

    const tasksResponse = await second.inject({ method: "GET", url: "/v1/generations" });
    expect(tasksResponse.json()).toMatchObject({
      tasks: [{ mode: "text", status: "queued", prompt: "帮我写一个新品发布文案" }]
    });

    const assetsResponse = await second.inject({ method: "GET", url: "/v1/assets" });
    expect(assetsResponse.json()).toMatchObject({
      assets: [{ mode: "text", title: "文本资产" }]
    });
  });
});
