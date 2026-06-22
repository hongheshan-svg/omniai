# GW-LINK OmniAI Async Generation Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the async generation lifecycle — a task can be created `running` with a provider job reference, advanced to `succeeded`/`failed` by re-polling on `GET /v1/generations/:id`, and refreshed from the desktop — proven end-to-end with a deterministic fake async provider.

**Architecture:** `submitGeneration` may return `running` + `providerRef`; `ProviderAdapter` gains optional `pollGeneration`. A `FakeAsyncProvider` (submit→running, poll→succeeds after N polls) proves the machinery. The `providerRef` is a server-internal column (not in the product contract). The repository gains `get`/`update`; the generation service persists running tasks without charging and exposes `refreshTask` (re-poll, persist, deduct on the `running→succeeded` transition). `GET /v1/generations/:id` re-polls running tasks; the desktop adds a per-running-task refresh button. Production video stays `queued` (a real async provider arrives in 11b). No `packages/shared` change.

**Tech Stack:** TypeScript (strict, ESM), Fastify 4, Drizzle ORM + postgres, `@electric-sql/pglite` (tests), React 18, Vitest, pnpm workspaces, Node 20.

**Spec:** `docs/superpowers/specs/2026-06-22-gw-link-omniai-async-generation-lifecycle-design.md` (approved).

## Global Constraints (apply to every task)

1. No `packages/shared` change — `GenerationTaskStatus` already has `running`/`failed`; `providerRef` is server-internal (a DB column, never on `GenerationTask`).
2. `providerRef` is a hidden provider detail: it is stored in `generation_tasks.provider_ref`, used only server-side for polling, and never returned to clients (`list`/`GenerationTask` omit it).
3. A generation is charged exactly once, on the transition INTO `succeeded` (synchronously in `createTask`, or asynchronously in `refreshTask`). `running` and `queued` are never charged.
4. Advancement is pull-on-read: `GET /v1/generations/:id` re-polls a `running` task's provider via the stored `providerRef` and persists the new status/result. No background worker.
5. Production default video stays `queued` (the default composite's `video` slot is the text provider, which queues video). The async path is exercised only by an injected `FakeAsyncProvider`.
6. Each task ends green: `pnpm --filter @gw-link-omniai/<pkg> test` + `... typecheck` before committing. Final task runs root `pnpm test` + `pnpm typecheck`.

## File Structure

- Modify: `apps/api/src/services/gatewayClient.ts`; Create: `apps/api/src/services/fakeAsyncProvider.ts` (+ test) (Task 1).
- Modify: `apps/api/src/services/compositeProviderAdapter.ts` (+ test), `server.ts`, `appServices.ts`, and the composite call sites in tests (Task 2).
- Modify: `apps/api/src/db/schema.ts` (+ migration), `repositories/types.ts`/`memory.ts`/`drizzle.ts` (+ contract test) (Task 3).
- Modify: `apps/api/src/services/generationService.ts` (+ test) (Task 4).
- Modify: `apps/api/src/routes/generations.ts` (+ `__tests__/server.test.ts` e2e) (Task 5).
- Modify: `apps/desktop/src/apiClient.ts`, `App.tsx` (+ tests) (Task 6).
- Modify: `README.md`, `docs/architecture/mvp-skeleton.md` (Task 7).

---

## Task 1: Provider async interface + FakeAsyncProvider

**Files:**
- Modify: `apps/api/src/services/gatewayClient.ts`
- Create: `apps/api/src/services/fakeAsyncProvider.ts`
- Test: `apps/api/src/services/__tests__/fakeAsyncProvider.test.ts`

**Interfaces:**
- Produces: `ProviderGenerationResult.providerRef?: string`; `ProviderAdapter.pollGeneration?(request: ProviderPollRequest): Promise<ProviderGenerationResult>`; `ProviderPollRequest { mode, provider, providerModelId, providerRef }`; `FakeAsyncProvider`.

- [ ] **Step 1: Extend the provider contract** — in `apps/api/src/services/gatewayClient.ts`:
  - Add `providerRef?: string;` to the `ProviderGenerationResult` interface.
  - Add a poll-request type (after `ProviderGenerationResult`):
    ```ts
    export interface ProviderPollRequest {
      mode: CreationMode;
      provider: CatalogProviderReference;
      providerModelId: string;
      providerRef: string;
    }
    ```
  - Add the optional method to `ProviderAdapter`:
    ```ts
    export interface ProviderAdapter {
      submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult>;
      pollGeneration?(request: ProviderPollRequest): Promise<ProviderGenerationResult>;
    }
    ```

- [ ] **Step 2: Write the failing test** — create `apps/api/src/services/__tests__/fakeAsyncProvider.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import type { ProviderGenerationRequest, ProviderPollRequest } from "../gatewayClient";
  import { FakeAsyncProvider } from "../fakeAsyncProvider";

  const provider = {
    id: "video-main",
    displayName: "Video Main",
    protocol: "anthropic-compatible" as const,
    baseUrl: "https://video",
    apiKeyEnv: "VIDEO_KEY"
  };

  function submitReq(): ProviderGenerationRequest {
    return {
      mode: "video",
      productModelId: "gw-video-motion",
      provider,
      providerModelId: "claude-video",
      optimizedPrompt: "一段短视频",
      parameters: {},
      userId: "user-a"
    };
  }

  function pollReq(providerRef: string): ProviderPollRequest {
    return { mode: "video", provider, providerModelId: "claude-video", providerRef };
  }

  describe("FakeAsyncProvider", () => {
    it("submits a running task with a provider reference", async () => {
      const fake = new FakeAsyncProvider({ idGenerator: () => "job-1" });
      const result = await fake.submitGeneration(submitReq());
      expect(result.status).toBe("running");
      expect(result.providerRef).toBe("job-1");
      expect(result.result).toBeUndefined();
    });

    it("stays running until the configured number of polls, then succeeds", async () => {
      const fake = new FakeAsyncProvider({ pollsUntilDone: 2, idGenerator: () => "job-1" });
      const { providerRef } = await fake.submitGeneration(submitReq());

      expect((await fake.pollGeneration(pollReq(providerRef!))).status).toBe("running");
      expect((await fake.pollGeneration(pollReq(providerRef!))).status).toBe("running");
      const done = await fake.pollGeneration(pollReq(providerRef!));
      expect(done.status).toBe("succeeded");
      expect(done.result).toEqual({ kind: "image", url: "data:image/png;base64,dmlkZW8=", alt: "video" });
    });

    it("succeeds immediately when pollsUntilDone is 0", async () => {
      const fake = new FakeAsyncProvider({ pollsUntilDone: 0, idGenerator: () => "job-1" });
      const { providerRef } = await fake.submitGeneration(submitReq());
      expect((await fake.pollGeneration(pollReq(providerRef!))).status).toBe("succeeded");
    });
  });
  ```

- [ ] **Step 3: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/fakeAsyncProvider.test.ts`
  Expected: FAIL (module does not exist).

- [ ] **Step 4: Implement it** — create `apps/api/src/services/fakeAsyncProvider.ts`:
  ```ts
  import { randomUUID } from "node:crypto";
  import type { GenerationTaskResult } from "@gw-link-omniai/shared";
  import type {
    ProviderAdapter,
    ProviderGenerationRequest,
    ProviderGenerationResult,
    ProviderPollRequest
  } from "./gatewayClient";

  export interface FakeAsyncProviderOptions {
    pollsUntilDone?: number;
    idGenerator?: () => string;
    clock?: { now(): Date };
  }

  const PLACEHOLDER_RESULT: GenerationTaskResult = {
    kind: "image",
    url: "data:image/png;base64,dmlkZW8=",
    alt: "video"
  };

  export class FakeAsyncProvider implements ProviderAdapter {
    private readonly remaining = new Map<string, number>();
    private readonly pollsUntilDone: number;
    private readonly idGenerator: () => string;
    private readonly clock: { now(): Date };

    constructor(options: FakeAsyncProviderOptions = {}) {
      this.pollsUntilDone = options.pollsUntilDone ?? 1;
      this.idGenerator = options.idGenerator ?? (() => `job_${randomUUID()}`);
      this.clock = options.clock ?? { now: () => new Date() };
    }

    async submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
      const providerRef = this.idGenerator();
      this.remaining.set(providerRef, this.pollsUntilDone);
      return {
        status: "running",
        providerId: request.provider.id,
        providerProtocol: request.provider.protocol,
        providerModelId: request.providerModelId,
        submittedAt: this.clock.now().toISOString(),
        providerRef
      };
    }

    async pollGeneration(request: ProviderPollRequest): Promise<ProviderGenerationResult> {
      const base = {
        providerId: request.provider.id,
        providerProtocol: request.provider.protocol,
        providerModelId: request.providerModelId,
        submittedAt: this.clock.now().toISOString()
      };
      const left = this.remaining.get(request.providerRef) ?? 0;
      if (left > 0) {
        this.remaining.set(request.providerRef, left - 1);
        return { ...base, status: "running", providerRef: request.providerRef };
      }
      return { ...base, status: "succeeded", result: { ...PLACEHOLDER_RESULT } };
    }
  }
  ```

- [ ] **Step 5: Run it to verify it passes**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/fakeAsyncProvider.test.ts`
  Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green — `pollGeneration` is optional, existing providers unaffected).
  ```bash
  git add apps/api/src/services/gatewayClient.ts apps/api/src/services/fakeAsyncProvider.ts apps/api/src/services/__tests__/fakeAsyncProvider.test.ts
  git commit -m "feat(api): add async provider poll interface and FakeAsyncProvider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2: Composite video slot + poll routing

**Files:**
- Modify: `apps/api/src/services/compositeProviderAdapter.ts`
- Modify: `apps/api/src/server.ts`, `apps/api/src/services/appServices.ts`
- Test: `apps/api/src/services/__tests__/compositeProviderAdapter.test.ts`
- Modify (compile): `apps/api/src/__tests__/server.test.ts` (existing `new CompositeProviderAdapter({...})` call sites)

**Interfaces:**
- Consumes: `ProviderPollRequest`, `FakeAsyncProvider` (Task 1).
- Produces: `CompositeProviders { text; image; video }`; `CompositeProviderAdapter.pollGeneration`.

- [ ] **Step 1: Write the failing test** — replace the body of `apps/api/src/services/__tests__/compositeProviderAdapter.test.ts` so the stub records calls for poll too and add `video`:
  - Update the `stub` helper to also implement `pollGeneration`:
    ```ts
    function stub(id: string): ProviderAdapter & { calls: string[]; polls: string[] } {
      const calls: string[] = [];
      const polls: string[] = [];
      return {
        calls,
        polls,
        async submitGeneration(req): Promise<ProviderGenerationResult> {
          calls.push(req.mode);
          return {
            status: "queued",
            providerId: id,
            providerProtocol: "openai-compatible",
            providerModelId: "pm",
            submittedAt: "2026-06-22T00:00:00.000Z"
          };
        },
        async pollGeneration(req): Promise<ProviderGenerationResult> {
          polls.push(req.mode);
          return {
            status: "running",
            providerId: id,
            providerProtocol: "openai-compatible",
            providerModelId: "pm",
            submittedAt: "2026-06-22T00:00:00.000Z",
            providerRef: req.providerRef
          };
        }
      };
    }
    ```
  - Update the `request(mode)` factory to also produce a poll request helper:
    ```ts
    function pollRequest(mode: ProviderPollRequest["mode"]): ProviderPollRequest {
      return {
        mode,
        provider: { id: "p", displayName: "P", protocol: "openai-compatible", baseUrl: "https://x", apiKeyEnv: "K" },
        providerModelId: "pm",
        providerRef: "ref-1"
      };
    }
    ```
    (Add `ProviderPollRequest` to the import from `../gatewayClient`.)
  - Replace the two existing tests so all three providers are constructed and routing covers submit + poll:
    ```ts
    it("routes submit by mode", async () => {
      const text = stub("text");
      const image = stub("image");
      const video = stub("video");
      const adapter = new CompositeProviderAdapter({ text, image, video });

      await adapter.submitGeneration(request("text"));
      await adapter.submitGeneration(request("image"));
      await adapter.submitGeneration(request("video"));

      expect(text.calls).toEqual(["text"]);
      expect(image.calls).toEqual(["image"]);
      expect(video.calls).toEqual(["video"]);
    });

    it("routes poll by mode", async () => {
      const text = stub("text");
      const image = stub("image");
      const video = stub("video");
      const adapter = new CompositeProviderAdapter({ text, image, video });

      const result = await adapter.pollGeneration(pollRequest("video"));

      expect(result.providerId).toBe("video");
      expect(video.polls).toEqual(["video"]);
      expect(text.polls).toEqual([]);
    });
    ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/compositeProviderAdapter.test.ts`
  Expected: FAIL (`video` not in `CompositeProviders`; `pollGeneration` missing).

- [ ] **Step 3: Implement the composite changes** — replace `apps/api/src/services/compositeProviderAdapter.ts`:
  ```ts
  import {
    ProviderAdapterError,
    type ProviderAdapter,
    type ProviderGenerationRequest,
    type ProviderGenerationResult,
    type ProviderPollRequest
  } from "./gatewayClient";

  export interface CompositeProviders {
    text: ProviderAdapter;
    image: ProviderAdapter;
    video: ProviderAdapter;
  }

  export class CompositeProviderAdapter implements ProviderAdapter {
    constructor(private readonly providers: CompositeProviders) {}

    submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
      return this.providerFor(request.mode).submitGeneration(request);
    }

    pollGeneration(request: ProviderPollRequest): Promise<ProviderGenerationResult> {
      const provider = this.providerFor(request.mode);
      if (!provider.pollGeneration) {
        throw new ProviderAdapterError("Provider does not support polling", 502);
      }
      return provider.pollGeneration(request);
    }

    private providerFor(mode: ProviderGenerationRequest["mode"]): ProviderAdapter {
      if (mode === "image") {
        return this.providers.image;
      }
      if (mode === "video") {
        return this.providers.video;
      }
      return this.providers.text;
    }
  }
  ```

- [ ] **Step 4: Update the default composite wiring** — add a `video` slot (the text provider, which queues video) everywhere the default composite is built:
  - In `apps/api/src/server.ts`, the default `providerAdapter`:
    ```ts
    const objectStore = options.objectStore ?? new InMemoryObjectStore();
    const textProvider = new OpenAiCompatibleTextProvider();
    const providerAdapter =
      options.providerAdapter ??
      new CompositeProviderAdapter({
        text: textProvider,
        image: new OpenAiCompatibleImageProvider({ objectStore }),
        video: textProvider
      });
    ```
  - In `apps/api/src/services/appServices.ts` `createDbServices`:
    ```ts
    providerAdapter:
      options.providerAdapter ??
      (() => {
        const textProvider = new OpenAiCompatibleTextProvider();
        return new CompositeProviderAdapter({
          text: textProvider,
          image: new OpenAiCompatibleImageProvider({ objectStore: options.objectStore }),
          video: textProvider
        });
      })(),
    ```
  - In `apps/api/src/services/appServices.ts` `createServices` in-memory branch:
    ```ts
    providerAdapter: (() => {
      const textProvider = new OpenAiCompatibleTextProvider();
      return new CompositeProviderAdapter({
        text: textProvider,
        image: new OpenAiCompatibleImageProvider({ objectStore }),
        video: textProvider
      });
    })(),
    ```

- [ ] **Step 5: Fix the existing composite call sites in tests** — in `apps/api/src/__tests__/server.test.ts`, both existing `new CompositeProviderAdapter({ text: ..., image: ... })` literals (in the image e2e + the object-storage e2e tests) need a `video` slot. Add `video: new OpenAiCompatibleTextProvider()` to each.

- [ ] **Step 6: Run the api suite + typecheck**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green (composite routing covered; default video → text → queued, so existing behavior is unchanged).

- [ ] **Step 7: Commit**
  ```bash
  git add apps/api/src/services/compositeProviderAdapter.ts apps/api/src/services/__tests__/compositeProviderAdapter.test.ts apps/api/src/server.ts apps/api/src/services/appServices.ts apps/api/src/__tests__/server.test.ts
  git commit -m "feat(api): add video slot and poll routing to CompositeProviderAdapter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3: Repository provider_ref + get/update

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Generate: `apps/api/drizzle/0003_*.sql` (+ meta)
- Modify: `apps/api/src/repositories/types.ts`, `memory.ts`, `drizzle.ts`
- Test: `apps/api/src/repositories/__tests__/repositoryContract.test.ts`

**Interfaces:**
- Produces: `GenerationTaskRepository.insert(task, ownerUserId, providerRef?)`, `get(ownerUserId, id): Promise<{ task; providerRef } | undefined>`, `update(task, ownerUserId, providerRef?)`.

- [ ] **Step 1: Add the schema column + migration** — in `apps/api/src/db/schema.ts`, add `providerRef: text("provider_ref")` to the `generationTasks` columns (nullable). Then run `pnpm --filter @gw-link-omniai/api db:generate` (writes `apps/api/drizzle/0003_*.sql` adding the column + meta). Commit whatever it generates.

- [ ] **Step 2: Extend the repository interface** — in `apps/api/src/repositories/types.ts`, replace the `GenerationTaskRepository` interface:
  ```ts
  export interface GenerationTaskRepository {
    insert(task: GenerationTask, ownerUserId: string, providerRef?: string | null): Promise<void>;
    list(ownerUserId: string): Promise<GenerationTask[]>;
    get(ownerUserId: string, id: string): Promise<{ task: GenerationTask; providerRef: string | null } | undefined>;
    update(task: GenerationTask, ownerUserId: string, providerRef?: string | null): Promise<void>;
  }
  ```

- [ ] **Step 3: Write the failing contract tests** — in `apps/api/src/repositories/__tests__/repositoryContract.test.ts`, add inside the `describe.each` block:
  ```ts
  it("gets a task with its provider ref scoped to the owner", async () => {
    const { users, tasks } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await users.insert(makeUser({ id: "owner-b", destination: "b@example.com" }));
    await tasks.insert(makeTask({ id: "task-a", status: "running" }), "owner-a", "job-1");

    const got = await tasks.get("owner-a", "task-a");
    expect(got?.task.status).toBe("running");
    expect(got?.providerRef).toBe("job-1");
    expect(await tasks.get("owner-b", "task-a")).toBeUndefined();
    expect(await tasks.get("owner-a", "missing")).toBeUndefined();
  });

  it("updates a task status, result, and provider ref", async () => {
    const { users, tasks } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await tasks.insert(makeTask({ id: "task-a", status: "running" }), "owner-a", "job-1");

    await tasks.update(
      makeTask({
        id: "task-a",
        status: "succeeded",
        result: { kind: "image", url: "data:image/png;base64,dmlkZW8=", alt: "video" }
      }),
      "owner-a",
      null
    );

    const got = await tasks.get("owner-a", "task-a");
    expect(got?.task.status).toBe("succeeded");
    expect(got?.task.result).toEqual({ kind: "image", url: "data:image/png;base64,dmlkZW8=", alt: "video" });
    expect(got?.providerRef).toBeNull();
  });
  ```

- [ ] **Step 4: Run them to verify they fail**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts -t "provider ref"`
  Expected: FAIL (`get`/`update` not implemented).

- [ ] **Step 5: Implement the in-memory repo** — in `apps/api/src/repositories/memory.ts`, change `InMemoryGenerationTaskRepository` to store and expose the ref:
  ```ts
  export class InMemoryGenerationTaskRepository implements GenerationTaskRepository {
    private readonly tasks: Array<{ ownerUserId: string; task: GenerationTask; providerRef: string | null }> = [];

    async insert(task: GenerationTask, ownerUserId: string, providerRef: string | null = null): Promise<void> {
      this.tasks.push({ ownerUserId, task: structuredClone(task), providerRef });
    }

    async list(ownerUserId: string): Promise<GenerationTask[]> {
      return this.tasks
        .filter((row) => row.ownerUserId === ownerUserId)
        .map((row) => structuredClone(row.task));
    }

    async get(
      ownerUserId: string,
      id: string
    ): Promise<{ task: GenerationTask; providerRef: string | null } | undefined> {
      const row = this.tasks.find((entry) => entry.ownerUserId === ownerUserId && entry.task.id === id);
      return row ? { task: structuredClone(row.task), providerRef: row.providerRef } : undefined;
    }

    async update(task: GenerationTask, ownerUserId: string, providerRef: string | null = null): Promise<void> {
      const row = this.tasks.find((entry) => entry.ownerUserId === ownerUserId && entry.task.id === task.id);
      if (row) {
        row.task = structuredClone(task);
        row.providerRef = providerRef;
      }
    }
  }
  ```

- [ ] **Step 6: Implement the Drizzle repo** — in `apps/api/src/repositories/drizzle.ts`:
  - `DrizzleGenerationTaskRepository.insert` adds `providerRef`:
    ```ts
    async insert(task: GenerationTask, ownerUserId: string, providerRef: string | null = null): Promise<void> {
      await this.db.insert(generationTasks).values({
        id: task.id,
        ownerUserId,
        mode: task.mode,
        status: task.status,
        prompt: task.prompt,
        optimizedPrompt: task.optimizedPrompt,
        preset: task.preset,
        resultPreview: task.resultPreview,
        result: task.result ?? null,
        providerRef,
        createdAt: new Date(task.createdAt),
        updatedAt: new Date(task.updatedAt)
      });
    }
    ```
  - Add `get` and `update` (after `list`):
    ```ts
    async get(
      ownerUserId: string,
      id: string
    ): Promise<{ task: GenerationTask; providerRef: string | null } | undefined> {
      const rows = await this.db
        .select()
        .from(generationTasks)
        .where(and(eq(generationTasks.id, id), eq(generationTasks.ownerUserId, ownerUserId)))
        .limit(1);
      const row = rows[0];
      return row ? { task: mapTaskRow(row), providerRef: row.providerRef ?? null } : undefined;
    }

    async update(task: GenerationTask, ownerUserId: string, providerRef: string | null = null): Promise<void> {
      await this.db
        .update(generationTasks)
        .set({
          status: task.status,
          result: task.result ?? null,
          providerRef,
          updatedAt: new Date(task.updatedAt)
        })
        .where(and(eq(generationTasks.id, task.id), eq(generationTasks.ownerUserId, ownerUserId)));
    }
    ```
    (`and` is already imported from `drizzle-orm`.)

- [ ] **Step 7: Run the contract tests + typecheck**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green (both backends).

- [ ] **Step 8: Commit**
  ```bash
  git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/src/repositories
  git commit -m "feat(api): add provider_ref column and task get/update to the repository

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4: Generation service running + refreshTask

**Files:**
- Modify: `apps/api/src/services/generationService.ts`
- Test: `apps/api/src/services/__tests__/generationService.test.ts`

**Interfaces:**
- Consumes: repository `get`/`update`/`insert(…, providerRef)` (Task 3); `pollGeneration`, `ProviderPollRequest`, `providerRef` (Tasks 1–2).
- Produces: `GenerationService.refreshTask(id, userId): GenerationTask | Promise<GenerationTask>`.

- [ ] **Step 1: Write the failing tests** — in `apps/api/src/services/__tests__/generationService.test.ts`, add a small async-provider stub + tests. Add near the top (the file already imports `InMemoryGenerationService`, `GenerationTaskError`, `ConfigModelCatalog`, `createModelConfig`, `StubCreditService`, `fixedNow`):
  ```ts
  import type { ProviderAdapter, ProviderPollRequest } from "../gatewayClient";

  function runningThenSucceeds(): ProviderAdapter {
    let polled = false;
    return {
      async submitGeneration(req) {
        return {
          status: "running",
          providerId: req.provider.id,
          providerProtocol: req.provider.protocol,
          providerModelId: req.providerModelId,
          submittedAt: "2026-06-20T00:00:00.000Z",
          providerRef: "job-1"
        };
      },
      async pollGeneration(_req: ProviderPollRequest) {
        const status = polled ? "succeeded" : "running";
        polled = true;
        return {
          status,
          providerId: "video-main",
          providerProtocol: "anthropic-compatible" as const,
          providerModelId: "claude-video",
          submittedAt: "2026-06-20T00:00:00.000Z",
          ...(status === "succeeded"
            ? { result: { kind: "image" as const, url: "data:image/png;base64,dmlkZW8=", alt: "video" } }
            : {})
        };
      }
    };
  }

  function createVideoRequest() {
    return {
      mode: "video" as const,
      prompt: "一段短视频",
      optimizedPrompt: "生成一段短视频。",
      preset: { modelId: "gw-video-motion", parameters: {}, creditEstimate: { credits: 3, unit: "credit" as const } }
    };
  }
  ```
  Then add the tests inside the `describe("InMemoryGenerationService", ...)` block:
  ```ts
  it("persists a running task without charging", async () => {
    const credit = new StubCreditService({ "user-a": 100 });
    const service = new InMemoryGenerationService({
      clock: { now: () => fixedNow },
      idGenerator: () => "generation_task_video",
      modelCatalog: new ConfigModelCatalog(createModelConfig()),
      providerAdapter: runningThenSucceeds(),
      creditService: credit
    });

    const task = await service.createTask(createVideoRequest(), "user-a");

    expect(task.status).toBe("running");
    expect(credit.deductions).toEqual([]);
    expect((await service.listTasks("user-a"))[0]!.status).toBe("running");
  });

  it("refreshes a running task to succeeded and charges once", async () => {
    const credit = new StubCreditService({ "user-a": 100 });
    const service = new InMemoryGenerationService({
      clock: { now: () => fixedNow },
      idGenerator: () => "generation_task_video",
      modelCatalog: new ConfigModelCatalog(createModelConfig()),
      providerAdapter: runningThenSucceeds(),
      creditService: credit
    });
    await service.createTask(createVideoRequest(), "user-a");

    const first = await service.refreshTask("generation_task_video", "user-a");
    expect(first.status).toBe("running");
    expect(credit.deductions).toEqual([]);

    const second = await service.refreshTask("generation_task_video", "user-a");
    expect(second.status).toBe("succeeded");
    expect(second.result).toEqual({ kind: "image", url: "data:image/png;base64,dmlkZW8=", alt: "video" });
    expect(credit.deductions).toEqual([{ userId: "user-a", amount: 3, reference: "generation_task_video" }]);

    const third = await service.refreshTask("generation_task_video", "user-a");
    expect(third.status).toBe("succeeded");
    expect(credit.deductions).toHaveLength(1);
  });

  it("rejects refreshing an unknown task", async () => {
    const service = createService();
    await expect(service.refreshTask("missing", "user-a")).rejects.toMatchObject({ statusCode: 404 });
  });
  ```
  (`createModelConfig` in this test file includes `gw-video-motion` with `creditUnitCost: 3` and capability video — it already does.)

- [ ] **Step 2: Run them to verify they fail**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/generationService.test.ts -t "running"`
  Expected: FAIL (`refreshTask` not a function; `createTask` insert lacks providerRef so the running task has no ref to poll).

- [ ] **Step 3: Implement it** — in `apps/api/src/services/generationService.ts`:
  - Add `ProviderPollRequest` to the import from `./gatewayClient`.
  - Add `refreshTask` to the `GenerationService` interface:
    ```ts
    refreshTask(id: string, userId: string): GenerationTask | Promise<GenerationTask>;
    ```
  - In `createTask`, change the persist call to pass the provider ref:
    ```ts
    await this.tasks.insert(task, userId, providerResult.providerRef ?? null);
    ```
  - Add the `refreshTask` method (after `listTasks`):
    ```ts
    async refreshTask(id: string, userId: string): Promise<GenerationTask> {
      const stored = await this.tasks.get(userId, id);
      if (!stored) {
        throw new GenerationTaskError("Generation task was not found", 404);
      }

      const { task, providerRef } = stored;
      if (task.status !== "running" || !providerRef || !this.providerAdapter.pollGeneration) {
        return cloneGenerationTask(task);
      }

      if (this.modelCatalog === undefined) {
        throw new GenerationTaskError("Model catalog is not configured", 500);
      }

      let modelReference: ReturnType<ModelCatalog["getModelReference"]>;
      try {
        modelReference = this.modelCatalog.getModelReference(task.preset.modelId, task.mode);
      } catch (error) {
        if (error instanceof ModelCatalogError) {
          throw new GenerationTaskError(error.message, error.statusCode);
        }
        throw error;
      }

      let pollResult: ProviderGenerationResult;
      try {
        pollResult = await this.providerAdapter.pollGeneration({
          mode: task.mode,
          provider: modelReference.provider,
          providerModelId: modelReference.providerModelId,
          providerRef
        });
      } catch (error) {
        if (error instanceof ProviderAdapterError) {
          throw new GenerationTaskError(error.message, error.statusCode);
        }
        throw new GenerationTaskError("Provider adapter failed", 502);
      }

      if (pollResult.status === "running") {
        return cloneGenerationTask(task);
      }

      const updated: GenerationTask = {
        ...task,
        status: pollResult.status,
        ...(pollResult.result ? { result: cloneGenerationTaskResult(pollResult.result) } : {}),
        updatedAt: this.clock.now().toISOString()
      };
      await this.tasks.update(updated, userId, providerRef);

      if (this.creditService && pollResult.status === "succeeded") {
        await this.creditService.deduct(userId, modelReference.product.creditUnitCost, updated.id);
      }

      return cloneGenerationTask(updated);
    }
    ```

- [ ] **Step 4: Run them to verify they pass**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/generationService.test.ts`
  Expected: PASS (running not charged; refresh→succeeded charges once; 404; existing tests unaffected).

- [ ] **Step 5: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green).
  ```bash
  git add apps/api/src/services/generationService.ts apps/api/src/services/__tests__/generationService.test.ts
  git commit -m "feat(api): persist running tasks and add refreshTask polling

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 5: GET /v1/generations/:id route + e2e

**Files:**
- Modify: `apps/api/src/routes/generations.ts`
- Test: `apps/api/src/__tests__/server.test.ts`

**Interfaces:**
- Consumes: `generationService.refreshTask` (Task 4); `FakeAsyncProvider`, `CompositeProviderAdapter` (Tasks 1–2).

- [ ] **Step 1: Add the route** — in `apps/api/src/routes/generations.ts`, add inside `registerGenerationRoutes` (after the `GET /v1/generations` list route):
  ```ts
  server.get("/v1/generations/:id", { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (typeof id !== "string" || id.length === 0) {
      return reply.status(400).send({ error: "Invalid generation task id" });
    }

    try {
      const task = await generationService.refreshTask(id, request.userId!);
      return { task };
    } catch (error) {
      return sendGenerationTaskError(reply, error);
    }
  });
  ```

- [ ] **Step 2: Write the failing e2e test** — in `apps/api/src/__tests__/server.test.ts`, add imports (next to the other provider imports):
  ```ts
  import { FakeAsyncProvider } from "../services/fakeAsyncProvider";
  ```
  and a test inside the `describe("product API", ...)` block (signup grants 100; video cost 3):
  ```ts
  it("advances a running task to succeeded via GET /v1/generations/:id", async () => {
    const modelConfig: ModelCatalogConfig = {
      providers: [
        {
          id: "video-main",
          displayName: "Video Main",
          protocol: "anthropic-compatible",
          baseUrl: "https://video",
          apiKeyEnv: "VIDEO_KEY",
          models: [
            {
              id: "gw-video-motion",
              providerModelId: "claude-video",
              displayName: "OmniAI Video Motion",
              capability: "video",
              tags: ["motion"],
              visibility: "visible",
              minimumPlan: "free",
              creditUnitCost: 3
            }
          ]
        }
      ]
    };
    const textProvider = new OpenAiCompatibleTextProvider();
    const server = buildServer({
      modelCatalog: new ConfigModelCatalog(modelConfig),
      providerAdapter: new CompositeProviderAdapter({
        text: textProvider,
        image: textProvider,
        video: new FakeAsyncProvider({ pollsUntilDone: 1 })
      })
    });
    const token = await authenticate(server);

    const create = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: "video",
        prompt: "一段短视频",
        optimizedPrompt: "生成一段短视频。",
        preset: { modelId: "gw-video-motion", parameters: {}, creditEstimate: { credits: 3, unit: "credit" } }
      }
    });
    expect(create.json()).toMatchObject({ task: { status: "running" } });
    const id = (create.json() as { task: { id: string } }).task.id;

    const running = await server.inject({
      method: "GET",
      url: `/v1/generations/${id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(running.json()).toMatchObject({ task: { status: "running" } });

    const done = await server.inject({
      method: "GET",
      url: `/v1/generations/${id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(done.json()).toMatchObject({ task: { status: "succeeded", result: { kind: "image" } } });

    const balance = await server.inject({
      method: "GET",
      url: "/v1/credits/balance",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(balance.json()).toEqual({ balance: { credits: 97, unit: "credit" } });
  });
  ```

- [ ] **Step 3: Run the api suite + typecheck**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green.

- [ ] **Step 4: Commit**
  ```bash
  git add apps/api/src/routes/generations.ts apps/api/src/__tests__/server.test.ts
  git commit -m "feat(api): add GET /v1/generations/:id to advance running tasks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 6: Desktop refresh button

**Files:**
- Modify: `apps/desktop/src/apiClient.ts`
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/src/__tests__/apiClient.test.ts`, `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Produces: `ApiClient.getGeneration(id, token): Promise<GenerationTask>`.

- [ ] **Step 1: Add `getGeneration` to the client** — in `apps/desktop/src/apiClient.ts`:
  - Add to the `ApiClient` interface (after `getSession`): `getGeneration(id: string, token: string): Promise<GenerationTask>;`.
  - Add the implementation (after `getSession`):
    ```ts
    async getGeneration(id, token) {
      const { task } = await send<{ task: GenerationTask }>(`/v1/generations/${encodeURIComponent(id)}`, { token });
      return task;
    }
    ```

- [ ] **Step 2: Add the client test** — in `apps/desktop/src/__tests__/apiClient.test.ts`, add:
  ```ts
  it("fetches one generation by id with the bearer token", async () => {
    const task = {
      id: "task-v",
      mode: "video",
      status: "succeeded",
      prompt: "p",
      optimizedPrompt: "op",
      preset: { modelId: "gw-video-motion", parameters: {}, creditEstimate: { credits: 3, unit: "credit" } },
      resultPreview: { title: "视频生成任务", description: "已生成。" },
      result: { kind: "image", url: "data:image/png;base64,dmlkZW8=", alt: "video" },
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    };
    const fetchMock = vi.fn(async () => jsonResponse({ task }));
    const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

    const result = await client.getGeneration("task-v", "tok-1");

    expect(result).toEqual(task);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/v1/generations/task-v");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });
  ```

- [ ] **Step 3: Wire the refresh button in `App.tsx`:**
  - Add `handleRefreshTask` (after `handleSaveAsset`):
    ```ts
    async function handleRefreshTask(task: GenerationTask) {
      if (!token) {
        return;
      }
      setActionError(undefined);
      try {
        const updated = await api.getGeneration(task.id, token);
        setTasks((prev) => prev.map((existing) => (existing.id === updated.id ? updated : existing)));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          handleSignedOut("登录已失效，请重新登录");
          return;
        }
        setActionError(errorMessage(error));
      }
    }
    ```
  - In the task-center `<article>`, after the result/save block, add a refresh button for running tasks:
    ```tsx
    {task.status === "running" ? (
      <button type="button" onClick={() => handleRefreshTask(task)}>
        刷新状态
      </button>
    ) : null}
    ```

- [ ] **Step 4: Add the fake `getGeneration` + the App test** — in `apps/desktop/src/__tests__/App.test.tsx`:
  - Add a default `getGeneration` to the `base` fake (after `getSession`):
    ```ts
    getGeneration: async (id: string) => {
      const found = tasks.find((task) => task.id === id);
      if (!found) {
        throw new ApiError("Generation task was not found", 404);
      }
      return found;
    }
    ```
  - Add a test (after the asset/image tests):
    ```ts
    it("refreshes a running task from the task center", async () => {
      const runningTask: GenerationTask = {
        id: "task-v",
        mode: "video",
        status: "running",
        prompt: "一段短视频",
        optimizedPrompt: "生成一段短视频。",
        preset: { modelId: "gw-video-motion", parameters: {}, creditEstimate: { credits: 3, unit: "credit" } },
        resultPreview: { title: "视频生成任务", description: "生成中。" },
        createdAt: "2026-06-22T00:00:00.000Z",
        updatedAt: "2026-06-22T00:00:00.000Z"
      };
      const succeededTask: GenerationTask = {
        ...runningTask,
        status: "succeeded",
        result: { kind: "image", url: "data:image/png;base64,dmlkZW8=", alt: "video" }
      };
      const client = createFakeClient({
        listGenerations: async () => [runningTask],
        getGeneration: async () => succeededTask
      });
      await signIn(client);

      const taskCenter = screen.getByLabelText("任务中心");
      expect(within(taskCenter).getByText("生成中")).toBeTruthy();
      fireEvent.click(within(taskCenter).getByRole("button", { name: "刷新状态" }));

      expect(await within(taskCenter).findByText("已完成")).toBeTruthy();
    });
    ```

- [ ] **Step 5: Run the desktop suite + typecheck**

  Run: `pnpm --filter @gw-link-omniai/desktop test` then `pnpm --filter @gw-link-omniai/desktop typecheck`. Both green.

- [ ] **Step 6: Commit**
  ```bash
  git add apps/desktop/src/apiClient.ts apps/desktop/src/App.tsx apps/desktop/src/__tests__/apiClient.test.ts apps/desktop/src/__tests__/App.test.tsx
  git commit -m "feat(desktop): refresh a running task from the task center

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 7: Documentation + final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update `README.md`** — add a section after "Real Image Generation":
  ```markdown
  ### Async Generation Lifecycle

  Generation can be asynchronous: a provider may return a `running` task with an
  internal job reference (never exposed in the product contract). `GET
  /v1/generations/:id` re-polls a `running` task via the stored reference,
  persists the new status/result, and charges the model's `creditUnitCost` once,
  on the `running → succeeded` transition. The desktop shows a "刷新状态" button on
  running tasks that fetches the latest state. This is proven with a deterministic
  `FakeAsyncProvider`; production video stays `queued` until a real async video
  provider is added. No background worker — advancement happens on read.
  ```

- [ ] **Step 2: Update `docs/architecture/mvp-skeleton.md`** — append:
  ```markdown
  ## Async Generation Lifecycle Slice

  The async generation machinery (slice 11a, fake provider). `submitGeneration`
  may return `running` + a `providerRef` (server-internal, stored in
  `generation_tasks.provider_ref`, never in `GenerationTask`); `ProviderAdapter`
  gains optional `pollGeneration`. `CompositeProviderAdapter` routes submit/poll by
  mode (text/image/video). The repository gains `get`/`update`; the generation
  service persists running tasks without charging and exposes `refreshTask`
  (re-poll, persist, deduct on `running → succeeded`). `GET /v1/generations/:id`
  re-polls on read (no worker); the desktop adds a per-running-task refresh button.
  A `FakeAsyncProvider` (submit→running, poll→succeeds after N) proves it
  end-to-end; production video stays `queued`. The real async video provider, a
  video-specific result variant, background polling, and a desktop auto-poll
  remain slice 11b / later.
  ```

- [ ] **Step 3: Full workspace verification**

  Run from the repo root: `pnpm test` then `pnpm typecheck`. Both green.

- [ ] **Step 4: Commit**
  ```bash
  git add README.md docs/architecture/mvp-skeleton.md
  git commit -m "docs: document the async generation lifecycle slice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Final Verification (after all tasks)

- [ ] `pnpm test` + `pnpm typecheck` pass across all packages.
- [ ] No `packages/shared` change; `providerRef` never appears on `GenerationTask` / `/v1/generations` responses.
- [ ] A video generation with `FakeAsyncProvider` is created `running`, advances to `succeeded` via `GET /v1/generations/:id`, and is charged exactly once (balance −3); production video without an async provider stays `queued`.
- [ ] The desktop shows "刷新状态" on running tasks and updates them on click.
- [ ] pglite contract test green (migration `0003` applies; `get`/`update` round-trip `provider_ref`).
