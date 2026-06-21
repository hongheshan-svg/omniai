import type { GenerationTask, GenerationTaskStatus } from "@gw-link-omniai/shared";

const statusLabels: Record<GenerationTaskStatus, string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败"
};

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
