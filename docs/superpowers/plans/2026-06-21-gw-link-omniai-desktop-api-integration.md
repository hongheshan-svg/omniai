# GW-LINK OmniAI Desktop ↔ API Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the desktop app to the real product API — passwordless login → bearer session, prompt optimization, generation submit/list, and read-only per-user asset list — and add CORS to the API so the desktop webview can call it.

**Architecture:** Add a framework-free, fetch-injectable typed API client (`apps/desktop/src/apiClient.ts`) covering the product endpoints. Rewrite `App.tsx` to take an injected client, hold session/token/list state in React, and drive login + optimize + submit + list flows. Register `@fastify/cors` in the API. Remove the now-dead local fixture/constructor functions. Token lives in React memory only.

**Tech Stack:** TypeScript (strict, ESM), React 18, Vite, Vitest, @testing-library/react + jsdom (desktop); Fastify + @fastify/cors (api); pnpm workspaces, Node 20.

**Spec:** `docs/superpowers/specs/2026-06-21-gw-link-omniai-desktop-api-integration-design.md` (approved).

## Global Constraints (apply to every task)

1. **Contracts frozen:** Do not edit `packages/shared`. Route paths and response shapes unchanged. The desktop client only consumes the existing API.
2. **Asset creation via API is OUT OF SCOPE** (API requires `source.taskStatus === "succeeded"`; tasks are always `queued`). The asset library is read-only this slice; the "保存到资产库" button and local asset construction are removed.
3. **Token is in-memory only** (React state). No localStorage/secure store. Re-login after restart is expected.
4. **HTTP via injectable `fetch`.** The client takes `{ baseUrl?, fetch? }`; tests inject a fake `fetch`. Base URL defaults to `VITE_API_BASE_URL` then `http://localhost:8787`.
5. **CORS must not force env-config load:** register cors with `options.config?.corsOrigins ?? true` (reading `options.config` directly), NOT `getConfig()` — otherwise the existing `server.test.ts` "does not load environment config when an auth service is injected" test breaks.
6. **Each task ends green:** run the touched package's `test` + `typecheck` before committing; commit per task. Final task runs root `pnpm test` + `pnpm typecheck`.
7. **Injectable side effects:** no inline `Date.now()`/random in new logic beyond existing default generators.

## File Structure

- Modify: `apps/api/package.json` — add `@fastify/cors`.
- Modify: `apps/api/src/config.ts` — add `corsOrigins?: string[]` from `GW_LINK_CORS_ORIGINS`.
- Modify: `apps/api/src/__tests__/config.test.ts` — corsOrigins cases.
- Modify: `apps/api/src/server.ts` — register `@fastify/cors`.
- Modify: `apps/api/src/__tests__/server.test.ts` — CORS header assertion.
- Create: `apps/desktop/src/apiClient.ts` — typed fetch client + `ApiError`.
- Create: `apps/desktop/src/__tests__/apiClient.test.ts` — client unit tests (fake fetch).
- Modify: `apps/desktop/src/App.tsx` — inject client; login + optimize + submit + list; read-only assets.
- Modify: `apps/desktop/src/__tests__/App.test.tsx` — rewrite with a fake client.
- Modify: `apps/desktop/src/generationModel.ts` — remove `createLocalGenerationTask` (+ its private helpers); keep display helpers.
- Modify: `apps/desktop/src/__tests__/generationModel.test.ts` — drop the removed function's tests.
- Modify: `apps/desktop/src/assetModel.ts` — remove `createLocalCreationAsset` (+ its private helpers); keep display helpers.
- Modify: `apps/desktop/src/__tests__/assetModel.test.ts` — drop the removed function's tests.
- Modify: `apps/desktop/src/studioModel.ts` — remove `getFixtureOptimization` (+ fixtures); keep shell helpers.
- Modify: `apps/desktop/src/__tests__/studioModel.test.ts` — drop the removed function's tests.
- Modify: `.env.example`, `README.md`, `CLAUDE.md`, `docs/architecture/mvp-skeleton.md` — docs.

---

## Task 1: API CORS support

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/__tests__/config.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/server.test.ts`

**Interfaces:**
- Produces: `ApiConfig.corsOrigins?: string[]`; `buildServer` registers CORS reflecting the request origin by default (or restricting to `config.corsOrigins`).

- [ ] **Step 1: Install @fastify/cors**

  Run: `pnpm --filter @gw-link-omniai/api add @fastify/cors`
  (Let the lockfile resolve the version compatible with Fastify ^4.26.)

- [ ] **Step 2: Add the failing config test** — in `apps/api/src/__tests__/config.test.ts`, add:
  ```ts
  it("parses comma-separated CORS origins", () => {
    expect(
      loadConfig({ GW_LINK_CORS_ORIGINS: "http://localhost:1420, tauri://localhost" }).corsOrigins
    ).toEqual(["http://localhost:1420", "tauri://localhost"]);
  });

  it("omits CORS origins when not provided", () => {
    expect(loadConfig({}).corsOrigins).toBeUndefined();
  });
  ```

- [ ] **Step 3: Run the config test to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/config.test.ts`
  Expected: FAIL (`corsOrigins` does not exist).

- [ ] **Step 4: Implement config parsing** — in `apps/api/src/config.ts`:
  - Add `corsOrigins?: string[];` to `ApiConfig` (after `databaseUrl?`).
  - Add the parser:
    ```ts
    function parseCorsOrigins(value: string | undefined): string[] | undefined {
      if (value === undefined) {
        return undefined;
      }

      const origins = value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);

      return origins.length > 0 ? origins : undefined;
    }
    ```
  - In `loadConfig`'s returned object add: `corsOrigins: parseCorsOrigins(env.GW_LINK_CORS_ORIGINS)`.

- [ ] **Step 5: Run the config test to verify it passes**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/config.test.ts`
  Expected: PASS (existing `toEqual` cases still pass — `corsOrigins: undefined` is ignored by `toEqual`).

- [ ] **Step 6: Add the failing CORS server test** — in `apps/api/src/__tests__/server.test.ts`, add inside `describe("product API", ...)`:
  ```ts
  it("reflects the request origin via CORS headers", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/v1/models",
      headers: { origin: "http://localhost:1420" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:1420");
  });
  ```

- [ ] **Step 7: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/server.test.ts -t "reflects the request origin"`
  Expected: FAIL (no CORS header).

- [ ] **Step 8: Register CORS in buildServer** — in `apps/api/src/server.ts`:
  - Add import at top: `import cors from "@fastify/cors";`
  - Immediately after `const server = Fastify({ logger: false });` (before the route registrations), add:
    ```ts
    server.register(cors, {
      origin: options.config?.corsOrigins ?? true
    });
    ```
  (Reading `options.config?.corsOrigins` directly — NOT `getConfig()` — preserves the "does not load environment config when an auth service is injected" test. `origin: true` reflects the request origin in development; production sets `GW_LINK_CORS_ORIGINS`.)

- [ ] **Step 9: Run the API suite + typecheck**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`
  Expected: PASS — the new CORS test passes; all existing API tests (incl. the env-config-injection test) stay green.

- [ ] **Step 10: Commit**
  ```bash
  git add apps/api/package.json apps/api/src/config.ts apps/api/src/__tests__/config.test.ts \
    apps/api/src/server.ts apps/api/src/__tests__/server.test.ts pnpm-lock.yaml
  git commit -m "feat(api): enable CORS for cross-origin desktop clients

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2: Desktop API client

**Files:**
- Create: `apps/desktop/src/apiClient.ts`
- Test: `apps/desktop/src/__tests__/apiClient.test.ts`

**Interfaces:**
- Produces:
  - `class ApiError extends Error { readonly status: number }`
  - `interface ApiClient` with `startLogin`, `verifyLogin`, `logout`, `optimizePrompt`, `createGeneration(req, token)`, `listGenerations(token)`, `listAssets(token)` (signatures in the spec §5.1).
  - `function createApiClient(options?: { baseUrl?: string; fetch?: typeof fetch }): ApiClient`

- [ ] **Step 1: Write the failing client tests** — `apps/desktop/src/__tests__/apiClient.test.ts`:
  ```ts
  import { describe, expect, it, vi } from "vitest";
  import type { GenerationTask } from "@gw-link-omniai/shared";
  import { ApiError, createApiClient } from "../apiClient";

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    });
  }

  const baseUrl = "http://api.test";

  it("posts start-login and returns the response body", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        challengeId: "c1",
        channel: "email",
        maskedDestination: "c***@example.com",
        expiresAt: "2026-06-21T00:05:00.000Z",
        devCode: "123456"
      })
    );
    const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

    const result = await client.startLogin({ destination: "creator@example.com" });

    expect(result.challengeId).toBe("c1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/v1/auth/start-login");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({ destination: "creator@example.com" });
    expect((init!.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("unwraps the generation task envelope and sends the bearer token", async () => {
    const task: GenerationTask = {
      id: "t1",
      mode: "text",
      status: "queued",
      prompt: "p",
      optimizedPrompt: "op",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
      resultPreview: { title: "T", description: "D" },
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    };
    const fetchMock = vi.fn(async () => jsonResponse({ task }));
    const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

    const created = await client.createGeneration(
      { mode: "text", prompt: "p", optimizedPrompt: "op", preset: task.preset },
      "tok-1"
    );

    expect(created).toEqual(task);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/v1/generations");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });

  it("unwraps the tasks list with the bearer token", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ tasks: [] }));
    const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

    const tasks = await client.listGenerations("tok-1");

    expect(tasks).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/v1/generations");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });

  it("unwraps the prompt optimization envelope", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ optimization: { id: "o1", mode: "text", originalPrompt: "p", optimizedPrompt: "op", sections: [], preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } }, createdAt: "2026-06-21T00:00:00.000Z" } })
    );
    const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

    const optimization = await client.optimizePrompt({ mode: "text", prompt: "p" });

    expect(optimization.optimizedPrompt).toBe("op");
  });

  it("throws ApiError with the API error message and status on non-2xx", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "Authentication required" }, 401));
    const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

    await expect(client.listGenerations("bad")).rejects.toMatchObject({
      name: "ApiError",
      message: "Authentication required",
      status: 401
    });
    await expect(client.listGenerations("bad")).rejects.toBeInstanceOf(ApiError);
  });
  ```

- [ ] **Step 2: Run the client tests to verify they fail**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/apiClient.test.ts`
  Expected: FAIL (`../apiClient` not found).

- [ ] **Step 3: Implement the client** — `apps/desktop/src/apiClient.ts`:
  ```ts
  import type {
    AuthSession,
    CreationAsset,
    GenerationTask,
    GenerationTaskRequest,
    LoginStartRequest,
    LoginStartResponse,
    LoginVerifyRequest,
    PromptOptimization,
    PromptOptimizationRequest
  } from "@gw-link-omniai/shared";

  export class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number
    ) {
      super(message);
      this.name = "ApiError";
    }
  }

  export interface ApiClientOptions {
    baseUrl?: string;
    fetch?: typeof fetch;
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

  const DEFAULT_BASE_URL = "http://localhost:8787";

  function resolveBaseUrl(explicit?: string): string {
    if (explicit) {
      return explicit;
    }
    const env = (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env;
    return env?.VITE_API_BASE_URL ?? DEFAULT_BASE_URL;
  }

  export function createApiClient(options: ApiClientOptions = {}): ApiClient {
    const baseUrl = resolveBaseUrl(options.baseUrl).replace(/\/$/, "");
    const fetchImpl = options.fetch ?? globalThis.fetch;

    async function send<T>(
      path: string,
      init: { method?: string; body?: unknown; token?: string } = {}
    ): Promise<T> {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (init.token) {
        headers.authorization = `Bearer ${init.token}`;
      }

      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) })
      });

      if (!response.ok) {
        let message = response.statusText || `Request failed with status ${response.status}`;
        try {
          const errorBody = (await response.json()) as { error?: unknown };
          if (errorBody && typeof errorBody.error === "string") {
            message = errorBody.error;
          }
        } catch {
          // non-JSON body; keep the status-derived message
        }
        throw new ApiError(message, response.status);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    }

    return {
      startLogin(request) {
        return send<LoginStartResponse>("/v1/auth/start-login", { method: "POST", body: request });
      },
      verifyLogin(request) {
        return send<AuthSession>("/v1/auth/verify-login", { method: "POST", body: request });
      },
      async logout(token) {
        await send<{ ok: boolean }>("/v1/auth/logout", { method: "POST", token });
      },
      async optimizePrompt(request) {
        const { optimization } = await send<{ optimization: PromptOptimization }>(
          "/v1/prompt/optimize",
          { method: "POST", body: request }
        );
        return optimization;
      },
      async createGeneration(request, token) {
        const { task } = await send<{ task: GenerationTask }>("/v1/generations", {
          method: "POST",
          body: request,
          token
        });
        return task;
      },
      async listGenerations(token) {
        const { tasks } = await send<{ tasks: GenerationTask[] }>("/v1/generations", { token });
        return tasks;
      },
      async listAssets(token) {
        const { assets } = await send<{ assets: CreationAsset[] }>("/v1/assets", { token });
        return assets;
      }
    };
  }
  ```

- [ ] **Step 4: Run the client tests to verify they pass**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/apiClient.test.ts`
  Expected: PASS (5/5).

- [ ] **Step 5: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/desktop typecheck` (green).
  ```bash
  git add apps/desktop/src/apiClient.ts apps/desktop/src/__tests__/apiClient.test.ts
  git commit -m "feat(desktop): add typed API client

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3: Rewrite App to use the API client (login + optimize + submit + lists)

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `createApiClient`, `ApiClient`, `ApiError` (Task 2); existing display helpers from `generationModel`/`assetModel`/`studioModel`/`sessionModel`.
- Produces: `App({ client }?: { client?: ApiClient })` default-injects `createApiClient()`.

- [ ] **Step 1: Replace `App.tsx` entirely** with the API-driven implementation:
  ```tsx
  import { useMemo, useState } from "react";
  import type {
    CreationAsset,
    CreationMode,
    GenerationTask,
    PromptOptimization,
    SessionResponse
  } from "@gw-link-omniai/shared";
  import { ApiError, createApiClient, type ApiClient } from "./apiClient";
  import { filterCreationAssets, getAssetFilterLabel, summarizeAssetPrompt, type AssetFilter } from "./assetModel";
  import { getGenerationStatusLabel, summarizeGenerationPrompt } from "./generationModel";
  import { getDesktopSessionCta } from "./sessionModel";
  import { getStudioModeContent, getStudioModes, getStudioTemplates } from "./studioModel";

  const anonymousSession: SessionResponse = { authenticated: false, user: null, expiresAt: null };

  function errorMessage(error: unknown): string {
    if (error instanceof ApiError) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "请求失败，请稍后再试";
  }

  export function App({ client }: { client?: ApiClient } = {}) {
    const api = useMemo(() => client ?? createApiClient(), [client]);

    const [session, setSession] = useState<SessionResponse>(anonymousSession);
    const [token, setToken] = useState<string | undefined>(undefined);

    const [destination, setDestination] = useState("");
    const [challengeId, setChallengeId] = useState<string | undefined>(undefined);
    const [devCode, setDevCode] = useState<string | undefined>(undefined);
    const [maskedDestination, setMaskedDestination] = useState<string | undefined>(undefined);
    const [code, setCode] = useState("");
    const [authError, setAuthError] = useState<string | undefined>(undefined);

    const [selectedMode, setSelectedMode] = useState<CreationMode>("text");
    const [promptText, setPromptText] = useState("");
    const [optimization, setOptimization] = useState<PromptOptimization | undefined>(undefined);
    const [tasks, setTasks] = useState<GenerationTask[]>([]);
    const [assets, setAssets] = useState<CreationAsset[]>([]);
    const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
    const [actionError, setActionError] = useState<string | undefined>(undefined);

    const studioModes = useMemo(() => getStudioModes(), []);
    const content = useMemo(() => getStudioModeContent(selectedMode), [selectedMode]);
    const templates = useMemo(() => getStudioTemplates(selectedMode), [selectedMode]);
    const assetFilters: AssetFilter[] = ["all", "text", "image", "video"];
    const filteredAssets = useMemo(() => filterCreationAssets(assets, assetFilter), [assets, assetFilter]);
    const promptInputId = `${selectedMode}-studio-prompt`;

    function handleSignedOut(message?: string) {
      setToken(undefined);
      setSession(anonymousSession);
      setTasks([]);
      setAssets([]);
      setOptimization(undefined);
      if (message) {
        setAuthError(message);
      }
    }

    async function handleStartLogin() {
      setAuthError(undefined);
      try {
        const challenge = await api.startLogin({ destination });
        setChallengeId(challenge.challengeId);
        setMaskedDestination(challenge.maskedDestination);
        setDevCode(challenge.devCode);
      } catch (error) {
        setAuthError(errorMessage(error));
      }
    }

    async function handleVerifyLogin() {
      if (!challengeId) {
        return;
      }
      setAuthError(undefined);
      try {
        const authSession = await api.verifyLogin({ challengeId, code });
        setToken(authSession.token);
        setSession({ authenticated: true, user: authSession.user, expiresAt: authSession.expiresAt });
        setChallengeId(undefined);
        setDevCode(undefined);
        setCode("");
        const [loadedTasks, loadedAssets] = await Promise.all([
          api.listGenerations(authSession.token),
          api.listAssets(authSession.token)
        ]);
        setTasks(loadedTasks);
        setAssets(loadedAssets);
      } catch (error) {
        setAuthError(errorMessage(error));
      }
    }

    async function handleLogout() {
      if (token) {
        try {
          await api.logout(token);
        } catch {
          // best-effort; clear local state regardless
        }
      }
      handleSignedOut();
    }

    async function handleOptimize() {
      setActionError(undefined);
      try {
        setOptimization(await api.optimizePrompt({ mode: selectedMode, prompt: promptText }));
      } catch (error) {
        setActionError(errorMessage(error));
      }
    }

    async function handleSubmitGeneration() {
      if (!optimization || !token) {
        return;
      }
      setActionError(undefined);
      try {
        await api.createGeneration(
          {
            mode: optimization.mode,
            prompt: optimization.originalPrompt,
            optimizedPrompt: optimization.optimizedPrompt,
            preset: optimization.preset
          },
          token
        );
        setTasks(await api.listGenerations(token));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          handleSignedOut("登录已失效，请重新登录");
          return;
        }
        setActionError(errorMessage(error));
      }
    }

    if (!session.authenticated) {
      return (
        <main>
          <header>
            <h1>GW-LINK OmniAI</h1>
            <button type="button">{getDesktopSessionCta(session)}</button>
          </header>

          <section aria-label="登录">
            <h2>登录</h2>
            <div>
              <label htmlFor="login-destination">登录邮箱或手机号</label>
              <input
                id="login-destination"
                name="destination"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              />
              <button type="button" onClick={handleStartLogin}>
                发送验证码
              </button>
            </div>

            {challengeId ? (
              <div>
                <p>验证码已发送至 {maskedDestination}</p>
                {devCode ? <p>开发验证码：{devCode}</p> : null}
                <label htmlFor="login-code">验证码</label>
                <input
                  id="login-code"
                  name="code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                <button type="button" onClick={handleVerifyLogin}>
                  登录
                </button>
              </div>
            ) : null}

            {authError ? <p role="alert">{authError}</p> : null}
          </section>
        </main>
      );
    }

    return (
      <main>
        <header>
          <h1>GW-LINK OmniAI</h1>
          <button type="button">{getDesktopSessionCta(session)}</button>
          <button type="button" onClick={handleLogout}>
            登出
          </button>
        </header>

        <nav aria-label="Studio modes">
          {studioModes.map((mode) => (
            <button
              key={mode.mode}
              type="button"
              aria-pressed={selectedMode === mode.mode}
              onClick={() => {
                setSelectedMode(mode.mode);
                setOptimization(undefined);
              }}
            >
              {mode.title}
            </button>
          ))}
        </nav>

        <section aria-labelledby="current-studio-mode-title">
          <h2 id="current-studio-mode-title">{content.title}</h2>
          <p>{content.description}</p>
          <div>
            <label htmlFor={promptInputId}>{content.promptLabel}</label>
            <textarea
              id={promptInputId}
              name={`${selectedMode}Prompt`}
              placeholder={content.promptPlaceholder}
              value={promptText}
              onChange={(event) => setPromptText(event.target.value)}
            />
          </div>

          <section aria-label="提示词模板">
            <h3>提示词模板</h3>
            <ul>
              {templates.map((template) => (
                <li key={template.id}>
                  <h4>{template.name}</h4>
                  <p>{template.description}</p>
                </li>
              ))}
            </ul>
          </section>

          <button type="button" onClick={handleOptimize}>
            优化提示词
          </button>
        </section>

        {optimization ? (
          <section aria-label="提示词优化结果">
            <h2>优化结果</h2>
            <p>{optimization.optimizedPrompt}</p>
            <dl>
              {optimization.sections.map((part) => (
                <div key={part.label}>
                  <dt>{part.label}</dt>
                  <dd>{part.value}</dd>
                </div>
              ))}
            </dl>
            <section aria-labelledby="preset-suggestion-title">
              <h3 id="preset-suggestion-title">推荐参数</h3>
              <p>{optimization.preset.modelId}</p>
              <p>
                预计点数：{optimization.preset.creditEstimate.credits}{" "}
                {optimization.preset.creditEstimate.credits === 1 ? "credit" : "credits"}
              </p>
            </section>
            <button type="button" onClick={handleSubmitGeneration}>
              提交生成
            </button>
          </section>
        ) : null}

        {actionError ? <p role="alert">{actionError}</p> : null}

        <section aria-label="任务中心">
          <h2>任务中心</h2>
          {tasks.length === 0 ? (
            <p>暂无生成任务</p>
          ) : (
            <ol>
              {tasks.map((task) => {
                const taskMode = getStudioModeContent(task.mode);
                const taskCredits = task.preset.creditEstimate.credits;
                return (
                  <li key={task.id}>
                    <article>
                      <h3>{taskMode.title}</h3>
                      <p>{getGenerationStatusLabel(task.status)}</p>
                      <p>{summarizeGenerationPrompt(task)}</p>
                      <p>{task.preset.modelId}</p>
                      <p>
                        预计点数：{taskCredits} {taskCredits === 1 ? "credit" : "credits"}
                      </p>
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section aria-label="资产库">
          <h2>资产库</h2>
          <nav aria-label="资产过滤">
            {assetFilters.map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={assetFilter === filter}
                onClick={() => setAssetFilter(filter)}
              >
                {getAssetFilterLabel(filter)}
              </button>
            ))}
          </nav>
          {filteredAssets.length === 0 ? (
            <p>暂无资产</p>
          ) : (
            <ol>
              {filteredAssets.map((asset) => (
                <li key={asset.id}>
                  <article>
                    <h3>{asset.title}</h3>
                    <p>{asset.preview.description}</p>
                    <p>{summarizeAssetPrompt(asset)}</p>
                    <p>{asset.preset.modelId}</p>
                  </article>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    );
  }
  ```

- [ ] **Step 2: Replace `App.test.tsx` entirely** with API-driven tests using a fake client:
  ```tsx
  import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
  import { afterEach, describe, expect, it } from "vitest";
  import type {
    AuthSession,
    CreationAsset,
    GenerationTask,
    LoginStartResponse,
    PromptOptimization
  } from "@gw-link-omniai/shared";
  import { App } from "../App";
  import type { ApiClient } from "../apiClient";
  import { getDesktopSessionCta } from "../sessionModel";

  afterEach(cleanup);

  const textOptimization: PromptOptimization = {
    id: "o1",
    mode: "text",
    originalPrompt: "帮我写一个咖啡店新品发布文案",
    optimizedPrompt: "请生成一段新品推广文案。",
    sections: [{ label: "写作目标", value: "发布新品" }],
    preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
    createdAt: "2026-06-21T00:00:00.000Z"
  };

  const authSession: AuthSession = {
    token: "tok-1",
    user: {
      id: "user_email_creator",
      displayName: "creator",
      destination: "creator@example.com",
      channel: "email",
      plan: "free",
      createdAt: "2026-06-21T00:00:00.000Z"
    },
    expiresAt: "2026-06-28T00:00:00.000Z"
  };

  function createFakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
    let tasks: GenerationTask[] = [];
    const base: ApiClient = {
      startLogin: async (): Promise<LoginStartResponse> => ({
        challengeId: "c1",
        channel: "email",
        maskedDestination: "c***@example.com",
        expiresAt: "2026-06-21T00:05:00.000Z",
        devCode: "123456"
      }),
      verifyLogin: async () => authSession,
      logout: async () => undefined,
      optimizePrompt: async () => textOptimization,
      createGeneration: async (request) => {
        const task: GenerationTask = {
          id: `task-${tasks.length + 1}`,
          mode: request.mode,
          status: "queued",
          prompt: request.prompt,
          optimizedPrompt: request.optimizedPrompt,
          preset: request.preset,
          resultPreview: { title: "文本生成任务", description: "任务已排队。" },
          createdAt: "2026-06-21T00:00:00.000Z",
          updatedAt: "2026-06-21T00:00:00.000Z"
        };
        tasks = [task, ...tasks];
        return task;
      },
      listGenerations: async () => tasks,
      listAssets: async (): Promise<CreationAsset[]> => []
    };
    return { ...base, ...overrides };
  }

  async function signIn(client: ApiClient) {
    render(<App client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
    await screen.findByText("开发验证码：123456");
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    await screen.findByRole("button", { name: "Signed in as creator" });
  }

  describe("Desktop App", () => {
    it("shows the sign-in entry when unauthenticated", () => {
      render(<App client={createFakeClient()} />);
      expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
      expect(screen.getByLabelText("登录邮箱或手机号")).toBeTruthy();
    });

    it("completes the passwordless login flow", async () => {
      await signIn(createFakeClient());
      expect(screen.getByRole("button", { name: "Signed in as creator" })).toBeTruthy();
      const modeNavigation = screen.getByRole("navigation", { name: "Studio modes" });
      expect(within(modeNavigation).getByRole("button", { name: "文本创作" })).toBeTruthy();
    });

    it("optimizes then submits a generation into the task center", async () => {
      const client = createFakeClient();
      await signIn(client);

      fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
      await screen.findByLabelText("提示词优化结果");
      fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

      const taskCenter = screen.getByLabelText("任务中心");
      await within(taskCenter).findByText("排队中");
      expect(within(taskCenter).getByText("gw-text-balanced")).toBeTruthy();
    });

    it("lists the user's assets read-only (no save button)", async () => {
      const asset: CreationAsset = {
        id: "a1",
        mode: "text",
        title: "文本资产",
        content: { kind: "text", text: "已生成文案", format: "markdown" },
        preview: { title: "文本资产", description: "占位文本资产。" },
        source: { taskId: "t1", taskStatus: "succeeded" },
        prompt: "帮我写一个咖啡店新品发布文案",
        optimizedPrompt: "请生成一段新品推广文案。",
        preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
        createdAt: "2026-06-21T00:00:00.000Z"
      };
      const client = createFakeClient({ listAssets: async () => [asset] });
      await signIn(client);

      const assetLibrary = screen.getByLabelText("资产库");
      expect(within(assetLibrary).getByText("文本资产")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "保存到资产库" })).toBeNull();
    });

    it("surfaces a login error", async () => {
      const client = createFakeClient({
        startLogin: async () => {
          throw new Error("Login destination is required");
        }
      });
      render(<App client={client} />);
      fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
      await screen.findByRole("alert");
      expect(screen.getByRole("alert").textContent).toContain("Login destination is required");
    });

    it("summarizes authenticated desktop sessions", () => {
      expect(
        getDesktopSessionCta({ authenticated: true, expiresAt: authSession.expiresAt, user: authSession.user })
      ).toBe("Signed in as creator");
    });
  });
  ```

- [ ] **Step 3: Run the desktop App tests**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx`
  Expected: PASS. If a query/label mismatch fails, adjust the component/test to align (the component is the target; keep assertions meaningful). Note: at this point `generationModel`/`assetModel`/`studioModel` still export the soon-removed functions — that's fine; App no longer imports them.

- [ ] **Step 4: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/desktop typecheck` (green — App no longer imports `createLocalGenerationTask`/`createLocalCreationAsset`/`getFixtureOptimization`).
  ```bash
  git add apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
  git commit -m "feat(desktop): drive App from the API client with login

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4: Remove dead local fixture/constructor functions

App no longer imports these; remove them and their tests (keep all display helpers and shell helpers).

**Files:**
- Modify: `apps/desktop/src/generationModel.ts`
- Modify: `apps/desktop/src/__tests__/generationModel.test.ts`
- Modify: `apps/desktop/src/assetModel.ts`
- Modify: `apps/desktop/src/__tests__/assetModel.test.ts`
- Modify: `apps/desktop/src/studioModel.ts`
- Modify: `apps/desktop/src/__tests__/studioModel.test.ts`

- [ ] **Step 1: Trim `generationModel.ts`** — remove `createLocalGenerationTask` and the symbols used ONLY by it: `LocalGenerationTaskClock`, `LocalGenerationTaskOptions`, `resultPreviewByMode`, `clonePreset`, `createLocalGenerationTaskId`, and the now-unused imports (`GenerationTaskResultPreview`, `PresetSuggestion`, `PromptOptimization`). KEEP `statusLabels`, `getGenerationStatusLabel`, `summarizeGenerationPrompt` and their imports (`GenerationTask`, `GenerationTaskStatus`).

- [ ] **Step 2: Trim `generationModel.test.ts`** — remove the `describe`/`it` blocks that call `createLocalGenerationTask`; keep tests for `getGenerationStatusLabel` and `summarizeGenerationPrompt`. Remove the now-unused import of `createLocalGenerationTask`.

- [ ] **Step 3: Trim `assetModel.ts`** — remove `createLocalCreationAsset` and the symbols used ONLY by it: `LocalCreationAssetClock`, `LocalCreationAssetOptions`, `previews`, `createContent`, `clonePreset`, `createLocalCreationAssetId`, and now-unused imports (`CreationAssetContent`, `CreationAssetPreview`, `GenerationTask`, `PresetSuggestion`). KEEP `AssetFilter`, `filterCreationAssets`, `getAssetFilterLabel`, `getAssetModeLabel`, `summarizeAssetPrompt`, `assetModeLabels`, `assetFilterLabels` and their imports (`CreationAsset`, `CreationMode`).

- [ ] **Step 4: Trim `assetModel.test.ts`** — remove the blocks that call `createLocalCreationAsset`; keep tests for `filterCreationAssets`/`getAssetFilterLabel`/`getAssetModeLabel`/`summarizeAssetPrompt`. Remove the unused import.

- [ ] **Step 5: Trim `studioModel.ts`** — remove `getFixtureOptimization`, `fixtureOptimizations`, `cloneOptimization`, and the now-unused `PromptOptimization` import. KEEP `StudioModeContent`, `getStudioModes`, `getStudioModeContent`, `getStudioTemplates`, `cloneModeContent`, `cloneTemplate`, and imports (`CreationMode`, `PromptTemplate`).

- [ ] **Step 6: Trim `studioModel.test.ts`** — remove the blocks that call `getFixtureOptimization`; keep tests for the shell helpers. Remove the unused import.

- [ ] **Step 7: Run the desktop suite + typecheck**

  Run: `pnpm --filter @gw-link-omniai/desktop test` then `pnpm --filter @gw-link-omniai/desktop typecheck`
  Expected: PASS — no remaining references to the removed functions; App + apiClient + remaining model tests green.

- [ ] **Step 8: Commit**
  ```bash
  git add apps/desktop/src/generationModel.ts apps/desktop/src/__tests__/generationModel.test.ts \
    apps/desktop/src/assetModel.ts apps/desktop/src/__tests__/assetModel.test.ts \
    apps/desktop/src/studioModel.ts apps/desktop/src/__tests__/studioModel.test.ts
  git commit -m "refactor(desktop): remove local fixture/constructor dead code

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 5: Documentation + final verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update `.env.example`** — append:
  ```bash

  # Desktop app: base URL of the product API (default http://localhost:8787)
  VITE_API_BASE_URL=http://localhost:8787

  # API CORS allowed origins (comma-separated). Unset reflects the request origin
  # (development only). In production set explicit origins, e.g.:
  # GW_LINK_CORS_ORIGINS=https://app.example.com
  ```

- [ ] **Step 2: Update `README.md`** — add after the "Per-User Isolation" section, before `## Validation`:
  ~~~markdown
  ### Desktop ↔ API

  The seventh product-first slice connects the desktop app to the product API.

  - Start the API first (`pnpm dev:api`), then the desktop app (`pnpm dev:desktop`).
  - Desktop reads `VITE_API_BASE_URL` (default `http://localhost:8787`).
  - Passwordless login: enter an email/phone, the start-login response returns a
    `devCode` in local development, enter it to receive a bearer session (held in
    memory — re-login after restart).
  - Optimize a prompt, submit a generation, and view your own task list and asset
    library (per-user, via the guarded API).
  - Asset *creation* from the desktop is deferred: the API requires a succeeded
    source task and tasks remain queued until a later task-status/real-provider
    slice, so the asset library is read-only for now.
  - The API enables CORS (`GW_LINK_CORS_ORIGINS`, reflects the request origin when
    unset — set explicit origins in production).
  ~~~

- [ ] **Step 3: Update `CLAUDE.md`** — in the "## Frontend conventions (desktop / admin / mobile)" section, append:
  ```markdown

  Desktop now talks to the HTTP API: `apps/desktop/src/apiClient.ts` is a framework-free, fetch-injectable typed client (`createApiClient({ baseUrl?, fetch? })` → `ApiClient`; throws `ApiError`), and `App.tsx` takes an injected `client` (default `createApiClient()`), runs the passwordless login flow, and drives optimize/submit/list against the API with a bearer token held in React memory. Admin and mobile remain local/fixture-based. The API enables CORS (`@fastify/cors`, `GW_LINK_CORS_ORIGINS`).
  ```

- [ ] **Step 4: Update `docs/architecture/mvp-skeleton.md`** — append:
  ```markdown
  ## Desktop ↔ API Integration Slice

  The desktop integration slice connects the primary creation workspace to the
  product API. A framework-free, fetch-injectable API client (`apiClient.ts`)
  wraps the product endpoints; `App.tsx` takes an injected client and runs the
  passwordless login flow, then optimizes prompts, submits generations, and lists
  the user's tasks and assets through the guarded API with a bearer token held in
  React memory. The API enables CORS so the Tauri webview / Vite dev server can
  call it across origins.

  Asset creation from the desktop is intentionally deferred: the API requires a
  succeeded source task, and tasks remain queued until a later task-status /
  real-provider slice, so the asset library is read-only here. Admin and mobile
  remain local; token persistence, real providers, and streaming are later slices.
  ```

- [ ] **Step 5: Full workspace verification**

  Run from the repo root: `pnpm test` then `pnpm typecheck`. Both green.

- [ ] **Step 6: Commit**
  ```bash
  git add .env.example README.md CLAUDE.md docs/architecture/mvp-skeleton.md
  git commit -m "docs: document the desktop API integration slice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Final Verification (after all tasks)

- [ ] `pnpm test` passes (root `node:test` workspace check + every package's vitest, including desktop apiClient + App + API CORS).
- [ ] `pnpm typecheck` passes across all packages.
- [ ] No edits under `packages/shared/`; no `/v1/*` route path or response-shape change.
- [ ] `git grep -n "createLocalGenerationTask\|createLocalCreationAsset\|getFixtureOptimization" apps/desktop/src` returns nothing (dead code gone).
- [ ] `git grep -n "保存到资产库" apps/desktop/src` returns nothing (asset save removed this slice).
- [ ] Manual check (not automated): `pnpm dev:api` + `pnpm dev:desktop`, log in with the dev code, optimize, submit a generation, see it in the task center; asset library lists your assets (empty until asset creation lands).
