import type {
  GenerationTask,
  GenerationTaskResultPreview,
  GenerationTaskStatus,
  PresetSuggestion,
  PromptOptimization
} from "@gw-link-omniai/shared";

export interface LocalGenerationTaskClock {
  now(): Date;
}

export interface LocalGenerationTaskOptions {
  clock?: LocalGenerationTaskClock;
  idGenerator?: () => string;
}

const resultPreviewByMode: Record<PromptOptimization["mode"], GenerationTaskResultPreview> = {
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

const statusLabels: Record<GenerationTaskStatus, string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败"
};

export function createLocalGenerationTask(
  optimization: PromptOptimization,
  options: LocalGenerationTaskOptions = {}
): GenerationTask {
  const now = (options.clock ?? { now: () => new Date() }).now().toISOString();
  const idGenerator = options.idGenerator ?? createLocalGenerationTaskId;

  return {
    id: idGenerator(),
    mode: optimization.mode,
    status: "queued",
    prompt: optimization.originalPrompt,
    optimizedPrompt: optimization.optimizedPrompt,
    preset: clonePreset(optimization.preset),
    resultPreview: { ...resultPreviewByMode[optimization.mode] },
    createdAt: now,
    updatedAt: now
  };
}

export function getGenerationStatusLabel(status: GenerationTaskStatus): string {
  return statusLabels[status];
}

export function summarizeGenerationPrompt(task: GenerationTask, maxLength = 48): string {
  const prompt = task.prompt.trim();

  if (prompt.length <= maxLength) {
    return prompt;
  }

  return `${prompt.slice(0, maxLength)}...`;
}

function clonePreset(preset: PresetSuggestion): PresetSuggestion {
  return {
    ...preset,
    parameters: { ...preset.parameters },
    creditEstimate: { ...preset.creditEstimate }
  };
}

function createLocalGenerationTaskId(): string {
  return `desktop_generation_task_${Date.now().toString(36)}`;
}
