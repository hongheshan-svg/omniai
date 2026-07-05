import type { GenerationTask } from "@gw-link-omniai/shared";

export type WorkspaceView = "studio" | "assets" | "tasks" | "account";

export interface WorkspaceNavItem {
  view: WorkspaceView;
  label: string;
}

const navItems: WorkspaceNavItem[] = [
  { view: "studio", label: "创作" },
  { view: "assets", label: "资产库" },
  { view: "tasks", label: "任务" },
  { view: "account", label: "账户" }
];

const shortcutViews: Record<string, WorkspaceView> = {
  "1": "studio",
  "2": "assets",
  "3": "tasks",
  "4": "account"
};

export function getWorkspaceNavItems(): WorkspaceNavItem[] {
  return navItems.map((item) => ({ ...item }));
}

export function viewForShortcutDigit(digit: string): WorkspaceView | null {
  return shortcutViews[digit] ?? null;
}

export function countActiveTasks(tasks: readonly GenerationTask[]): number {
  return tasks.filter((task) => task.status === "queued" || task.status === "running").length;
}
