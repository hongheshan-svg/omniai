import { describe, expect, it } from "vitest";
import {
  FakeProviderAdapter,
  ProviderAdapterError,
  type ProviderGenerationRequest
} from "../gatewayClient";

function createRequest(protocol: ProviderGenerationRequest["provider"]["protocol"]): ProviderGenerationRequest {
  return {
    mode: "text",
    productModelId: "gw-text-balanced",
    provider: {
      id: protocol === "openai-compatible" ? "openai-main" : "anthropic-main",
      displayName: protocol === "openai-compatible" ? "OpenAI Main" : "Anthropic Main",
      protocol,
      baseUrl: protocol === "openai-compatible" ? "https://api.openai.com/v1" : "https://api.anthropic.com",
      apiKeyEnv: protocol === "openai-compatible" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"
    },
    providerModelId: protocol === "openai-compatible" ? "gpt-4.1-mini" : "claude-sonnet",
    optimizedPrompt: "Write a launch post.",
    parameters: { tone: "clear" },
    userId: "development-user"
  };
}

function createAdapter() {
  return new FakeProviderAdapter({
    clock: {
      now: () => new Date("2026-06-20T12:00:00.000Z")
    }
  });
}

describe("FakeProviderAdapter", () => {
  it("queues dry-run OpenAI-compatible provider generations without reading API keys", async () => {
    const restoreEnv = blockEnvironmentAccess();

    try {
      await expect(createAdapter().submitGeneration(createRequest("openai-compatible"))).resolves.toEqual({
        status: "queued",
        providerId: "openai-main",
        providerProtocol: "openai-compatible",
        providerModelId: "gpt-4.1-mini",
        submittedAt: "2026-06-20T12:00:00.000Z"
      });
    } finally {
      restoreEnv();
    }
  });

  it("queues dry-run Anthropic-compatible provider generations", async () => {
    await expect(createAdapter().submitGeneration(createRequest("anthropic-compatible"))).resolves.toEqual({
      status: "queued",
      providerId: "anthropic-main",
      providerProtocol: "anthropic-compatible",
      providerModelId: "claude-sonnet",
      submittedAt: "2026-06-20T12:00:00.000Z"
    });
  });

  it("rejects unsupported provider protocols with a provider adapter error", async () => {
    const request = {
      ...createRequest("openai-compatible"),
      provider: {
        ...createRequest("openai-compatible").provider,
        protocol: "custom-provider"
      }
    } as unknown as ProviderGenerationRequest;

    await expect(createAdapter().submitGeneration(request)).rejects.toMatchObject({
      name: "ProviderAdapterError",
      message: "Provider protocol is not supported",
      statusCode: 502
    });
    await expect(createAdapter().submitGeneration(request)).rejects.toBeInstanceOf(ProviderAdapterError);
  });
});

function blockEnvironmentAccess(): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, "env");
  if (originalDescriptor === undefined) {
    throw new Error("Cannot block environment variable access");
  }

  Object.defineProperty(process, "env", {
    configurable: true,
    get() {
      throw new Error("Environment variables should not be read by the fake provider adapter");
    }
  });

  return () => {
    Object.defineProperty(process, "env", originalDescriptor);
  };
}
