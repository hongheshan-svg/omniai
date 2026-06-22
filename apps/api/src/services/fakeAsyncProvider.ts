import { randomUUID } from "node:crypto";
import type { GenerationTaskResult } from "@gw-link-omniai/shared";
import type {
  ProviderAdapter,
  ProviderGenerationRequest,
  ProviderGenerationResult,
  ProviderPollRequest
} from "./gatewayClient";

export interface FakeAsyncProviderOptions {
  pollsUntilDone?: number;
  idGenerator?: () => string;
  clock?: { now(): Date };
}

const PLACEHOLDER_RESULT: GenerationTaskResult = {
  kind: "image",
  url: "data:image/png;base64,dmlkZW8=",
  alt: "video"
};

export class FakeAsyncProvider implements ProviderAdapter {
  private readonly remaining = new Map<string, number>();
  private readonly pollsUntilDone: number;
  private readonly idGenerator: () => string;
  private readonly clock: { now(): Date };

  constructor(options: FakeAsyncProviderOptions = {}) {
    this.pollsUntilDone = options.pollsUntilDone ?? 1;
    this.idGenerator = options.idGenerator ?? (() => `job_${randomUUID()}`);
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    const providerRef = this.idGenerator();
    this.remaining.set(providerRef, this.pollsUntilDone);
    return {
      status: "running",
      providerId: request.provider.id,
      providerProtocol: request.provider.protocol,
      providerModelId: request.providerModelId,
      submittedAt: this.clock.now().toISOString(),
      providerRef
    };
  }

  async pollGeneration(request: ProviderPollRequest): Promise<ProviderGenerationResult> {
    const base = {
      providerId: request.provider.id,
      providerProtocol: request.provider.protocol,
      providerModelId: request.providerModelId,
      submittedAt: this.clock.now().toISOString()
    };
    const left = this.remaining.get(request.providerRef) ?? 0;
    if (left > 0) {
      this.remaining.set(request.providerRef, left - 1);
      return { ...base, status: "running", providerRef: request.providerRef };
    }
    return { ...base, status: "succeeded", result: { ...PLACEHOLDER_RESULT } };
  }
}
