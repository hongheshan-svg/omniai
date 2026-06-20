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
    const modeLabel = {
      text: "文本",
      image: "图片",
      video: "视频"
    }[request.capability];

    return {
      id: `task_${request.capability}_${request.modelId}`,
      mode: request.capability,
      status: "queued",
      prompt: request.prompt,
      optimizedPrompt: request.prompt,
      preset: {
        modelId: request.modelId,
        parameters: {},
        creditEstimate: {
          credits: 1,
          unit: "credit"
        }
      },
      resultPreview: {
        title: `${modeLabel}生成任务`,
        description: "任务已排队，后续阶段将接入真实生成结果。"
      },
      createdAt: now,
      updatedAt: now
    };
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
