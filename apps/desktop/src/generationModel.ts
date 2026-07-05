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

export function selectRunningTaskIds(tasks: GenerationTask[]): string[] {
  return tasks.filter((task) => task.status === "running").map((task) => task.id);
}

export function selectActiveTaskIds(tasks: GenerationTask[]): string[] {
  return tasks
    .filter((task) => task.status === "queued" || task.status === "running")
    .map((task) => task.id);
}

/**
 * Repositories return lists ascending by createdAt; UI surfaces (history strip,
 * tasks view, asset grid) need newest-first display order. Sort defensively at
 * the display boundary rather than relying on API/repository order.
 */
export function sortByCreatedAtDesc<T extends { createdAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
