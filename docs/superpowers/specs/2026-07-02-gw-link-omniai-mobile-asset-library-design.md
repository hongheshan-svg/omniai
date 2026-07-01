# GW-LINK OmniAI Mobile 资产库设计规格

**日期**: 2026-07-02
**Slice**: 15 — Mobile 资产库

---

## 摘要

给 mobile 端加"保存生成结果到资产库"+ 资产列表（含过滤），镜像 desktop（Slice 5 / Slice 7）。把 desktop `assetModel.ts` 的纯函数提升到 `packages/shared`（framework-free，desktop + mobile 共享）；mobile `appModel` 扩展 assets 数据 + `saveAsset` 动作；`App.tsx` 加"保存到资产库"按钮 + 资产库 section（过滤 + 列表）。

## 动机

Slice 13/14 让 mobile 接入了核心生成流程 + 任务刷新，但生成结果无法保存复用。desktop 早有资产库（保存 + 列表 + 过滤）。本切片补齐 mobile 的资产能力，与 desktop 对齐；同时把资产纯逻辑提升到 shared，消除 desktop-local 重复（延续 Slice 13 apiClient 提升的模式）。

**非目标**：
- 资产删除、编辑（后续）
- 跨设备同步（后端已按 owner 隔离，但无实时同步）
- 图片/视频缩略图渲染（列表仅显示 mode 标签 + prompt 摘要，同当前 mobile 文本预览风格）
- 触碰 desktop 的 UI 行为（仅改其 import）

## 设计

### 架构概览

```
packages/shared/src/
  ├─ assetModel.ts          ← 从 desktop 提升（framework-free 纯函数）
  └─ __tests__/assetModel.test.ts  ← 随文件移动
apps/desktop/src/
  ├─ assetModel.ts          ← 删除
  └─ App.tsx                ← 改 import: from "@gw-link-omniai/shared"
apps/mobile/src/
  └─ appModel.ts            ← +assets state, +saveAsset, loadUserData 加载 assets
apps/mobile/App.tsx         ← +保存按钮, +资产库 section（过滤+列表）
```

### 1. shared assetModel 提升

把 `apps/desktop/src/assetModel.ts` 提升到 `packages/shared/src/assetModel.ts`（内容不变），从 `packages/shared/src/index.ts` 导出。移动其测试到 `packages/shared/src/__tests__/assetModel.test.ts`。desktop `App.tsx` 改 import：`from "@gw-link-omniai/shared"`（原 `from "./assetModel"`）。

导出的公开成员（保持签名不变）：
- `type AssetFilter = "all" | CreationMode`
- `filterCreationAssets(assets: CreationAsset[], filter: AssetFilter): CreationAsset[]`
- `getAssetFilterLabel(filter: AssetFilter): string`
- `getAssetModeLabel(mode: CreationMode): string`
- `buildAssetRequestFromTask(task: GenerationTask): CreationAssetRequest`
- `summarizeAssetPrompt(asset: CreationAsset, maxLength?: number): string`

验证：desktop 测试保持绿（仅 import 改动），shared 新增 assetModel 测试通过。

### 2. appModel 扩展

`MobileAppState` 加字段：

```typescript
assets: CreationAsset[];
```

初始 `assets: []`。`signOutInternal` 重置时加 `assets: []`。

`loadUserData` 并行加载 assets：

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

`MobileAppController` 接口加：

```typescript
saveAsset(task: GenerationTask): Promise<void>;
```

实现：

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
}
```

新增错误 helper（与 loginError/generationError/refreshError 同风格）：

```typescript
function assetError(err: unknown): string {
  if (err instanceof ApiError) {
    return "保存失败，请稍后重试";
  }
  return "网络错误";
}
```

`buildAssetRequestFromTask` 从 `@gw-link-omniai/shared` 导入。

### 3. App.tsx

**保存按钮**：在任务 `renderItem` 里，对 `succeeded` 任务追加保存按钮（在刷新按钮同区域）：

```tsx
{item.status === "succeeded" ? (
  <Button title="保存到资产库" onPress={() => void ctrl.saveAsset(item)} />
) : null}
```

**资产库 section**：`signedIn` 视图底部，任务 FlatList 之后：
- 本地 `const [assetFilter, setAssetFilter] = useState<AssetFilter>("all")`
- 过滤按钮行：`["all", "text", "image", "video"]` 各一个 `Button`，title 用 `getAssetFilterLabel(filter)`，onPress 设置 assetFilter
- 列表：`filterCreationAssets(state.assets, assetFilter)` → FlatList，每项显示 `getAssetModeLabel(asset.mode)` 标签 + `summarizeAssetPrompt(asset)` 摘要

`AssetFilter`、`filterCreationAssets`、`getAssetFilterLabel`、`getAssetModeLabel`、`summarizeAssetPrompt` 从 `@gw-link-omniai/shared` 导入。

## 错误处理

- saveAsset 401 → `signOutInternal`（清 token、回 signedOut，无错误文案）
- saveAsset 其它 `ApiError` → `actionError = "保存失败，请稍后重试"`
- saveAsset 非 `ApiError`（网络） → `actionError = "网络错误"`
- 不泄露内部错误细节

## 测试策略

`appModel.test.ts`（vitest 直接测控制器，复用现有 fake helpers；`createFakeClient` 需补 `createAsset`/`listAssets` 的可用 fake，替换现有的 `throw new Error("unused")`）：

1. **loadUserData 加载 assets**：verifyLogin 后 `state.assets` 反映 fake `listAssets`。
2. **saveAsset 成功**：`saveAsset(task)` 后 `state.assets` 含新资产（fake `createAsset` 追加、`listAssets` 返回）。
3. **saveAsset 401 登出**：fake `createAsset` 抛 `ApiError(401)` → stage `signedOut`、token 清除。
4. **saveAsset 其它错误**：fake `createAsset` 抛 `ApiError(500)` → `actionError === "保存失败，请稍后重试"`，stage 仍 `signedIn`。

`packages/shared`：assetModel 测试随文件移动，保持绿。

desktop：测试保持绿（仅 import 改动）。

全量：`pnpm test` + `pnpm typecheck` 全绿。App.tsx 仍 typecheck-only（不单测）。

## 文档

- README `### Mobile API Integration` 段落补：可保存生成结果到资产库并按类型过滤查看。
- mvp-skeleton `## Mobile API Integration Slice` 段落补同上。

## 任务分解

1. **提升 assetModel 到 shared**：移文件 + 测试 + index 导出 + desktop 改 import（desktop 测试绿）。
2. **appModel 扩展**：`assets` state + `saveAsset` + `assetError` helper + loadUserData 加载 assets + signOut 清 assets + 4 测试。
3. **App.tsx**：succeeded 任务行"保存到资产库"按钮 + 资产库 section（过滤 + 列表）+ typecheck。
4. **文档**：README + mvp-skeleton。

## 交付清单

- [ ] `packages/shared/src/assetModel.ts` + 测试从 desktop 移动，index 导出
- [ ] desktop `App.tsx` 改 import，测试绿
- [ ] appModel：assets + saveAsset + assetError + loadUserData 加载 assets + 4 测试
- [ ] App.tsx：保存按钮 + 资产库 section（过滤 + 列表）
- [ ] 文档（README + mvp-skeleton）
- [ ] `pnpm test` + `pnpm typecheck` 全绿
