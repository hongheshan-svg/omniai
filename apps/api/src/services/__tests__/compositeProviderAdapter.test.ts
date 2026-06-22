import { describe, expect, it } from "vitest";
import type {
  ProviderAdapter,
  ProviderGenerationRequest,
  ProviderGenerationResult,
  ProviderPollRequest
} from "../gatewayClient";
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

function pollRequest(mode: ProviderPollRequest["mode"]): ProviderPollRequest {
  return {
    mode,
    provider: { id: "p", displayName: "P", protocol: "openai-compatible", baseUrl: "https://x", apiKeyEnv: "K" },
    providerModelId: "pm",
    providerRef: "ref-1"
  };
}

function stub(id: string): ProviderAdapter & { calls: string[]; polls: string[] } {
  const calls: string[] = [];
  const polls: string[] = [];
  return {
    calls,
    polls,
    async submitGeneration(req): Promise<ProviderGenerationResult> {
      calls.push(req.mode);
      return {
        status: "queued",
        providerId: id,
        providerProtocol: "openai-compatible",
        providerModelId: "pm",
        submittedAt: "2026-06-22T00:00:00.000Z"
      };
    },
    async pollGeneration(req): Promise<ProviderGenerationResult> {
      polls.push(req.mode);
      return {
        status: "running",
        providerId: id,
        providerProtocol: "openai-compatible",
        providerModelId: "pm",
        submittedAt: "2026-06-22T00:00:00.000Z",
        providerRef: req.providerRef
      };
    }
  };
}

describe("CompositeProviderAdapter", () => {
  it("routes submit by mode", async () => {
    const text = stub("text");
    const image = stub("image");
    const video = stub("video");
    const adapter = new CompositeProviderAdapter({ text, image, video });

    await adapter.submitGeneration(request("text"));
    await adapter.submitGeneration(request("image"));
    await adapter.submitGeneration(request("video"));

    expect(text.calls).toEqual(["text"]);
    expect(image.calls).toEqual(["image"]);
    expect(video.calls).toEqual(["video"]);
  });

  it("routes poll by mode", async () => {
    const text = stub("text");
    const image = stub("image");
    const video = stub("video");
    const adapter = new CompositeProviderAdapter({ text, image, video });

    const result = await adapter.pollGeneration(pollRequest("video"));

    expect(result.providerId).toBe("video");
    expect(video.polls).toEqual(["video"]);
    expect(text.polls).toEqual([]);
  });
});
