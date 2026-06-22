import type {
  CreationMode,
  GenerationTask,
  GenerationTaskRequest,
  GenerationTaskResult,
  GenerationTaskResultPreview,
  PresetSuggestion
} from "@gw-link-omniai/shared";
import { FakeProviderAdapter, ProviderAdapterError, type ProviderAdapter, type ProviderGenerationResult } from "./gatewayClient";
import type { CreditService } from "./creditService";
import { ModelCatalogError, type ModelCatalog } from "./modelCatalog";
import type { GenerationTaskRepository } from "../repositories/types";
import { InMemoryGenerationTaskRepository } from "../repositories/memory";

export class GenerationTaskError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "GenerationTaskError";
  }
}

export interface GenerationServiceClock {
  now(): Date;
}

export interface GenerationServiceOptions {
  clock?: GenerationServiceClock;
  idGenerator?: () => string;
  modelCatalog?: ModelCatalog;
  providerAdapter?: ProviderAdapter;
  creditService?: CreditService;
}

export interface GenerationService {
  createTask(request: GenerationTaskRequest, userId: string): GenerationTask | Promise<GenerationTask>;
  listTasks(userId: string): GenerationTask[] | Promise<GenerationTask[]>;
  refreshTask(id: string, userId: string): GenerationTask | Promise<GenerationTask>;
}

const resultPreviews: Record<CreationMode, GenerationTaskResultPreview> = {
  text: {
    title: "文本生成任务",
    description: "任务已排队，后续阶段将接入真实文本生成结果。"
  },
  image: {
    title: "图片生成任务",
    description: "任务已排队，后续阶段将接入真实图片生成结果。"
  },
  video: {
    title: "视频生成任务",
    description: "任务已排队，后续阶段将接入真实视频生成结果。"
  }
};

export class GenerationServiceImpl implements GenerationService {
  private readonly clock: GenerationServiceClock;
  private readonly idGenerator: () => string;
  private readonly modelCatalog?: ModelCatalog;
  private readonly providerAdapter: ProviderAdapter;
  private readonly creditService?: CreditService;
  private readonly tasks: GenerationTaskRepository;

  constructor(taskRepository: GenerationTaskRepository, options: GenerationServiceOptions = {}) {
    this.tasks = taskRepository;
    this.clock = options.clock ?? { now: () => new Date() };
    this.idGenerator = options.idGenerator ?? createGenerationTaskId;
    this.modelCatalog = options.modelCatalog;
    this.providerAdapter = options.providerAdapter ?? new FakeProviderAdapter();
    this.creditService = options.creditService;
  }

  async createTask(request: GenerationTaskRequest, userId: string): Promise<GenerationTask> {
    const requestValue: unknown = request;
    if (!isRecord(requestValue) || typeof requestValue.prompt !== "string") {
      throw new GenerationTaskError("Prompt is required", 400);
    }

    const prompt = requestValue.prompt.trim();
    if (!prompt) {
      throw new GenerationTaskError("Prompt is required", 400);
    }

    if (typeof requestValue.optimizedPrompt !== "string") {
      throw new GenerationTaskError("Optimized prompt is required", 400);
    }

    const optimizedPrompt = requestValue.optimizedPrompt.trim();
    if (!optimizedPrompt) {
      throw new GenerationTaskError("Optimized prompt is required", 400);
    }

    const mode = requestValue.mode;
    if (!isCreationMode(mode)) {
      throw new GenerationTaskError("Unsupported creation mode", 400);
    }

    const preset = requestValue.preset;
    if (!isValidPresetSuggestion(preset)) {
      throw new GenerationTaskError("Invalid preset suggestion", 400);
    }

    if (this.modelCatalog === undefined) {
      throw new GenerationTaskError("Model catalog is not configured", 500);
    }

    let modelReference: ReturnType<ModelCatalog["getModelReference"]>;
    try {
      modelReference = this.modelCatalog.getModelReference(preset.modelId, mode);
    } catch (error) {
      if (error instanceof ModelCatalogError) {
        throw new GenerationTaskError(error.message, error.statusCode);
      }

      throw error;
    }

    if (modelReference.product.visibility === "maintenance") {
      throw new GenerationTaskError("Model is temporarily unavailable", 409);
    }

    const creditCost = modelReference.product.creditUnitCost;
    if (this.creditService) {
      const balance = await this.creditService.getBalance(userId);
      if (balance.credits < creditCost) {
        throw new GenerationTaskError("Insufficient credits", 402);
      }
    }

    let providerResult: ProviderGenerationResult;
    try {
      providerResult = await this.providerAdapter.submitGeneration({
        mode,
        productModelId: modelReference.product.id,
        provider: modelReference.provider,
        providerModelId: modelReference.providerModelId,
        optimizedPrompt,
        parameters: { ...preset.parameters },
        userId
      });
    } catch (error) {
      if (error instanceof ProviderAdapterError) {
        throw new GenerationTaskError(error.message, error.statusCode);
      }

      throw new GenerationTaskError("Provider adapter failed", 502);
    }

    const timestamp = this.clock.now().toISOString();
    const task: GenerationTask = {
      id: this.idGenerator(),
      mode,
      status: providerResult.status,
      prompt,
      optimizedPrompt,
      preset: clonePresetSuggestion(preset),
      resultPreview: cloneResultPreview(resultPreviews[mode]),
      ...(providerResult.result ? { result: cloneGenerationTaskResult(providerResult.result) } : {}),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.tasks.insert(task, userId, providerResult.providerRef ?? null);

    if (this.creditService && providerResult.status === "succeeded") {
      await this.creditService.deduct(userId, creditCost, task.id);
    }

    return cloneGenerationTask(task);
  }

  async listTasks(userId: string): Promise<GenerationTask[]> {
    return this.tasks.list(userId);
  }

  async refreshTask(id: string, userId: string): Promise<GenerationTask> {
    const stored = await this.tasks.get(userId, id);
    if (!stored) {
      throw new GenerationTaskError("Generation task was not found", 404);
    }

    const { task, providerRef } = stored;
    if (task.status !== "running" || !providerRef || !this.providerAdapter.pollGeneration) {
      return cloneGenerationTask(task);
    }

    if (this.modelCatalog === undefined) {
      throw new GenerationTaskError("Model catalog is not configured", 500);
    }

    let modelReference: ReturnType<ModelCatalog["getModelReference"]>;
    try {
      modelReference = this.modelCatalog.getModelReference(task.preset.modelId, task.mode);
    } catch (error) {
      if (error instanceof ModelCatalogError) {
        throw new GenerationTaskError(error.message, error.statusCode);
      }
      throw error;
    }

    let pollResult: ProviderGenerationResult;
    try {
      pollResult = await this.providerAdapter.pollGeneration!({
        mode: task.mode,
        provider: modelReference.provider,
        providerModelId: modelReference.providerModelId,
        providerRef
      });
    } catch (error) {
      if (error instanceof ProviderAdapterError) {
        throw new GenerationTaskError(error.message, error.statusCode);
      }
      throw new GenerationTaskError("Provider adapter failed", 502);
    }

    if (pollResult.status === "running") {
      return cloneGenerationTask(task);
    }

    const updated: GenerationTask = {
      ...task,
      status: pollResult.status,
      ...(pollResult.result ? { result: cloneGenerationTaskResult(pollResult.result) } : {}),
      updatedAt: this.clock.now().toISOString()
    };
    await this.tasks.update(updated, userId, providerRef);

    if (this.creditService && pollResult.status === "succeeded") {
      await this.creditService.deduct(userId, modelReference.product.creditUnitCost, updated.id);
    }

    return cloneGenerationTask(updated);
  }
}

export class InMemoryGenerationService extends GenerationServiceImpl {
  constructor(options: GenerationServiceOptions = {}) {
    super(new InMemoryGenerationTaskRepository(), options);
  }
}

function isCreationMode(value: unknown): value is CreationMode {
  return value === "text" || value === "image" || value === "video";
}

function isValidPresetSuggestion(value: unknown): value is PresetSuggestion {
  if (!isRecord(value)) {
    return false;
  }

  const { modelId, parameters, creditEstimate } = value;

  if (typeof modelId !== "string" || modelId.trim().length === 0) {
    return false;
  }

  if (!isRecord(parameters)) {
    return false;
  }

  if (!Object.values(parameters).every(isPresetParameterValue)) {
    return false;
  }

  if (!isRecord(creditEstimate)) {
    return false;
  }

  return (
    typeof creditEstimate.credits === "number" &&
    Number.isFinite(creditEstimate.credits) &&
    creditEstimate.credits > 0 &&
    creditEstimate.unit === "credit"
  );
}

function isPresetParameterValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneGenerationTask(task: GenerationTask): GenerationTask {
  return {
    ...task,
    preset: clonePresetSuggestion(task.preset),
    resultPreview: cloneResultPreview(task.resultPreview),
    ...(task.result ? { result: cloneGenerationTaskResult(task.result) } : {})
  };
}

function cloneGenerationTaskResult(result: GenerationTaskResult): GenerationTaskResult {
  return { ...result };
}

function clonePresetSuggestion(preset: PresetSuggestion): PresetSuggestion {
  return {
    modelId: preset.modelId,
    parameters: { ...preset.parameters },
    creditEstimate: { ...preset.creditEstimate }
  };
}

function cloneResultPreview(resultPreview: GenerationTaskResultPreview): GenerationTaskResultPreview {
  return { ...resultPreview };
}

function createGenerationTaskId(): string {
  return `generation_task_${Date.now().toString(36)}`;
}
