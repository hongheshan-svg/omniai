# GW-LINK OmniAI Persistence Foundation 设计

文档版本：V0.1
文档日期：2026-06-21
文档类型：阶段实现设计
适用阶段：Stage 5 - Persistence Foundation（Supabase Postgres，仅 Postgres）

## 1. 背景

Stage 1-4 已完成 Studio Shell + Prompt Optimizer、统一生成任务、本地资产库和 provider adapter foundation。当前产品层用 `CreationMode`、`GenerationTaskRequest`、`GenerationTask`、`CreationAsset`、`AuthSession` 表达文字、图片、视频生产流程，并把 provider detail 隐藏在产品 API 之后。

但所有后端服务的存储都是进程内的：`InMemoryAuthService`（`Map` 存 users/sessions/challenges）、`InMemoryGenerationService`（数组存 tasks）、`InMemoryAssetService`（数组存 assets）。**服务器一重启，所有 users、sessions、tasks、assets 全部丢失。** 这是迈向可发布版本的第一个、也是最大的总闸：真实鉴权、生成历史、资产、计费、后台运营都依赖持久化存储。

代码库的依赖注入风格让这一步可以干净落地——三个核心服务都已经是「`interface` + 可替换实现」，本阶段只替换其背后的存储介质，不改产品合同、不改 HTTP 路由。

整体托管目标已选定 Supabase 托管 Postgres。本阶段刻意只采用 Supabase 的 Postgres 能力；Supabase Auth 与 Supabase Storage 留给后续「真实鉴权」「对象存储」切片再决定是否采用。

## 2. 目标

本阶段交付一个产品优先的持久化底座：

1. 引入 Supabase Postgres，经 Drizzle ORM 访问，带版本化迁移。
2. 为 users、login_challenges、sessions、generation_tasks、assets 定义 schema 与初始迁移。
3. 在三个核心服务背后抽出 Repository 接缝；服务业务逻辑保持不变，仅把存储从内存换成可注入的仓储。
4. 每个仓储提供内存实现与 Drizzle 实现两套：内存实现服务于快速单测与零配置本地开发，Drizzle 实现服务于真实 Postgres。
5. 通过 `DATABASE_URL` 配置选择实现：存在则用 Drizzle 服务，缺省则用内存服务。
6. 启动时做数据库连通性检查，关停时优雅释放连接。
7. 数据跨进程重启存活。

验收标准：配置 `DATABASE_URL` 指向 Supabase（或测试用 pglite）后，登录建会话、创建生成任务、保存资产，重启 API 进程，数据仍可读取；`packages/shared` 合同、`/v1/*` 路由与 HTTP 行为零改动；`pnpm test` 与 `pnpm typecheck` 全绿。

## 3. 非目标

本阶段不做：

1. 真实短信/邮件投递；不改动 dev-code 行为，也不做生产鉴权加固（刷新令牌、登录限流等）。
2. 采用 Supabase Auth 替换自研无密码登录。
3. 对象存储 / Supabase Storage 接入；资产 image/video 仍是占位 URL。
4. 真实 provider HTTP 调用、流式输出、异步队列与 worker、任务状态轮询。
5. 按用户隔离的访问控制、鉴权守卫中间件、Postgres RLS 策略。
6. 点数扣减、退款、订单、套餐权限强校验。
7. 前端（desktop/admin/mobile）接入 HTTP API。
8. 产品合同字段变更、路由变更或 HTTP 响应形态变更。

说明：本阶段为「按用户隔离」预留了 `owner_user_id` 可空列，但不强制、不在查询中过滤；`listTasks/listAssets` 行为与今天一致（返回全部）。

## 4. 数据行为

1. 鉴权流程（start-login → verify-login → session → logout）的语义与现状完全一致，仅存储改为 Postgres。
2. 验证码仍以 sha256 哈希存储（`code_hash`），不落明文。
3. 过期的 challenge 与 session 仍按现有 sweep 语义清理（基于注入的 `clock`）；本阶段的 sweep 由仓储的 `deleteExpired(now)` 实现。
4. 生成任务创建仍走现有校验 + catalog 校验 + fake provider dry-run，成功后写库并返回 queued task。
5. 资产创建仍走现有校验，成功后写库。
6. 所有读取保持现有的 defensive copy 语义：返回给调用方的对象不与存储内部状态共享可变引用。

## 5. 数据模型

数据库为 Postgres。结构化判别联合（preset、content、preview、source、resultPreview）以 `jsonb` 存储，避免在本阶段过度规范化；时间以 `timestamptz` 存储，读出时序列化为 ISO 字符串以匹配现有合同。

### 5.1 users

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | text | 主键（如 `user_email_<hash16>`） |
| `display_name` | text | not null |
| `destination` | text | not null |
| `channel` | text | not null，取值 `email` / `phone` |
| `plan` | text | not null，默认 `free`，取值 `free` / `pro` / `studio` |
| `created_at` | timestamptz | not null |

唯一约束：`(channel, destination)`。

### 5.2 login_challenges

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | text | 主键（uuid） |
| `destination` | text | not null |
| `channel` | text | not null |
| `code_hash` | text | not null |
| `expires_at` | timestamptz | not null |
| `failed_attempts` | integer | not null，默认 0 |

索引：`expires_at`（支持 sweep）。

### 5.3 sessions

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `token` | text | 主键 |
| `user_id` | text | not null，外键 → `users(id)`，`on delete cascade` |
| `expires_at` | timestamptz | not null |

索引：`user_id`、`expires_at`。

### 5.4 generation_tasks

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | text | 主键 |
| `owner_user_id` | text | 可空，外键 → `users(id)`，`on delete set null` |
| `mode` | text | not null，取值 `text` / `image` / `video` |
| `status` | text | not null，取值 `queued` / `running` / `succeeded` / `failed` |
| `prompt` | text | not null |
| `optimized_prompt` | text | not null |
| `preset` | jsonb | not null（`PresetSuggestion`） |
| `result_preview` | jsonb | not null（`GenerationTaskResultPreview`） |
| `created_at` | timestamptz | not null |
| `updated_at` | timestamptz | not null |

索引：`(owner_user_id, created_at)`。

### 5.5 assets

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | text | 主键 |
| `owner_user_id` | text | 可空，外键 → `users(id)`，`on delete set null` |
| `mode` | text | not null |
| `title` | text | not null |
| `content` | jsonb | not null（`CreationAssetContent` 判别联合） |
| `preview` | jsonb | not null（`CreationAssetPreview`） |
| `source` | jsonb | not null（`{ taskId, taskStatus }`） |
| `prompt` | text | not null |
| `optimized_prompt` | text | not null |
| `preset` | jsonb | not null |
| `created_at` | timestamptz | not null |

索引：`(owner_user_id, created_at)`。

### 5.6 ID 生成

服务保留可注入的 `idGenerator`/`tokenGenerator`/`challengeIdGenerator`/`codeGenerator` 选项，签名不变：

1. 内存组合沿用现有默认生成器，现有测试不受影响。
2. Drizzle 组合默认采用 uuid 前缀生成器（`generation_task_<uuid>`、`creation_asset_<uuid>`），保证跨重启全局唯一，规避现有 `Date.now()` / 进程内自增计数器在持久化场景的碰撞。
3. 产品合同中 id 仍为字符串，形态不构成合同约束，不变。

## 6. 组件设计

### 6.1 Repository 接缝

新增 `apps/api/src/repositories/types.ts`，定义 5 个仓储接口（方法可同步或返回 Promise，由实现决定；服务统一 `await`）：

```ts
interface UserRepository {
  findBySubject(channel: LoginChannel, destination: string): Promise<UserProfile | undefined>;
  findById(id: string): Promise<UserProfile | undefined>;
  insert(user: UserProfile): Promise<void>;
}

interface SessionRepository {
  save(session: SessionRecord): Promise<void>;
  findByToken(token: string): Promise<SessionRecord | undefined>;
  delete(token: string): Promise<boolean>;
  deleteExpired(nowMs: number): Promise<void>;
}

interface ChallengeRepository {
  save(challenge: LoginChallengeRecord): Promise<void>;
  findById(id: string): Promise<LoginChallengeRecord | undefined>;
  update(challenge: LoginChallengeRecord): Promise<void>;
  delete(id: string): Promise<boolean>;
  deleteExpired(nowMs: number): Promise<void>;
}

interface GenerationTaskRepository {
  insert(task: GenerationTask): Promise<void>;
  list(): Promise<GenerationTask[]>;
}

interface AssetRepository {
  insert(asset: CreationAsset): Promise<void>;
  list(): Promise<CreationAsset[]>;
}
```

`SessionRecord` 与 `LoginChallengeRecord` 是 API 内部类型（不从 `packages/shared` 导出），与现有 `authService.ts` 中的内部记录一致。`challenge.update` 用于失败次数自增（现状是直接改 Map 中对象，迁到仓储后改为显式更新）。

### 6.2 内存仓储

`apps/api/src/repositories/memory/`：用 `Map`/数组实现上述接口，行为等价于现有 `InMemory*` 服务内部的存储部分。负责 defensive copy 中属于「存储边界」的那部分（写入与读出时 clone），与服务层的 clone 协同，保持对外语义不变。

### 6.3 Drizzle 仓储

`apps/api/src/repositories/drizzle/`：以 Drizzle + schema 实现上述接口。读写时在 DB 行与产品/内部类型之间做映射（jsonb ↔ 对象，timestamptz ↔ ISO 字符串）。`deleteExpired` 用 `delete ... where expires_at <= now`。

### 6.4 服务改造

`authService.ts`、`generationService.ts`、`assetService.ts` 保留各自的 `interface` 与全部业务逻辑（校验、哈希、sweep、find-or-create、catalog 校验、provider dry-run、defensive clone），仅把存储访问改为依赖注入的仓储：

1. 服务实现类改为接收仓储 + 既有 options（`clock`、各 generator、TTL、`devCodesEnabled` 等）。
2. 保留向后兼容的构造方式：`InMemoryAuthService` / `InMemoryGenerationService` / `InMemoryAssetService` 作为「内存仓储 + 服务逻辑」的组合工厂，构造选项签名不变，使现有测试与 `server.ts` 注入路径零改动或最小改动。
3. 方法签名按需要返回 `Promise`（鉴权方法目前同步，改造后 `getSession`/`verifyLogin`/`startLogin`/`logout` 改为 async；路由已可 `await`）。

### 6.5 数据库客户端与迁移

1. `apps/api/src/db/schema.ts`：Drizzle 表定义。
2. `apps/api/src/db/client.ts`：由 `DATABASE_URL` 创建 `postgres.js` 客户端与 drizzle 实例（走 Supabase 事务池 6543 端口时设 `prepare: false`）。
3. `apps/api/src/db/migrate.ts`：以编程方式执行迁移，供 `db:migrate` 脚本与 pglite 测试初始化复用。
4. `apps/api/drizzle.config.ts` + `apps/api/drizzle/`：drizzle-kit 配置与生成的迁移文件。

迁移为**显式步骤**（`db:migrate` 脚本），启动流程不自动改 schema，避免生产环境意外迁移。

### 6.6 配置与组合

1. `config.ts` 的 `loadConfig` 新增可选 `databaseUrl`（来自 `DATABASE_URL`）。
2. 新增 `createServices(config)` 工厂：`databaseUrl` 存在则装配 Drizzle 仓储 + 服务并复用单一 DB 客户端；否则装配内存仓储 + 服务。
3. `buildServer` 继续接受可注入的 `authService`/`generationService`/`assetService`/`modelCatalog`/`promptOptimizer`/`providerAdapter`；注入时不强制创建 DB 客户端（保持测试可注入内存实现，零外部依赖）。
4. `server.ts` 的 `import.meta.url` 主入口：`loadConfig()` → `createServices(config)` → 连通性检查（`select 1`）→ `buildServer({...services})` → `listen`。
5. 主入口注册 `SIGINT`/`SIGTERM`：先 `await server.close()`，再关闭 DB 连接池。

## 7. 错误处理

1. 现有领域错误（`AuthError`、`GenerationTaskError`、`AssetError`、`ModelCatalogError`、`ProviderAdapterError`）与 HTTP 状态码映射保持不变。
2. 启动期数据库连通性失败：打印清晰错误并以非零码退出，不进入 `listen`。
3. 运行期仓储/数据库异常：服务捕获后映射为现有领域错误或 500，路由层错误形态不变（`{ "error": "..." }`）。
4. 不向客户端泄露数据库连接串、SQL 或 driver 细节。

## 8. 测试策略

测试库使用 `@electric-sql/pglite`（进程内 WASM 版 Postgres），免 Docker、CI 友好；迁移在测试初始化时注入新建的 pglite 实例。

1. **仓储契约测试**：同一套行为用例，参数化地同时跑内存实现与 Drizzle(pglite) 实现，保证两实现行为一致（find/insert/update/delete/deleteExpired、唯一约束、jsonb 往返、时间往返）。
2. **现有服务单测**：`authService.test.ts`、`generationService.test.ts`、`assetService.test.ts` 全部保持绿（服务跑在内存仓储上，对外行为不变；如方法转 async，相应 `await`）。
3. **DB 端到端冒烟**：`buildServer` 接 Drizzle(pglite) 服务，跑关键路由（start-login/verify、generations POST+GET、assets POST+GET），并用**新建的服务实例**读同一个 pglite 库，证明「重启后数据还在」。
4. **配置/组合测试**：`createServices` 在有/无 `DATABASE_URL` 时分别返回 Drizzle / 内存服务；连通性检查失败路径有覆盖。
5. **现有工作区结构测试** `tests/workspace.test.mjs` 保持绿。
6. 全量：`pnpm test`、`pnpm typecheck`。

## 9. 文档更新

1. `.env.example`：新增 `DATABASE_URL`（含 Supabase 连接串说明：直连 5432 vs 事务池 6543 + `prepare:false`）。
2. README：新增「持久化」小节——`DATABASE_URL` 配置、`db:generate` / `db:migrate` 命令、缺省回落内存实现的本地开发说明。
3. `CLAUDE.md`：在 API 架构小节补充「仓储接缝 + Drizzle/内存双实现 + createServices 组合」与 pglite 测试约定。
4. `docs/architecture/mvp-skeleton.md`：新增「Persistence Foundation Slice」小节，说明本阶段在不动产品合同与路由的前提下替换存储介质，并为按用户隔离预留 `owner_user_id`。

## 10. 风险与约束

1. **未隔离的全局列表会被持久化**：`listTasks/listAssets` 返回全部，与今天行为一致；在没有真实多用户接入前可接受，但**公开前必须**在后续「桌面端接 API + 真实鉴权」「按用户隔离 + 鉴权守卫」切片补齐。`owner_user_id` 已就位以避免再次迁移。
2. **Supabase 区域 vs 中国市场**：完整计费暗示中国大陆市场，而 Supabase 不在大陆，存在延迟/合规张力；本阶段不决策，留到计费切片再议。
3. **鉴权方法转 async**：可能波及调用点与若干测试；规避方式是路由已 `await`、服务保持同一 `interface` 语义，仅在内部 await 仓储。
4. **postgres.js + Supabase 事务池**：走 6543 时需 `prepare:false`，否则预编译语句报错；在 `client.ts` 与 `.env.example` 中明确。
5. **pglite 保真度**：pglite 是 Postgres 的 WASM 版，jsonb/timestamptz/唯一约束均支持，与真实 Supabase 的差异对本切片用法影响低；如需更高保真，可在 CI 增设针对真实 Supabase 分支的可选作业（本阶段不强制）。
6. **迁移与现有数据**：本阶段为首次建表，无存量数据迁移；后续切片如改 schema 需走增量迁移。

## 11. 验收清单

- [ ] 新增 5 个 Repository 接口，各有内存实现与 Drizzle 实现。
- [ ] Drizzle schema + 初始迁移覆盖 users / login_challenges / sessions / generation_tasks / assets。
- [ ] 三个服务改为依赖仓储，业务逻辑、`interface`、路由、产品合同均不变。
- [ ] `createServices(config)` 按 `DATABASE_URL` 选择 Drizzle / 内存实现；`buildServer` 仍可注入服务。
- [ ] 启动连通性检查 + `SIGINT`/`SIGTERM` 优雅关停。
- [ ] 仓储契约测试对内存与 Drizzle(pglite) 两实现均通过。
- [ ] DB 端到端冒烟证明跨服务实例（重启）持久化。
- [ ] 手动用真实 Supabase 跑通「建任务/资产/登录 → 重启 → 数据还在」。
- [ ] `.env.example`、README、`CLAUDE.md`、`mvp-skeleton.md` 更新到位。
- [ ] `pnpm test` 通过。
- [ ] `pnpm typecheck` 通过。
