# GW-LINK OmniAI Real Text Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make text generation real — synchronously call an OpenAI-compatible provider, return the generated text on a `succeeded` task carrying a new optional `result`, while image/video and key-less environments keep today's `queued` behavior.

**Architecture:** Extend the `GenerationTask` contract with an optional `result`. Add an `OpenAiCompatibleTextProvider` adapter (injectable `fetch`+`env`) that does a real `chat/completions` call for text when an API key is configured and otherwise falls back to the existing fake `queued` behavior. The generation service uses the adapter's returned `status`/`result`; persistence gains a nullable `result` jsonb column. The desktop task center renders `task.result.text`.

**Tech Stack:** TypeScript (strict, ESM), Vitest, Fastify, Drizzle ORM, `@electric-sql/pglite` (test Postgres), React 18 (desktop), pnpm workspaces, Node 20.

**Spec:** `docs/superpowers/specs/2026-06-21-gw-link-omniai-real-text-provider-design.md` (approved).

## Global Constraints (apply to every task)

1. **Contract change is additive only:** add `GenerationTaskResult` + optional `GenerationTask.result?`; `GenerationTaskRequest` and all other shapes unchanged. Routes return the same `{ task }`/`{ tasks }` envelopes (task may now carry `result`).
2. **No-key fallback:** the real text adapter returns `status: "queued"` (no `result`) whenever `request.mode !== "text"`, `request.provider.protocol !== "openai-compatible"`, OR the provider's API key env var is empty — so all existing key-less tests and local dev keep today's behavior.
3. **Real call only on text+openai+key:** POST `${baseUrl}/chat/completions` with body `{ model: providerModelId, messages: [{ role: "user", content: optimizedPrompt }] }` and header `Authorization: Bearer <apiKey>`; do NOT forward `preset.parameters`.
4. **Provider real errors → `ProviderAdapterError(message, 502)`** (non-2xx / network / no content / invalid JSON); message comes from the provider error body when present and NEVER includes the API key. The generation service maps it to `GenerationTaskError` and does NOT persist a task.
5. **Key safety:** the API key is read from the injected `env` via `provider.apiKeyEnv`, used only in the request header, and never returned, logged, stored on the task, or exposed by `/v1/models`.
6. **Default provider adapter becomes `OpenAiCompatibleTextProvider`** in `buildServer` and `createDbServices` (it self-falls-back without a key). Keep `FakeProviderAdapter` for tests that need deterministic `queued`.
7. **Each task ends green:** run the touched package(s) `test` + `typecheck` before committing; commit per task. Final task runs root `pnpm test` + `pnpm typecheck`.
8. **Injectable side effects** preserved (clock/fetch/env). No inline `Date.now()`/random in new logic except existing default generators.

## File Structure

- Modify: `packages/shared/src/models.ts` — `GenerationTaskResult` + `GenerationTask.result?`.
- Modify: `packages/shared/src/index.ts` — export `GenerationTaskResult`.
- Modify: `apps/api/src/db/schema.ts` — `result` jsonb column on `generation_tasks`.
- Create: `apps/api/drizzle/0001_*.sql` (+ meta) — generated migration.
- Modify: `apps/api/src/repositories/drizzle.ts` — map `result` on insert/list.
- Modify: `apps/api/src/repositories/__tests__/repositoryContract.test.ts` — result round-trip.
- Modify: `apps/api/src/services/gatewayClient.ts` — extend `ProviderGenerationResult` (status + result).
- Create: `apps/api/src/services/openAiTextProvider.ts` — `OpenAiCompatibleTextProvider`.
- Create: `apps/api/src/services/__tests__/openAiTextProvider.test.ts` — adapter tests.
- Modify: `apps/api/src/services/generationService.ts` — use adapter `status`/`result`.
- Modify: `apps/api/src/services/__tests__/generationService.test.ts` — succeeded+result test.
- Modify: `apps/api/src/server.ts` — default adapter → `OpenAiCompatibleTextProvider`.
- Modify: `apps/api/src/services/appServices.ts` — `createDbServices` injects the real adapter.
- Modify: `apps/api/src/__tests__/server.test.ts` — e2e: keyed adapter → succeeded+result.
- Modify: `apps/desktop/src/App.tsx` — render `task.result.text`.
- Modify: `apps/desktop/src/__tests__/App.test.tsx` — result render test.
- Modify: `.env.example`, `README.md`, `CLAUDE.md`, `docs/architecture/mvp-skeleton.md` — docs.

---

## Task 1: Shared contract — `GenerationTaskResult`

**Files:**
- Modify: `packages/shared/src/models.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `type GenerationTaskResult = { kind: "text"; text: string; format: "markdown" | "plain" }`; `GenerationTask.result?: GenerationTaskResult`.

- [ ] **Step 1: Add the type + field** — in `packages/shared/src/models.ts`, add the result type just above `GenerationTask` and add the optional field. Add after the `GenerationTaskResultPreview` interface:
  ```ts
  export type GenerationTaskResult = { kind: "text"; text: string; format: "markdown" | "plain" };
  ```
  In the `GenerationTask` interface, add the optional field (e.g. after `resultPreview`):
  ```ts
  export interface GenerationTask {
    id: string;
    mode: CreationMode;
    status: GenerationTaskStatus;
    prompt: string;
    optimizedPrompt: string;
    preset: PresetSuggestion;
    resultPreview: GenerationTaskResultPreview;
    result?: GenerationTaskResult;
    createdAt: string;
    updatedAt: string;
  }
  ```

- [ ] **Step 2: Export it** — in `packages/shared/src/index.ts`, add `GenerationTaskResult` to the `export type { ... } from "./models"` list (alphabetically near `GenerationTask`):
  ```ts
    GenerationTask,
    GenerationTaskRequest,
    GenerationTaskResult,
    GenerationTaskResultPreview,
    GenerationTaskStatus,
  ```

- [ ] **Step 3: Typecheck the workspace**

  Run: `pnpm typecheck`
  Expected: PASS (additive optional field — nothing breaks; `packages/shared` is consumed as TS source).

- [ ] **Step 4: Commit**
  ```bash
  git add packages/shared/src/models.ts packages/shared/src/index.ts
  git commit -m "feat(shared): add optional GenerationTask.result (text)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2: Persist `result` (schema + migration + Drizzle mapping + contract test)

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0001_*.sql` (+ `meta/` — generated)
- Modify: `apps/api/src/repositories/drizzle.ts`
- Modify: `apps/api/src/repositories/__tests__/repositoryContract.test.ts`

**Interfaces:**
- Consumes: `GenerationTaskResult` (Task 1).
- Produces: `generation_tasks.result` nullable jsonb; Drizzle repo round-trips `task.result`.

- [ ] **Step 1: Add the schema column** — in `apps/api/src/db/schema.ts`, import the type and add the column to `generationTasks`. Add `GenerationTaskResult` to the existing `import type { ... } from "@gw-link-omniai/shared"`, then add inside the `generationTasks` table after `resultPreview`:
  ```ts
    result: jsonb("result").$type<GenerationTaskResult>(),
  ```
  (Nullable — no `.notNull()`.)

- [ ] **Step 2: Generate the migration**

  Run: `pnpm --filter @gw-link-omniai/api db:generate`
  Expected: creates `apps/api/drizzle/0001_*.sql` containing `ALTER TABLE "generation_tasks" ADD COLUMN "result" jsonb;` plus an updated `meta/` snapshot + journal. Commit these generated files exactly as produced.

- [ ] **Step 3: Map `result` in the Drizzle repo** — in `apps/api/src/repositories/drizzle.ts`:
  - In `DrizzleGenerationTaskRepository.insert`, add to the `.values({...})` object: `result: task.result ?? null,`.
  - In the `mapTaskRow` helper, add the result mapping. Find `mapTaskRow` and change its return to include `result` only when present:
    ```ts
    function mapTaskRow(row: typeof generationTasks.$inferSelect): GenerationTask {
      return {
        id: row.id,
        mode: row.mode as GenerationTask["mode"],
        status: row.status as GenerationTask["status"],
        prompt: row.prompt,
        optimizedPrompt: row.optimizedPrompt,
        preset: row.preset,
        resultPreview: row.resultPreview,
        ...(row.result ? { result: row.result } : {}),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      };
    }
    ```
  (The in-memory repo needs no change — `structuredClone` already preserves `result`.)

- [ ] **Step 4: Add the failing contract round-trip test** — in `apps/api/src/repositories/__tests__/repositoryContract.test.ts`, add a test inside the `describe.each(backends)(...)` block (it runs on both memory + pglite):
  ```ts
  it("round-trips a task result", async () => {
    const { users, tasks } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await tasks.insert(
      makeTask({
        id: "task-result",
        status: "succeeded",
        result: { kind: "text", text: "生成的文案", format: "markdown" }
      }),
      "owner-a"
    );

    const [listed] = await tasks.list("owner-a");
    expect(listed!.result).toEqual({ kind: "text", text: "生成的文案", format: "markdown" });
    expect(listed!.status).toBe("succeeded");
  });
  ```
  (`makeTask` accepts overrides; `result` is a valid optional field on `GenerationTask`.)

- [ ] **Step 5: Run the contract test on both backends**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts`
  Expected: PASS (memory + pglite; the migration adds the column for pglite).

- [ ] **Step 6: Full api check + commit**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green (existing task tests unaffected — `result` is absent on existing tasks).
  ```bash
  git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/src/repositories/drizzle.ts \
    apps/api/src/repositories/__tests__/repositoryContract.test.ts
  git commit -m "feat(api): persist optional generation task result

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3: Provider adapter — extend result + `OpenAiCompatibleTextProvider`

**Files:**
- Modify: `apps/api/src/services/gatewayClient.ts`
- Create: `apps/api/src/services/openAiTextProvider.ts`
- Test: `apps/api/src/services/__tests__/openAiTextProvider.test.ts`

**Interfaces:**
- Consumes: `GenerationTaskResult` (Task 1); `ProviderAdapter`, `ProviderGenerationRequest`, `ProviderAdapterError`, `CatalogProviderReference`.
- Produces: `ProviderGenerationResult` now has `status: GenerationTaskStatus` and optional `result?: GenerationTaskResult`; `class OpenAiCompatibleTextProvider implements ProviderAdapter` with options `{ fetch?, env?, clock? }`.

- [ ] **Step 1: Extend `ProviderGenerationResult`** — in `apps/api/src/services/gatewayClient.ts`:
  - Add to the imports from `@gw-link-omniai/shared`: `GenerationTaskResult` and `GenerationTaskStatus` (the file already imports `CreationMode, PresetSuggestion`):
    ```ts
    import type { CreationMode, GenerationTaskResult, GenerationTaskStatus, PresetSuggestion } from "@gw-link-omniai/shared";
    ```
  - Change `ProviderGenerationResult`:
    ```ts
    export interface ProviderGenerationResult {
      status: GenerationTaskStatus;
      providerId: string;
      providerProtocol: CatalogProviderReference["protocol"];
      providerModelId: string;
      submittedAt: string;
      result?: GenerationTaskResult;
    }
    ```
  (`FakeProviderAdapter` already returns `status: "queued"` with no `result` — it stays valid and unchanged.)

- [ ] **Step 2: Write the failing adapter tests** — `apps/api/src/services/__tests__/openAiTextProvider.test.ts`:
  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { ProviderAdapterError, type ProviderGenerationRequest } from "../gatewayClient";
  import { OpenAiCompatibleTextProvider } from "../openAiTextProvider";

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  function textRequest(overrides: Partial<ProviderGenerationRequest> = {}): ProviderGenerationRequest {
    return {
      mode: "text",
      productModelId: "gw-text-balanced",
      provider: {
        id: "openai-main",
        displayName: "OpenAI Main",
        protocol: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY"
      },
      providerModelId: "gpt-4.1-mini",
      optimizedPrompt: "请生成一段新品推广文案。",
      parameters: { tone: "warm" },
      userId: "user-1",
      ...overrides
    };
  }

  const clock = { now: () => new Date("2026-06-21T00:00:00.000Z") };

  describe("OpenAiCompatibleTextProvider", () => {
    it("calls chat/completions and returns a succeeded text result", async () => {
      const fetchMock = vi.fn(async () =>
        jsonResponse({ choices: [{ message: { role: "assistant", content: "新品上市文案" } }] })
      );
      const provider = new OpenAiCompatibleTextProvider({
        fetch: fetchMock as unknown as typeof fetch,
        env: { OPENAI_API_KEY: "sk-test" },
        clock
      });

      const result = await provider.submitGeneration(textRequest());

      expect(result.status).toBe("succeeded");
      expect(result.result).toEqual({ kind: "text", text: "新品上市文案", format: "markdown" });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
      expect(JSON.parse(init.body as string)).toEqual({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "请生成一段新品推广文案。" }]
      });
    });

    it("falls back to queued (no fetch) when the API key is absent", async () => {
      const fetchMock = vi.fn();
      const provider = new OpenAiCompatibleTextProvider({
        fetch: fetchMock as unknown as typeof fetch,
        env: {},
        clock
      });

      const result = await provider.submitGeneration(textRequest());

      expect(result.status).toBe("queued");
      expect(result.result).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("falls back to queued for non-text modes", async () => {
      const fetchMock = vi.fn();
      const provider = new OpenAiCompatibleTextProvider({
        fetch: fetchMock as unknown as typeof fetch,
        env: { OPENAI_API_KEY: "sk-test" },
        clock
      });

      const result = await provider.submitGeneration(textRequest({ mode: "image" }));

      expect(result.status).toBe("queued");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("maps a non-2xx provider response to a 502 ProviderAdapterError using the provider message", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ error: { message: "model overloaded" } }, 503));
      const provider = new OpenAiCompatibleTextProvider({
        fetch: fetchMock as unknown as typeof fetch,
        env: { OPENAI_API_KEY: "sk-test" },
        clock
      });

      await expect(provider.submitGeneration(textRequest())).rejects.toMatchObject({
        name: "ProviderAdapterError",
        message: "model overloaded",
        statusCode: 502
      });
    });

    it("maps a network failure to a 502 ProviderAdapterError", async () => {
      const fetchMock = vi.fn(async () => {
        throw new Error("ECONNRESET");
      });
      const provider = new OpenAiCompatibleTextProvider({
        fetch: fetchMock as unknown as typeof fetch,
        env: { OPENAI_API_KEY: "sk-test" },
        clock
      });

      await expect(provider.submitGeneration(textRequest())).rejects.toBeInstanceOf(ProviderAdapterError);
    });

    it("errors when the provider returns no content", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "" } }] }));
      const provider = new OpenAiCompatibleTextProvider({
        fetch: fetchMock as unknown as typeof fetch,
        env: { OPENAI_API_KEY: "sk-test" },
        clock
      });

      await expect(provider.submitGeneration(textRequest())).rejects.toMatchObject({
        message: "Provider returned no content",
        statusCode: 502
      });
    });
  });
  ```

- [ ] **Step 3: Run the adapter tests to verify they fail**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/openAiTextProvider.test.ts`
  Expected: FAIL (`../openAiTextProvider` not found).

- [ ] **Step 4: Implement the adapter** — `apps/api/src/services/openAiTextProvider.ts`:
  ```ts
  import type { GenerationTaskResult } from "@gw-link-omniai/shared";
  import {
    ProviderAdapterError,
    type ProviderAdapter,
    type ProviderGenerationRequest,
    type ProviderGenerationResult
  } from "./gatewayClient";

  export interface OpenAiCompatibleTextProviderOptions {
    fetch?: typeof fetch;
    env?: Record<string, string | undefined>;
    clock?: { now(): Date };
  }

  export class OpenAiCompatibleTextProvider implements ProviderAdapter {
    private readonly fetchImpl: typeof fetch;
    private readonly env: Record<string, string | undefined>;
    private readonly clock: { now(): Date };

    constructor(options: OpenAiCompatibleTextProviderOptions = {}) {
      this.fetchImpl = options.fetch ?? globalThis.fetch;
      this.env = options.env ?? process.env;
      this.clock = options.clock ?? { now: () => new Date() };
    }

    async submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
      const base = {
        providerId: request.provider.id,
        providerProtocol: request.provider.protocol,
        providerModelId: request.providerModelId,
        submittedAt: this.clock.now().toISOString()
      };

      const apiKey = this.env[request.provider.apiKeyEnv];
      if (request.mode !== "text" || request.provider.protocol !== "openai-compatible" || !apiKey) {
        return { ...base, status: "queued" };
      }

      const url = `${request.provider.baseUrl.replace(/\/$/, "")}/chat/completions`;

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: request.providerModelId,
            messages: [{ role: "user", content: request.optimizedPrompt }]
          })
        });
      } catch {
        throw new ProviderAdapterError("Provider request failed", 502);
      }

      if (!response.ok) {
        throw new ProviderAdapterError(await readProviderError(response), 502);
      }

      let payload: { choices?: Array<{ message?: { content?: unknown } }> };
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        throw new ProviderAdapterError("Provider returned an invalid response", 502);
      }

      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.length === 0) {
        throw new ProviderAdapterError("Provider returned no content", 502);
      }

      const result: GenerationTaskResult = { kind: "text", text, format: "markdown" };
      return { ...base, status: "succeeded", result };
    }
  }

  async function readProviderError(response: Response): Promise<string> {
    const fallback = `Provider request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: unknown };
      const error = body.error;
      if (typeof error === "string" && error.length > 0) {
        return error;
      }
      if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
        const message = (error as { message: string }).message;
        if (message.length > 0) {
          return message;
        }
      }
    } catch {
      // non-JSON error body — fall through
    }
    return fallback;
  }
  ```

- [ ] **Step 5: Run the adapter tests to verify they pass**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/openAiTextProvider.test.ts`
  Expected: PASS (6/6).

- [ ] **Step 6: Full api check + commit**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green (existing gatewayClient/FakeProviderAdapter consumers unaffected).
  ```bash
  git add apps/api/src/services/gatewayClient.ts apps/api/src/services/openAiTextProvider.ts \
    apps/api/src/services/__tests__/openAiTextProvider.test.ts
  git commit -m "feat(api): add OpenAI-compatible text provider adapter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4: Generation service uses the result + default adapter swap + e2e

**Files:**
- Modify: `apps/api/src/services/generationService.ts`
- Modify: `apps/api/src/services/__tests__/generationService.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/services/appServices.ts`
- Modify: `apps/api/src/__tests__/server.test.ts`

**Interfaces:**
- Consumes: `ProviderGenerationResult` (now with `status`/`result`, Task 3); `OpenAiCompatibleTextProvider` (Task 3).
- Produces: generation tasks whose `status`/`result` come from the provider result.

- [ ] **Step 1: Use the provider result in the service** — in `apps/api/src/services/generationService.ts`:
  - Add the type import: `import { FakeProviderAdapter, ProviderAdapterError, type ProviderAdapter, type ProviderGenerationResult } from "./gatewayClient";` (extend the existing import).
  - Also import the result type from shared: add `GenerationTaskResult` to the existing `import type { ... } from "@gw-link-omniai/shared"`.
  - Replace the provider call + task construction block. Change the `try { await this.providerAdapter.submitGeneration({...}); } catch {...}` to CAPTURE the result:
    ```ts
    let providerResult: ProviderGenerationResult;
    try {
      providerResult = await this.providerAdapter.submitGeneration({
        mode,
        productModelId: modelReference.product.id,
        provider: modelReference.provider,
        providerModelId: modelReference.providerModelId,
        optimizedPrompt,
        parameters: { ...preset.parameters },
        userId
      });
    } catch (error) {
      if (error instanceof ProviderAdapterError) {
        throw new GenerationTaskError(error.message, error.statusCode);
      }

      throw new GenerationTaskError("Provider adapter failed", 502);
    }

    const timestamp = this.clock.now().toISOString();
    const task: GenerationTask = {
      id: this.idGenerator(),
      mode,
      status: providerResult.status,
      prompt,
      optimizedPrompt,
      preset: clonePresetSuggestion(preset),
      resultPreview: cloneResultPreview(resultPreviews[mode]),
      ...(providerResult.result ? { result: cloneGenerationTaskResult(providerResult.result) } : {}),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.tasks.insert(task, userId);
    return cloneGenerationTask(task);
    ```
  - Update `cloneGenerationTask` to also clone `result`:
    ```ts
    function cloneGenerationTask(task: GenerationTask): GenerationTask {
      return {
        ...task,
        preset: clonePresetSuggestion(task.preset),
        resultPreview: cloneResultPreview(task.resultPreview),
        ...(task.result ? { result: cloneGenerationTaskResult(task.result) } : {})
      };
    }
    ```
  - Add the result cloner near the other clone helpers:
    ```ts
    function cloneGenerationTaskResult(result: GenerationTaskResult): GenerationTaskResult {
      return { ...result };
    }
    ```

- [ ] **Step 2: Add the succeeded+result service test** — in `apps/api/src/services/__tests__/generationService.test.ts`, add a stub adapter test inside `describe("InMemoryGenerationService", ...)`:
  ```ts
  it("stores the provider's succeeded text result", async () => {
    const providerAdapter: ProviderAdapter = {
      async submitGeneration() {
        return {
          status: "succeeded",
          providerId: "openai-main",
          providerProtocol: "openai-compatible",
          providerModelId: "gpt-4.1-mini",
          submittedAt: "2026-06-20T00:00:00.000Z",
          result: { kind: "text", text: "生成的文案", format: "markdown" }
        };
      }
    };
    const service = new InMemoryGenerationService({
      clock: { now: () => fixedNow },
      idGenerator: () => "generation_task_000001",
      modelCatalog: new ConfigModelCatalog(createModelConfig()),
      providerAdapter
    });

    const task = await service.createTask(
      {
        mode: "text",
        prompt: "帮我写一个新品发布文案",
        optimizedPrompt: "请生成一段新品推广文案。",
        preset: {
          modelId: "gw-text-balanced",
          parameters: { outputFormat: "markdown", tone: "clear" },
          creditEstimate: { credits: 1, unit: "credit" }
        }
      },
      "user-a"
    );

    expect(task.status).toBe("succeeded");
    expect(task.result).toEqual({ kind: "text", text: "生成的文案", format: "markdown" });
    expect((await service.listTasks("user-a"))[0]!.result).toEqual({
      kind: "text",
      text: "生成的文案",
      format: "markdown"
    });
  });
  ```
  (The existing tests inject `FakeProviderAdapter`, which returns `queued` with no result — their `toEqual` assertions on the task object stay correct because no `result` key is added when the provider returns none.)

- [ ] **Step 3: Swap the default adapter** — in `apps/api/src/server.ts`:
  - Change the import: replace `import { FakeProviderAdapter, type ProviderAdapter } from "./services/gatewayClient";` with `import { type ProviderAdapter } from "./services/gatewayClient";` and add `import { OpenAiCompatibleTextProvider } from "./services/openAiTextProvider";`.
  - Change the default: `const providerAdapter = options.providerAdapter ?? new OpenAiCompatibleTextProvider();`.
  In `apps/api/src/services/appServices.ts`:
  - Add `import { OpenAiCompatibleTextProvider } from "./openAiTextProvider";`.
  - In `createDbServices`, pass the adapter to the generation service:
    ```ts
    const generationService = new GenerationServiceImpl(new DrizzleGenerationTaskRepository(db), {
      modelCatalog,
      idGenerator: () => `generation_task_${randomUUID()}`,
      providerAdapter: new OpenAiCompatibleTextProvider()
    });
    ```
  (Both default to the real adapter, which falls back to `queued` without a key — existing key-less tests stay green.)

- [ ] **Step 4: Add the wired e2e test** — in `apps/api/src/__tests__/server.test.ts`, add the imports `import { OpenAiCompatibleTextProvider } from "../services/openAiTextProvider";`, `import { ConfigModelCatalog } from "../services/modelCatalog";`, and `import type { ModelCatalogConfig } from "../services/modelConfig";` at the top. The e2e injects a model catalog so the keyed adapter's env reliably matches the provider's `apiKeyEnv` (instead of depending on the real `config/models.json`). Add inside `describe("product API", ...)`:
  ```ts
  it("returns a succeeded text task with a result when a provider key is configured", async () => {
    const modelConfig: ModelCatalogConfig = {
      providers: [
        {
          id: "openai-main",
          displayName: "OpenAI Main",
          protocol: "openai-compatible",
          baseUrl: "https://api.openai.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
          models: [
            {
              id: "gw-text-balanced",
              providerModelId: "gpt-4.1-mini",
              displayName: "OmniAI Text Balanced",
              capability: "text",
              tags: ["recommended", "balanced"],
              visibility: "visible",
              minimumPlan: "free",
              creditUnitCost: 1
            }
          ]
        }
      ]
    };
    const fetchMock = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "真实生成文案" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    const server = buildServer({
      modelCatalog: new ConfigModelCatalog(modelConfig),
      providerAdapter: new OpenAiCompatibleTextProvider({
        fetch: fetchMock as unknown as typeof fetch,
        env: { OPENAI_API_KEY: "sk-test" }
      })
    });
    const token = await authenticate(server);

    const response = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
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

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      task: { status: "succeeded", result: { kind: "text", text: "真实生成文案" } }
    });
  });
  ```
  (`authenticate(server)` was added to `server.test.ts` in the per-user-isolation slice; reuse it. `buildServer` here uses its default in-memory services + default auth, with the keyed adapter injected.)

- [ ] **Step 5: Run the affected tests**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/generationService.test.ts src/__tests__/server.test.ts`
  Expected: PASS (succeeded+result service test; e2e keyed→succeeded+result; existing queued tests unaffected).

- [ ] **Step 6: Full api check + commit**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green (server e2e/dbPersistence without a key still get `queued`).
  ```bash
  git add apps/api/src/services/generationService.ts apps/api/src/services/__tests__/generationService.test.ts \
    apps/api/src/server.ts apps/api/src/services/appServices.ts apps/api/src/__tests__/server.test.ts
  git commit -m "feat(api): real text generation wired through the service

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 5: Desktop renders the generated text

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `GenerationTask.result` (Task 1) flowing through the existing `apiClient.listGenerations` (no client change needed — it passes `GenerationTask` through).

- [ ] **Step 1: Render `result.text` in the task center** — in `apps/desktop/src/App.tsx`, inside the task-center `<article>` for each task (where it already renders `getGenerationStatusLabel(task.status)`, `summarizeGenerationPrompt(task)`, and `task.preset.modelId`), add a result paragraph after the existing `<p>` elements:
  ```tsx
  {task.result?.kind === "text" ? <p>{task.result.text}</p> : null}
  ```

- [ ] **Step 2: Add the result-render test** — in `apps/desktop/src/__tests__/App.test.tsx`, extend the stateful fake client so `createGeneration` returns a task carrying a text `result`, and assert the task center shows the text. In `createFakeClient`, change the `createGeneration` stub to attach a result:
  ```ts
  createGeneration: async (request) => {
    const task: GenerationTask = {
      id: `task-${tasks.length + 1}`,
      mode: request.mode,
      status: "succeeded",
      prompt: request.prompt,
      optimizedPrompt: request.optimizedPrompt,
      preset: request.preset,
      resultPreview: { title: "文本生成任务", description: "已生成。" },
      result: { kind: "text", text: "真实生成文案", format: "markdown" },
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    };
    tasks = [task, ...tasks];
    return task;
  },
  ```
  Add a test (after the existing "optimizes then submits a generation" test):
  ```ts
  it("shows the generated text in the task center", async () => {
    const client = createFakeClient();
    await signIn(client);

    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByLabelText("提示词优化结果");
    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

    const taskCenter = screen.getByLabelText("任务中心");
    await within(taskCenter).findByText("真实生成文案");
    expect(within(taskCenter).getByText("已完成")).toBeTruthy();
  });
  ```
  (`已完成` is the `succeeded` status label from `getGenerationStatusLabel`. Keep the existing "optimizes then submits" test working — if it asserted `排队中`, update it to the new `succeeded`/`已完成` since the fake now returns `succeeded`; do not weaken other assertions.)

- [ ] **Step 3: Run the desktop suite**

  Run: `pnpm --filter @gw-link-omniai/desktop test` then `pnpm --filter @gw-link-omniai/desktop typecheck`
  Expected: PASS (result render test green; other desktop tests green — adjust the prior submit test's status label to `已完成` if needed).

- [ ] **Step 4: Commit**
  ```bash
  git add apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
  git commit -m "feat(desktop): show generated text in the task center

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 6: Documentation + final verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update `.env.example`** — append:
  ```bash

  # Provider API keys (referenced by config/models.json `apiKeyEnv`). When set,
  # text generation calls the real OpenAI-compatible provider synchronously;
  # when unset, text generation falls back to a queued placeholder (no real call).
  # OPENAI_API_KEY=sk-...
  ```

- [ ] **Step 2: Update `README.md`** — add after the "Desktop ↔ API" section, before `## Validation`:
  ~~~markdown
  ### Real Text Generation

  The eighth product-first slice makes text generation real.

  - Configure a provider API key (the env var named by `config/models.json`'s
    `apiKeyEnv`, e.g. `OPENAI_API_KEY`). With a key, `POST /v1/generations` for a
    text model calls the OpenAI-compatible provider synchronously and returns a
    `succeeded` task carrying `result: { kind: "text", text, format }`.
  - Without a key, text generation falls back to today's `queued` placeholder
    (no real call). Image and video remain placeholder/`queued`.
  - Generation is synchronous (no queue/worker); provider errors return `502`
    without persisting a task. The API key is never exposed by `/v1/models` or
    returned to clients.
  - The desktop task center shows the generated text when present.
  ~~~

- [ ] **Step 3: Update `CLAUDE.md`** — under "## The product boundary (most important constraint)", append a bullet:
  ```markdown
  - **Real text provider**: `OpenAiCompatibleTextProvider` (`src/services/openAiTextProvider.ts`) is the default provider adapter. For text + openai-compatible models with the provider's `apiKeyEnv` set, it calls `chat/completions` synchronously and returns `status: "succeeded"` with a `GenerationTask.result` (text); otherwise (no key / non-text / non-openai) it falls back to `status: "queued"` with no result. The API key is read from env, used only in the request header, and never exposed via `/v1/models` or responses. `GenerationTask.result?` is the (optional, additive) contract field carrying generated content. `FakeProviderAdapter` remains for deterministic `queued` tests.
  ```

- [ ] **Step 4: Update `docs/architecture/mvp-skeleton.md`** — append:
  ```markdown
  ## Real Text Provider Slice

  The real text provider slice makes text generation produce actual content. The
  default provider adapter (`OpenAiCompatibleTextProvider`) calls an OpenAI-
  compatible `chat/completions` endpoint synchronously when a text model's
  `apiKeyEnv` is configured, returning a `succeeded` task with an optional
  `GenerationTask.result` (text). Without a key, or for image/video, it falls
  back to the prior `queued` placeholder, so existing behavior and tests are
  unchanged. Provider keys stay in env and are never exposed across the product
  boundary; provider failures return 502 without persisting a task.

  Generation is synchronous here — async queues/workers, streaming, image/video
  providers, the anthropic-compatible path, credit deduction, and saving a
  succeeded task as an asset remain later slices.
  ```

- [ ] **Step 5: Full workspace verification**

  Run from the repo root: `pnpm test` then `pnpm typecheck`. Both green.

- [ ] **Step 6: Commit**
  ```bash
  git add .env.example README.md CLAUDE.md docs/architecture/mvp-skeleton.md
  git commit -m "docs: document the real text provider slice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Final Verification (after all tasks)

- [ ] `pnpm test` passes (root `node:test` workspace check + every package's vitest, including the new adapter tests, the result round-trip, the keyed e2e, and the desktop result render).
- [ ] `pnpm typecheck` passes across all packages.
- [ ] `git grep -n "apiKeyEnv\|Bearer \${" apps/api/src/routes` shows no key handling leaked into routes; `/v1/models` still returns product fields only.
- [ ] Only `packages/shared` change is the additive optional `result` (+ export); `GenerationTaskRequest` and response envelopes unchanged.
- [ ] Manual check (not automated): set `OPENAI_API_KEY`, `pnpm dev:api` + `pnpm dev:desktop`, log in, submit a text generation, and see the real generated text in the task center.
