# GW-LINK OmniAI Desktop Asset Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the desktop save a `succeeded` text generation task as an asset via the existing `/v1/assets` API — re-adding the "保存到资产库" action that was deferred until tasks could reach `succeeded`.

**Architecture:** Re-add `apiClient.createAsset(request, token)`; add a framework-free `buildAssetRequestFromTask(task)` that maps a succeeded text task to a `CreationAssetRequest` (content = `task.result`, source `taskStatus: "succeeded"`); wire a save button on succeeded-text task cards in `App.tsx` that creates the asset and refreshes the asset list. No backend or `packages/shared` change.

**Tech Stack:** TypeScript (strict, ESM), React 18, Vite, Vitest + @testing-library/react + jsdom, pnpm workspaces, Node 20.

**Spec:** `docs/superpowers/specs/2026-06-21-gw-link-omniai-desktop-asset-save-design.md` (approved).

## Global Constraints (apply to every task)

1. No backend change (the `/v1/assets` route + asset service + `taskStatus === "succeeded"` validation already exist) and NO `packages/shared` change (the `CreationAssetContent` text variant already equals the `GenerationTaskResult` text variant).
2. Only text tasks are saveable: the save action exists only when `task.status === "succeeded" && task.result?.kind === "text"`. Image/video stay `queued` with no result and no button.
3. Asset title = `getAssetModeLabel(task.mode)` (e.g. "文本资产"). `source.taskStatus` is the literal `"succeeded"`. `content` and `preset` are deep-copied (no shared mutable refs with the task).
4. Errors: `createAsset` non-2xx → `ApiError` → App shows the message; `401` → return to signed-out (`handleSignedOut`).
5. Each task ends green: run `pnpm --filter @gw-link-omniai/desktop test` + `... typecheck` before committing; commit per task. Final task runs root `pnpm test` + `pnpm typecheck`.

## File Structure

- Modify: `apps/desktop/src/apiClient.ts` — add `createAsset`.
- Modify: `apps/desktop/src/__tests__/apiClient.test.ts` — `createAsset` test.
- Modify: `apps/desktop/src/assetModel.ts` — add `buildAssetRequestFromTask`.
- Modify: `apps/desktop/src/__tests__/assetModel.test.ts` — `buildAssetRequestFromTask` test.
- Modify: `apps/desktop/src/App.tsx` — save button + `handleSaveAsset`.
- Modify: `apps/desktop/src/__tests__/App.test.tsx` — save-flow test + fake `createAsset`.
- Modify: `README.md`, `docs/architecture/mvp-skeleton.md` — asset save no longer deferred.

---

## Task 1: `apiClient.createAsset`

**Files:**
- Modify: `apps/desktop/src/apiClient.ts`
- Test: `apps/desktop/src/__tests__/apiClient.test.ts`

**Interfaces:**
- Produces: `ApiClient.createAsset(request: CreationAssetRequest, token: string): Promise<CreationAsset>`.

- [ ] **Step 1: Write the failing test** — in `apps/desktop/src/__tests__/apiClient.test.ts`, add (the file already imports `vi`, `createApiClient`, and a `jsonResponse` helper + `baseUrl`):
  ```ts
  it("posts an asset with the bearer token and unwraps the asset envelope", async () => {
    const asset = {
      id: "a1",
      mode: "text",
      title: "文本资产",
      content: { kind: "text", text: "已生成文案", format: "markdown" },
      preview: { title: "文本资产", description: "占位文本资产。" },
      source: { taskId: "t1", taskStatus: "succeeded" },
      prompt: "p",
      optimizedPrompt: "op",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
      createdAt: "2026-06-21T00:00:00.000Z"
    };
    const fetchMock = vi.fn(async () => jsonResponse({ asset }));
    const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

    const created = await client.createAsset(
      {
        mode: "text",
        title: "文本资产",
        content: { kind: "text", text: "已生成文案", format: "markdown" },
        source: { taskId: "t1", taskStatus: "succeeded" },
        prompt: "p",
        optimizedPrompt: "op",
        preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } }
      },
      "tok-1"
    );

    expect(created).toEqual(asset);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/v1/assets");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });
  ```
  (If the existing tests use a `baseUrl` constant other than `http://api.test`, match it.)

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/apiClient.test.ts -t "posts an asset"`
  Expected: FAIL (`createAsset` is not a function).

- [ ] **Step 3: Implement `createAsset`** — in `apps/desktop/src/apiClient.ts`:
  - Add `CreationAssetRequest` to the import from `@gw-link-omniai/shared` (alongside the existing `CreationAsset`).
  - Add to the `ApiClient` interface (after `listAssets`):
    ```ts
    createAsset(request: CreationAssetRequest, token: string): Promise<CreationAsset>;
    ```
  - Add the implementation in the returned object (after `listAssets`):
    ```ts
    async createAsset(request, token) {
      const { asset } = await send<{ asset: CreationAsset }>("/v1/assets", {
        method: "POST",
        body: request,
        token
      });
      return asset;
    }
    ```

- [ ] **Step 4: Run it to verify it passes**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/apiClient.test.ts`
  Expected: PASS (existing client tests + the new one).

- [ ] **Step 5: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/desktop typecheck` (green).
  ```bash
  git add apps/desktop/src/apiClient.ts apps/desktop/src/__tests__/apiClient.test.ts
  git commit -m "feat(desktop): add apiClient.createAsset

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2: `buildAssetRequestFromTask`

**Files:**
- Modify: `apps/desktop/src/assetModel.ts`
- Test: `apps/desktop/src/__tests__/assetModel.test.ts`

**Interfaces:**
- Produces: `buildAssetRequestFromTask(task: GenerationTask): CreationAssetRequest` (requires a succeeded text task — throws otherwise).

- [ ] **Step 1: Write the failing test** — in `apps/desktop/src/__tests__/assetModel.test.ts`, add (import what you need from `@gw-link-omniai/shared` + `buildAssetRequestFromTask` from `../assetModel`):
  ```ts
  it("builds a creation-asset request from a succeeded text task", () => {
    const task: GenerationTask = {
      id: "task-1",
      mode: "text",
      status: "succeeded",
      prompt: "帮我写一个新品发布文案",
      optimizedPrompt: "请生成一段新品推广文案。",
      preset: {
        modelId: "gw-text-balanced",
        parameters: { tone: "warm" },
        creditEstimate: { credits: 1, unit: "credit" }
      },
      resultPreview: { title: "文本生成任务", description: "已生成。" },
      result: { kind: "text", text: "新品上市文案", format: "markdown" },
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    };

    const request = buildAssetRequestFromTask(task);

    expect(request).toEqual({
      mode: "text",
      title: "文本资产",
      content: { kind: "text", text: "新品上市文案", format: "markdown" },
      source: { taskId: "task-1", taskStatus: "succeeded" },
      prompt: "帮我写一个新品发布文案",
      optimizedPrompt: "请生成一段新品推广文案。",
      preset: {
        modelId: "gw-text-balanced",
        parameters: { tone: "warm" },
        creditEstimate: { credits: 1, unit: "credit" }
      }
    });

    // deep copy: mutating the request must not touch the task
    request.preset.parameters.tone = "mutated";
    expect(task.preset.parameters.tone).toBe("warm");
  });

  it("throws when the task is not a succeeded text task", () => {
    const queued = {
      id: "t",
      mode: "text",
      status: "queued",
      prompt: "p",
      optimizedPrompt: "op",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
      resultPreview: { title: "t", description: "d" },
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    } as GenerationTask;
    expect(() => buildAssetRequestFromTask(queued)).toThrow();
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/assetModel.test.ts -t "creation-asset request"`
  Expected: FAIL (`buildAssetRequestFromTask` not exported).

- [ ] **Step 3: Implement it** — in `apps/desktop/src/assetModel.ts`:
  - Extend the import to: `import type { CreationAsset, CreationAssetRequest, CreationMode, GenerationTask } from "@gw-link-omniai/shared";`
  - Add the function:
    ```ts
    export function buildAssetRequestFromTask(task: GenerationTask): CreationAssetRequest {
      if (task.result?.kind !== "text") {
        throw new Error("Only succeeded text tasks can be saved as assets");
      }

      return {
        mode: task.mode,
        title: getAssetModeLabel(task.mode),
        content: { kind: "text", text: task.result.text, format: task.result.format },
        source: { taskId: task.id, taskStatus: "succeeded" },
        prompt: task.prompt,
        optimizedPrompt: task.optimizedPrompt,
        preset: {
          modelId: task.preset.modelId,
          parameters: { ...task.preset.parameters },
          creditEstimate: { ...task.preset.creditEstimate }
        }
      };
    }
    ```

- [ ] **Step 4: Run it to verify it passes**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/assetModel.test.ts`
  Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/desktop typecheck` (green).
  ```bash
  git add apps/desktop/src/assetModel.ts apps/desktop/src/__tests__/assetModel.test.ts
  git commit -m "feat(desktop): build a creation-asset request from a succeeded task

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3: App save-to-asset flow

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `apiClient.createAsset` (Task 1), `buildAssetRequestFromTask` (Task 2).

- [ ] **Step 1: Wire the save flow in `App.tsx`:**
  - Extend the assetModel import to include `buildAssetRequestFromTask`:
    ```ts
    import { buildAssetRequestFromTask, filterCreationAssets, getAssetFilterLabel, summarizeAssetPrompt, type AssetFilter } from "./assetModel";
    ```
  - Add `handleSaveAsset` after `handleSubmitGeneration`:
    ```ts
    async function handleSaveAsset(task: GenerationTask) {
      if (!token) {
        return;
      }
      setActionError(undefined);
      try {
        await api.createAsset(buildAssetRequestFromTask(task), token);
        setAssets(await api.listAssets(token));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          handleSignedOut("登录已失效，请重新登录");
          return;
        }
        setActionError(errorMessage(error));
      }
    }
    ```
  - In the task card `<article>`, after the result `<p>` line (`{task.result?.kind === "text" ? <p>{task.result.text}</p> : null}`), add the save button:
    ```tsx
    {task.status === "succeeded" && task.result?.kind === "text" ? (
      <button type="button" onClick={() => handleSaveAsset(task)}>
        保存到资产库
      </button>
    ) : null}
    ```

- [ ] **Step 2: Update the fake client + add the save test** — in `apps/desktop/src/__tests__/App.test.tsx`:
  - Make the fake client's assets stateful and add `createAsset`. In `createFakeClient`, add an `assets` array alongside the existing `tasks`, and replace the `listAssets`/add `createAsset` entries:
    ```ts
    let assets: CreationAsset[] = overrides.listAssets ? [] : [];
    ```
    (Keep it simple: declare `let assets: CreationAsset[] = [];` near the `let tasks` declaration.) Then in the returned base object set:
    ```ts
    createAsset: async (request) => {
      const asset: CreationAsset = {
        id: `asset-${assets.length + 1}`,
        mode: request.mode,
        title: request.title,
        content: request.content,
        preview: { title: request.title, description: "已保存。" },
        source: request.source,
        prompt: request.prompt,
        optimizedPrompt: request.optimizedPrompt,
        preset: request.preset,
        createdAt: "2026-06-21T00:00:00.000Z"
      };
      assets = [asset, ...assets];
      return asset;
    },
    listAssets: async () => assets,
    ```
    (Remove the old `listAssets: async (): Promise<CreationAsset[]> => []` line — the stateful `listAssets` above replaces it. Tests that need a preset asset list, like "lists the user's assets read-only", pass `listAssets` via `overrides` — keep that working by letting `overrides` win via the `{ ...base, ...overrides }` spread, which it already does.)
  - Add a test (after "shows the generated text in the task center"):
    ```ts
    it("saves a succeeded text task to the asset library", async () => {
      const client = createFakeClient();
      await signIn(client);

      fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
      await screen.findByLabelText("提示词优化结果");
      fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

      const taskCenter = screen.getByLabelText("任务中心");
      fireEvent.click(await within(taskCenter).findByRole("button", { name: "保存到资产库" }));

      const assetLibrary = screen.getByLabelText("资产库");
      await within(assetLibrary).findByText("文本资产");
      expect(within(assetLibrary).getByText("已保存。")).toBeTruthy();
    });
    ```
    Note on the assertions: the asset card renders `asset.title`, `asset.preview.description`, `summarizeAssetPrompt(asset)`, and `asset.preset.modelId` — it does NOT render `content.text`, so do not assert the generated text inside 资产库. The fake `createAsset` above sets `title = request.title` ("文本资产", from `getAssetModeLabel`) and `preview.description = "已保存。"`; 资产库 starts as "暂无资产", so finding "文本资产" + "已保存。" within it proves the freshly-saved asset is now listed. The fake `createGeneration` (from the prior slice) already returns a `succeeded` text task, so the "保存到资产库" button is present.

- [ ] **Step 3: Run the desktop App test**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx`
  Expected: PASS (save-flow test green; the existing "lists the user's assets read-only (no save button)" test stays green — it signs in with no submitted task, so no succeeded task card → no save button).

- [ ] **Step 4: Full desktop check + commit**

  Run: `pnpm --filter @gw-link-omniai/desktop test` then `pnpm --filter @gw-link-omniai/desktop typecheck`. Both green.
  ```bash
  git add apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
  git commit -m "feat(desktop): save a succeeded text task to the asset library

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4: Documentation + final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update `README.md`** — in the "Desktop ↔ API" section, the bullet that says asset creation is deferred (`- Asset *creation* from the desktop is deferred: ...`) should be replaced with:
  ```markdown
  - Save a `succeeded` text generation as an asset ("保存到资产库") — the desktop
    builds the asset from the task's text result and posts it to `/v1/assets`.
    (Image/video stay `queued` with no result, so they are not yet saveable.)
  ```

- [ ] **Step 2: Update `docs/architecture/mvp-skeleton.md`** — append a section:
  ```markdown
  ## Desktop Asset Save Slice

  With real text generation producing `succeeded` tasks (Real Text Provider
  slice), the desktop can now save a generated text task as an asset. A
  framework-free `buildAssetRequestFromTask` maps a succeeded text task to a
  `CreationAssetRequest` (content from the task's text result, source
  `taskStatus: "succeeded"`), and the App posts it through `apiClient.createAsset`
  to the existing guarded `/v1/assets` route, then refreshes the per-user asset
  library. No backend or shared-contract change was needed. Image and video stay
  `queued` (no result) and are not yet saveable; object storage and saving
  image/video assets remain later slices.
  ```

- [ ] **Step 3: Full workspace verification**

  Run from the repo root: `pnpm test` then `pnpm typecheck`. Both green.

- [ ] **Step 4: Commit**
  ```bash
  git add README.md docs/architecture/mvp-skeleton.md
  git commit -m "docs: document the desktop asset save slice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Final Verification (after all tasks)

- [ ] `pnpm test` + `pnpm typecheck` pass across all packages.
- [ ] No edits under `packages/shared/` or `apps/api/`.
- [ ] `git grep -n "保存到资产库" apps/desktop/src/App.tsx` shows the button gated by `task.status === "succeeded" && task.result?.kind === "text"`.
- [ ] Manual check (not automated): set `OPENAI_API_KEY`, `pnpm dev:api` + `pnpm dev:desktop`, log in, submit a text generation, save it, and see it in the asset library.
