import { describe, expect, it, vi } from "vitest";
import type { ProviderGenerationRequest, ProviderPollRequest } from "../gatewayClient";
import { AsyncVideoProvider } from "../asyncVideoProvider";

const provider = {
  id: "video-main",
  displayName: "Video Main",
  protocol: "openai-compatible" as const,
  baseUrl: "https://api.video.test/v1",
  apiKeyEnv: "VIDEO_KEY"
};

function submitReq(overrides: Partial<ProviderGenerationRequest> = {}): ProviderGenerationRequest {
  return {
    mode: "video",
    productModelId: "gw-video-motion",
    provider,
    providerModelId: "video-1",
    optimizedPrompt: "一段海边日落短视频",
    parameters: {},
    userId: "user-a",
    ...overrides
  };
}

function pollReq(providerRef: string): ProviderPollRequest {
  return { mode: "video", provider, providerModelId: "video-1", providerRef };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("AsyncVideoProvider", () => {
  it("submits a running job with a provider reference", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "job-1" }));
    const fake = new AsyncVideoProvider({ fetch: fetchMock as unknown as typeof fetch, env: { VIDEO_KEY: "k" } });

    const result = await fake.submitGeneration(submitReq());

    expect(result.status).toBe("running");
    expect(result.providerRef).toBe("job-1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.video.test/v1/videos/generations");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string)).toEqual({ model: "video-1", prompt: "一段海边日落短视频" });
  });

  it("polls a completed job into a video result", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: "completed", url: "https://cdn/v.mp4", poster_url: "https://cdn/p.jpg", duration_seconds: 8 })
    );
    const fake = new AsyncVideoProvider({ fetch: fetchMock as unknown as typeof fetch, env: { VIDEO_KEY: "k" } });

    const result = await fake.pollGeneration(pollReq("job-1"));

    expect(result.status).toBe("succeeded");
    expect(result.result).toEqual({
      kind: "video",
      url: "https://cdn/v.mp4",
      durationSeconds: 8,
      posterUrl: "https://cdn/p.jpg"
    });
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.video.test/v1/videos/generations/job-1");
  });

  it("defaults missing poster and duration", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: "completed", url: "https://cdn/v.mp4" }));
    const fake = new AsyncVideoProvider({ fetch: fetchMock as unknown as typeof fetch, env: { VIDEO_KEY: "k" } });

    const result = await fake.pollGeneration(pollReq("job-1"));

    expect(result.result).toEqual({ kind: "video", url: "https://cdn/v.mp4", durationSeconds: 0, posterUrl: "" });
  });

  it("maps in_progress to running and failed to failed", async () => {
    const running = new AsyncVideoProvider({
      fetch: (async () => jsonResponse({ status: "in_progress" })) as unknown as typeof fetch,
      env: { VIDEO_KEY: "k" }
    });
    expect((await running.pollGeneration(pollReq("job-1"))).status).toBe("running");

    const failed = new AsyncVideoProvider({
      fetch: (async () => jsonResponse({ status: "failed" })) as unknown as typeof fetch,
      env: { VIDEO_KEY: "k" }
    });
    expect((await failed.pollGeneration(pollReq("job-1"))).status).toBe("failed");
  });

  it("queues without a key and makes no request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const fake = new AsyncVideoProvider({ fetch: fetchMock as unknown as typeof fetch, env: {} });

    const result = await fake.submitGeneration(submitReq());

    expect(result.status).toBe("queued");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("queues a non-video request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const fake = new AsyncVideoProvider({ fetch: fetchMock as unknown as typeof fetch, env: { VIDEO_KEY: "k" } });
    expect((await fake.submitGeneration(submitReq({ mode: "text" }))).status).toBe("queued");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws 502 on a provider error and on a completed job without a url", async () => {
    const errored = new AsyncVideoProvider({
      fetch: (async () => jsonResponse({ error: { message: "boom" } }, 500)) as unknown as typeof fetch,
      env: { VIDEO_KEY: "k" }
    });
    await expect(errored.submitGeneration(submitReq())).rejects.toMatchObject({ statusCode: 502 });

    const noUrl = new AsyncVideoProvider({
      fetch: (async () => jsonResponse({ status: "completed" })) as unknown as typeof fetch,
      env: { VIDEO_KEY: "k" }
    });
    await expect(noUrl.pollGeneration(pollReq("job-1"))).rejects.toMatchObject({ statusCode: 502 });
  });
});
