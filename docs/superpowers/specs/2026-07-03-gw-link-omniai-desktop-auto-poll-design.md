# GW-LINK OmniAI Desktop 任务自动轮询设计规格

**日期**: 2026-07-03
**Slice**: 20 — Desktop running 任务自动轮询

---

## 摘要

desktop 对 `running` 生成任务每 5 秒自动轮询 `getGeneration`，无需手动点"刷新状态"。纯选择器 `selectRunningTaskIds` 放 `generationModel.ts`（可单测）；App.tsx 加一个轮询 `useEffect`；手动刷新按钮保留。

## 动机

Slice 11a 让 desktop 能手动刷新 running 任务（异步视频等）。但用户需盯着按钮反复点。自动轮询让 running 任务在后台推进到最终状态，体验对齐"任务中心"应有的实时感。无后台 worker——沿用"读时推进"（`getGeneration` re-poll + running→succeeded 扣费一次）。

**非目标**：
- 轮询退避 / 指数重试 / 可配置间隔 UI / 后台 worker
- mobile 自动轮询（本片仅 desktop；mobile 保留手动刷新）
- 轮询余额 / 资产（仅任务）

## 设计

### 1. generationModel.selectRunningTaskIds（framework-free）

`apps/desktop/src/generationModel.ts` 加：

```typescript
export function selectRunningTaskIds(tasks: GenerationTask[]): string[] {
  return tasks.filter((task) => task.status === "running").map((task) => task.id);
}
```

单测：混合状态任务列表 → 只返回 running 的 id（顺序保持）；无 running → `[]`。

### 2. App.tsx 轮询 effect

常量（模块顶层或组件外）：

```typescript
const POLL_INTERVAL_MS = 5000;
```

新增 `useEffect`：

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

`pollRunningTasks`（组件内 async）：

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

- deps 用 `runningKey`（running id 集合的字符串）：只有 running **集合**变化才重建定时器；某任务解决 → 集合变化 → 重建（或集合空 → 停）。
- 与手动 `handleRefreshTask` 同路径（`getGeneration` + `setTasks` 替换）；手动按钮不变。

### 数据流

`running` 任务 → 每 5s `getGeneration(id, token)`（后端 re-poll，running→succeeded 扣 `creditUnitCost` 一次）→ 更新任务 → 变 succeeded 后移出 running 集合 → 自动停轮询。

## 错误处理

- 轮询 401 → `handleSignedOut("登录已失效，请重新登录")`（清 token、停轮询）。
- 其它轮询错误 → 静默（不设 actionError，避免每 5s 弹错），下一 tick 重试。

## 测试策略

desktop 用 jsdom + `@testing-library/react` + `vi.useFakeTimers()`（可渲染测试）。

1. **generationModel.test**：`selectRunningTaskIds` 纯函数（混合状态 → 只 running id；空/无 running → `[]`）。
2. **App.test**（fake timers）：
   - 登录后任务列表含一个 `running` 任务，fake `getGeneration` 返回同 id 的 `succeeded`：`await act(() => vi.advanceTimersByTimeAsync(5000))` 后任务中心显示"已完成"（自动轮询生效）。
   - 无 `running` 任务时，推进 5s，fake `getGeneration` 未被调用（不轮询）。
   - 注意：用 `vi.useFakeTimers()` + `afterEach(() => vi.useRealTimers())`，避免影响其它测试。
3. 全量：`pnpm test` + `pnpm typecheck` 全绿。

## 文档

- README `### Async Generation Lifecycle` 段落补：desktop 现自动轮询 running 任务（5s），手动按钮保留。
- mvp-skeleton 相应段落补同上。

## 任务分解

1. **generationModel.selectRunningTaskIds** + 测试。
2. **App.tsx** 轮询 effect + `pollRunningTasks` + `POLL_INTERVAL_MS` + fake-timer 测试。
3. **文档**（README + mvp-skeleton）。

## 交付清单

- [ ] `selectRunningTaskIds` + generationModel 测试
- [ ] App.tsx 轮询 effect + pollRunningTasks + 2 个 fake-timer 测试
- [ ] 文档（README + mvp-skeleton）
- [ ] `pnpm test` + `pnpm typecheck` 全绿
