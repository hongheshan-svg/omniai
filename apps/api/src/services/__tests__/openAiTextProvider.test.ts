import { describe, expect, it, vi } from "vitest";
import { ProviderAdapterError, type ProviderGenerationRequest } from "../gatewayClient";
import { OpenAiCompatibleTextProvider } from "../openAiTextProvider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function textRequest(overrides: Partial<ProviderGenerationRequest> = {}): ProviderGenerationRequest {
  return {
    mode: "text",
    productModelId: "gw-text-balanced",
    provider: {
      id: "openai-main",
      displayName: "OpenAI Main",
      protocol: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY"
    },
    providerModelId: "gpt-4.1-mini",
    optimizedPrompt: "请生成一段新品推广文案。",
    parameters: { tone: "warm" },
    userId: "user-1",
    ...overrides
  };
}

const clock = { now: () => new Date("2026-06-21T00:00:00.000Z") };

describe("OpenAiCompatibleTextProvider", () => {
  it("calls chat/completions and returns a succeeded text result", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { role: "assistant", content: "新品上市文案" } }] })
    );
    const provider = new OpenAiCompatibleTextProvider({
      fetch: fetchMock as unknown as typeof fetch,
      env: { OPENAI_API_KEY: "sk-test" },
      clock
    });

    const result = await provider.submitGeneration(textRequest());

    expect(result.status).toBe("succeeded");
    expect(result.result).toEqual({ kind: "text", text: "新品上市文案", format: "markdown" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "请生成一段新品推广文案。" }]
    });
  });

  it("falls back to queued (no fetch) when the API key is absent", async () => {
    const fetchMock = vi.fn();
    const provider = new OpenAiCompatibleTextProvider({
      fetch: fetchMock as unknown as typeof fetch,
      env: {},
      clock
    });

    const result = await provider.submitGeneration(textRequest());

    expect(result.status).toBe("queued");
    expect(result.result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to queued for non-text modes", async () => {
    const fetchMock = vi.fn();
    const provider = new OpenAiCompatibleTextProvider({
      fetch: fetchMock as unknown as typeof fetch,
      env: { OPENAI_API_KEY: "sk-test" },
      clock
    });

    const result = await provider.submitGeneration(textRequest({ mode: "image" }));

    expect(result.status).toBe("queued");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a non-2xx provider response to a 502 ProviderAdapterError using the provider message", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { message: "model overloaded" } }, 503));
    const provider = new OpenAiCompatibleTextProvider({
      fetch: fetchMock as unknown as typeof fetch,
      env: { OPENAI_API_KEY: "sk-test" },
      clock
    });

    await expect(provider.submitGeneration(textRequest())).rejects.toMatchObject({
      name: "ProviderAdapterError",
      message: "model overloaded",
      statusCode: 502
    });
  });

  it("maps a network failure to a 502 ProviderAdapterError", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const provider = new OpenAiCompatibleTextProvider({
      fetch: fetchMock as unknown as typeof fetch,
      env: { OPENAI_API_KEY: "sk-test" },
      clock
    });

    await expect(provider.submitGeneration(textRequest())).rejects.toBeInstanceOf(ProviderAdapterError);
  });

  it("errors when the provider returns no content", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "" } }] }));
    const provider = new OpenAiCompatibleTextProvider({
      fetch: fetchMock as unknown as typeof fetch,
      env: { OPENAI_API_KEY: "sk-test" },
      clock
    });

    await expect(provider.submitGeneration(textRequest())).rejects.toMatchObject({
      message: "Provider returned no content",
      statusCode: 502
    });
  });
});
