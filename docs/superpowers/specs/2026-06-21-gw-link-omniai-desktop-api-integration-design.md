# GW-LINK OmniAI 桌面端接入 HTTP API + 登录 设计

文档版本：V0.1
文档日期：2026-06-21
文档类型：阶段实现设计
适用阶段：Stage 7 - Desktop ↔ API Integration（建立在 Stage 5 持久化、Stage 6 按用户隔离 + 鉴权守卫之上）

## 1. 背景

后端已具备持久化（Postgres + Drizzle）、自研无密码鉴权、按用户隔离的生成/资产 API。但桌面端（`apps/desktop`，Tauri 2 + Vite + React 18）至今**完全本地**：`App.tsx` 用 `useState` + 固定 fixtures（`getFixtureOptimization`）+ 硬编码匿名会话，本地构造任务/资产（`createLocalGenerationTask` / `createLocalCreationAsset`），从不调用 HTTP API。

迈向可交付产品的下一步，是让主创作工作台真正连上后端：无密码登录拿 bearer 会话，提示词优化、提交生成、查看本人生成历史与资产都走真实 API。这首次把「前端 + API + 持久化 + 鉴权 + 隔离」整条链路端到端打通。

代码库的既有约定让这步可以干净落地：桌面端逻辑放在框架无关、vitest 可测的 `*Model.ts` 模块，`App.tsx` 保持薄。本切片新增一个框架无关的 API 客户端模块，并把 `App.tsx` 从本地状态改造为调用客户端。

## 2. 目标

1. 新增桌面端 API 客户端：框架无关、可注入 `fetch`、类型化，覆盖登录、提示词优化、生成提交/列表、资产列表。
2. 桌面端实现无密码登录流程（start-login → 显示 devCode → verify-login → 持有 bearer token）。
3. 登录后：提交生成走 `POST /v1/generations`（带 bearer），任务中心列出 `GET /v1/generations`（本人）；资产库列出 `GET /v1/assets`（本人，只读）。
4. 提示词优化走 `POST /v1/prompt/optimize`（公开路由）。
5. 给产品 API 增加 CORS 支持，使桌面 webview / Vite 开发跨源 fetch 成功。
6. 产品合同、`/v1/*` 路由路径与响应形态不变。

验收标准：本地起 API（默认内存模式即可）后，桌面端能登录、优化、提交生成并看到本人任务列表、查看本人资产列表；未登录时显示登录入口、受保护操作不可用；`pnpm test`、`pnpm typecheck` 全绿。

## 3. 非目标

1. **资产创建经 API**：API 资产校验要求 `source.taskStatus === "succeeded"`，但当前生成任务恒为 `queued`（无 worker / 状态流转）。故桌面端经 API 创建资产本切片不做，**资产库为只读**（列出本人资产，通常为空，直到后续「任务状态流转 / 真实 provider」切片）。「保存到资产库」动作及本地 `createLocalCreationAsset` 一并移除。
2. admin / mobile 接入 API（后续各自切片）。
3. 真实 provider 调用、流式输出、任务状态轮询/转换。
4. token 的安全持久化（本切片用内存态，重启需重新登录）；刷新令牌、登录限流。
5. 离线缓存、请求重试队列、乐观更新。
6. 桌面端 UI 视觉重设计；仅做数据接入与登录所需的最小 UI（登录表单、加载/错误态）。
7. 产品合同字段、路由路径、响应形态变更。

## 4. 数据行为

1. 登录：用户输入 destination（邮箱/手机号）→ `POST /v1/auth/start-login` 返回 `{ challengeId, channel, maskedDestination, expiresAt, devCode? }`；本地开发 `devCode` 存在并展示，便于完成验证 → 用户输入 code → `POST /v1/auth/verify-login` 返回 `{ token, user, expiresAt }`，token 存入 React 内存态。
2. 会话：持有 token 后视为已登录，展示 `user.displayName`（复用 `getDesktopSessionCta`）。登出清空内存 token（可选调用 `POST /v1/auth/logout`）。
3. 优化：`POST /v1/prompt/optimize` 返回 `{ optimization }`；展示 optimizedPrompt、sections、preset。
4. 提交生成：用当前 optimization 组装 `GenerationTaskRequest`，`POST /v1/generations`（带 bearer）→ `{ task }`；成功后刷新 `GET /v1/generations`（带 bearer）→ `{ tasks }`，任务中心展示本人任务。
5. 资产：登录后 `GET /v1/assets`（带 bearer）→ `{ assets }`，资产库只读展示本人资产。
6. 401（未登录/会话失效）：客户端抛 `ApiError(status=401)`，App 视为未登录，回到登录态。

## 5. 组件设计

### 5.1 API 客户端（桌面，框架无关）

新增 `apps/desktop/src/apiClient.ts`：

```ts
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "ApiError"; }
}

export interface ApiClientOptions {
  baseUrl?: string;          // 默认 import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787"
  fetch?: typeof fetch;      // 默认全局 fetch；测试注入 fake
}

export interface ApiClient {
  startLogin(request: LoginStartRequest): Promise<LoginStartResponse>;
  verifyLogin(request: LoginVerifyRequest): Promise<AuthSession>;
  logout(token: string): Promise<void>;
  optimizePrompt(request: PromptOptimizationRequest): Promise<PromptOptimization>;
  createGeneration(request: GenerationTaskRequest, token: string): Promise<GenerationTask>;
  listGenerations(token: string): Promise<GenerationTask[]>;
  listAssets(token: string): Promise<CreationAsset[]>;
}
```

（不含 `getSession`：登录用 `verifyLogin` 的返回直接得到 `user`，内存 token 不做启动恢复，故无需该方法 — YAGNI。）

```ts

export function createApiClient(options?: ApiClientOptions): ApiClient;
```

- 全部类型来自 `@gw-link-omniai/shared`。客户端解包响应信封：`{ task }`/`{ tasks }`/`{ asset }`/`{ assets }`/`{ optimization }`；start/verify/session/logout 直接返回对象（logout 返回 `{ ok: true }` → 客户端忽略）。
- 受保护方法（createGeneration/listGenerations/listAssets/logout/getSession-带 token）设置 `Authorization: Bearer <token>` 头。
- 非 2xx：尝试解析 `{ error }`，抛 `ApiError(message, status)`（无 body 时用状态文本）。
- 不在客户端做重试/缓存（YAGNI）。

### 5.2 桌面状态与 App 改造

`apps/desktop/src/App.tsx` 改造（保持薄，逻辑尽量落在客户端/纯函数）：

1. `App` 接受可选注入 `App({ client }: { client?: ApiClient })`，默认 `createApiClient()`；测试注入 fake client（与 `buildServer` 同款依赖注入）。
2. React 内存态：`token`、`session`、`tasks`、`assets`、`optimization`、`selectedMode`、各操作的 `loading`/`error`、登录子态（`challengeId`、`devCode`、`destination`、`code`）。
3. 登录区：未登录展示 destination 表单 → 发送验证码（startLogin，展示 maskedDestination + devCode 提示）→ code 表单 → 登录（verifyLogin）→ 存 token+session，并加载 `listGenerations` + `listAssets`。
4. 已登录：展示用户名 + 登出；Studio 区「优化提示词」→ `optimizePrompt`（展示结果，启用「提交生成」）；「提交生成」→ `createGeneration` → 刷新任务列表；资产库只读列出本人资产。
5. `studioModel` 的 `getStudioModes/getStudioModeContent/getStudioTemplates` 继续用于 UI 外壳；保留 `generationModel`/`assetModel` 的展示函数（`getGenerationStatusLabel`、`summarizeGenerationPrompt`、`filterCreationAssets`、`getAssetFilterLabel`、`getAssetModeLabel`、`summarizeAssetPrompt`）。
6. 移除随接入而变为死代码的本地构造/占位函数及其测试：`createLocalGenerationTask`（generationModel）、`createLocalCreationAsset`（assetModel）、`getFixtureOptimization`（studioModel）；以及「保存到资产库」按钮与 `handleSaveAsset`。

### 5.3 API CORS（产品 API 小改动）

1. `apps/api`：新增依赖 `@fastify/cors`，在 `buildServer` 注册（在路由注册前）。
2. `config.ts`：新增可选 `corsOrigins?: string[]`，来自 `GW_LINK_CORS_ORIGINS`（逗号分隔）。
3. 注册策略：`origin: config.corsOrigins ?? true`（`true` = 反射请求源，开发友好），`credentials: false`，允许 `authorization`、`content-type` 头与常用方法。生产应显式设 `GW_LINK_CORS_ORIGINS`。
4. 产品合同与 `/v1/*` 路由路径、响应形态不变；仅新增响应头与对 `OPTIONS` 预检的处理。

### 5.4 配置

- 桌面：`VITE_API_BASE_URL`（默认 `http://localhost:8787`）。在 `.env.example` 补充说明。
- API：`GW_LINK_CORS_ORIGINS`（默认未设 → 反射源，仅建议开发用）。在 `.env.example` 补充说明。

## 6. 错误处理

1. 客户端非 2xx → `ApiError(message, status)`；App 把 `error.message` 展示在对应操作的错误位，`loading` 复位。
2. 401 → App 清空 token/session，回到登录态（提示需重新登录）。
3. 网络异常（fetch reject）→ App 展示通用错误信息，不崩溃。
4. 不向用户泄露后端内部细节；客户端只透出 API 返回的 `{ error }` 文案与状态码。

## 7. 测试策略

1. **apiClient 单测**（vitest，注入 fake `fetch`）：每个方法的 URL/方法/头（含 bearer）正确；响应信封正确解包；非 2xx → `ApiError`（含 status 与 message）；401 透出。
2. **App 集成测**（`@testing-library/react` + jsdom，注入 fake `ApiClient`）：未登录展示登录入口；登录流程（start → 显示 devCode → verify → 显示用户名）；登录后「优化 → 提交生成 → 任务出现在任务中心」；资产库列出注入的本人资产；错误态（如 401）回到登录态。
3. **保留/更新模型单测**：展示函数测试保留；移除的本地构造/占位函数的测试相应删除。
4. **API CORS 测**：`server.test.ts` 加用例——带 `Origin` 的请求响应含 `access-control-allow-origin`；`OPTIONS` 预检返回允许的方法/头。既有 API 测试保持绿。
5. CI 不跑真实跨进程联调（保持快、无外部依赖）；真实 API + Tauri 联调走手动验收。
6. 全量：`pnpm test`、`pnpm typecheck`。

## 8. 文档更新

1. README：新增「Desktop ↔ API」小节——`VITE_API_BASE_URL`、登录流程、需要先起 `pnpm dev:api`、资产创建为何暂缺（依赖任务状态流转）。
2. `.env.example`：补 `VITE_API_BASE_URL`、`GW_LINK_CORS_ORIGINS`。
3. `CLAUDE.md`：在前端约定小节注明 desktop 现接入 HTTP API（apiClient + 注入 + 登录），admin/mobile 仍本地。
4. `docs/architecture/mvp-skeleton.md`：新增「Desktop ↔ API Integration Slice」小节。

## 9. 风险与约束

1. **资产创建受阻于任务状态**：API 要求 `taskStatus==="succeeded"`，当前无状态流转。本切片资产只读，明确推迟创建；公开前需在「任务状态流转 / 真实 provider」切片补齐。
2. **CORS 范围**：默认反射源便于开发，但生产必须用 `GW_LINK_CORS_ORIGINS` 收敛；在 `.env.example` 与文档强调。
3. **Tauri webview 真实联调**：jsdom 下用 fake fetch 测试，真实 Tauri webview 的跨源/协议行为以手动验收覆盖；若真机出现 CORS/协议问题，回退方案是 Vite dev proxy 或 Tauri http 插件（本切片不预先实现）。
4. **token 内存态**：重启需重新登录；安全持久化留后续。
5. **死代码移除**：移除本地构造/占位函数会触及对应测试；以「接入后变为死代码即移除」为界，避免遗留双份真相。
6. **dev 模式 baseUrl**：桌面默认指向 `http://localhost:8787`，需先 `pnpm dev:api`；文档说明。

## 10. 验收清单

- [ ] `apiClient.ts`：登录/优化/生成提交/生成列表/资产列表方法，注入 fetch、bearer 头、信封解包、`ApiError` 映射；单测覆盖成功/401/错误。
- [ ] `App.tsx`：注入 client；未登录登录入口；登录流程；登录后优化→提交→任务列表；资产只读列表；加载/错误态。
- [ ] 移除死代码（`createLocalGenerationTask`/`createLocalCreationAsset`/`getFixtureOptimization` + 保存资产按钮）及其测试；保留展示函数。
- [ ] API：`@fastify/cors` 注册 + `config.corsOrigins`（`GW_LINK_CORS_ORIGINS`）；CORS 测试通过；既有 API 测试不变绿。
- [ ] 产品合同、`/v1/*` 路由路径、响应形态不变。
- [ ] README、`.env.example`、`CLAUDE.md`、`mvp-skeleton.md` 更新。
- [ ] `pnpm test` 通过。
- [ ] `pnpm typecheck` 通过。
