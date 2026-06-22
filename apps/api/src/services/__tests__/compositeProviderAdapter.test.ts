import { describe, expect, it } from "vitest";
import type { ProviderAdapter, ProviderGenerationRequest, ProviderGenerationResult } from "../gatewayClient";
import { CompositeProviderAdapter } from "../compositeProviderAdapter";

function request(mode: ProviderGenerationRequest["mode"]): ProviderGenerationRequest {
  return {
    mode,
    productModelId: "m",
    provider: { id: "p", displayName: "P", protocol: "openai-compatible", baseUrl: "https://x", apiKeyEnv: "K" },
    providerModelId: "pm",
    optimizedPrompt: "p",
    parameters: {},
    userId: "u"
  };
}

function stub(id: string): ProviderAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async submitGeneration(req): Promise<ProviderGenerationResult> {
      calls.push(req.mode);
      return {
        status: "queued",
        providerId: id,
        providerProtocol: "openai-compatible",
        providerModelId: "pm",
        submittedAt: "2026-06-22T00:00:00.000Z"
      };
    }
  };
}

describe("CompositeProviderAdapter", () => {
  it("routes image requests to the image provider", async () => {
    const text = stub("text");
    const image = stub("image");
    const adapter = new CompositeProviderAdapter({ text, image });

    const result = await adapter.submitGeneration(request("image"));

    expect(result.providerId).toBe("image");
    expect(image.calls).toEqual(["image"]);
    expect(text.calls).toEqual([]);
  });

  it("routes text and video requests to the text provider", async () => {
    const text = stub("text");
    const image = stub("image");
    const adapter = new CompositeProviderAdapter({ text, image });

    await adapter.submitGeneration(request("text"));
    await adapter.submitGeneration(request("video"));

    expect(text.calls).toEqual(["text", "video"]);
    expect(image.calls).toEqual([]);
  });
});
