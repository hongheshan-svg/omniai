import type { GenerationTaskResult } from "@gw-link-omniai/shared";
import {
  ProviderAdapterError,
  type ProviderAdapter,
  type ProviderGenerationRequest,
  type ProviderGenerationResult
} from "./gatewayClient";
import { readProviderError } from "./openAiTextProvider";
import type { ObjectStore } from "./objectStore";

export interface OpenAiCompatibleImageProviderOptions {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  clock?: { now(): Date };
  objectStore?: ObjectStore;
}

export class OpenAiCompatibleImageProvider implements ProviderAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly env: Record<string, string | undefined>;
  private readonly clock: { now(): Date };
  private readonly objectStore?: ObjectStore;

  constructor(options: OpenAiCompatibleImageProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.env = options.env ?? process.env;
    this.clock = options.clock ?? { now: () => new Date() };
    this.objectStore = options.objectStore;
  }

  async submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    const base = {
      providerId: request.provider.id,
      providerProtocol: request.provider.protocol,
      providerModelId: request.providerModelId,
      submittedAt: this.clock.now().toISOString()
    };

    const apiKey = this.env[request.provider.apiKeyEnv];
    if (request.mode !== "image" || request.provider.protocol !== "openai-compatible" || !apiKey) {
      return { ...base, status: "queued" };
    }

    const url = `${request.provider.baseUrl.replace(/\/$/, "")}/images/generations`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.providerModelId, prompt: request.optimizedPrompt })
      });
    } catch {
      throw new ProviderAdapterError("Provider request failed", 502);
    }

    if (!response.ok) {
      throw new ProviderAdapterError(await readProviderError(response), 502);
    }

    let payload: { data?: Array<{ b64_json?: unknown; url?: unknown }> };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new ProviderAdapterError("Provider returned an invalid response", 502);
    }

    const first = payload.data?.[0];
    let imageUrl: string | undefined;
    if (first && typeof first.b64_json === "string" && first.b64_json.length > 0) {
      if (this.objectStore) {
        const stored = await this.objectStore.put(Buffer.from(first.b64_json, "base64"), "image/png");
        imageUrl = stored.url;
      } else {
        imageUrl = `data:image/png;base64,${first.b64_json}`;
      }
    } else if (first && typeof first.url === "string" && first.url.length > 0) {
      imageUrl = first.url;
    }

    if (!imageUrl) {
      throw new ProviderAdapterError("Provider returned no image", 502);
    }

    const result: GenerationTaskResult = { kind: "image", url: imageUrl, alt: request.optimizedPrompt };
    return { ...base, status: "succeeded", result };
  }
}
