import { describe, expect, it } from "vitest";
import type { GenerationTask } from "@gw-link-omniai/shared";
import { countActiveTasks, getWorkspaceNavItems, viewForShortcutDigit } from "../navModel";

function makeTask(id: string, status: GenerationTask["status"]): GenerationTask {
  return {
    id,
    mode: "text",
    status,
    prompt: "p",
    optimizedPrompt: "op",
    preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
    resultPreview: { title: "t", description: "d" },
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:00.000Z"
  };
}

describe("navModel", () => {
  it("lists the four workspace views in order", () => {
    const items = getWorkspaceNavItems();
    expect(items.map((item) => item.view)).toEqual(["studio", "assets", "tasks", "account"]);
    expect(items.map((item) => item.label)).toEqual(["创作", "资产库", "任务", "账户"]);
  });

  it("returns cloned nav items", () => {
    const first = getWorkspaceNavItems();
    first[0].label = "mutated";
    expect(getWorkspaceNavItems()[0].label).toBe("创作");
  });

  it("maps shortcut digits 1-4 to views and rejects others", () => {
    expect(viewForShortcutDigit("1")).toBe("studio");
    expect(viewForShortcutDigit("2")).toBe("assets");
    expect(viewForShortcutDigit("3")).toBe("tasks");
    expect(viewForShortcutDigit("4")).toBe("account");
    expect(viewForShortcutDigit("5")).toBeNull();
    expect(viewForShortcutDigit("a")).toBeNull();
  });

  it("counts queued and running tasks as active", () => {
    const tasks = [
      makeTask("t1", "queued"),
      makeTask("t2", "running"),
      makeTask("t3", "succeeded"),
      makeTask("t4", "failed")
    ];
    expect(countActiveTasks(tasks)).toBe(2);
    expect(countActiveTasks([])).toBe(0);
  });
});
