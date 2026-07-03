# GW-LINK OmniAI Mobile 自动轮询设计规格

**日期**: 2026-07-03
**Slice**: 21 — Mobile 自动轮询（控制器内）

---

## 摘要

把 Slice 20 的桌面自动轮询平移到 mobile，但放进 framework-free 的 `appModel` 控制器（而非 App.tsx），因此可用 `vi.useFakeTimers()` 直接完整单测。控制器新增 `startAutoPoll()`/`stopAutoPoll()`，每 5 秒轮询 `running` 任务；App.tsx 在 signedIn 时启动、清理时停止。手动"刷新状态"按钮保留。

## 动机

Slice 14 让 mobile 能手动刷新 running 任务；Slice 20 给 desktop 加了自动轮询。本切片让 mobile 也自动推进 running 任务，与 desktop 对齐。因 mobile 逻辑在 `appModel` 控制器（纯逻辑、可直接单测），轮询放控制器内比放 App.tsx（typecheck-only、不可单测）覆盖更完整。

**非目标**：
- 退避 / 指数重试 / 可配置间隔 / 后台推送
- 轮询余额 / 资产（仅任务，与 desktop 一致）
- desktop 改动

## 设计

### 1. appModel 控制器内轮询

`apps/mobile/src/appModel.ts`：

**常量**（模块顶层）：
```typescript
const POLL_INTERVAL_MS = 5000;
```

**接口** `MobileAppController` 新增：
```typescript
startAutoPoll(): void;
stopAutoPoll(): void;
```

**工厂内部状态**（`state`/`listeners` 旁）：
```typescript
let pollHandle: ReturnType<typeof setInterval> | null = null;
```

**内部 `pollRunning`**：
```typescript
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
        stopAutoPoll();
        await signOutInternal();
        return;
      }
      // transient poll error: stay quiet, retry next tick
    }
  }
}
```

**内部 `stopAutoPoll`**（工厂内函数声明，供 pollRunning 与接口共用）：
```typescript
function stopAutoPoll(): void {
  if (pollHandle !== null) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}
```

**`signOutInternal`** 追加停轮询（任何登出都停）：
```typescript
async function signOutInternal(): Promise<void> {
  stopAutoPoll();
  await tokenStore.clear();
  setState({ token: null, stage: "signedOut", balance: null, tasks: [], assets: [], challengeId: null });
}
```

**接口实现**（返回对象加）：
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
  stopAutoPoll();
},
```

要点：
- `pollRunning` 每 tick 读 `state.tasks`（`state` 是工厂闭包内 `let`，`setState` 重赋值 → 天然最新，无陈旧闭包）。
- `startAutoPoll` 幂等（已在跑则忽略）。
- 轮询 401 → `stopAutoPoll` + `signOutInternal`（`signOutInternal` 内也调 stopAutoPoll，幂等安全）。
- 其它错误静默。

### 2. App.tsx 接线（薄，typecheck-only）

在 `App` 组件里加一个 `useEffect`（signedIn 时启动、清理停止）：
```typescript
useEffect(() => {
  if (state.stage !== "signedIn") {
    return;
  }
  ctrl.startAutoPoll();
  return () => ctrl.stopAutoPoll();
}, [ctrl, state.stage]);
```
手动"刷新状态"按钮（Slice 14）不变。

## 数据流

signedIn → 每 5s `getGeneration(id, token)`（后端 re-poll，running→succeeded 扣 `creditUnitCost` 一次）→ 更新任务 → 变 succeeded 后不再 running → 自然停轮询它。登出 → `stopAutoPoll`。

## 错误处理

- 轮询 401 → `stopAutoPoll` + `signOutInternal`（清 token、停轮询、回 signedOut）。
- 其它轮询错误 → 静默（不设 actionError），下 tick 重试。

## 测试策略

`appModel.test.ts`（纯逻辑，`vi.useFakeTimers()`，无需渲染；`afterEach(() => vi.useRealTimers())`）：

1. **自动轮询推进**：登录后 `listGenerations` 返回一个 `running` 任务，fake `getGeneration` 返回同 id 的 `succeeded`；`ctrl.startAutoPoll()` → `await vi.advanceTimersByTimeAsync(5000)` → `state.tasks[0].status === "succeeded"`。
2. **stopAutoPoll 停止**：`startAutoPoll` 后 `stopAutoPoll`，`getGeneration` 用 `vi.fn()` 计数；advance 5000 → 计数为 0（或停止后不再增长）。
3. **轮询 401 登出**：fake `getGeneration` 抛 `ApiError(401)`；startAutoPoll + advance 5000 → stage `signedOut`、token 清除；再 advance → 无进一步轮询。
4. **startAutoPoll 幂等**：连调两次，`getGeneration` 用 `vi.fn` 计数，advance 一个 5000 周期 → running 任务只被 `getGeneration` 调用一次（非两次）。

App.tsx 仍 typecheck-only（接线不单测——与既有 mobile App.tsx 一致）。

全量：`pnpm test` + `pnpm typecheck` 全绿。

## 文档

- README `### Mobile API Integration` 段落补：running 任务每 5s 自动轮询。
- mvp-skeleton 相应段落补同上。

## 任务分解

1. **appModel** `startAutoPoll`/`stopAutoPoll`/`pollRunning` + `POLL_INTERVAL_MS` + signOutInternal 停轮询 + 4 fake-timer 测试；App.tsx signedIn `useEffect` 接线。
2. **文档**（README + mvp-skeleton）。

## 交付清单

- [ ] appModel `startAutoPoll`/`stopAutoPoll`/`pollRunning` + signOutInternal 停轮询 + 4 测试
- [ ] App.tsx signedIn 自动轮询接线
- [ ] 文档（README + mvp-skeleton）
- [ ] `pnpm test` + `pnpm typecheck` 全绿
