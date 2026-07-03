import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import { AssetError, InMemoryAssetService, type AssetService } from "../../services/assetService";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

const testConfig = {
  port: 8787,
  gatewayBaseUrl: "https://gateway.gw-link.local",
  authDevCodesEnabled: true,
  modelConfigPath: "config/models.json",
  packagesConfigPath: "config/credit-packages.json",
  initialCredits: 100,
  publicBaseUrl: "http://localhost:8787",
  devTopupEnabled: true
};

function buildAssetTestServer() {
  return buildServer({
    config: testConfig,
    assetService: new InMemoryAssetService({
      clock: { now: () => fixedNow },
      idGenerator: () => "creation_asset_000001"
    })
  });
}

async function authenticate(server: ReturnType<typeof buildAssetTestServer>): Promise<string> {
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

function createImagePayload() {
  return {
    mode: "image",
    title: "图片资产",
    content: {
      kind: "image",
      url: "https://assets.gw-link.local/placeholders/image-generation.png",
      alt: "咖啡店新品海报占位图"
    },
    source: {
      taskId: "generation_task_000001",
      taskStatus: "succeeded"
    },
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

describe("asset routes", () => {
  it("creates and lists creation assets", async () => {
    const server = buildAssetTestServer();
    const token = await authenticate(server);
    const createResponse = await server.inject({
      method: "POST",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${token}` },
      payload: createImagePayload()
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toEqual({
      asset: {
        id: "creation_asset_000001",
        mode: "image",
        title: "图片资产",
        content: {
          kind: "image",
          url: "https://assets.gw-link.local/placeholders/image-generation.png",
          alt: "咖啡店新品海报占位图"
        },
        preview: {
          title: "图片资产",
          description: "占位图片资产，后续阶段将接入真实图片文件。"
        },
        source: {
          taskId: "generation_task_000001",
          taskStatus: "succeeded"
        },
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
        createdAt: "2026-06-20T00:00:00.000Z"
      }
    });

    const listResponse = await server.inject({
      method: "GET",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({
      assets: [createResponse.json().asset]
    });
  });

  it("rejects malformed asset requests", async () => {
    const server = buildAssetTestServer();
    const token = await authenticate(server);
    const valid = createImagePayload();
    const invalidPayloads = [
      {},
      { mode: "image" },
      { mode: "image", title: "图片资产" },
      { mode: "image", title: "图片资产", content: valid.content },
      { ...valid, title: 123 },
      { ...valid, content: "not-content" },
      { ...valid, source: "not-source" },
      { ...valid, preset: "not-preset" },
      ["image", "图片资产"]
    ];

    for (const payload of invalidPayloads) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/assets",
        headers: { authorization: `Bearer ${token}` },
        payload
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "Invalid asset request"
      });
    }
  });

  it("maps asset domain errors to HTTP responses", async () => {
    const server = buildAssetTestServer();
    const token = await authenticate(server);
    const unsupportedMode = await server.inject({
      method: "POST",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...createImagePayload(),
        mode: "audio"
      }
    });
    const emptyTitle = await server.inject({
      method: "POST",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...createImagePayload(),
        title: " "
      }
    });
    const invalidContent = await server.inject({
      method: "POST",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...createImagePayload(),
        content: {
          kind: "image",
          url: "",
          alt: "missing url"
        }
      }
    });
    const invalidSource = await server.inject({
      method: "POST",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...createImagePayload(),
        source: {
          taskId: "",
          taskStatus: "succeeded"
        }
      }
    });

    expect(unsupportedMode.statusCode).toBe(400);
    expect(unsupportedMode.json()).toEqual({ error: "Unsupported asset mode" });
    expect(emptyTitle.statusCode).toBe(400);
    expect(emptyTitle.json()).toEqual({ error: "Asset title is required" });
    expect(invalidContent.statusCode).toBe(400);
    expect(invalidContent.json()).toEqual({ error: "Invalid asset content" });
    expect(invalidSource.statusCode).toBe(400);
    expect(invalidSource.json()).toEqual({ error: "Invalid asset source" });
  });

  it("maps unexpected asset service errors to a 500 response", async () => {
    const assetService = {
      createAsset: (_request: unknown, _userId: string) => {
        throw new Error("boom");
      },
      listAssets: (_userId: string) => []
    } satisfies AssetService;
    const server = buildServer({ config: testConfig, assetService });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${token}` },
      payload: createImagePayload()
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "Unexpected asset error"
    });
  });

  it("maps async rejected asset creation errors to a 500 response", async () => {
    const assetService = {
      createAsset: async (_request: unknown, _userId: string) => {
        throw new Error("boom");
      },
      listAssets: (_userId: string) => []
    } as unknown as AssetService;
    const server = buildServer({ config: testConfig, assetService });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${token}` },
      payload: createImagePayload()
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "Unexpected asset error"
    });
  });

  it("maps asset errors from injected services", async () => {
    const assetService = {
      createAsset: (_request: unknown, _userId: string) => {
        throw new AssetError("Invalid asset source", 422);
      },
      listAssets: (_userId: string) => []
    } satisfies AssetService;
    const server = buildServer({ config: testConfig, assetService });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${token}` },
      payload: createImagePayload()
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: "Invalid asset source"
    });
  });

  it("maps unexpected asset list errors to a 500 response", async () => {
    const assetService = {
      createAsset: (_request: unknown, _userId: string) => {
        throw new Error("not implemented");
      },
      listAssets: (_userId: string) => {
        throw new Error("boom");
      }
    } satisfies AssetService;
    const server = buildServer({ config: testConfig, assetService });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "GET",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "Unexpected asset error"
    });
  });

  it("maps asset list errors from injected services", async () => {
    const assetService = {
      createAsset: (_request: unknown, _userId: string) => {
        throw new Error("not implemented");
      },
      listAssets: (_userId: string) => {
        throw new AssetError("Asset library unavailable", 503);
      }
    } satisfies AssetService;
    const server = buildServer({ config: testConfig, assetService });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "GET",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "Asset library unavailable"
    });
  });
});
