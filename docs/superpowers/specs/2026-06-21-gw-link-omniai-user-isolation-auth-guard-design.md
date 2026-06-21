# GW-LINK OmniAI 按用户隔离 + 鉴权守卫 设计

文档版本：V0.1
文档日期：2026-06-21
文档类型：阶段实现设计
适用阶段：Stage 6 - Per-User Isolation + Auth-Guarded API（建立在 Stage 5 Persistence Foundation 之上）

## 1. 背景

Stage 5（持久化底座）已把 users、login_challenges、sessions、generation_tasks、assets 落到 Postgres，并在 `generation_tasks` 与 `assets` 上**预留了可空的 `owner_user_id` 外键列**，但本切片之前刻意不填充、不过滤：`createTask`/`createAsset` 写入 `owner_user_id = null`，`listTasks`/`listAssets` 返回全部数据，且 `/v1/generations`、`/v1/assets` 路由不要求鉴权。

这对单机演示可行，但对可发布的多用户产品不可接受：任何调用方都能读到所有人的生成历史与资产。迈向可交付产品的下一道闸是**把数据按登录用户隔离，并为受保护路由加上鉴权守卫**。

代码库已具备落地条件：Stage 5 的 `owner_user_id` 列与外键已在位（本切片**无需任何数据库迁移**），鉴权能力 `authService.getSession(token)` 已存在且可注入，三个核心服务已经是「`interface` + 仓储实现」结构。本切片只在这些既有接缝上加「归属 + 过滤 + 守卫」，不改产品合同字段、不改路由路径与响应形态。

## 2. 目标

1. 新增鉴权守卫：受保护路由要求有效 bearer token，未认证返回 401。
2. 生成任务与资产的写入归属当前认证用户（填充 `owner_user_id`）。
3. 生成任务与资产的列表只返回当前认证用户的项（按 `owner_user_id` 过滤）。
4. `/v1/generations`（POST、GET）与 `/v1/assets`（POST、GET）受守卫保护；`/health`、`/v1/models`、`/v1/prompt/*`、`/v1/auth/*` 保持公开。
5. 跨用户隔离可验证：用户 A 创建的任务/资产，用户 B 列不出、读不到。
6. 不引入数据库迁移（复用 Stage 5 的 `owner_user_id` 列与外键）。

验收标准：未带 token 调用 `/v1/generations`/`/v1/assets` 的写或读返回 401；带 A 的 token 创建任务/资产后，带 B 的 token 列表为空、带 A 的 token 能列出自己的项；`packages/shared` 合同与路由路径/响应形态不变；`pnpm test` 与 `pnpm typecheck` 全绿。

## 3. 非目标

本阶段不做：

1. 刷新令牌轮换、登录限流、设备/会话管理等生产鉴权加固。
2. 角色 / RBAC / 管理员跨用户访问；管理后台读取他人数据。
3. Postgres 行级安全（RLS）——本切片用**应用层过滤**实现隔离；DB 层 RLS 留到「安全加固」切片再议。
4. 前端（desktop/admin/mobile）接入 HTTP API（下一切片）。
5. 真实 provider 调用、对象存储、计费扣减。
6. 产品合同字段变更、路由路径变更、响应形态变更。
7. 既有 `owner_user_id` 外键删除策略变更（保持 `on delete set null`：用户删除后其任务/资产变为孤儿而非级联删除）。

说明：本切片有意改变两处既有行为——(a) 未认证调用受保护路由从「匿名可用」变为「401」；(b) 列表从「返回全部」变为「只返回本人项」。这是迈向多用户产品的必要演进，受保护路由的响应**形态**不变（成功仍是 `{ tasks }` / `{ asset }` / `{ assets }`；失败仍是 `{ error }`）。

## 4. 数据行为

1. 鉴权守卫复用现有 session 语义：`getSession(token)` 返回 `authenticated:false` 或无 user 时视为未认证（401），否则取 `user.id` 作为当前用户。守卫不引入新的鉴权逻辑、不改 session 存储。
2. `createTask`/`createAsset` 以当前用户 id 作为 `owner_user_id` 持久化。生成任务的 provider dry-run 的 `userId` 也改用当前用户 id（此前为常量 `development-user`）。
3. `listTasks`/`listAssets` 仅返回 `owner_user_id = 当前用户 id` 的记录，按 `created_at` 排序，保持既有 defensive copy 语义。
4. 既有校验（生成的 prompt/optimizedPrompt/preset/catalog/provider dry-run；资产的 title/content/source/preset 等）顺序、错误信息、状态码完全不变——守卫在校验之前、在路由层把关。
5. `owner_user_id` 外键要求归属用户存在。真实流程中用户在登录（verify-login）时已 find-or-create，故写入时外键满足；测试中在写入归属任务/资产前先建对应用户。

## 5. 数据模型

**无数据库迁移。** 复用 Stage 5 的现有列与约束：

- `generation_tasks.owner_user_id`：可空 text，外键 → `users(id)`，`on delete set null`，索引 `(owner_user_id, created_at)`。
- `assets.owner_user_id`：同上。

本切片把这两列从「恒为 null」改为「写入当前用户 id」，并在查询中按其过滤。列保持可空：历史上 Stage 5 写入的 null 行（若有）不属于任何用户，对任何用户的列表都不可见——可接受（Stage 5 为占位阶段，无真实数据）。

## 6. 组件设计

### 6.1 鉴权守卫（routes 层）

新增 `apps/api/src/routes/authGuard.ts`：

```ts
// 扩展 FastifyRequest，挂载已认证用户 id
declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

export function createAuthGuard(authService: AuthService): preHandlerHookHandler {
  return async (request, reply) => {
    const token = readBearerToken(request.headers.authorization);
    const session = await authService.getSession(token);
    if (!session.authenticated || !session.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }
    request.userId = session.user.id;
  };
}
```

- `readBearerToken` 复用现有 `routes/auth.ts` 中相同的解析逻辑（`Bearer ` 前缀 → token，否则 undefined）。为避免重复，把它抽到一个共享小模块（如 `routes/bearer.ts`）供 `auth.ts` 与 `authGuard.ts` 复用；`auth.ts` 行为不变。
- 守卫只依赖 `AuthService` 接口（可注入 fake/in-memory），无网络、无新存储。
- 守卫以 Fastify `preHandler` 形式挂到受保护路由；通过后 `request.userId` 必为字符串，处理器以 `request.userId` 读取（断言非空）。

### 6.2 路由接线

- `registerGenerationRoutes(server, generationService, authService)` 与 `registerAssetRoutes(server, assetService, authService)` 新增 `authService` 形参，在 POST/GET 上挂 `{ preHandler: createAuthGuard(authService) }`。
- 处理器改为把 `request.userId` 传入服务：
  - `POST /v1/generations`：`await generationService.createTask(body, request.userId!)`
  - `GET /v1/generations`：`await generationService.listTasks(request.userId!)`
  - `POST /v1/assets`：`await assetService.createAsset(body, request.userId!)`
  - `GET /v1/assets`：`await assetService.listAssets(request.userId!)`
- `server.ts` 的 `buildServer` 在注册这两组路由时传入已构造的 `authService`（已存在于作用域）。
- `health`/`models`/`prompt`/`auth` 路由不变、保持公开。

### 6.3 服务签名

把 userId 从「构造期常量」改为「每请求参数」：

```ts
interface GenerationService {
  createTask(request: GenerationTaskRequest, userId: string): GenerationTask | Promise<GenerationTask>;
  listTasks(userId: string): GenerationTask[] | Promise<GenerationTask[]>;
}

interface AssetService {
  createAsset(request: CreationAssetRequest, userId: string): CreationAsset | Promise<CreationAsset>;
  listAssets(userId: string): CreationAsset[] | Promise<CreationAsset[]>;
}
```

- 生成服务：`createTask` 用传入的 `userId` 作为 provider dry-run 的 `userId` 与任务 owner；移除构造期 `userId` 默认值的使用（`GenerationServiceOptions.userId` 不再需要，删除该选项以免误导）。
- 资产服务：`createAsset` 用传入的 `userId` 作为 owner。
- 联合返回类型（`T | Promise<T>`）保持不变。`InMemoryGenerationService`/`InMemoryAssetService` 构造签名 `(options = {})` 不变。
- 写入路径末尾改为 `await this.<repo>.insert(entity, userId)`；列表改为 `return this.<repo>.list(userId)`。

### 6.4 仓储签名

```ts
interface GenerationTaskRepository {
  insert(task: GenerationTask, ownerUserId: string): Promise<void>;
  list(ownerUserId: string): Promise<GenerationTask[]>;
}
interface AssetRepository {
  insert(asset: CreationAsset, ownerUserId: string): Promise<void>;
  list(ownerUserId: string): Promise<CreationAsset[]>;
}
```

- **内存实现**：内部存 `{ ownerUserId, entity }` 记录；`insert` 存 `ownerUserId` 与 `structuredClone(entity)`；`list(ownerUserId)` 过滤同 owner 并 `structuredClone` 返回，保持防御拷贝。
- **Drizzle 实现**：`insert` 写 `ownerUserId`（不再恒 null）；`list` 用 `where(eq(<table>.ownerUserId, ownerUserId)).orderBy(<table>.createdAt)`。映射不变。
- `UserRepository`/`SessionRepository`/`ChallengeRepository` 不变。

### 6.5 受影响的既有测试

- `apps/api/src/__tests__/server.test.ts`：原先无鉴权地 POST/GET generations 与 assets 的两个用例，改为先走登录流程（start-login 取 devCode → verify-login 取 token）再带 `Authorization: Bearer <token>` 调用；断言不变（成功形态相同）。
- `apps/api/src/services/__tests__/generationService.test.ts`、`assetService.test.ts`：所有 `createTask`/`listTasks`/`createAsset`/`listAssets` 调用补传一个测试用 `userId`；新增「按 owner 隔离」用例（A 创建后 B 列表为空）。
- 仓储契约测试：`insert`/`list` 增加 `ownerUserId` 参数；新增隔离用例（两个 owner 互不可见）；写入归属任务/资产前先 `users.insert` 对应用户以满足外键。
- `routes/__tests__/auth.test.ts`：不变（auth 路由仍公开）。
- 新增 `routes/__tests__/generations`/`assets` 的 401（无 token）与认证后成功用例（可并入 server.test.ts 或各自路由测试）。

### 6.6 端到端

扩展/新增 DB 端到端：两个用户分别登录拿 token，各自创建任务/资产；断言每人只列出自己的项、互不可见；并验证跨服务实例（重启）后归属仍正确。沿用 pglite。

## 7. 错误处理

1. 未认证（无 token / token 无效 / 会话过期）→ 401 `{ "error": "Authentication required" }`，在守卫层、业务校验之前返回。
2. 既有领域错误（`GenerationTaskError`、`AssetError`、`AuthError`、`ModelCatalogError`、`ProviderAdapterError`）与状态码映射不变。
3. 守卫只暴露「需要认证」，不泄露 token、用户存在性或 DB 细节。
4. 路由错误形态保持 `{ "error": "..." }`。

## 8. 测试策略

1. **守卫单测**：注入 fake/in-memory authService；无 token / 非 Bearer / 未知 token → 401；有效 token → 放行并在 `request.userId` 挂上正确 id。
2. **服务单测**：`createTask`/`createAsset` 以传入 userId 写 owner；`listTasks`/`listAssets` 按 owner 过滤；A 创建、B 列空的隔离用例。
3. **仓储契约测试**（内存 + pglite 双实现）：owner 维度的 insert/list 往返；跨 owner 隔离；外键满足（先建用户）。
4. **路由级**：401（无 token）与认证后成功；列表只含本人项。
5. **DB 端到端**：双用户跨实例隔离 + 持久化。
6. **既有测试保持绿**（按 6.5 调整后）：`pnpm test`、`pnpm typecheck`。

## 9. 文档更新

1. README：在「Persistence Foundation」后新增「Per-User Isolation」小节——受保护路由需 `Authorization: Bearer <token>`，列表按用户隔离，附 curl 示例（先登录拿 token 再调用）。
2. `CLAUDE.md`：在产品边界/架构小节补充「受保护路由 + 鉴权守卫 + 按 owner 过滤」约定，以及哪些路由公开。
3. `docs/architecture/mvp-skeleton.md`：新增「Per-User Isolation Slice」小节。

## 10. 风险与约束

1. **行为破坏面**：未认证调用受保护路由从 200 变 401，列表语义从全局变按人。这是有意演进，但任何已假设匿名可用的调用方需更新（当前仅测试，已纳入 6.5）。
2. **外键前置**：写入归属任务/资产要求 owner 用户已存在。真实流程经 verify-login 必然满足；测试需先建用户，契约/端到端测试已覆盖。
3. **历史 null 行**：Stage 5 期若写入过 `owner_user_id = null` 的占位行，对任何用户不可见（无真实数据，可接受）。
4. **应用层隔离而非 DB RLS**：所有读路径必须经服务/仓储的 owner 过滤；不得新增绕过过滤的查询。DB 层强制（RLS）留后续安全切片。
5. **守卫覆盖完整性**：必须确保 generations/assets 的**写与读**都挂守卫，避免只保护写而读漏网。验收清单逐路由核对。
6. **userId 参数线程化**：服务方法签名变更会波及调用点与测试；联合返回类型与 fake「少参数可赋值」特性使 HTTP 测试 fake 仍有效，降低波及面。

## 11. 验收清单

- [ ] 新增 `createAuthGuard(authService)` 守卫；bearer 解析复用共享 helper。
- [ ] `/v1/generations`（POST、GET）与 `/v1/assets`（POST、GET）均挂守卫；health/models/prompt/auth 仍公开。
- [ ] 生成/资产服务签名加 `userId` 参数；写入填充 `owner_user_id`，列表按 owner 过滤。
- [ ] 生成/资产仓储 `insert(entity, ownerUserId)`/`list(ownerUserId)`，内存 + Drizzle 双实现。
- [ ] 无数据库迁移（复用 Stage 5 的 `owner_user_id`）。
- [ ] 守卫单测、服务隔离单测、仓储契约隔离测试、路由 401/成功、DB 双用户端到端隔离均通过。
- [ ] 既有测试按 6.5 调整后保持绿；`server.test.ts` 受保护路由用例改为先登录再调用。
- [ ] `packages/shared` 合同、路由路径、成功/失败响应形态不变。
- [ ] README、`CLAUDE.md`、`mvp-skeleton.md` 更新到位。
- [ ] `pnpm test` 通过。
- [ ] `pnpm typecheck` 通过。
