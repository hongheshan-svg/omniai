import type {
  CreationMode,
  GenerationTask,
  GenerationTaskRequest,
  GenerationTaskResultPreview,
  PresetSuggestion
} from "@gw-link-omniai/shared";

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
}

export interface GenerationService {
  createTask(request: GenerationTaskRequest): GenerationTask;
  listTasks(): GenerationTask[];
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

export class InMemoryGenerationService implements GenerationService {
  private readonly clock: GenerationServiceClock;
  private readonly idGenerator: () => string;
  private readonly tasks: GenerationTask[] = [];

  constructor(options: GenerationServiceOptions = {}) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.idGenerator = options.idGenerator ?? createGenerationTaskId;
  }

  createTask(request: GenerationTaskRequest): GenerationTask {
    if (!isCreationMode(request.mode)) {
      throw new GenerationTaskError("Unsupported creation mode", 400);
    }

    const prompt = request.prompt.trim();
    if (!prompt) {
      throw new GenerationTaskError("Prompt is required", 400);
    }

    const optimizedPrompt = request.optimizedPrompt.trim();
    if (!optimizedPrompt) {
      throw new GenerationTaskError("Optimized prompt is required", 400);
    }

    if (!isValidPresetSuggestion(request.preset)) {
      throw new GenerationTaskError("Invalid preset suggestion", 400);
    }

    const timestamp = this.clock.now().toISOString();
    const task: GenerationTask = {
      id: this.idGenerator(),
      mode: request.mode,
      status: "queued",
      prompt,
      optimizedPrompt,
      preset: clonePresetSuggestion(request.preset),
      resultPreview: cloneResultPreview(resultPreviews[request.mode]),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.tasks.push(task);

    return cloneGenerationTask(task);
  }

  listTasks(): GenerationTask[] {
    return this.tasks.map(cloneGenerationTask);
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
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneGenerationTask(task: GenerationTask): GenerationTask {
  return {
    ...task,
    preset: clonePresetSuggestion(task.preset),
    resultPreview: cloneResultPreview(task.resultPreview)
  };
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
