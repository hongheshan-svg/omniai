# Desktop Auto-Poll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-poll `running` generation tasks on the desktop every 5s so they advance without manual refresh.

**Architecture:** A pure `selectRunningTaskIds` selector in `generationModel.ts` (unit-tested). An `App.tsx` `useEffect` that, while signed-in with running tasks, sets a 5s interval polling each running task via `getGeneration`. The manual "刷新状态" button stays.

**Tech Stack:** React 18, vitest + jsdom + @testing-library/react (fake timers).

## Global Constraints

- Poll interval: `POLL_INTERVAL_MS = 5000`.
- Poll only `running` tasks; no running tasks → no interval. Effect deps keyed on the running-id set (`runningKey`), so the interval is (re)created only when that set changes.
- Poll path mirrors manual refresh: `getGeneration(id, token)` → replace the task in state.
- Poll error handling: 401 → `handleSignedOut("登录已失效，请重新登录")`; other errors → silent (no `actionError`), retry next tick.
- Manual "刷新状态" button unchanged.
- Tests fake ONLY `setInterval`/`clearInterval` (`vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })`) so `@testing-library` `findBy*` (real `setTimeout`) still works; `afterEach(() => vi.useRealTimers())`.
- Non-goals: backoff/retry policy, configurable-interval UI, background worker, mobile auto-poll, balance/asset polling.
- Each task green before commit.

---

## Task 1: generationModel.selectRunningTaskIds

**Files:**
- Modify: `apps/desktop/src/generationModel.ts`
- Test: `apps/desktop/src/__tests__/generationModel.test.ts`

**Interfaces:**
- Produces: `selectRunningTaskIds(tasks: GenerationTask[]): string[]`.

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/src/__tests__/generationModel.test.ts` (create the file if it does not exist; if it exists, add this `describe` block and merge imports):

```typescript
import { describe, expect, it } from "vitest";
import type { GenerationTask } from "@gw-link-omniai/shared";
import { selectRunningTaskIds } from "../generationModel";

function task(id: string, status: GenerationTask["status"]): GenerationTask {
  return {
    id,
    mode: "video",
    status,
    prompt: "p",
    optimizedPrompt: "op",
    preset: { modelId: "gw-video-motion", parameters: {}, creditEstimate: { credits: 3, unit: "credit" } },
    resultPreview: { title: "T", description: "D" },
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z"
  };
}

describe("selectRunningTaskIds", () => {
  it("returns only running task ids, preserving order", () => {
    const tasks = [task("a", "running"), task("b", "succeeded"), task("c", "running"), task("d", "queued")];
    expect(selectRunningTaskIds(tasks)).toEqual(["a", "c"]);
  });

  it("returns an empty array when nothing is running", () => {
    expect(selectRunningTaskIds([task("a", "succeeded"), task("b", "failed")])).toEqual([]);
    expect(selectRunningTaskIds([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/generationModel.test.ts`
Expected: FAIL — `selectRunningTaskIds` is not exported.

- [ ] **Step 3: Implement selectRunningTaskIds**

In `apps/desktop/src/generationModel.ts`, add at the end:

```typescript
export function selectRunningTaskIds(tasks: GenerationTask[]): string[] {
  return tasks.filter((task) => task.status === "running").map((task) => task.id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/generationModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: no errors.

```bash
git add apps/desktop/src/generationModel.ts apps/desktop/src/__tests__/generationModel.test.ts
git commit -m "feat(desktop): add selectRunningTaskIds selector

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: App.tsx auto-poll effect

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `selectRunningTaskIds` (Task 1); existing `api.getGeneration`, `setTasks`, `handleSignedOut`, `token`.

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/src/__tests__/App.test.tsx`, add these two tests inside the `describe("Desktop App", ...)` block. They reuse the existing `createFakeClient` / `signIn` helpers. A `runningTask` builder is defined inline.

```typescript
  it("auto-polls a running task to completion", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const running: GenerationTask = {
        id: "task-run",
        mode: "video",
        status: "running",
        prompt: "p",
        optimizedPrompt: "op",
        preset: { modelId: "gw-video-motion", parameters: {}, creditEstimate: { credits: 3, unit: "credit" } },
        resultPreview: { title: "视频生成任务", description: "生成中。" },
        createdAt: "2026-07-03T00:00:00.000Z",
        updatedAt: "2026-07-03T00:00:00.000Z"
      };
      const succeeded: GenerationTask = { ...running, status: "succeeded", result: { kind: "text", text: "done", format: "plain" } };
      const client = createFakeClient({
        listGenerations: async () => [running],
        getGeneration: async () => succeeded
      });
      await signIn(client);

      const taskCenter = screen.getByLabelText("任务中心");
      await within(taskCenter).findByText("生成中");
      vi.advanceTimersByTime(5000);
      await within(taskCenter).findByText("已完成");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not poll when there are no running tasks", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const getGeneration = vi.fn(async (id: string) => {
        throw new ApiError("should not be called", 404);
      });
      const client = createFakeClient({ listGenerations: async () => [], getGeneration });
      await signIn(client);
      vi.advanceTimersByTime(5000);
      expect(getGeneration).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx -t "auto-polls"`
Expected: FAIL — the running task never becomes "已完成" (no polling yet).

- [ ] **Step 3: Add the selectRunningTaskIds import**

In `apps/desktop/src/App.tsx`, change:

```typescript
import { getGenerationStatusLabel, summarizeGenerationPrompt } from "./generationModel";
```
to:
```typescript
import { getGenerationStatusLabel, selectRunningTaskIds, summarizeGenerationPrompt } from "./generationModel";
```

- [ ] **Step 4: Add the POLL_INTERVAL_MS constant**

In `apps/desktop/src/App.tsx`, just after the `anonymousSession` constant near the top of the module (before the `App` component), add:

```typescript
const POLL_INTERVAL_MS = 5000;
```

- [ ] **Step 5: Add the pollRunningTasks function**

In the `App` component, immediately after the `handleRefreshTask` function (the block ending around line 202), add:

```typescript
  async function pollRunningTasks(ids: string[]) {
    if (!token) {
      return;
    }
    for (const id of ids) {
      try {
        const updated = await api.getGeneration(id, token);
        setTasks((prev) => prev.map((existing) => (existing.id === updated.id ? updated : existing)));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          handleSignedOut("登录已失效，请重新登录");
          return;
        }
        // transient poll error: stay quiet, retry next tick
      }
    }
  }
```

- [ ] **Step 6: Add the polling effect**

In the `App` component, immediately after the existing session-restore `useEffect` (the one ending with `}, [api, store]);`), add:

```typescript
  const runningKey = selectRunningTaskIds(tasks).join(",");
  useEffect(() => {
    if (!token) {
      return;
    }
    const runningIds = runningKey ? runningKey.split(",") : [];
    if (runningIds.length === 0) {
      return;
    }
    const interval = setInterval(() => {
      void pollRunningTasks(runningIds);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, token, runningKey]);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx`
Expected: PASS — including the two new auto-poll tests plus all existing desktop App tests.

- [ ] **Step 8: Typecheck + full workspace**

Run: `pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: no errors.

Run: `pnpm test`
Expected: all packages green (desktop gains 2 App tests + 2 generationModel tests from Task 1).

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
git commit -m "feat(desktop): auto-poll running tasks every 5s

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update README.md**

In the `### Async Generation Lifecycle` section, the paragraph mentions the desktop "刷新状态" button ("The desktop shows a "刷新状态" button on running tasks..."). Append to that sentence:

Change:
```markdown
running tasks that fetches the latest state. No background worker — advancement
happens on read.
```
to:
```markdown
running tasks that fetches the latest state, and additionally auto-polls running
tasks every 5 seconds so they advance without manual clicks. No background worker
— advancement happens on read.
```

- [ ] **Step 2: Update mvp-skeleton.md**

In `docs/architecture/mvp-skeleton.md`, find the async generation lifecycle section (it mentions `refreshTask` / the desktop refresh button) and append a sentence:

```markdown
The desktop also auto-polls `running` tasks every 5s (`selectRunningTaskIds` +
a `setInterval` effect keyed on the running-id set; poll reuses `getGeneration`,
401 signs out, other errors stay silent), keeping the manual "刷新状态" button.
```

If the async lifecycle section is not present under that exact heading, append this sentence to the paragraph that documents `refreshTask` / the desktop refresh button.

- [ ] **Step 3: Full workspace validation**

Run: `pnpm test`
Expected: all packages green.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document desktop auto-poll (Slice 20)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ selectRunningTaskIds + test (spec §1) → Task 1
- ✅ POLL_INTERVAL_MS + polling effect + pollRunningTasks (spec §2) → Task 2 Steps 4-6
- ✅ 401→signout / other→silent (spec §错误处理) → Task 2 Step 5
- ✅ fake-timer tests only faking setInterval/clearInterval (spec §测试策略) → Task 2 Step 1
- ✅ manual button unchanged (spec §设计) → not touched
- ✅ docs (spec §文档) → Task 3
- ✅ non-goals honored (no backoff, no mobile, no balance/asset poll)

**Placeholder scan:** none — all code/commands/expected outputs concrete.

**Type consistency:** `selectRunningTaskIds(tasks: GenerationTask[]): string[]` consistent across generationModel, its test, and App.tsx usage (`selectRunningTaskIds(tasks).join(",")`). `pollRunningTasks(ids: string[])` matches the effect call. `getGeneration(id, token)` and `handleSignedOut(message)` match existing App signatures.
