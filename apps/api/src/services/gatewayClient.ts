import type { GenerationTask, ModelCapability } from "@gw-link-omniai/shared";

export interface GatewayGenerationRequest {
  capability: ModelCapability;
  modelId: string;
  prompt: string;
  userId: string;
}

export interface GatewayClient {
  submitGeneration(request: GatewayGenerationRequest): Promise<GenerationTask>;
}

export class GwLinkGatewayClient implements GatewayClient {
  constructor(private readonly baseUrl: string) {}

  async submitGeneration(request: GatewayGenerationRequest): Promise<GenerationTask> {
    const now = new Date().toISOString();

    return {
      id: `task_${request.capability}_${request.modelId}`,
      capability: request.capability,
      status: "queued",
      modelId: request.modelId,
      createdAt: now,
      updatedAt: now,
      creditEstimate: {
        credits: 1,
        unit: "credit"
      }
    };
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
