import type { GenerationTaskResult } from "@gw-link-omniai/shared";
import {
  ProviderAdapterError,
  type ProviderAdapter,
  type ProviderGenerationRequest,
  type ProviderGenerationResult,
  type ProviderPollRequest
} from "./gatewayClient";
import { readProviderError } from "./openAiTextProvider";

export interface AsyncVideoProviderOptions {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  clock?: { now(): Date };
}

export class AsyncVideoProvider implements ProviderAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly env: Record<string, string | undefined>;
  private readonly clock: { now(): Date };

  constructor(options: AsyncVideoProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.env = options.env ?? process.env;
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    const base = this.base(request.provider.id, request.provider.protocol, request.providerModelId);
    const apiKey = this.env[request.provider.apiKeyEnv];
    if (request.mode !== "video" || !apiKey) {
      return { ...base, status: "queued" };
    }

    const url = `${request.provider.baseUrl.replace(/\/$/, "")}/videos/generations`;
    const payload = await this.requestJson(url, apiKey, {
      method: "POST",
      body: JSON.stringify({ model: request.providerModelId, prompt: request.optimizedPrompt })
    });

    const id = (payload as { id?: unknown }).id;
    if (typeof id !== "string" || id.length === 0) {
      throw new ProviderAdapterError("Provider returned no job id", 502);
    }

    return { ...base, status: "running", providerRef: id };
  }

  async pollGeneration(request: ProviderPollRequest): Promise<ProviderGenerationResult> {
    const base = this.base(request.provider.id, request.provider.protocol, request.providerModelId);
    const apiKey = this.env[request.provider.apiKeyEnv];
    if (!apiKey) {
      return { ...base, status: "running" };
    }

    const url = `${request.provider.baseUrl.replace(/\/$/, "")}/videos/generations/${request.providerRef}`;
    const payload = (await this.requestJson(url, apiKey, { method: "GET" })) as {
      status?: unknown;
      url?: unknown;
      poster_url?: unknown;
      duration_seconds?: unknown;
    };

    const status = payload.status;
    if (status === "failed") {
      return { ...base, status: "failed" };
    }
    if (status === "completed" || status === "succeeded") {
      if (typeof payload.url !== "string" || payload.url.length === 0) {
        throw new ProviderAdapterError("Provider returned no video url", 502);
      }
      const result: GenerationTaskResult = {
        kind: "video",
        url: payload.url,
        durationSeconds: typeof payload.duration_seconds === "number" ? payload.duration_seconds : 0,
        posterUrl: typeof payload.poster_url === "string" ? payload.poster_url : ""
      };
      return { ...base, status: "succeeded", result };
    }
    return { ...base, status: "running" };
  }

  private base(
    providerId: string,
    providerProtocol: ProviderGenerationResult["providerProtocol"],
    providerModelId: string
  ) {
    return { providerId, providerProtocol, providerModelId, submittedAt: this.clock.now().toISOString() };
  }

  private async requestJson(
    url: string,
    apiKey: string,
    init: { method: string; body?: string }
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: init.method,
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        ...(init.body === undefined ? {} : { body: init.body })
      });
    } catch {
      throw new ProviderAdapterError("Provider request failed", 502);
    }

    if (!response.ok) {
      throw new ProviderAdapterError(await readProviderError(response), 502);
    }

    try {
      return await response.json();
    } catch {
      throw new ProviderAdapterError("Provider returned an invalid response", 502);
    }
  }
}
