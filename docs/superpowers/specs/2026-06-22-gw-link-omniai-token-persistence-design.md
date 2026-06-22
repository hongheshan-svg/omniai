# GW-LINK OmniAI 桌面会话令牌持久化 设计

文档版本：V0.1
文档日期：2026-06-22
文档类型：阶段实现设计
适用阶段：Stage 14 - Desktop Session Token Persistence（重启免重登）

## 1. 背景

桌面端登录后，bearer 令牌仅存于 React 内存（`useState`），重启即丢失、需要重新登录——真实体验痛点。本阶段把令牌持久化，并在启动时校验后恢复会话。

按本项目「可注入接缝」范式：新增可注入的 `TokenStore` 接口（默认 localStorage 实现），令 App 可用 fake 单测、在 Tauri webview 里直接可用；OS 钥匙串/Tauri 安全存储作为同接口的后续替换。后端 `GET /v1/auth/session` 已存在，本阶段只在桌面端 `apiClient` 暴露 `getSession` 并接线。**不改后端、不改 `packages/shared`。**

## 2. 目标

1. `apiClient.getSession(token)` 暴露 `GET /v1/auth/session`，返回 `SessionResponse`。
2. 可注入 `TokenStore`（`load`/`save`/`clear`）+ 默认 `createLocalStorageTokenStore()`（非浏览器环境 no-op 守卫）。
3. App 启动校验恢复：有存储令牌 → `getSession` 校验 → 认证有效则恢复会话并加载任务/资产/余额；无效/出错则清令牌、回登录态。
4. 登录成功存令牌；登出/401 清令牌。
5. 不改后端、不改 `packages/shared`。

验收标准：登录后重启（模拟：注入预置有效令牌的 TokenStore + getSession 返回认证）→ 直接进入登录态、显示余额与任务，跳过登录表单；预置无效令牌 → 留在登录、令牌被清；登录成功 → 令牌被存；登出 → 令牌被清；`pnpm test`、`pnpm typecheck` 全绿。

## 3. 非目标

1. 后端改动（`/v1/auth/session` 路由已存在）；`packages/shared` 改动（`SessionResponse` 已存在）。
2. OS 钥匙串 / Tauri 安全存储（同 `TokenStore` 接口后续替换）。
3. 刷新令牌 / 会话续期（会话 7 天 TTL，过期即重登）。
4. admin / mobile 的令牌持久化。
5. 多账号 / 账号切换。

## 4. 数据行为

1. **存储 key**：`"gw-link-omniai.token"`（localStorage）。
2. **登录成功**（`handleVerifyLogin`）→ `tokenStore.save(authSession.token)`。
3. **登出 / 401**（`handleSignedOut`）→ `tokenStore.clear()`（登出与会话失效都经此）。
4. **启动恢复**（App 挂载一次）：
   - `const stored = tokenStore.load()`；无 → 维持登录态（现状）。
   - 有 → `const session = await api.getSession(stored)`：
     - `session.authenticated && session.user` → `setToken(stored)`、`setSession({authenticated:true, user, expiresAt})`、`await loadUserData(stored)`（加载 tasks/assets/balance）。
     - 否则 → `tokenStore.clear()`（维持登录态）。
   - 整体 try/catch；`getSession` 抛错 → `tokenStore.clear()`、维持登录态（不把瞬时网络错误当有效会话）。
5. **loadUserData(token)**：抽取自现有 `handleVerifyLogin` 的 `Promise.all([listGenerations, listAssets, getCreditBalance])` + setters，供登录后与启动恢复共用。

## 5. 组件设计

### 5.1 apiClient.getSession

`apps/desktop/src/apiClient.ts`：
- 从 `@gw-link-omniai/shared` 引入 `SessionResponse`。
- `ApiClient` 接口增 `getSession(token: string): Promise<SessionResponse>;`。
- 实现：`return send<SessionResponse>("/v1/auth/session", { token });`（后端直接返回 `SessionResponse` 结构，非信封）。非 2xx → `ApiError`（沿用 `send`）。

### 5.2 TokenStore

`apps/desktop/src/tokenStore.ts`：
```ts
export interface TokenStore {
  load(): string | undefined;
  save(token: string): void;
  clear(): void;
}

const TOKEN_KEY = "gw-link-omniai.token";

export function createLocalStorageTokenStore(): TokenStore {
  const storage = typeof localStorage === "undefined" ? undefined : localStorage;
  return {
    load: () => storage?.getItem(TOKEN_KEY) ?? undefined,
    save: (token) => storage?.setItem(TOKEN_KEY, token),
    clear: () => storage?.removeItem(TOKEN_KEY)
  };
}
```
非浏览器环境（`localStorage` 不存在）→ 全 no-op、`load` 返回 undefined。

### 5.3 App 改造

`apps/desktop/src/App.tsx`：
1. 引入 `useEffect`、`SessionResponse`（type）、`createLocalStorageTokenStore`/`TokenStore`。
2. 组件签名增选项：`App({ client, tokenStore }: { client?: ApiClient; tokenStore?: TokenStore } = {})`；`const store = useMemo(() => tokenStore ?? createLocalStorageTokenStore(), [tokenStore])`。
3. 抽取 `loadUserData(token)`（`Promise.all` + `setTasks/setAssets/setBalance`）；`handleVerifyLogin` 改用它。
4. `handleVerifyLogin` 成功后 `store.save(authSession.token)`。
5. `handleSignedOut` 内首部 `store.clear()`。
6. 启动 `useEffect(() => { void restoreSession(); }, [])`：见 §4.4；`restoreSession` 是组件内 async 函数，引用 `store`、`api`。
7. 其余流程不变。

### 5.4 文档

README「Credit Foundation / Desktop」表述补一句：桌面端令牌持久化、重启恢复会话；`docs/architecture/mvp-skeleton.md` 同步。

## 6. 错误处理

1. 启动 `getSession` 抛错或返回未认证 → `tokenStore.clear()`、保持登录态（不误恢复）。
2. 既有 401 → `handleSignedOut`（现也清令牌）。
3. 启动 `loadUserData` 失败（已认证但加载列表出错）→ 走其 try/catch，会话已恢复、列表暂空，下次操作重试（不清令牌，避免把数据加载错误当登录失效）。
4. 不向用户泄露后端细节。

## 7. 测试策略

1. **apiClient.getSession 单测**（注入 fake fetch）：URL `/v1/auth/session`、bearer 头、返回 `SessionResponse`；非 2xx → `ApiError`。
2. **createLocalStorageTokenStore 单测**（jsdom）：`save`→`load` 往返、`clear` 后 `load` 为 undefined。
3. **App 集成测**（注入 fake client + fake in-memory TokenStore）：
   - 预置有效令牌 + `getSession` 返回认证 → 启动直接显示「Signed in as creator」+ 余额，未经登录表单。
   - 预置无效令牌 + `getSession` 返回匿名 → 留在登录态、`clear` 被调用。
   - 登录成功 → `save` 被调用（令牌正确）。
   - 登出 → `clear` 被调用。
4. **既有桌面测试保持绿**：`createFakeClient` 补 `getSession`（默认匿名）；测试加 `afterEach(() => localStorage.clear())` 防跨用例泄漏（默认空 localStorage → 启动不触发恢复，既有用例行为不变）。
5. 全量：`pnpm test`、`pnpm typecheck`。

## 8. 风险与约束

1. **令牌可被 webview 脚本读取**：localStorage 对 webview 内任意脚本可读；打包桌面应用无第三方脚本、风险较低；OS 钥匙串后续。
2. **会话 7 天 TTL**：过期即重登；无刷新令牌。
3. **启动多一次请求**：`getSession` 校验为一次额外往返，换取不误恢复过期会话——可接受。
4. **跨用例 localStorage 泄漏**：测试以 `afterEach` 清理 + 注入 fake store 隔离。

## 9. 验收清单

- [ ] `apiClient.getSession(token)` + 单测（bearer、SessionResponse、ApiError）。
- [ ] `TokenStore` 接口 + `createLocalStorageTokenStore`（no-op 守卫）+ 单测。
- [ ] App 启动校验恢复（有效→恢复+加载；无效/错→清+登录态）；登录存、登出清；`loadUserData` 抽取。
- [ ] `createFakeClient` 补 `getSession`，`afterEach` 清 localStorage，既有测试绿。
- [ ] 不改后端、不改 `packages/shared`。
- [ ] README、`mvp-skeleton.md` 更新。
- [ ] `pnpm test`、`pnpm typecheck` 通过。
