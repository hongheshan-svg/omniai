# GW-LINK OmniAI Mobile 任务刷新设计规格

**日期**: 2026-07-01
**Slice**: 14 — Mobile 任务刷新

---

## 摘要

给 mobile 端加"刷新任务状态"能力，镜像 desktop 的既有做法（Slice 11a）：`appModel` 增加 `refreshTask(taskId)` 动作，App.tsx 对 `running` 状态的任务行显示"刷新状态"按钮，复用已有的 `apiClient.getGeneration`。使 mobile 上的异步（running）任务能推进到最终状态。

## 动机

Slice 13 让 mobile 接入了核心流程（登录/生成/任务/余额），但任务列表是静态的——异步 provider 返回的 `running` 任务无法在 mobile 上推进。desktop 早在 Slice 11a 就有"刷新状态"按钮。本切片补齐 mobile 的这一能力，与 desktop 对齐。

**非目标**：
- 自动轮询（保持手动按钮，与 desktop 一致；后台 worker 是更后面的事）
- 刷新余额（镜像 desktop `handleRefreshTask` —— 它只更新任务，不刷余额；余额在下次 `submitGeneration` 时刷新）
- 触碰 desktop（它已有此按钮）
- 图片/视频结果渲染（仍仅文本预览，同 Slice 13）

## 设计

### appModel.ts

`MobileAppController` 接口新增：

```typescript
refreshTask(taskId: string): Promise<void>;
```

实现：

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
}
```

新增错误映射 helper（与 `loginError`/`generationError` 同风格）：

```typescript
function refreshError(err: unknown): string {
  if (err instanceof ApiError) {
    return "刷新失败，请稍后重试";
  }
  return "网络错误";
}
```

### App.tsx（薄视图）

在任务 `FlatList` 的 `renderItem` 中，对 `running` 状态的任务追加刷新按钮：

```tsx
{item.status === "running" ? (
  <Button title="刷新状态" onPress={() => void ctrl.refreshTask(item.id)} />
) : null}
```

## 错误处理

- `refreshTask` 401 → `signOutInternal`（清 token、回 signedOut，无错误文案）
- 其它 `ApiError` → `actionError = "刷新失败，请稍后重试"`
- 非 `ApiError`（网络） → `actionError = "网络错误"`
- 不泄露内部错误细节

## 测试策略

`appModel.test.ts`（vitest 直接测控制器，复用现有 `createFakeClient`/`createFakeTokenStore`）：

1. **刷新更新任务状态**：初始 tasks 有一个 `running` 任务，fake `getGeneration` 返回同 id 的 `succeeded` 任务 → `refreshTask` 后该任务在 state 中变为 `succeeded`。
2. **刷新遇 401 登出**：fake `getGeneration` 抛 `ApiError(401)` → stage 变 `signedOut`、token 清除。
3. **刷新其它错误**：fake `getGeneration` 抛 `ApiError(500)` → `actionError === "刷新失败，请稍后重试"`，stage 仍 `signedIn`。

全量：`pnpm --filter @gw-link-omniai/mobile test` + `pnpm test` + `pnpm typecheck` 全绿。App.tsx 仍 typecheck-only（不单测，同 Slice 13）。

## 文档

- README `### Mobile API Integration` 段落补一句：running 任务可"刷新状态"。
- mvp-skeleton `## Mobile API Integration Slice` 段落补一句同上。

## 交付清单

- [ ] `appModel.ts`：`refreshTask` + `refreshError` helper
- [ ] `appModel.test.ts`：3 个 refreshTask 测试
- [ ] `App.tsx`：running 任务行"刷新状态"按钮
- [ ] 文档补充（README + mvp-skeleton）
- [ ] `pnpm test` + `pnpm typecheck` 全绿
