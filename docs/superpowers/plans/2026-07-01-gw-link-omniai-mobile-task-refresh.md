# Mobile Task Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "refresh task status" capability to the mobile app so `running` tasks can advance, mirroring the desktop precedent.

**Architecture:** Add a `refreshTask(taskId)` action to the framework-free `appModel` controller (calls existing `apiClient.getGeneration`, replaces the matching task in state); the thin `App.tsx` view shows a "刷新状态" button on `running` task rows. Controller logic is unit-tested with vitest; App.tsx stays typecheck-only.

**Tech Stack:** React Native 0.74, Expo 51, vitest, shared `apiClient`.

## Global Constraints

- Mobile controller is framework-free (`apps/mobile/src/appModel.ts`); tests run under vitest (`describe/it/expect`), not node:test.
- `App.tsx` is a thin RN view, typecheck-only (not unit-tested — RN can't render under vite-node).
- Error copy EXACT: refresh 401 → sign out (clear token, stage `signedOut`, no error text); refresh other `ApiError` → `"刷新失败，请稍后重试"`; refresh non-`ApiError` → `"网络错误"`.
- Refresh replaces the matching task by id in `state.tasks`; it does NOT refresh the balance (mirrors desktop `handleRefreshTask`).
- The "刷新状态" button appears only on `running` task rows.
- Non-goals: auto-polling, balance refresh on refresh, touching desktop, image/video rendering.
- Each task green before commit.

---

## Task 1: Mobile refreshTask action + running-row button

**Files:**
- Modify: `apps/mobile/src/appModel.ts` (add `refreshTask` to interface + impl, add `refreshError` helper)
- Modify: `apps/mobile/src/__tests__/appModel.test.ts` (add 3 tests; `textTask`, `createFakeClient`, `createFakeTokenStore` helpers already exist in this file)
- Modify: `apps/mobile/App.tsx` (running-row refresh button)
- Modify: `README.md` (one line under `### Mobile API Integration`)
- Modify: `docs/architecture/mvp-skeleton.md` (one line under `## Mobile API Integration Slice`)

**Interfaces:**
- Consumes: `apiClient.getGeneration(id: string, token: string): Promise<GenerationTask>` (already in `@gw-link-omniai/shared`); existing `MobileAppController` from `appModel.ts`.
- Produces: `MobileAppController.refreshTask(taskId: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Add these three tests to `apps/mobile/src/__tests__/appModel.test.ts` (inside the existing `describe("MobileAppController", ...)` block). They reuse the file's existing `textTask`, `createFakeClient`, and `createFakeTokenStore` helpers.

```typescript
  it("refreshes a running task to its latest state", async () => {
    const running: GenerationTask = { ...textTask("t1", "p"), status: "running", result: undefined };
    const succeeded = textTask("t1", "p");
    const client = createFakeClient({
      listGenerations: async () => [running],
      getGeneration: async () => succeeded
    });
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    expect(ctrl.getState().tasks[0].status).toBe("running");
    await ctrl.refreshTask("t1");
    expect(ctrl.getState().tasks[0].status).toBe("succeeded");
  });

  it("signs out on a 401 during refresh", async () => {
    const running: GenerationTask = { ...textTask("t1", "p"), status: "running", result: undefined };
    const client = createFakeClient({
      listGenerations: async () => [running],
      getGeneration: async () => { throw new ApiError("unauth", 401); }
    });
    const store = createFakeTokenStore();
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: store });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    await ctrl.refreshTask("t1");
    expect(ctrl.getState().stage).toBe("signedOut");
    expect(await store.load()).toBeNull();
  });

  it("maps a non-401 refresh error to a friendly message", async () => {
    const running: GenerationTask = { ...textTask("t1", "p"), status: "running", result: undefined };
    const client = createFakeClient({
      listGenerations: async () => [running],
      getGeneration: async () => { throw new ApiError("boom", 500); }
    });
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    await ctrl.refreshTask("t1");
    expect(ctrl.getState().actionError).toBe("刷新失败，请稍后重试");
    expect(ctrl.getState().stage).toBe("signedIn");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @gw-link-omniai/mobile exec vitest run src/__tests__/appModel.test.ts`
Expected: FAIL — `ctrl.refreshTask is not a function` (property missing on the controller).

- [ ] **Step 3: Implement `refreshTask` + `refreshError` in `apps/mobile/src/appModel.ts`**

Add `refreshTask` to the `MobileAppController` interface, right after `submitGeneration`:

```typescript
  submitGeneration(input: { prompt: string; mode: CreationMode }): Promise<void>;
  refreshTask(taskId: string): Promise<void>;
  signOut(): Promise<void>;
```

Add the `refreshError` helper next to `loginError`/`generationError`:

```typescript
function refreshError(err: unknown): string {
  if (err instanceof ApiError) {
    return "刷新失败，请稍后重试";
  }
  return "网络错误";
}
```

Add the `refreshTask` implementation to the returned controller object, right after `submitGeneration`:

```typescript
    async refreshTask(taskId) {
      const token = state.token;
      if (!token) {
        return;
      }
      setState({ actionError: null });
      try {
        const updated = await apiClient.getGeneration(taskId, token);
        setState({ tasks: state.tasks.map((task) => (task.id === updated.id ? updated : task)) });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await signOutInternal();
          return;
        }
        setState({ actionError: refreshError(err) });
      }
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @gw-link-omniai/mobile exec vitest run src/__tests__/appModel.test.ts`
Expected: PASS — 16/16 (13 existing + 3 new).

- [ ] **Step 5: Add the running-row refresh button in `apps/mobile/App.tsx`**

In the `FlatList` `renderItem`, inside the task `<View style={styles.task}>`, add a refresh button after the existing text-result line. The final `renderItem` block should read:

```tsx
            renderItem={({ item }) => (
              <View style={styles.task}>
                <Text>ID: {item.id}</Text>
                <Text>状态: {item.status}</Text>
                <Text>提示词: {item.prompt}</Text>
                {item.result?.kind === "text" ? <Text numberOfLines={2}>结果: {item.result.text}</Text> : null}
                {item.status === "running" ? (
                  <Button title="刷新状态" onPress={() => void ctrl.refreshTask(item.id)} />
                ) : null}
              </View>
            )}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @gw-link-omniai/mobile typecheck`
Expected: no errors.

- [ ] **Step 7: Update docs**

In `README.md`, under `### Mobile API Integration`, extend the "Core flow only" bullet or add a line noting running tasks can be refreshed. Change:

```markdown
- Core flow only: login, submit a generation, list your tasks, show balance.
  Task refresh, save-to-assets, the asset library, top-up, and image/video
  rendering remain later slices.
```
to:
```markdown
- Core flow: login, submit a generation, list your tasks, show balance, and
  refresh a `running` task's status. Save-to-assets, the asset library, top-up,
  and image/video rendering remain later slices.
```

In `docs/architecture/mvp-skeleton.md`, under `## Mobile API Integration Slice`, change the final sentence:

```markdown
Task refresh, save-to-assets, the
asset library, top-up, image/video rendering, and multi-screen navigation remain
later slices.
```
to:
```markdown
A `running` task row shows a "刷新状态" button that re-polls via
`getGeneration` (mirroring desktop). Save-to-assets, the asset library, top-up,
image/video rendering, and multi-screen navigation remain later slices.
```

- [ ] **Step 8: Run the mobile suite + full workspace + typecheck**

Run: `pnpm --filter @gw-link-omniai/mobile test`
Expected: 23/23 (appModel 16 + tokenStore 3 + homeModel 4).

Run: `pnpm test`
Expected: all packages green.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/appModel.ts apps/mobile/src/__tests__/appModel.test.ts apps/mobile/App.tsx README.md docs/architecture/mvp-skeleton.md
git commit -m "feat(mobile): refresh running task status

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ `refreshTask` action + `refreshError` helper (spec §appModel.ts) → Step 3
- ✅ running-row "刷新状态" button (spec §App.tsx) → Step 5
- ✅ 3 tests (update / 401 signout / other-error) (spec §测试策略) → Step 1
- ✅ error mapping 401/other/network (spec §错误处理) → Step 3
- ✅ docs (spec §文档) → Step 7
- ✅ no balance refresh, no auto-poll, no desktop change (spec §非目标) → constraints honored

**Placeholder scan:** none — all code/commands/expected outputs concrete.

**Type consistency:** `refreshTask(taskId: string): Promise<void>` consistent across interface, impl, tests, and the App button call `ctrl.refreshTask(item.id)`. `refreshError` matches `loginError`/`generationError` shape.
