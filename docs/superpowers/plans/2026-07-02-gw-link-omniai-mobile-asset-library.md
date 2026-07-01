# Mobile Asset Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add save-to-asset-library + filtered asset list to the mobile app, mirroring desktop, and lift the shared asset logic into `packages/shared`.

**Architecture:** Lift desktop `assetModel.ts` pure functions to `packages/shared` (framework-free); extend the mobile `appModel` controller with `assets` state + a `saveAsset` action + asset loading; the thin `App.tsx` view adds a "保存到资产库" button on succeeded task rows and an asset-library section with filter buttons. Controller logic is unit-tested with vitest; App.tsx stays typecheck-only.

**Tech Stack:** React Native 0.74, Expo 51, vitest, shared contracts + apiClient + assetModel.

## Global Constraints

- `assetModel` pure functions live in `packages/shared` after Task 1; desktop + mobile import from `@gw-link-omniai/shared`.
- appModel is framework-free; tests use vitest (`describe/it/expect`), not node:test.
- App.tsx is a thin RN view, typecheck-only (not unit-tested).
- Error copy EXACT: saveAsset 401 → sign out (clear token, stage `signedOut`, no error text); saveAsset other `ApiError` → `"保存失败，请稍后重试"`; saveAsset non-`ApiError` → `"网络错误"`.
- `saveAsset` calls `createAsset(buildAssetRequestFromTask(task), token)` then refreshes via `listAssets`; `loadUserData` loads assets alongside balance + tasks; `signOutInternal` resets `assets: []`.
- "保存到资产库" button only on `succeeded` task rows. Filter is local App.tsx state (`AssetFilter` = `"all" | "text" | "image" | "video"`), computed with shared `filterCreationAssets`.
- Non-goals: asset delete/edit, cross-device sync, image/video thumbnail rendering, desktop UI behavior changes (only its imports change).
- Each task green before commit.

---

## Task 1: Lift assetModel to shared

**Files:**
- Move: `apps/desktop/src/assetModel.ts` → `packages/shared/src/assetModel.ts`
- Move: `apps/desktop/src/__tests__/assetModel.test.ts` → `packages/shared/src/__tests__/assetModel.test.ts`
- Modify: `packages/shared/src/index.ts` (export assetModel)
- Modify: `apps/desktop/src/App.tsx` + any other desktop file importing `./assetModel`

**Interfaces:**
- Consumes: existing desktop `assetModel.ts` (exports `AssetFilter`, `filterCreationAssets`, `getAssetFilterLabel`, `getAssetModeLabel`, `buildAssetRequestFromTask`, `summarizeAssetPrompt`).
- Produces: same exports, now from `@gw-link-omniai/shared`.

- [ ] **Step 1: Move assetModel.ts + its test to shared**

```bash
git mv apps/desktop/src/assetModel.ts packages/shared/src/assetModel.ts
git mv apps/desktop/src/__tests__/assetModel.test.ts packages/shared/src/__tests__/assetModel.test.ts
```

- [ ] **Step 2: Export assetModel from `packages/shared/src/index.ts`**

Append:

```typescript
export {
  filterCreationAssets,
  getAssetFilterLabel,
  getAssetModeLabel,
  buildAssetRequestFromTask,
  summarizeAssetPrompt,
  type AssetFilter
} from "./assetModel.js";
```

- [ ] **Step 3: Find every desktop import of the old path**

Run: `grep -rn "\./assetModel\|/assetModel" apps/desktop/src`
Expected: at least `apps/desktop/src/App.tsx`. Note each file (App.tsx, and possibly a test that imports it).

- [ ] **Step 4: Update the desktop imports**

In each file found in Step 3, change the import source from `"./assetModel"` (or `"../assetModel"` in tests) to `"@gw-link-omniai/shared"`. For `apps/desktop/src/App.tsx`, the line:

```typescript
import { buildAssetRequestFromTask, filterCreationAssets, getAssetFilterLabel, summarizeAssetPrompt, type AssetFilter } from "./assetModel";
```
becomes:
```typescript
import { buildAssetRequestFromTask, filterCreationAssets, getAssetFilterLabel, summarizeAssetPrompt, type AssetFilter } from "@gw-link-omniai/shared";
```

If the shared import for other symbols already exists on a separate line, keep both lines (do not merge). Apply the analogous change to any test file found in Step 3.

- [ ] **Step 5: Fix the moved test's import path**

In `packages/shared/src/__tests__/assetModel.test.ts`, the import was `from "../assetModel"` (relative to the old `src/__tests__` location); it still resolves to `../assetModel` in the new location, so no change is needed — but verify by running the tests in Step 6. If the test imported `@gw-link-omniai/shared` types, leave those as-is.

- [ ] **Step 6: Run shared + desktop tests**

Run: `pnpm --filter @gw-link-omniai/shared test`
Expected: PASS — existing shared tests + moved assetModel tests.

Run: `pnpm --filter @gw-link-omniai/desktop test`
Expected: PASS — desktop suite still green (imports rerouted, behavior unchanged).

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/shared apps/desktop
git commit -m "refactor(shared): lift assetModel from desktop to shared

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: appModel assets + saveAsset

**Files:**
- Modify: `apps/mobile/src/appModel.ts`
- Modify: `apps/mobile/src/__tests__/appModel.test.ts`

**Interfaces:**
- Consumes: `buildAssetRequestFromTask` from `@gw-link-omniai/shared` (lifted in Task 1); `apiClient.createAsset(request, token)`, `apiClient.listAssets(token)`.
- Produces: `MobileAppController.saveAsset(task: GenerationTask): Promise<void>`; `MobileAppState.assets: CreationAsset[]`.

- [ ] **Step 1: Extend the fake client + write the failing tests**

In `apps/mobile/src/__tests__/appModel.test.ts`:

First, update the imports at the top to add `CreationAsset` and `CreationAssetRequest`:

```typescript
import type { ApiClient, AuthSession, CreationAsset, CreationAssetRequest, GenerationTask, LoginStartResponse, SessionResponse } from "@gw-link-omniai/shared";
```

Then replace the two "unused" lines in `createFakeClient`'s `base` object:

```typescript
    listAssets: async () => { throw new Error("unused"); },
    createAsset: async () => { throw new Error("unused"); },
```
with stateful fakes (declare `let assets: CreationAsset[] = [];` next to the existing `let tasks` / `let balance` declarations at the top of `createFakeClient`):

```typescript
    listAssets: async () => assets,
    createAsset: async (request: CreationAssetRequest) => {
      const asset: CreationAsset = {
        id: `a${assets.length + 1}`,
        mode: request.mode,
        title: request.title,
        content: request.content,
        preview: { title: request.title, description: "已保存" },
        source: request.source,
        prompt: request.prompt,
        optimizedPrompt: request.optimizedPrompt,
        preset: request.preset,
        createdAt: "2026-07-02T00:00:00.000Z"
      };
      assets = [asset, ...assets];
      return asset;
    },
```

Now add these four tests inside the `describe("MobileAppController", ...)` block:

```typescript
  it("loads assets on login", async () => {
    const seeded: CreationAsset = {
      id: "a-seed",
      mode: "text",
      title: "文本资产",
      content: { kind: "text", text: "已生成", format: "plain" },
      preview: { title: "文本资产", description: "已保存" },
      source: { taskId: "t0", taskStatus: "succeeded" },
      prompt: "p",
      optimizedPrompt: "p",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
      createdAt: "2026-07-02T00:00:00.000Z"
    };
    const client = createFakeClient({ listAssets: async () => [seeded] });
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    expect(ctrl.getState().assets).toHaveLength(1);
    expect(ctrl.getState().assets[0].id).toBe("a-seed");
  });

  it("saves a succeeded task as an asset and refreshes the list", async () => {
    const ctrl = createMobileAppController({ apiClient: createFakeClient(), tokenStore: createFakeTokenStore() });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    const task = textTask("t1", "存这个");
    await ctrl.saveAsset(task);
    expect(ctrl.getState().assets).toHaveLength(1);
    expect(ctrl.getState().assets[0].prompt).toBe("存这个");
  });

  it("signs out on a 401 during saveAsset", async () => {
    const client = createFakeClient({ createAsset: async () => { throw new ApiError("unauth", 401); } });
    const store = createFakeTokenStore();
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: store });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    await ctrl.saveAsset(textTask("t1", "p"));
    expect(ctrl.getState().stage).toBe("signedOut");
    expect(await store.load()).toBeNull();
  });

  it("maps a non-401 saveAsset error to a friendly message", async () => {
    const client = createFakeClient({ createAsset: async () => { throw new ApiError("boom", 500); } });
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    await ctrl.saveAsset(textTask("t1", "p"));
    expect(ctrl.getState().actionError).toBe("保存失败，请稍后重试");
    expect(ctrl.getState().stage).toBe("signedIn");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @gw-link-omniai/mobile exec vitest run src/__tests__/appModel.test.ts`
Expected: FAIL — `ctrl.saveAsset is not a function` and `assets` undefined.

- [ ] **Step 3: Extend `apps/mobile/src/appModel.ts`**

Add the shared import at the top (extend the existing shared import or add a new line):

```typescript
import { ApiError, buildAssetRequestFromTask, type ApiClient, type CreationAsset, type CreationMode, type GenerationTask, type PresetSuggestion } from "@gw-link-omniai/shared";
```

Add `assets` to `MobileAppState` (after `tasks`):

```typescript
  tasks: GenerationTask[];
  assets: CreationAsset[];
  actionError: string | null;
```

Add `saveAsset` to the `MobileAppController` interface (after `refreshTask`):

```typescript
  refreshTask(taskId: string): Promise<void>;
  saveAsset(task: GenerationTask): Promise<void>;
  signOut(): Promise<void>;
```

Add the `assetError` helper next to `refreshError`:

```typescript
function assetError(err: unknown): string {
  if (err instanceof ApiError) {
    return "保存失败，请稍后重试";
  }
  return "网络错误";
}
```

Initialize `assets: []` in the initial `state` object (after `tasks: []`):

```typescript
    tasks: [],
    assets: [],
    actionError: null
```

Extend `loadUserData` to load assets:

```typescript
  async function loadUserData(token: string): Promise<void> {
    const [balance, tasks, assets] = await Promise.all([
      apiClient.getCreditBalance(token),
      apiClient.listGenerations(token),
      apiClient.listAssets(token)
    ]);
    setState({ balance: balance.credits, tasks, assets });
  }
```

Add `assets: []` to the `signOutInternal` reset:

```typescript
  async function signOutInternal(): Promise<void> {
    await tokenStore.clear();
    setState({ token: null, stage: "signedOut", balance: null, tasks: [], assets: [], challengeId: null });
  }
```

Add the `saveAsset` action to the returned controller (after `refreshTask`):

```typescript
    async saveAsset(task) {
      const token = state.token;
      if (!token) {
        return;
      }
      setState({ actionError: null });
      try {
        await apiClient.createAsset(buildAssetRequestFromTask(task), token);
        const assets = await apiClient.listAssets(token);
        setState({ assets });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await signOutInternal();
          return;
        }
        setState({ actionError: assetError(err) });
      }
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @gw-link-omniai/mobile exec vitest run src/__tests__/appModel.test.ts`
Expected: PASS — 20/20 (16 existing + 4 new).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @gw-link-omniai/mobile typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/appModel.ts apps/mobile/src/__tests__/appModel.test.ts
git commit -m "feat(mobile): appModel assets state + saveAsset action

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: App.tsx save button + asset library section

**Files:**
- Modify: `apps/mobile/App.tsx`

**Interfaces:**
- Consumes: `ctrl.saveAsset`, `state.assets` (Task 2); `AssetFilter`, `filterCreationAssets`, `getAssetFilterLabel`, `getAssetModeLabel`, `summarizeAssetPrompt` from `@gw-link-omniai/shared` (Task 1).
- Produces: mobile UI (typecheck-only).

- [ ] **Step 1: Add the shared asset imports**

At the top of `apps/mobile/App.tsx`, extend the shared import to include the asset helpers and `AssetFilter`:

```typescript
import { createApiClient, type ApiClient, type CreationMode, filterCreationAssets, getAssetFilterLabel, getAssetModeLabel, summarizeAssetPrompt, type AssetFilter } from "@gw-link-omniai/shared";
```

- [ ] **Step 2: Add the filter state**

Alongside the other `useState` hooks (near `const [mode, setMode] = ...`):

```typescript
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
```

- [ ] **Step 3: Add the save button to succeeded task rows**

In the task `FlatList` `renderItem`, after the existing running-row refresh button, add:

```tsx
                {item.status === "running" ? (
                  <Button title="刷新状态" onPress={() => void ctrl.refreshTask(item.id)} />
                ) : null}
                {item.status === "succeeded" ? (
                  <Button title="保存到资产库" onPress={() => void ctrl.saveAsset(item)} />
                ) : null}
```

- [ ] **Step 4: Add the asset library section**

After the task `FlatList` (before the closing `</>` of the `signedIn` block), add:

```tsx
          <View style={styles.assetHeader}>
            <Text>资产库</Text>
            <View style={styles.filterRow}>
              {(["all", "text", "image", "video"] as AssetFilter[]).map((filter) => (
                <Button key={filter} title={getAssetFilterLabel(filter)} onPress={() => setAssetFilter(filter)} />
              ))}
            </View>
          </View>
          <FlatList
            data={filterCreationAssets(state.assets, assetFilter)}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.task}>
                <Text>{getAssetModeLabel(item.mode)}</Text>
                <Text numberOfLines={1}>{summarizeAssetPrompt(item)}</Text>
              </View>
            )}
          />
```

- [ ] **Step 5: Add the styles**

In the `StyleSheet.create({...})` at the bottom, add:

```typescript
  assetHeader: { marginTop: 16, marginBottom: 8 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @gw-link-omniai/mobile typecheck`
Expected: no errors.

- [ ] **Step 7: Run the mobile suite + full workspace**

Run: `pnpm --filter @gw-link-omniai/mobile test`
Expected: 27/27 (appModel 20 + tokenStore 3 + homeModel 4).

Run: `pnpm test`
Expected: all packages green.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/App.tsx
git commit -m "feat(mobile): save-to-asset-library button + filtered asset list

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update README.md**

Under `### Mobile API Integration`, change the "Core flow" bullet to mention assets. Change:

```markdown
- Core flow: login, submit a generation, list your tasks, show balance, and
  refresh a `running` task's status. Save-to-assets, the asset library, top-up,
  and image/video rendering remain later slices.
```
to:
```markdown
- Core flow: login, submit a generation, list your tasks, show balance, refresh a
  `running` task's status, and save a succeeded result to a filtered asset
  library. Top-up and image/video rendering remain later slices.
```

- [ ] **Step 2: Update mvp-skeleton.md**

Under `## Mobile API Integration Slice`, change the final sentence. Change:

```markdown
A `running` task row shows a "刷新状态" button that re-polls via
`getGeneration` (mirroring desktop). Save-to-assets, the asset library, top-up,
image/video rendering, and multi-screen navigation remain later slices.
```
to:
```markdown
A `running` task row shows a "刷新状态" button that re-polls via
`getGeneration`, and a `succeeded` row shows a "保存到资产库" button; the
signed-in screen lists saved assets with type filters (`filterCreationAssets`).
The asset-model pure functions (`buildAssetRequestFromTask`, `filterCreationAssets`,
labels, `summarizeAssetPrompt`) were lifted to `packages/shared` so desktop and
mobile share them. Top-up, image/video rendering, and multi-screen navigation
remain later slices.
```

- [ ] **Step 3: Full workspace validation**

Run: `pnpm test`
Expected: all packages green.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document mobile asset library (Slice 15)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ assetModel → shared (spec §1) → Task 1
- ✅ appModel assets + saveAsset + loadUserData assets + signOut reset (spec §2) → Task 2
- ✅ App.tsx save button + asset section + filter (spec §3) → Task 3
- ✅ error mapping 401/other/network (spec §错误处理) → Task 2 Step 3
- ✅ 4 appModel tests + moved shared test (spec §测试策略) → Task 1, Task 2
- ✅ docs (spec §文档) → Task 4
- ✅ non-goals honored (no delete/edit/sync/thumbnail, no desktop behavior change)

**Placeholder scan:** none — all code/commands/expected outputs concrete.

**Type consistency:** `saveAsset(task: GenerationTask): Promise<void>` and `assets: CreationAsset[]` consistent across interface, impl, tests, and App call `ctrl.saveAsset(item)`. `assetError` matches `refreshError` shape. `AssetFilter` = `"all" | CreationMode` used in appModel-free App state and shared `filterCreationAssets`.
