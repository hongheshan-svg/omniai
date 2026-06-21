import type { GenerationTaskResult } from "@gw-link-omniai/shared";
import {
  ProviderAdapterError,
  type ProviderAdapter,
  type ProviderGenerationRequest,
  type ProviderGenerationResult
} from "./gatewayClient";

export interface OpenAiCompatibleTextProviderOptions {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  clock?: { now(): Date };
}

export class OpenAiCompatibleTextProvider implements ProviderAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly env: Record<string, string | undefined>;
  private readonly clock: { now(): Date };

  constructor(options: OpenAiCompatibleTextProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.env = options.env ?? process.env;
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    const base = {
      providerId: request.provider.id,
      providerProtocol: request.provider.protocol,
      providerModelId: request.providerModelId,
      submittedAt: this.clock.now().toISOString()
    };

    const apiKey = this.env[request.provider.apiKeyEnv];
    if (request.mode !== "text" || request.provider.protocol !== "openai-compatible" || !apiKey) {
      return { ...base, status: "queued" };
    }

    const url = `${request.provider.baseUrl.replace(/\/$/, "")}/chat/completions`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: request.providerModelId,
          messages: [{ role: "user", content: request.optimizedPrompt }]
        })
      });
    } catch {
      throw new ProviderAdapterError("Provider request failed", 502);
    }

    if (!response.ok) {
      throw new ProviderAdapterError(await readProviderError(response), 502);
    }

    let payload: { choices?: Array<{ message?: { content?: unknown } }> };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new ProviderAdapterError("Provider returned an invalid response", 502);
    }

    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.length === 0) {
      throw new ProviderAdapterError("Provider returned no content", 502);
    }

    const result: GenerationTaskResult = { kind: "text", text, format: "markdown" };
    return { ...base, status: "succeeded", result };
  }
}

async function readProviderError(response: Response): Promise<string> {
  const fallback = `Provider request failed with status ${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown };
    const error = body.error;
    if (typeof error === "string" && error.length > 0) {
      return error;
    }
    if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
      const message = (error as { message: string }).message;
      if (message.length > 0) {
        return message;
      }
    }
  } catch {
    // non-JSON error body — fall through
  }
  return fallback;
}
