import type { CreationMode, PresetSuggestion } from "@gw-link-omniai/shared";
import type { CatalogProviderReference } from "./modelCatalog";

export interface ProviderGenerationRequest {
  mode: CreationMode;
  productModelId: string;
  provider: CatalogProviderReference;
  providerModelId: string;
  optimizedPrompt: string;
  parameters: PresetSuggestion["parameters"];
  userId: string;
}

export interface ProviderGenerationResult {
  status: "queued";
  providerId: string;
  providerProtocol: CatalogProviderReference["protocol"];
  providerModelId: string;
  submittedAt: string;
}

export interface ProviderAdapter {
  submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult>;
}

export class ProviderAdapterError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "ProviderAdapterError";
  }
}

export interface FakeProviderAdapterClock {
  now(): Date;
}

export interface FakeProviderAdapterOptions {
  clock?: FakeProviderAdapterClock;
}

export class FakeProviderAdapter implements ProviderAdapter {
  private readonly clock: FakeProviderAdapterClock;

  constructor(options: FakeProviderAdapterOptions = {}) {
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    if (!isSupportedProtocol(request.provider.protocol)) {
      throw new ProviderAdapterError("Provider protocol is not supported", 502);
    }

    return {
      status: "queued",
      providerId: request.provider.id,
      providerProtocol: request.provider.protocol,
      providerModelId: request.providerModelId,
      submittedAt: this.clock.now().toISOString()
    };
  }
}

function isSupportedProtocol(protocol: unknown): protocol is CatalogProviderReference["protocol"] {
  return protocol === "openai-compatible" || protocol === "anthropic-compatible";
}
