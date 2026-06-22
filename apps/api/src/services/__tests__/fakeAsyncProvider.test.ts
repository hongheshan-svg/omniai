import { describe, expect, it } from "vitest";
import type { ProviderGenerationRequest, ProviderPollRequest } from "../gatewayClient";
import { FakeAsyncProvider } from "../fakeAsyncProvider";

const provider = {
  id: "video-main",
  displayName: "Video Main",
  protocol: "anthropic-compatible" as const,
  baseUrl: "https://video",
  apiKeyEnv: "VIDEO_KEY"
};

function submitReq(): ProviderGenerationRequest {
  return {
    mode: "video",
    productModelId: "gw-video-motion",
    provider,
    providerModelId: "claude-video",
    optimizedPrompt: "一段短视频",
    parameters: {},
    userId: "user-a"
  };
}

function pollReq(providerRef: string): ProviderPollRequest {
  return { mode: "video", provider, providerModelId: "claude-video", providerRef };
}

describe("FakeAsyncProvider", () => {
  it("submits a running task with a provider reference", async () => {
    const fake = new FakeAsyncProvider({ idGenerator: () => "job-1" });
    const result = await fake.submitGeneration(submitReq());
    expect(result.status).toBe("running");
    expect(result.providerRef).toBe("job-1");
    expect(result.result).toBeUndefined();
  });

  it("stays running until the configured number of polls, then succeeds", async () => {
    const fake = new FakeAsyncProvider({ pollsUntilDone: 2, idGenerator: () => "job-1" });
    const { providerRef } = await fake.submitGeneration(submitReq());

    expect((await fake.pollGeneration(pollReq(providerRef!))).status).toBe("running");
    expect((await fake.pollGeneration(pollReq(providerRef!))).status).toBe("running");
    const done = await fake.pollGeneration(pollReq(providerRef!));
    expect(done.status).toBe("succeeded");
    expect(done.result).toEqual({ kind: "image", url: "data:image/png;base64,dmlkZW8=", alt: "video" });
  });

  it("succeeds immediately when pollsUntilDone is 0", async () => {
    const fake = new FakeAsyncProvider({ pollsUntilDone: 0, idGenerator: () => "job-1" });
    const { providerRef } = await fake.submitGeneration(submitReq());
    expect((await fake.pollGeneration(pollReq(providerRef!))).status).toBe("succeeded");
  });
});
