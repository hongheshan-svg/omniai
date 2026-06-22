import { describe, expect, it, vi } from "vitest";
import type { ProviderGenerationRequest } from "../gatewayClient";
import { OpenAiCompatibleImageProvider } from "../openAiImageProvider";

function imageRequest(overrides: Partial<ProviderGenerationRequest> = {}): ProviderGenerationRequest {
  return {
    mode: "image",
    productModelId: "gw-image-creative",
    provider: {
      id: "openai-main",
      displayName: "OpenAI Main",
      protocol: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY"
    },
    providerModelId: "gpt-image-1",
    optimizedPrompt: "一只在霓虹城市里的猫",
    parameters: {},
    userId: "user-a",
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("OpenAiCompatibleImageProvider", () => {
  it("generates an image as a data URL when a key is configured", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ b64_json: "aGVsbG8=" }] }));
    const provider = new OpenAiCompatibleImageProvider({
      fetch: fetchMock as unknown as typeof fetch,
      env: { OPENAI_API_KEY: "sk-test" }
    });

    const result = await provider.submitGeneration(imageRequest());

    expect(result.status).toBe("succeeded");
    expect(result.result).toEqual({
      kind: "image",
      url: "data:image/png;base64,aGVsbG8=",
      alt: "一只在霓虹城市里的猫"
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body as string)).toEqual({ model: "gpt-image-1", prompt: "一只在霓虹城市里的猫" });
  });

  it("passes through a provider-returned url", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ url: "https://cdn.example/img.png" }] }));
    const provider = new OpenAiCompatibleImageProvider({
      fetch: fetchMock as unknown as typeof fetch,
      env: { OPENAI_API_KEY: "sk-test" }
    });

    const result = await provider.submitGeneration(imageRequest());

    expect(result.result).toEqual({
      kind: "image",
      url: "https://cdn.example/img.png",
      alt: "一只在霓虹城市里的猫"
    });
  });

  it("queues without a key and makes no request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const provider = new OpenAiCompatibleImageProvider({ fetch: fetchMock as unknown as typeof fetch, env: {} });

    const result = await provider.submitGeneration(imageRequest());

    expect(result.status).toBe("queued");
    expect(result.result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("queues a non-image request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const provider = new OpenAiCompatibleImageProvider({
      fetch: fetchMock as unknown as typeof fetch,
      env: { OPENAI_API_KEY: "sk-test" }
    });

    const result = await provider.submitGeneration(imageRequest({ mode: "text" }));

    expect(result.status).toBe("queued");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws 502 on a provider error response", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { message: "boom" } }, 500));
    const provider = new OpenAiCompatibleImageProvider({
      fetch: fetchMock as unknown as typeof fetch,
      env: { OPENAI_API_KEY: "sk-test" }
    });

    await expect(provider.submitGeneration(imageRequest())).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws 502 when the response has no image data", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    const provider = new OpenAiCompatibleImageProvider({
      fetch: fetchMock as unknown as typeof fetch,
      env: { OPENAI_API_KEY: "sk-test" }
    });

    await expect(provider.submitGeneration(imageRequest())).rejects.toMatchObject({ statusCode: 502 });
  });
});
