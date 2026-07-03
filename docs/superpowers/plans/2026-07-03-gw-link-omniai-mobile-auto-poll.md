# Mobile Auto-Poll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-poll `running` tasks in the mobile app every 5s, with the polling logic inside the framework-free `appModel` controller so it is fully unit-tested.

**Architecture:** Add `startAutoPoll`/`stopAutoPoll` to the `appModel` controller; an internal `pollRunning` reads `state.tasks` each tick (no stale closure — `state` is a factory-scoped `let`). `App.tsx` starts polling while `signedIn` and stops on cleanup. Tests use `vi.useFakeTimers()` directly on the controller (no rendering).

**Tech Stack:** React Native 0.74, Expo 51, vitest (fake timers).

## Global Constraints

- `POLL_INTERVAL_MS = 5000`.
- Polling lives in the `appModel` controller (unit-tested with fake timers), not App.tsx.
- `startAutoPoll()` idempotent (a second call while running is a no-op — one interval only). `stopAutoPoll()` clears it.
- `pollRunning` each tick: for each `running` task id, `getGeneration(id, token)` → replace task; 401 → stop polling + `signOutInternal`; other errors → silent, retry next tick.
- `signOutInternal` also stops polling (any sign-out stops the timer).
- Internal stop function is named `stopPolling` (the interface method `stopAutoPoll` delegates to it — avoids a same-name shadow).
- App.tsx wiring is thin, typecheck-only (not unit-tested); manual "刷新状态" button unchanged.
- Non-goals: backoff/retry, configurable interval, background push, balance/asset polling, desktop changes.
- Each task green before commit.

---

## Task 1: appModel auto-poll + App.tsx wiring

**Files:**
- Modify: `apps/mobile/src/appModel.ts`
- Modify: `apps/mobile/App.tsx`
- Test: `apps/mobile/src/__tests__/appModel.test.ts`

**Interfaces:**
- Produces: `MobileAppController.startAutoPoll(): void`, `MobileAppController.stopAutoPoll(): void`.

- [ ] **Step 1: Write the failing tests**

Add these four tests to `apps/mobile/src/__tests__/appModel.test.ts` inside the `describe("MobileAppController", ...)` block. They reuse the existing `textTask` / `createFakeClient` / `createFakeTokenStore` helpers. `vi`, `ApiError`, `GenerationTask` are already imported.

```typescript
  it("auto-polls a running task to completion", async () => {
    vi.useFakeTimers();
    try {
      const running: GenerationTask = { ...textTask("t1", "p"), status: "running", result: undefined };
      const succeeded = textTask("t1", "p");
      const client = createFakeClient({ listGenerations: async () => [running], getGeneration: async () => succeeded });
      const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
      await ctrl.startLogin("test@example.com");
      await ctrl.verifyLogin("000000");
      expect(ctrl.getState().tasks[0].status).toBe("running");
      ctrl.startAutoPoll();
      await vi.advanceTimersByTimeAsync(5000);
      expect(ctrl.getState().tasks[0].status).toBe("succeeded");
      ctrl.stopAutoPoll();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling after stopAutoPoll", async () => {
    vi.useFakeTimers();
    try {
      const running: GenerationTask = { ...textTask("t1", "p"), status: "running", result: undefined };
      const getGeneration = vi.fn(async () => running);
      const client = createFakeClient({ listGenerations: async () => [running], getGeneration });
      const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
      await ctrl.startLogin("test@example.com");
      await ctrl.verifyLogin("000000");
      ctrl.startAutoPoll();
      await vi.advanceTimersByTimeAsync(5000);
      const callsAfterFirst = getGeneration.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThan(0);
      ctrl.stopAutoPoll();
      await vi.advanceTimersByTimeAsync(15000);
      expect(getGeneration.mock.calls.length).toBe(callsAfterFirst);
    } finally {
      vi.useRealTimers();
    }
  });

  it("signs out and stops polling on a 401 during a poll", async () => {
    vi.useFakeTimers();
    try {
      const running: GenerationTask = { ...textTask("t1", "p"), status: "running", result: undefined };
      const getGeneration = vi.fn(async () => { throw new ApiError("unauth", 401); });
      const store = createFakeTokenStore();
      const client = createFakeClient({ listGenerations: async () => [running], getGeneration });
      const ctrl = createMobileAppController({ apiClient: client, tokenStore: store });
      await ctrl.startLogin("test@example.com");
      await ctrl.verifyLogin("000000");
      ctrl.startAutoPoll();
      await vi.advanceTimersByTimeAsync(5000);
      expect(ctrl.getState().stage).toBe("signedOut");
      expect(await store.load()).toBeNull();
      const callsAfter = getGeneration.mock.calls.length;
      await vi.advanceTimersByTimeAsync(15000);
      expect(getGeneration.mock.calls.length).toBe(callsAfter);
    } finally {
      vi.useRealTimers();
    }
  });

  it("startAutoPoll is idempotent (one interval)", async () => {
    vi.useFakeTimers();
    try {
      const running: GenerationTask = { ...textTask("t1", "p"), status: "running", result: undefined };
      const getGeneration = vi.fn(async () => running);
      const client = createFakeClient({ listGenerations: async () => [running], getGeneration });
      const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
      await ctrl.startLogin("test@example.com");
      await ctrl.verifyLogin("000000");
      ctrl.startAutoPoll();
      ctrl.startAutoPoll();
      await vi.advanceTimersByTimeAsync(5000);
      expect(getGeneration).toHaveBeenCalledTimes(1);
      ctrl.stopAutoPoll();
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @gw-link-omniai/mobile exec vitest run src/__tests__/appModel.test.ts`
Expected: FAIL — `ctrl.startAutoPoll is not a function`.

- [ ] **Step 3: Add POLL_INTERVAL_MS + interface methods in `apps/mobile/src/appModel.ts`**

Add the constant right after the `DEFAULT_PRESET` constant (near the top of the module):

```typescript
const POLL_INTERVAL_MS = 5000;
```

Add to the `MobileAppController` interface, after `refreshTask` (keep `saveAsset`/`signOut` after):

```typescript
  refreshTask(taskId: string): Promise<void>;
  startAutoPoll(): void;
  stopAutoPoll(): void;
  saveAsset(task: GenerationTask): Promise<void>;
  signOut(): Promise<void>;
```

- [ ] **Step 4: Add the poll internals + stop-on-signout in `apps/mobile/src/appModel.ts`**

Inside `createMobileAppController`, add the `pollHandle` declaration next to `state`/`listeners` (after `const listeners = new Set...`):

```typescript
  let pollHandle: ReturnType<typeof setInterval> | null = null;
```

Add these two internal functions immediately before `signOutInternal`:

```typescript
  function stopPolling(): void {
    if (pollHandle !== null) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  async function pollRunning(): Promise<void> {
    const token = state.token;
    if (!token) {
      return;
    }
    const runningIds = state.tasks.filter((task) => task.status === "running").map((task) => task.id);
    for (const id of runningIds) {
      try {
        const updated = await apiClient.getGeneration(id, token);
        setState({ tasks: state.tasks.map((task) => (task.id === updated.id ? updated : task)) });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          stopPolling();
          await signOutInternal();
          return;
        }
        // transient poll error: stay quiet, retry next tick
      }
    }
  }
```

Modify `signOutInternal` to stop polling first:

```typescript
  async function signOutInternal(): Promise<void> {
    stopPolling();
    await tokenStore.clear();
    setState({ token: null, stage: "signedOut", balance: null, tasks: [], assets: [], challengeId: null });
  }
```

- [ ] **Step 5: Add the interface method implementations in `apps/mobile/src/appModel.ts`**

In the returned controller object, add `startAutoPoll` and `stopAutoPoll` right after the `refreshTask` method:

```typescript
    startAutoPoll() {
      if (pollHandle !== null) {
        return;
      }
      pollHandle = setInterval(() => {
        void pollRunning();
      }, POLL_INTERVAL_MS);
    },
    stopAutoPoll() {
      stopPolling();
    },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @gw-link-omniai/mobile exec vitest run src/__tests__/appModel.test.ts`
Expected: PASS — 4 new tests + all existing appModel tests.

- [ ] **Step 7: Wire auto-poll into App.tsx**

In `apps/mobile/App.tsx`, immediately after the existing restore effect (`useEffect(() => { void ctrl.restore(); }, [ctrl]);`), add:

```typescript
  useEffect(() => {
    if (state.stage !== "signedIn") {
      return;
    }
    ctrl.startAutoPoll();
    return () => ctrl.stopAutoPoll();
  }, [ctrl, state.stage]);
```

- [ ] **Step 8: Typecheck + full workspace**

Run: `pnpm --filter @gw-link-omniai/mobile typecheck`
Expected: no errors.

Run: `pnpm --filter @gw-link-omniai/mobile test`
Expected: appModel gains 4 tests (24 appModel + tokenStore 3 + resultModel 2 = 29 mobile).

Run: `pnpm test`
Expected: all packages green.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/appModel.ts apps/mobile/App.tsx apps/mobile/src/__tests__/appModel.test.ts
git commit -m "feat(mobile): auto-poll running tasks every 5s

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update README.md**

Under `### Mobile API Integration`, in the "Core flow" bullet, change the refresh clause. Change:

```markdown
refresh a `running` task's status, and save a succeeded result to a filtered asset
```
to:
```markdown
refresh a `running` task's status (and auto-poll running tasks every 5s), and save
a succeeded result to a filtered asset
```

- [ ] **Step 2: Update mvp-skeleton.md**

Under `## Mobile API Integration Slice`, append after the existing final sentence:

```markdown
The `appModel` controller also auto-polls `running` tasks every 5s
(`startAutoPoll`/`stopAutoPoll`; `pollRunning` reuses `getGeneration`, 401 signs
out and stops, other errors stay silent), started by `App.tsx` while signed-in and
stopped on cleanup. Because the polling lives in the framework-free controller, it
is fully unit-tested with fake timers (unlike the typecheck-only view).
```

- [ ] **Step 3: Full workspace validation**

Run: `pnpm test`
Expected: all packages green.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document mobile auto-poll (Slice 21)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ POLL_INTERVAL_MS + startAutoPoll/stopAutoPoll/pollRunning (spec §1) → Task 1 Steps 3-5
- ✅ signOutInternal stops polling (spec §1) → Task 1 Step 4
- ✅ 401→signout+stop / other→silent (spec §错误处理) → Task 1 Step 4
- ✅ App.tsx signedIn wiring (spec §2) → Task 1 Step 7
- ✅ 4 fake-timer tests: advance/stop/401/idempotent (spec §测试策略) → Task 1 Step 1
- ✅ docs (spec §文档) → Task 2
- ✅ non-goals honored (no backoff, no balance/asset poll, no desktop change, manual button kept)

**Placeholder scan:** none — all code/commands/expected outputs concrete.

**Type consistency:** `startAutoPoll(): void` / `stopAutoPoll(): void` consistent across interface, impl, App call, and tests. Internal `stopPolling()` (distinct from the method `stopAutoPoll`) called by `pollRunning`, `signOutInternal`, and the `stopAutoPoll` method. `pollHandle: ReturnType<typeof setInterval> | null`. `getGeneration(id, token)` matches the existing ApiClient signature.
