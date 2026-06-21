# GW-LINK OmniAI Per-User Isolation + Auth-Guarded API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope generation tasks and assets to the authenticated user — write rows under `owner_user_id`, list only the caller's rows, and guard the `/v1/generations` and `/v1/assets` routes with a bearer-token auth check — without changing product contracts, route paths, or response shapes.

**Architecture:** Add a Fastify `preHandler` auth guard (`createAuthGuard`) that resolves the bearer token via the existing `authService.getSession`. Owner-scope the repository seam (`insert(entity, ownerUserId)` / `list(ownerUserId)`) with in-memory + Drizzle implementations. Thread the authenticated user id from the guard → route → service → repository. No database migration (Stage 5 already created the nullable `owner_user_id` FK columns).

**Tech Stack:** TypeScript (strict, ESM), Vitest, Fastify, Drizzle ORM, `@electric-sql/pglite` (test Postgres), pnpm workspaces, Node 20.

**Spec:** `docs/superpowers/specs/2026-06-21-gw-link-omniai-user-isolation-auth-guard-design.md` (approved).

## Global Constraints (apply to every task)

1. **Contracts frozen:** Do not edit `packages/shared`. Route paths and success/failure response *shapes* are unchanged (`{ task }` / `{ tasks }` / `{ asset }` / `{ assets }` / `{ error }`). Auth routes (`/v1/auth/*`), `/health`, `/v1/models`, `/v1/prompt/*` stay public.
2. **No database migration.** Reuse the existing `generation_tasks.owner_user_id` and `assets.owner_user_id` columns + FKs (`on delete set null`). Do not touch `db/schema.ts` or `drizzle/`.
3. **Union return types stay.** Service interface methods remain `T | Promise<T>` so synchronous test fakes stay valid. `InMemory*Service` keep their `(options = {})` constructor signatures.
4. **Defensive copy preserved.** In-memory repos clone with `structuredClone` on write and read; Drizzle maps fresh row objects.
5. **Guard covers read AND write.** Both POST and GET of `/v1/generations` and `/v1/assets` get the guard. Missing/invalid/expired token → `401 { "error": "Authentication required" }`.
6. **Owner FK requires the user to exist.** On the Drizzle/pglite backend, inserting a task/asset with an `owner_user_id` requires that user row to exist first (in real flows the user is created at verify-login; in tests, insert the user first).
7. **Each task ends green:** run `pnpm --filter @gw-link-omniai/api test` and `pnpm --filter @gw-link-omniai/api typecheck` before committing. Commit after each task. Final task runs root `pnpm test` + `pnpm typecheck`.
8. **Injectable side effects preserved** (clock/generators). No `Date.now()`/random in new logic.

## File Structure

- Create: `apps/api/src/routes/bearer.ts` — shared `readBearerToken` helper (moved out of `auth.ts`).
- Create: `apps/api/src/routes/authGuard.ts` — `createAuthGuard(authService)` preHandler + `FastifyRequest.userId` augmentation.
- Create: `apps/api/src/routes/__tests__/authGuard.test.ts` — guard unit tests.
- Modify: `apps/api/src/routes/auth.ts` — import `readBearerToken` from `./bearer` (drop local copy).
- Modify: `apps/api/src/repositories/types.ts` — owner-scoped `GenerationTaskRepository` / `AssetRepository`.
- Modify: `apps/api/src/repositories/memory.ts` — owner-scoped in-memory task/asset repos.
- Modify: `apps/api/src/repositories/drizzle.ts` — owner-scoped Drizzle task/asset repos.
- Modify: `apps/api/src/repositories/__tests__/repositoryContract.test.ts` — owner-scoped task/asset cases + isolation.
- Modify: `apps/api/src/services/generationService.ts` — thread userId (Task 2 internal default → Task 3 per-request param).
- Modify: `apps/api/src/services/__tests__/generationService.test.ts` — userId arg + isolation test.
- Modify: `apps/api/src/services/assetService.ts` — thread userId (Task 2 internal default → Task 4 per-request param).
- Modify: `apps/api/src/services/__tests__/assetService.test.ts` — userId arg + isolation test.
- Modify: `apps/api/src/routes/generations.ts` — auth guard + pass `request.userId`.
- Modify: `apps/api/src/routes/assets.ts` — auth guard + pass `request.userId`.
- Modify: `apps/api/src/server.ts` — pass `authService` to generation/asset route registration.
- Modify: `apps/api/src/__tests__/server.test.ts` — authenticate the generation/asset route tests + 401 tests.
- Modify: `apps/api/src/__tests__/dbPersistence.test.ts` — auth headers + cross-user isolation e2e.
- Modify: `README.md`, `CLAUDE.md`, `docs/architecture/mvp-skeleton.md` — document the slice.

---

## Task 1: Bearer-token helper + auth guard

**Files:**
- Create: `apps/api/src/routes/bearer.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/routes/authGuard.ts`
- Test: `apps/api/src/routes/__tests__/authGuard.test.ts`

**Interfaces:**
- Produces: `readBearerToken(header: string | undefined): string | undefined` (from `routes/bearer.ts`); `createAuthGuard(authService: AuthService): preHandlerHookHandler` (from `routes/authGuard.ts`); augments `FastifyRequest` with `userId?: string`.

- [ ] **Step 1: Create the shared bearer helper** — `apps/api/src/routes/bearer.ts`:
  ```ts
  export function readBearerToken(header: string | undefined): string | undefined {
    if (!header?.startsWith("Bearer ")) {
      return undefined;
    }

    return header.slice("Bearer ".length).trim() || undefined;
  }
  ```

- [ ] **Step 2: Point `auth.ts` at the shared helper** — in `apps/api/src/routes/auth.ts`, add the import and delete the local `readBearerToken` function (lines 84-90). Add near the top imports:
  ```ts
  import { readBearerToken } from "./bearer";
  ```
  Remove the local function:
  ```ts
  function readBearerToken(header: string | undefined): string | undefined {
    if (!header?.startsWith("Bearer ")) {
      return undefined;
    }

    return header.slice("Bearer ".length).trim() || undefined;
  }
  ```
  (The two call sites in `auth.ts` now resolve to the imported helper — behavior identical.)

- [ ] **Step 3: Write the failing guard test** — `apps/api/src/routes/__tests__/authGuard.test.ts`:
  ```ts
  import Fastify from "fastify";
  import { describe, expect, it } from "vitest";
  import type { AuthService } from "../../services/authService";
  import { createAuthGuard } from "../authGuard";

  function fakeAuthService(): AuthService {
    return {
      startLogin: () => {
        throw new Error("not implemented");
      },
      verifyLogin: () => {
        throw new Error("not implemented");
      },
      getSession: (token) =>
        token === "good-token"
          ? {
              authenticated: true,
              user: {
                id: "user-1",
                displayName: "creator",
                destination: "creator@example.com",
                channel: "email",
                plan: "free",
                createdAt: "2026-06-20T00:00:00.000Z"
              },
              expiresAt: "2026-06-27T00:00:00.000Z"
            }
          : { authenticated: false, user: null, expiresAt: null },
      logout: () => false
    } satisfies AuthService;
  }

  function buildGuardedServer(authService: AuthService) {
    const server = Fastify({ logger: false });
    server.get("/protected", { preHandler: createAuthGuard(authService) }, async (request) => ({
      userId: request.userId
    }));
    return server;
  }

  describe("createAuthGuard", () => {
    it("passes through and attaches userId for a valid bearer token", async () => {
      const server = buildGuardedServer(fakeAuthService());
      const response = await server.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: "Bearer good-token" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ userId: "user-1" });
    });

    it("rejects missing, non-bearer, and invalid tokens with 401", async () => {
      const server = buildGuardedServer(fakeAuthService());

      for (const headers of [
        undefined,
        { authorization: "Basic good-token" },
        { authorization: "Bearer wrong-token" }
      ] as const) {
        const response = await server.inject({ method: "GET", url: "/protected", headers });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: "Authentication required" });
      }
    });
  });
  ```

- [ ] **Step 4: Run the test to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/routes/__tests__/authGuard.test.ts`
  Expected: FAIL — `../authGuard` cannot be found / `createAuthGuard` is not a function.

- [ ] **Step 5: Implement the guard** — `apps/api/src/routes/authGuard.ts`:
  ```ts
  import type { preHandlerHookHandler } from "fastify";
  import type { AuthService } from "../services/authService";
  import { readBearerToken } from "./bearer";

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

- [ ] **Step 6: Run the guard test + the existing auth route test**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/routes/__tests__/authGuard.test.ts src/routes/__tests__/auth.test.ts`
  Expected: PASS (guard 2/2; auth routes unchanged and green).

- [ ] **Step 7: Full package check + commit**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green.
  ```bash
  git add apps/api/src/routes/bearer.ts apps/api/src/routes/authGuard.ts \
    apps/api/src/routes/__tests__/authGuard.test.ts apps/api/src/routes/auth.ts
  git commit -m "feat(api): add bearer auth guard preHandler

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2: Owner-scope the repository seam (services bridge with an internal default owner)

This task changes ONLY the repository signatures and the service-internal call sites. The service public interfaces (`createTask(req)` / `listTasks()` / `createAsset(req)` / `listAssets()`) and the routes stay UNCHANGED, so `server.test.ts`, the route tests, and `dbPersistence.test.ts` remain green without edits. Tasks 3 and 4 then make the services per-request.

**Files:**
- Modify: `apps/api/src/repositories/types.ts`
- Modify: `apps/api/src/repositories/memory.ts`
- Modify: `apps/api/src/repositories/drizzle.ts`
- Modify: `apps/api/src/services/generationService.ts`
- Modify: `apps/api/src/services/assetService.ts`
- Test: `apps/api/src/repositories/__tests__/repositoryContract.test.ts`

**Interfaces:**
- Consumes: `GenerationTask`, `CreationAsset` (shared); existing `users`/`generationTasks`/`assets` Drizzle tables; `AppDatabase`.
- Produces:
  - `GenerationTaskRepository.insert(task: GenerationTask, ownerUserId: string): Promise<void>` and `list(ownerUserId: string): Promise<GenerationTask[]>`.
  - `AssetRepository.insert(asset: CreationAsset, ownerUserId: string): Promise<void>` and `list(ownerUserId: string): Promise<CreationAsset[]>`.

- [ ] **Step 1: Update the repository interfaces** — in `apps/api/src/repositories/types.ts`, replace the `GenerationTaskRepository` and `AssetRepository` interfaces:
  ```ts
  export interface GenerationTaskRepository {
    insert(task: GenerationTask, ownerUserId: string): Promise<void>;
    list(ownerUserId: string): Promise<GenerationTask[]>;
  }

  export interface AssetRepository {
    insert(asset: CreationAsset, ownerUserId: string): Promise<void>;
    list(ownerUserId: string): Promise<CreationAsset[]>;
  }
  ```

- [ ] **Step 2: Update the in-memory task/asset repos** — in `apps/api/src/repositories/memory.ts`, replace the `InMemoryGenerationTaskRepository` and `InMemoryAssetRepository` classes (keep the user/session/challenge repos unchanged):
  ```ts
  export class InMemoryGenerationTaskRepository implements GenerationTaskRepository {
    private readonly tasks: Array<{ ownerUserId: string; task: GenerationTask }> = [];

    async insert(task: GenerationTask, ownerUserId: string): Promise<void> {
      this.tasks.push({ ownerUserId, task: structuredClone(task) });
    }

    async list(ownerUserId: string): Promise<GenerationTask[]> {
      return this.tasks
        .filter((row) => row.ownerUserId === ownerUserId)
        .map((row) => structuredClone(row.task));
    }
  }

  export class InMemoryAssetRepository implements AssetRepository {
    private readonly assets: Array<{ ownerUserId: string; asset: CreationAsset }> = [];

    async insert(asset: CreationAsset, ownerUserId: string): Promise<void> {
      this.assets.push({ ownerUserId, asset: structuredClone(asset) });
    }

    async list(ownerUserId: string): Promise<CreationAsset[]> {
      return this.assets
        .filter((row) => row.ownerUserId === ownerUserId)
        .map((row) => structuredClone(row.asset));
    }
  }
  ```

- [ ] **Step 3: Update the Drizzle task/asset repos** — in `apps/api/src/repositories/drizzle.ts`, update the four methods. For `DrizzleGenerationTaskRepository`:
  ```ts
  async insert(task: GenerationTask, ownerUserId: string): Promise<void> {
    await this.db.insert(generationTasks).values({
      id: task.id,
      ownerUserId,
      mode: task.mode,
      status: task.status,
      prompt: task.prompt,
      optimizedPrompt: task.optimizedPrompt,
      preset: task.preset,
      resultPreview: task.resultPreview,
      createdAt: new Date(task.createdAt),
      updatedAt: new Date(task.updatedAt)
    });
  }

  async list(ownerUserId: string): Promise<GenerationTask[]> {
    const rows = await this.db
      .select()
      .from(generationTasks)
      .where(eq(generationTasks.ownerUserId, ownerUserId))
      .orderBy(generationTasks.createdAt);
    return rows.map(mapTaskRow);
  }
  ```
  For `DrizzleAssetRepository`:
  ```ts
  async insert(asset: CreationAsset, ownerUserId: string): Promise<void> {
    await this.db.insert(assets).values({
      id: asset.id,
      ownerUserId,
      mode: asset.mode,
      title: asset.title,
      content: asset.content,
      preview: asset.preview,
      source: asset.source,
      prompt: asset.prompt,
      optimizedPrompt: asset.optimizedPrompt,
      preset: asset.preset,
      createdAt: new Date(asset.createdAt)
    });
  }

  async list(ownerUserId: string): Promise<CreationAsset[]> {
    const rows = await this.db
      .select()
      .from(assets)
      .where(eq(assets.ownerUserId, ownerUserId))
      .orderBy(assets.createdAt);
    return rows.map(mapAssetRow);
  }
  ```
  Delete the two transitional `// Reserved for later per-user isolation ...` comment lines above the old `ownerUserId: null,` (the column is now populated). `eq` is already imported in this file.

- [ ] **Step 4: Bridge the generation service with its existing internal `userId`** — in `apps/api/src/services/generationService.ts`, update the two repository call sites inside `GenerationServiceImpl` (the `userId` field already exists, default `"development-user"`):
  - `await this.tasks.insert(task);` → `await this.tasks.insert(task, this.userId);`
  - `async listTasks(): Promise<GenerationTask[]> { return this.tasks.list(); }` → `async listTasks(): Promise<GenerationTask[]> { return this.tasks.list(this.userId); }`
  (The `GenerationService` interface and `InMemoryGenerationService` are unchanged in this task.)

- [ ] **Step 5: Bridge the asset service with a symmetric internal `userId`** — in `apps/api/src/services/assetService.ts`:
  - Add `userId?: string;` to `AssetServiceOptions`:
    ```ts
    export interface AssetServiceOptions {
      clock?: AssetServiceClock;
      idGenerator?: () => string;
      userId?: string;
    }
    ```
  - Add a `userId` field to `AssetServiceImpl` and set it in the constructor (mirrors `GenerationServiceImpl`):
    ```ts
    private readonly assets: AssetRepository;
    private readonly userId: string;
    private nextAssetId = 1;

    constructor(assetRepository: AssetRepository, options: AssetServiceOptions = {}) {
      this.assets = assetRepository;
      this.clock = options.clock ?? { now: () => new Date() };
      this.idGenerator = options.idGenerator ?? (() => this.createAssetId());
      this.userId = options.userId ?? "development-user";
    }
    ```
  - Update the repository call sites:
    - `await this.assets.insert(asset);` → `await this.assets.insert(asset, this.userId);`
    - `async listAssets(): Promise<CreationAsset[]> { return this.assets.list(); }` → `async listAssets(): Promise<CreationAsset[]> { return this.assets.list(this.userId); }`
  (The `AssetService` interface and `InMemoryAssetService` constructor are unchanged in this task.)

- [ ] **Step 6: Update the contract test to owner-scoped task/asset cases** — in `apps/api/src/repositories/__tests__/repositoryContract.test.ts`, replace the four task/asset test blocks (the user/session/challenge tests are unchanged). Replace the test titled `"inserts and lists generation tasks preserving jsonb and ordering"` and everything after it through the end of the `describe.each` body with:
  ```ts
    it("inserts and lists generation tasks scoped to the owner", async () => {
      const { users, tasks } = context.bundle;
      await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
      await users.insert(makeUser({ id: "owner-b", destination: "b@example.com" }));
      await tasks.insert(makeTask({ id: "task-a", createdAt: "2026-06-20T00:00:00.000Z" }), "owner-a");
      await tasks.insert(makeTask({ id: "task-b", createdAt: "2026-06-20T00:00:01.000Z" }), "owner-a");

      const listed = await tasks.list("owner-a");
      expect(listed.map((task) => task.id)).toEqual(["task-a", "task-b"]);
      expect(listed[0]!.preset).toEqual(makeTask().preset);
      expect(listed[0]!.resultPreview).toEqual(makeTask().resultPreview);
      expect(await tasks.list("owner-b")).toEqual([]);
    });

    it("inserts and lists assets scoped to the owner", async () => {
      const { users, assets } = context.bundle;
      await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
      await users.insert(makeUser({ id: "owner-b", destination: "b@example.com" }));
      await assets.insert(makeAsset({ id: "asset-a", createdAt: "2026-06-20T00:00:00.000Z" }), "owner-a");
      await assets.insert(makeAsset({ id: "asset-b", createdAt: "2026-06-20T00:00:01.000Z" }), "owner-a");

      const listed = await assets.list("owner-a");
      expect(listed.map((asset) => asset.id)).toEqual(["asset-a", "asset-b"]);
      expect(listed[0]!.content).toEqual(makeAsset().content);
      expect(listed[0]!.source).toEqual(makeAsset().source);
      expect(await assets.list("owner-b")).toEqual([]);
    });

    it("does not share mutable references with stored task state", async () => {
      const { users, tasks } = context.bundle;
      await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
      await tasks.insert(makeTask({ id: "task-a" }), "owner-a");

      const first = await tasks.list("owner-a");
      first[0]!.preset.parameters.quality = "mutated";

      const second = await tasks.list("owner-a");
      expect(second[0]!.preset.parameters.quality).toBe("high");
    });

    it("does not share mutable references with the inserted task (write isolation)", async () => {
      const { users, tasks } = context.bundle;
      await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
      const task = makeTask({ id: "task-a" });
      await tasks.insert(task, "owner-a");
      task.preset.parameters.quality = "mutated";

      const listed = await tasks.list("owner-a");
      expect(listed[0]!.preset.parameters.quality).toBe("high");
    });
  });
  ```
  (Note: each task/asset test now inserts the owning user first so the Drizzle FK is satisfied; `makeUser` overrides set distinct `id` + `destination` to satisfy the `(channel, destination)` unique index.)

- [ ] **Step 7: Run the contract test to verify it passes on both backends**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts`
  Expected: PASS (memory + pglite).

- [ ] **Step 8: Full package check + commit**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green — `server.test.ts`, route tests, and `dbPersistence.test.ts` pass UNCHANGED (services still own a default owner; create + list within one service instance still match).
  ```bash
  git add apps/api/src/repositories apps/api/src/services/generationService.ts apps/api/src/services/assetService.ts
  git commit -m "refactor(api): owner-scope generation/asset repositories

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3: Generation service per-request userId + guarded generation routes

**Files:**
- Modify: `apps/api/src/services/generationService.ts`
- Modify: `apps/api/src/services/__tests__/generationService.test.ts`
- Modify: `apps/api/src/routes/generations.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/server.test.ts`
- Modify: `apps/api/src/__tests__/dbPersistence.test.ts`

**Interfaces:**
- Consumes: `createAuthGuard` (Task 1); `GenerationTaskRepository.insert(task, ownerUserId)` / `list(ownerUserId)` (Task 2).
- Produces: `GenerationService.createTask(request, userId): GenerationTask | Promise<GenerationTask>` and `listTasks(userId): GenerationTask[] | Promise<GenerationTask[]>`.

- [ ] **Step 1: Make the generation service take userId per request** — in `apps/api/src/services/generationService.ts`:
  - Update the interface:
    ```ts
    export interface GenerationService {
      createTask(request: GenerationTaskRequest, userId: string): GenerationTask | Promise<GenerationTask>;
      listTasks(userId: string): GenerationTask[] | Promise<GenerationTask[]>;
    }
    ```
  - Remove `userId?: string;` from `GenerationServiceOptions`, and remove the `private readonly userId: string;` field and its constructor assignment `this.userId = options.userId ?? "development-user";`.
  - Change `createTask` signature and use the param for both the provider dry-run and the insert:
    ```ts
    async createTask(request: GenerationTaskRequest, userId: string): Promise<GenerationTask> {
    ```
    Inside the provider dry-run call, change `userId: this.userId` to `userId`. At the end:
    ```ts
    await this.tasks.insert(task, userId);
    return cloneGenerationTask(task);
    ```
  - Change `listTasks`:
    ```ts
    async listTasks(userId: string): Promise<GenerationTask[]> {
      return this.tasks.list(userId);
    }
    ```

- [ ] **Step 2: Guard the generation routes and pass the user id** — replace `apps/api/src/routes/generations.ts` entirely:
  ```ts
  import type { FastifyInstance, FastifyReply } from "fastify"
  import type { GenerationTaskRequest } from "@gw-link-omniai/shared"
  import { GenerationTaskError, type GenerationService } from "../services/generationService"
  import type { AuthService } from "../services/authService"
  import { createAuthGuard } from "./authGuard"

  export function registerGenerationRoutes(
    server: FastifyInstance,
    generationService: GenerationService,
    authService: AuthService
  ): void {
    const preHandler = createAuthGuard(authService)

    server.post("/v1/generations", { preHandler }, async (request, reply) => {
      const generationRequest = readGenerationTaskRequest(request.body)

      if (!generationRequest) {
        return sendBadRequest(reply)
      }

      try {
        const task = await generationService.createTask(generationRequest, request.userId!)
        return { task }
      } catch (error) {
        return sendGenerationTaskError(reply, error)
      }
    })

    server.get("/v1/generations", { preHandler }, async (request) => ({
      tasks: await generationService.listTasks(request.userId!)
    }))
  }

  function readGenerationTaskRequest(body: unknown): GenerationTaskRequest | undefined {
    if (
      !isRequestBody(body) ||
      typeof body.mode !== "string" ||
      typeof body.prompt !== "string" ||
      typeof body.optimizedPrompt !== "string" ||
      !isRequestBody(body.preset)
    ) {
      return undefined
    }

    return {
      mode: body.mode as GenerationTaskRequest["mode"],
      prompt: body.prompt,
      optimizedPrompt: body.optimizedPrompt,
      preset: body.preset as unknown as GenerationTaskRequest["preset"]
    }
  }

  function isRequestBody(body: unknown): body is Record<string, unknown> {
    return typeof body === "object" && body !== null && !Array.isArray(body)
  }

  function sendBadRequest(reply: FastifyReply) {
    return reply.status(400).send({
      error: "Invalid generation task request"
    })
  }

  function sendGenerationTaskError(reply: FastifyReply, error: unknown) {
    if (error instanceof GenerationTaskError) {
      return reply.status(error.statusCode).send({
        error: error.message
      })
    }

    return reply.status(500).send({
      error: "Unexpected generation task error"
    })
  }
  ```

- [ ] **Step 3: Pass authService to generation route registration** — in `apps/api/src/server.ts`, change:
  ```ts
  registerGenerationRoutes(server, generationService);
  ```
  to:
  ```ts
  registerGenerationRoutes(server, generationService, authService);
  ```

- [ ] **Step 4: Update the generation service unit tests** — in `apps/api/src/services/__tests__/generationService.test.ts`:
  - Add a constant near the top (after the imports):
    ```ts
    const TEST_USER_ID = "user_email_testowner000000";
    ```
  - Pass `TEST_USER_ID` as the second argument to EVERY `service.createTask(...)` call (the typecheck step will flag any you miss — `createTask` now requires 2 arguments).
  - Pass `TEST_USER_ID` to EVERY `service.listTasks()` call → `service.listTasks(TEST_USER_ID)`.
  - Add an isolation test at the end of the `describe("InMemoryGenerationService", ...)` block:
    ```ts
    it("lists only the requesting user's tasks", async () => {
      const service = createService();
      await service.createTask(createImageRequest(), "user-a");

      expect(await service.listTasks("user-a")).toHaveLength(1);
      expect(await service.listTasks("user-b")).toEqual([]);
    });
    ```

- [ ] **Step 5: Authenticate the generation route test + add a 401 test** — in `apps/api/src/__tests__/server.test.ts`, add this helper inside the `describe("product API", ...)` block (it is reused by the asset test in Task 4):
  ```ts
  async function authenticate(server: ReturnType<typeof buildServer>): Promise<string> {
    const start = await server.inject({
      method: "POST",
      url: "/v1/auth/start-login",
      payload: { destination: "creator@example.com" }
    });
    const { challengeId, devCode } = start.json() as { challengeId: string; devCode: string };
    const verify = await server.inject({
      method: "POST",
      url: "/v1/auth/verify-login",
      payload: { challengeId, code: devCode }
    });
    return (verify.json() as { token: string }).token;
  }
  ```
  In the existing `it("registers the generation routes", ...)` test, obtain a token and attach it to both the POST and GET:
  ```ts
  const server = buildServer();
  const token = await authenticate(server);
  const createResponse = await server.inject({
    method: "POST",
    url: "/v1/generations",
    headers: { authorization: `Bearer ${token}` },
    payload: { /* unchanged payload */ }
  });
  const listResponse = await server.inject({
    method: "GET",
    url: "/v1/generations",
    headers: { authorization: `Bearer ${token}` }
  });
  ```
  Add a new test:
  ```ts
  it("rejects unauthenticated generation requests", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        mode: "text",
        prompt: "帮我写一个新品发布文案",
        optimizedPrompt: "请生成一段新品推广文案。",
        preset: {
          modelId: "gw-text-balanced",
          parameters: { outputFormat: "markdown", tone: "clear" },
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Authentication required" });
  });
  ```

- [ ] **Step 6: Authenticate the generation calls in the DB e2e** — in `apps/api/src/__tests__/dbPersistence.test.ts`, add `headers: { authorization: \`Bearer ${token}\` }` to the generation POST (the one with `url: "/v1/generations"`) and to the `second.inject({ method: "GET", url: "/v1/generations" })` call:
  ```ts
  await first.inject({
    method: "POST",
    url: "/v1/generations",
    headers: { authorization: `Bearer ${token}` },
    payload: { /* unchanged */ }
  });
  ...
  const tasksResponse = await second.inject({
    method: "GET",
    url: "/v1/generations",
    headers: { authorization: `Bearer ${token}` }
  });
  ```
  (Leave the asset POST/GET as-is for now — Task 4 authenticates those. The asset service still owns a default owner this task, so its create+list still match within the test until Task 4.)

- [ ] **Step 7: Run the affected tests**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/generationService.test.ts src/__tests__/server.test.ts src/__tests__/dbPersistence.test.ts`
  Expected: PASS.

- [ ] **Step 8: Full package check + commit**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green.
  ```bash
  git add apps/api/src/services/generationService.ts apps/api/src/services/__tests__/generationService.test.ts \
    apps/api/src/routes/generations.ts apps/api/src/server.ts \
    apps/api/src/__tests__/server.test.ts apps/api/src/__tests__/dbPersistence.test.ts
  git commit -m "feat(api): scope generation routes to the authenticated user

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4: Asset service per-request userId + guarded asset routes

**Files:**
- Modify: `apps/api/src/services/assetService.ts`
- Modify: `apps/api/src/services/__tests__/assetService.test.ts`
- Modify: `apps/api/src/routes/assets.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/server.test.ts`
- Modify: `apps/api/src/__tests__/dbPersistence.test.ts`

**Interfaces:**
- Consumes: `createAuthGuard` (Task 1); `AssetRepository.insert(asset, ownerUserId)` / `list(ownerUserId)` (Task 2).
- Produces: `AssetService.createAsset(request, userId): CreationAsset | Promise<CreationAsset>` and `listAssets(userId): CreationAsset[] | Promise<CreationAsset[]>`.

- [ ] **Step 1: Make the asset service take userId per request** — in `apps/api/src/services/assetService.ts`:
  - Update the interface:
    ```ts
    export interface AssetService {
      createAsset(request: CreationAssetRequest, userId: string): CreationAsset | Promise<CreationAsset>;
      listAssets(userId: string): CreationAsset[] | Promise<CreationAsset[]>;
    }
    ```
  - Remove the `userId?: string;` option from `AssetServiceOptions`, remove the `private readonly userId: string;` field and its constructor assignment (both added transitionally in Task 2).
  - Change `createAsset` signature and use the param at the insert:
    ```ts
    async createAsset(request: CreationAssetRequest, userId: string): Promise<CreationAsset> {
    ```
    At the end:
    ```ts
    await this.assets.insert(asset, userId);
    return cloneAsset(asset);
    ```
  - Change `listAssets`:
    ```ts
    async listAssets(userId: string): Promise<CreationAsset[]> {
      return this.assets.list(userId);
    }
    ```

- [ ] **Step 2: Guard the asset routes and pass the user id** — replace `apps/api/src/routes/assets.ts` entirely:
  ```ts
  import type { CreationAssetRequest } from "@gw-link-omniai/shared";
  import type { FastifyInstance, FastifyReply } from "fastify";
  import { AssetError, type AssetService } from "../services/assetService";
  import type { AuthService } from "../services/authService";
  import { createAuthGuard } from "./authGuard";

  export function registerAssetRoutes(
    server: FastifyInstance,
    assetService: AssetService,
    authService: AuthService
  ): void {
    const preHandler = createAuthGuard(authService);

    server.post("/v1/assets", { preHandler }, async (request, reply) => {
      const assetRequest = readCreationAssetRequest(request.body);

      if (!assetRequest) {
        return sendBadRequest(reply);
      }

      try {
        const asset = await assetService.createAsset(assetRequest, request.userId!);
        return { asset };
      } catch (error) {
        return sendAssetError(reply, error);
      }
    });

    server.get("/v1/assets", { preHandler }, async (request, reply) => {
      try {
        const assets = await assetService.listAssets(request.userId!);
        return { assets };
      } catch (error) {
        return sendAssetError(reply, error);
      }
    });
  }

  function readCreationAssetRequest(body: unknown): CreationAssetRequest | undefined {
    if (
      !isRequestBody(body) ||
      typeof body.mode !== "string" ||
      typeof body.title !== "string" ||
      !isRequestBody(body.content) ||
      !isRequestBody(body.source) ||
      typeof body.prompt !== "string" ||
      typeof body.optimizedPrompt !== "string" ||
      !isRequestBody(body.preset)
    ) {
      return undefined;
    }

    return {
      mode: body.mode as CreationAssetRequest["mode"],
      title: body.title,
      content: body.content as unknown as CreationAssetRequest["content"],
      source: body.source as unknown as CreationAssetRequest["source"],
      prompt: body.prompt,
      optimizedPrompt: body.optimizedPrompt,
      preset: body.preset as unknown as CreationAssetRequest["preset"]
    };
  }

  function isRequestBody(body: unknown): body is Record<string, unknown> {
    return typeof body === "object" && body !== null && !Array.isArray(body);
  }

  function sendBadRequest(reply: FastifyReply) {
    return reply.status(400).send({
      error: "Invalid asset request"
    });
  }

  function sendAssetError(reply: FastifyReply, error: unknown) {
    if (error instanceof AssetError) {
      return reply.status(error.statusCode).send({
        error: error.message
      });
    }

    return reply.status(500).send({
      error: "Unexpected asset error"
    });
  }
  ```

- [ ] **Step 3: Pass authService to asset route registration** — in `apps/api/src/server.ts`, change:
  ```ts
  registerAssetRoutes(server, assetService);
  ```
  to:
  ```ts
  registerAssetRoutes(server, assetService, authService);
  ```

- [ ] **Step 4: Update the asset service unit tests** — in `apps/api/src/services/__tests__/assetService.test.ts`:
  - Add a constant near the top (after imports): `const TEST_USER_ID = "user_email_testowner000000";`
  - Pass `TEST_USER_ID` as the second argument to EVERY `service.createAsset(...)` call, including the calls inside the `expectAssetError(() => service.createAsset(...), ...)` actions and the unique-ids test's three `createAsset` calls. (Typecheck flags any missed call — `createAsset` now requires 2 args.)
  - Pass `TEST_USER_ID` to EVERY `service.listAssets()` call → `service.listAssets(TEST_USER_ID)`.
  - Add an isolation test at the end of the `describe("InMemoryAssetService", ...)` block:
    ```ts
    it("lists only the requesting user's assets", async () => {
      const service = createService();
      await service.createAsset(createImageRequest(), "user-a");

      expect(await service.listAssets("user-a")).toHaveLength(1);
      expect(await service.listAssets("user-b")).toEqual([]);
    });
    ```

- [ ] **Step 5: Authenticate the asset route test + add a 401 test** — in `apps/api/src/__tests__/server.test.ts` (the `authenticate` helper from Task 3 already exists). In the existing `it("registers the asset routes", ...)` test, obtain a token and attach it to both the POST and GET:
  ```ts
  const server = buildServer();
  const token = await authenticate(server);
  const createResponse = await server.inject({
    method: "POST",
    url: "/v1/assets",
    headers: { authorization: `Bearer ${token}` },
    payload: { /* unchanged payload */ }
  });
  const listResponse = await server.inject({
    method: "GET",
    url: "/v1/assets",
    headers: { authorization: `Bearer ${token}` }
  });
  ```
  Add a new test:
  ```ts
  it("rejects unauthenticated asset requests", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/v1/assets"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Authentication required" });
  });
  ```

- [ ] **Step 6: Authenticate the asset calls in the DB e2e** — in `apps/api/src/__tests__/dbPersistence.test.ts`, add `headers: { authorization: \`Bearer ${token}\` }` to the asset POST (`url: "/v1/assets"`) and to the `second.inject({ method: "GET", url: "/v1/assets" })` call (mirror the generation edits from Task 3).

- [ ] **Step 7: Run the affected tests**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/assetService.test.ts src/__tests__/server.test.ts src/__tests__/dbPersistence.test.ts`
  Expected: PASS.

- [ ] **Step 8: Full package check + commit**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green.
  ```bash
  git add apps/api/src/services/assetService.ts apps/api/src/services/__tests__/assetService.test.ts \
    apps/api/src/routes/assets.ts apps/api/src/server.ts \
    apps/api/src/__tests__/server.test.ts apps/api/src/__tests__/dbPersistence.test.ts
  git commit -m "feat(api): scope asset routes to the authenticated user

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 5: Cross-user isolation e2e + documentation

**Files:**
- Modify: `apps/api/src/__tests__/dbPersistence.test.ts`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Add a cross-user isolation e2e** — in `apps/api/src/__tests__/dbPersistence.test.ts`, add a helper above the `describe` (or inside it) to log a destination in:
  ```ts
  async function loginAs(server: ReturnType<typeof buildServerForDb>, destination: string): Promise<string> {
    const start = await server.inject({
      method: "POST",
      url: "/v1/auth/start-login",
      payload: { destination }
    });
    const { challengeId, devCode } = start.json() as { challengeId: string; devCode: string };
    const verify = await server.inject({
      method: "POST",
      url: "/v1/auth/verify-login",
      payload: { challengeId, code: devCode }
    });
    return (verify.json() as { token: string }).token;
  }
  ```
  Add a new test inside `describe("database-backed persistence", ...)`:
  ```ts
  it("isolates tasks and assets between users", async () => {
    const server = buildServerForDb(database);
    const tokenA = await loginAs(server, "alice@example.com");
    const tokenB = await loginAs(server, "bob@example.com");

    await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        mode: "text",
        prompt: "Alice 的任务",
        optimizedPrompt: "Alice 的优化提示。",
        preset: {
          modelId: "gw-text-balanced",
          parameters: { outputFormat: "markdown", tone: "clear" },
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });

    const aliceList = await server.inject({
      method: "GET",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect((aliceList.json() as { tasks: unknown[] }).tasks).toHaveLength(1);

    const bobList = await server.inject({
      method: "GET",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${tokenB}` }
    });
    expect(bobList.json()).toEqual({ tasks: [] });
  });
  ```

- [ ] **Step 2: Run the e2e test**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/dbPersistence.test.ts`
  Expected: PASS (cross-instance persistence + cross-user isolation).

- [ ] **Step 3: Update README** — in `README.md`, add a section after the "Persistence Foundation" section (before `## Validation`). Use a `~~~bash` outer fence so the nested code block renders:
  ~~~markdown
  ### Per-User Isolation

  The sixth product-first slice scopes generation tasks and assets to the
  authenticated user and guards the protected routes.

  - `/v1/generations` and `/v1/assets` (POST and GET) now require a bearer token;
    missing or invalid tokens get `401 { "error": "Authentication required" }`.
  - `/health`, `/v1/models`, `/v1/prompt/*`, and `/v1/auth/*` stay public.
  - List endpoints return only the calling user's items; new rows are written
    under the user's `owner_user_id`.
  - No database migration — this reuses the `owner_user_id` columns reserved in
    the Persistence Foundation slice.

  Obtain a token via the passwordless login flow, then call a protected route:

  ```bash
  # 1) start-login returns a devCode in local development
  curl -s -X POST http://localhost:8787/v1/auth/start-login \
    -H 'content-type: application/json' -d '{"destination":"creator@example.com"}'
  # 2) verify-login returns a token
  curl -s -X POST http://localhost:8787/v1/auth/verify-login \
    -H 'content-type: application/json' -d '{"challengeId":"<id>","code":"<devCode>"}'
  # 3) call a protected route with the token
  curl -s http://localhost:8787/v1/generations -H 'authorization: Bearer <token>'
  ```
  ~~~

- [ ] **Step 4: Update CLAUDE.md** — in `CLAUDE.md`, under "## The product boundary (most important constraint)", add a bullet:
  ```markdown
  - **Auth guard + per-user isolation**: `/v1/generations` and `/v1/assets` (POST + GET) are guarded by `createAuthGuard(authService)` (`src/routes/authGuard.ts`), which resolves the bearer token via `authService.getSession` and attaches `request.userId`; unauthenticated requests get `401 { error: "Authentication required" }`. Generation/asset services take a `userId` per call and persist/list by `owner_user_id` through the repositories. `/health`, `/v1/models`, `/v1/prompt/*`, and `/v1/auth/*` stay public. Isolation is enforced at the application layer (owner filter in the repositories), not yet via Postgres RLS.
  ```

- [ ] **Step 5: Update mvp-skeleton.md** — append to `docs/architecture/mvp-skeleton.md`:
  ```markdown
  ## Per-User Isolation Slice

  The per-user isolation slice scopes generation tasks and assets to the
  authenticated user without changing product contracts, route paths, or
  response shapes. A Fastify `preHandler` auth guard resolves the bearer token
  through the existing auth session service and attaches the user id to the
  request; `/v1/generations` and `/v1/assets` (read and write) require it, while
  the model catalog, prompt optimizer, auth, and health routes stay public.

  The services thread the authenticated user id into the repositories, which
  write `owner_user_id` and filter lists by it. No database migration is needed —
  the `owner_user_id` columns were reserved in the Persistence Foundation slice.
  Isolation is enforced at the application layer; Postgres row-level security,
  refresh tokens, roles, and admin cross-user access remain later slices.
  ```

- [ ] **Step 6: Full workspace verification + commit**

  Run from the repo root: `pnpm test` then `pnpm typecheck`. Both green.
  ```bash
  git add apps/api/src/__tests__/dbPersistence.test.ts README.md CLAUDE.md docs/architecture/mvp-skeleton.md
  git commit -m "feat(api): cross-user isolation e2e + per-user isolation docs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Final Verification (after all tasks)

- [ ] `pnpm test` passes (root `node:test` workspace check + every package's vitest).
- [ ] `pnpm typecheck` passes across all packages.
- [ ] `git grep -n "preHandler" apps/api/src/routes/generations.ts apps/api/src/routes/assets.ts` shows the guard on both POST and GET of both route files.
- [ ] Unauthenticated `POST`/`GET` of `/v1/generations` and `/v1/assets` return 401; authenticated calls succeed and list only the caller's items.
- [ ] No edits under `packages/shared/`; no migration added under `apps/api/drizzle/`; `db/schema.ts` unchanged.
