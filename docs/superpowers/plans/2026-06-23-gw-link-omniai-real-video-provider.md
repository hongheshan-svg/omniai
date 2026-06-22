# GW-LINK OmniAI Real Video Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make video generation real by plugging an async video provider (targeting a generic async video-job API) into the Slice-11a lifecycle as the default `video` slot.

**Architecture:** `GenerationTaskResult` gains a `video` variant (matching the asset video content). `AsyncVideoProvider` submits to `POST {baseUrl}/videos/generations` (→ `running` + job ref) and polls `GET {baseUrl}/videos/generations/{id}` (→ `running`/`succeeded`+video result/`failed`), reusing the 11a machinery (`refreshTask`, `GET /v1/generations/:id`, credit deduction on `running→succeeded`). The composite's default `video` slot becomes `AsyncVideoProvider`. The video URL is the service-hosted URL passed through directly (no object storage). The desktop renders `<video>` and saves video assets. The generation service, persistence, and credits are unchanged.

**Tech Stack:** TypeScript (strict, ESM), Fastify 4, React 18, Vitest, pnpm workspaces, Node 20.

**Spec:** `docs/superpowers/specs/2026-06-23-gw-link-omniai-real-video-provider-design.md` (approved).

## Global Constraints (apply to every task)

1. `GenerationTaskResult` video variant is exactly `{ kind: "video"; url: string; durationSeconds: number; posterUrl: string }` — identical to `CreationAssetContent`'s video variant.
2. `AsyncVideoProvider`: only for `mode === "video"` + `env[provider.apiKeyEnv]` present → submit `POST {baseUrl}/videos/generations` `{ model: providerModelId, prompt: optimizedPrompt }`; poll `GET {baseUrl}/videos/generations/{providerRef}`; map `completed`→succeeded+video result (url required, else 502), `failed`→failed, else→running. Otherwise `queued` (no request). The API key appears ONLY in the `Authorization: Bearer` header.
3. The result `url`/`posterUrl` are the service-hosted URLs passed through — no object storage.
4. No change to the generation service, `refreshTask`, persistence, credit logic (11a handles `running`→`succeeded` and charges `creditUnitCost` = 3 once), or `config/models.json` (default video stays `queued` without a configured video service key).
5. Each task ends green: `pnpm --filter @gw-link-omniai/<pkg> test` + `... typecheck` before committing. Final task runs root `pnpm test` + `pnpm typecheck`.

## File Structure

- Modify: `packages/shared/src/models.ts` — video result variant (Task 1).
- Create: `apps/api/src/services/asyncVideoProvider.ts` (+ test) (Task 1).
- Modify: `apps/api/src/server.ts`, `apps/api/src/services/appServices.ts` — default video slot; `apps/api/src/__tests__/server.test.ts` — e2e (Task 2).
- Modify: `apps/desktop/src/assetModel.ts`, `apps/desktop/src/App.tsx` (+ tests) — render/save video (Task 3).
- Modify: `README.md`, `docs/architecture/mvp-skeleton.md`, `.env.example` (Task 4).

---

## Task 1: Video result variant + AsyncVideoProvider

**Files:**
- Modify: `packages/shared/src/models.ts`
- Create: `apps/api/src/services/asyncVideoProvider.ts`
- Test: `apps/api/src/services/__tests__/asyncVideoProvider.test.ts`

**Interfaces:**
- Produces: `GenerationTaskResult` video variant; `AsyncVideoProvider` (implements `ProviderAdapter` with `submitGeneration` + `pollGeneration`).

- [ ] **Step 1: Extend the contract** — in `packages/shared/src/models.ts`, change `GenerationTaskResult` to:
  ```ts
  export type GenerationTaskResult =
    | { kind: "text"; text: string; format: "markdown" | "plain" }
    | { kind: "image"; url: string; alt: string }
    | { kind: "video"; url: string; durationSeconds: number; posterUrl: string };
  ```
  Run `pnpm --filter @gw-link-omniai/shared test` + `... typecheck` — green (additive).

- [ ] **Step 2: Write the failing provider tests** — create `apps/api/src/services/__tests__/asyncVideoProvider.test.ts`:
  ```ts
  import { describe, expect, it, vi } from "vitest";
  import type { ProviderGenerationRequest, ProviderPollRequest } from "../gatewayClient";
  import { AsyncVideoProvider } from "../asyncVideoProvider";

  const provider = {
    id: "video-main",
    displayName: "Video Main",
    protocol: "openai-compatible" as const,
    baseUrl: "https://api.video.test/v1",
    apiKeyEnv: "VIDEO_KEY"
  };

  function submitReq(overrides: Partial<ProviderGenerationRequest> = {}): ProviderGenerationRequest {
    return {
      mode: "video",
      productModelId: "gw-video-motion",
      provider,
      providerModelId: "video-1",
      optimizedPrompt: "一段海边日落短视频",
      parameters: {},
      userId: "user-a",
      ...overrides
    };
  }

  function pollReq(providerRef: string): ProviderPollRequest {
    return { mode: "video", provider, providerModelId: "video-1", providerRef };
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  describe("AsyncVideoProvider", () => {
    it("submits a running job with a provider reference", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ id: "job-1" }));
      const fake = new AsyncVideoProvider({ fetch: fetchMock as unknown as typeof fetch, env: { VIDEO_KEY: "k" } });

      const result = await fake.submitGeneration(submitReq());

      expect(result.status).toBe("running");
      expect(result.providerRef).toBe("job-1");
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.video.test/v1/videos/generations");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
      expect(JSON.parse(init.body as string)).toEqual({ model: "video-1", prompt: "一段海边日落短视频" });
    });

    it("polls a completed job into a video result", async () => {
      const fetchMock = vi.fn(async () =>
        jsonResponse({ status: "completed", url: "https://cdn/v.mp4", poster_url: "https://cdn/p.jpg", duration_seconds: 8 })
      );
      const fake = new AsyncVideoProvider({ fetch: fetchMock as unknown as typeof fetch, env: { VIDEO_KEY: "k" } });

      const result = await fake.pollGeneration(pollReq("job-1"));

      expect(result.status).toBe("succeeded");
      expect(result.result).toEqual({
        kind: "video",
        url: "https://cdn/v.mp4",
        durationSeconds: 8,
        posterUrl: "https://cdn/p.jpg"
      });
      const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.video.test/v1/videos/generations/job-1");
    });

    it("defaults missing poster and duration", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ status: "completed", url: "https://cdn/v.mp4" }));
      const fake = new AsyncVideoProvider({ fetch: fetchMock as unknown as typeof fetch, env: { VIDEO_KEY: "k" } });

      const result = await fake.pollGeneration(pollReq("job-1"));

      expect(result.result).toEqual({ kind: "video", url: "https://cdn/v.mp4", durationSeconds: 0, posterUrl: "" });
    });

    it("maps in_progress to running and failed to failed", async () => {
      const running = new AsyncVideoProvider({
        fetch: (async () => jsonResponse({ status: "in_progress" })) as unknown as typeof fetch,
        env: { VIDEO_KEY: "k" }
      });
      expect((await running.pollGeneration(pollReq("job-1"))).status).toBe("running");

      const failed = new AsyncVideoProvider({
        fetch: (async () => jsonResponse({ status: "failed" })) as unknown as typeof fetch,
        env: { VIDEO_KEY: "k" }
      });
      expect((await failed.pollGeneration(pollReq("job-1"))).status).toBe("failed");
    });

    it("queues without a key and makes no request", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({}));
      const fake = new AsyncVideoProvider({ fetch: fetchMock as unknown as typeof fetch, env: {} });

      const result = await fake.submitGeneration(submitReq());

      expect(result.status).toBe("queued");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("queues a non-video request", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({}));
      const fake = new AsyncVideoProvider({ fetch: fetchMock as unknown as typeof fetch, env: { VIDEO_KEY: "k" } });
      expect((await fake.submitGeneration(submitReq({ mode: "text" }))).status).toBe("queued");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("throws 502 on a provider error and on a completed job without a url", async () => {
      const errored = new AsyncVideoProvider({
        fetch: (async () => jsonResponse({ error: { message: "boom" } }, 500)) as unknown as typeof fetch,
        env: { VIDEO_KEY: "k" }
      });
      await expect(errored.submitGeneration(submitReq())).rejects.toMatchObject({ statusCode: 502 });

      const noUrl = new AsyncVideoProvider({
        fetch: (async () => jsonResponse({ status: "completed" })) as unknown as typeof fetch,
        env: { VIDEO_KEY: "k" }
      });
      await expect(noUrl.pollGeneration(pollReq("job-1"))).rejects.toMatchObject({ statusCode: 502 });
    });
  });
  ```

- [ ] **Step 3: Run them to verify they fail**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/asyncVideoProvider.test.ts`
  Expected: FAIL (module does not exist).

- [ ] **Step 4: Implement it** — create `apps/api/src/services/asyncVideoProvider.ts`:
  ```ts
  import type { GenerationTaskResult } from "@gw-link-omniai/shared";
  import {
    ProviderAdapterError,
    type ProviderAdapter,
    type ProviderGenerationRequest,
    type ProviderGenerationResult,
    type ProviderPollRequest
  } from "./gatewayClient";
  import { readProviderError } from "./openAiTextProvider";

  export interface AsyncVideoProviderOptions {
    fetch?: typeof fetch;
    env?: Record<string, string | undefined>;
    clock?: { now(): Date };
  }

  export class AsyncVideoProvider implements ProviderAdapter {
    private readonly fetchImpl: typeof fetch;
    private readonly env: Record<string, string | undefined>;
    private readonly clock: { now(): Date };

    constructor(options: AsyncVideoProviderOptions = {}) {
      this.fetchImpl = options.fetch ?? globalThis.fetch;
      this.env = options.env ?? process.env;
      this.clock = options.clock ?? { now: () => new Date() };
    }

    async submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
      const base = this.base(request.provider.id, request.provider.protocol, request.providerModelId);
      const apiKey = this.env[request.provider.apiKeyEnv];
      if (request.mode !== "video" || !apiKey) {
        return { ...base, status: "queued" };
      }

      const url = `${request.provider.baseUrl.replace(/\/$/, "")}/videos/generations`;
      const payload = await this.requestJson(url, apiKey, {
        method: "POST",
        body: JSON.stringify({ model: request.providerModelId, prompt: request.optimizedPrompt })
      });

      const id = (payload as { id?: unknown }).id;
      if (typeof id !== "string" || id.length === 0) {
        throw new ProviderAdapterError("Provider returned no job id", 502);
      }

      return { ...base, status: "running", providerRef: id };
    }

    async pollGeneration(request: ProviderPollRequest): Promise<ProviderGenerationResult> {
      const base = this.base(request.provider.id, request.provider.protocol, request.providerModelId);
      const apiKey = this.env[request.provider.apiKeyEnv];
      if (!apiKey) {
        return { ...base, status: "running" };
      }

      const url = `${request.provider.baseUrl.replace(/\/$/, "")}/videos/generations/${request.providerRef}`;
      const payload = (await this.requestJson(url, apiKey, { method: "GET" })) as {
        status?: unknown;
        url?: unknown;
        poster_url?: unknown;
        duration_seconds?: unknown;
      };

      const status = payload.status;
      if (status === "failed") {
        return { ...base, status: "failed" };
      }
      if (status === "completed" || status === "succeeded") {
        if (typeof payload.url !== "string" || payload.url.length === 0) {
          throw new ProviderAdapterError("Provider returned no video url", 502);
        }
        const result: GenerationTaskResult = {
          kind: "video",
          url: payload.url,
          durationSeconds: typeof payload.duration_seconds === "number" ? payload.duration_seconds : 0,
          posterUrl: typeof payload.poster_url === "string" ? payload.poster_url : ""
        };
        return { ...base, status: "succeeded", result };
      }
      return { ...base, status: "running" };
    }

    private base(providerId: string, providerProtocol: ProviderGenerationResult["providerProtocol"], providerModelId: string) {
      return { providerId, providerProtocol, providerModelId, submittedAt: this.clock.now().toISOString() };
    }

    private async requestJson(url: string, apiKey: string, init: { method: string; body?: string }): Promise<unknown> {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: init.method,
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          ...(init.body === undefined ? {} : { body: init.body })
        });
      } catch {
        throw new ProviderAdapterError("Provider request failed", 502);
      }

      if (!response.ok) {
        throw new ProviderAdapterError(await readProviderError(response), 502);
      }

      try {
        return await response.json();
      } catch {
        throw new ProviderAdapterError("Provider returned an invalid response", 502);
      }
    }
  }
  ```

- [ ] **Step 5: Run them to verify they pass**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/asyncVideoProvider.test.ts`
  Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green).
  ```bash
  git add packages/shared/src/models.ts apps/api/src/services/asyncVideoProvider.ts apps/api/src/services/__tests__/asyncVideoProvider.test.ts
  git commit -m "feat: add video result variant and AsyncVideoProvider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2: Wire AsyncVideoProvider as the default video slot + e2e

**Files:**
- Modify: `apps/api/src/server.ts`, `apps/api/src/services/appServices.ts`
- Test: `apps/api/src/__tests__/server.test.ts`

**Interfaces:**
- Consumes: `AsyncVideoProvider` (Task 1); 11a's `refreshTask` / `GET /v1/generations/:id`.

- [ ] **Step 1: Swap the default video slot** — replace the `video:` slot in every default composite construction with `new AsyncVideoProvider()`:
  - `apps/api/src/server.ts`: add `import { AsyncVideoProvider } from "./services/asyncVideoProvider";`. In the default `providerAdapter`, change `video: textProvider` to `video: new AsyncVideoProvider()` (keep `text: textProvider` for the text slot).
  - `apps/api/src/services/appServices.ts`: add `import { AsyncVideoProvider } from "./asyncVideoProvider";`. In `createDbServices`'s default composite, change `video: new OpenAiCompatibleTextProvider()` to `video: new AsyncVideoProvider()`. In `createServices`'s in-memory branch composite, do the same.

- [ ] **Step 2: Write the failing e2e test** — in `apps/api/src/__tests__/server.test.ts`, add the import:
  ```ts
  import { AsyncVideoProvider } from "../services/asyncVideoProvider";
  ```
  and a test inside the `describe("product API", ...)` block (signup grants 100; video cost 3):
  ```ts
  it("generates a video end-to-end via the async lifecycle", async () => {
    const modelConfig: ModelCatalogConfig = {
      providers: [
        {
          id: "video-main",
          displayName: "Video Main",
          protocol: "openai-compatible",
          baseUrl: "https://api.video.test/v1",
          apiKeyEnv: "VIDEO_KEY",
          models: [
            {
              id: "gw-video-motion",
              providerModelId: "video-1",
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
    const videoFetch = async (_url: string, init?: { method?: string }) =>
      new Response(
        JSON.stringify(
          (init?.method ?? "GET") === "POST"
            ? { id: "job-1" }
            : { status: "completed", url: "https://cdn/v.mp4", poster_url: "https://cdn/p.jpg", duration_seconds: 8 }
        ),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const textProvider = new OpenAiCompatibleTextProvider();
    const server = buildServer({
      modelCatalog: new ConfigModelCatalog(modelConfig),
      providerAdapter: new CompositeProviderAdapter({
        text: textProvider,
        image: textProvider,
        video: new AsyncVideoProvider({ fetch: videoFetch as unknown as typeof fetch, env: { VIDEO_KEY: "k" } })
      })
    });
    const token = await authenticate(server);

    const create = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: "video",
        prompt: "一段海边日落短视频",
        optimizedPrompt: "生成一段海边日落短视频。",
        preset: { modelId: "gw-video-motion", parameters: {}, creditEstimate: { credits: 3, unit: "credit" } }
      }
    });
    expect(create.json()).toMatchObject({ task: { status: "running" } });
    const id = (create.json() as { task: { id: string } }).task.id;

    const done = await server.inject({
      method: "GET",
      url: `/v1/generations/${id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(done.json()).toMatchObject({
      task: { status: "succeeded", result: { kind: "video", url: "https://cdn/v.mp4" } }
    });

    const balance = await server.inject({
      method: "GET",
      url: "/v1/credits/balance",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(balance.json()).toEqual({ balance: { credits: 97, unit: "credit" } });
  });
  ```

- [ ] **Step 3: Run the api suite + typecheck**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green (existing tests inject their own providerAdapter or have no video key, so video stays queued by default).

- [ ] **Step 4: Commit**
  ```bash
  git add apps/api/src/server.ts apps/api/src/services/appServices.ts apps/api/src/__tests__/server.test.ts
  git commit -m "feat(api): use AsyncVideoProvider as the default video provider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3: Desktop renders and saves video

**Files:**
- Modify: `apps/desktop/src/assetModel.ts`
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/src/__tests__/assetModel.test.ts`, `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: the `video` `GenerationTaskResult` variant (Task 1).

- [ ] **Step 1: Handle video in `buildAssetRequestFromTask`** — in `apps/desktop/src/assetModel.ts`, replace the `content` assignment so it covers video (it currently only branches image vs text):
  ```ts
  const content: CreationAssetRequest["content"] =
    result.kind === "image"
      ? { kind: "image", url: result.url, alt: result.alt }
      : result.kind === "video"
        ? { kind: "video", url: result.url, durationSeconds: result.durationSeconds, posterUrl: result.posterUrl }
        : { kind: "text", text: result.text, format: result.format };
  ```

- [ ] **Step 2: Add the assetModel video test** — in `apps/desktop/src/__tests__/assetModel.test.ts`, add:
  ```ts
  it("builds a video asset request from a succeeded video task", () => {
    const task: GenerationTask = {
      id: "task-vid",
      mode: "video",
      status: "succeeded",
      prompt: "一段海边日落短视频",
      optimizedPrompt: "生成一段海边日落短视频。",
      preset: { modelId: "gw-video-motion", parameters: {}, creditEstimate: { credits: 3, unit: "credit" } },
      resultPreview: { title: "视频生成任务", description: "已生成。" },
      result: { kind: "video", url: "https://cdn/v.mp4", durationSeconds: 8, posterUrl: "https://cdn/p.jpg" },
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z"
    };

    expect(buildAssetRequestFromTask(task)).toMatchObject({
      mode: "video",
      title: "视频资产",
      content: { kind: "video", url: "https://cdn/v.mp4", durationSeconds: 8, posterUrl: "https://cdn/p.jpg" },
      source: { taskId: "task-vid", taskStatus: "succeeded" }
    });
  });
  ```

- [ ] **Step 3: Render `<video>` in `App.tsx`** — add a video branch to BOTH cards:
  - Task-center `<article>`, after the image branch (`{task.result?.kind === "image" ? <img ... /> : null}`):
    ```tsx
    {task.result?.kind === "video" ? (
      <video controls src={task.result.url} poster={task.result.posterUrl} />
    ) : null}
    ```
  - Asset-library `<article>`, after the image branch (`{asset.content.kind === "image" ? <img ... /> : null}`):
    ```tsx
    {asset.content.kind === "video" ? (
      <video controls src={asset.content.url} poster={asset.content.posterUrl} />
    ) : null}
    ```

- [ ] **Step 4: Add the App video test** — in `apps/desktop/src/__tests__/App.test.tsx`, add a test (after the running-refresh test). It seeds a succeeded video task via `listGenerations`, asserts the `<video>` renders, then saves it:
  ```ts
  it("renders and saves a generated video", async () => {
    const videoTask: GenerationTask = {
      id: "task-vid",
      mode: "video",
      status: "succeeded",
      prompt: "一段海边日落短视频",
      optimizedPrompt: "生成一段海边日落短视频。",
      preset: { modelId: "gw-video-motion", parameters: {}, creditEstimate: { credits: 3, unit: "credit" } },
      resultPreview: { title: "视频生成任务", description: "已生成。" },
      result: { kind: "video", url: "https://cdn/v.mp4", durationSeconds: 8, posterUrl: "https://cdn/p.jpg" },
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z"
    };
    const client = createFakeClient({ listGenerations: async () => [videoTask] });
    await signIn(client);

    const taskCenter = screen.getByLabelText("任务中心");
    const video = taskCenter.querySelector("video");
    expect(video?.getAttribute("src")).toBe("https://cdn/v.mp4");

    fireEvent.click(within(taskCenter).getByRole("button", { name: "保存到资产库" }));

    const assetLibrary = screen.getByLabelText("资产库");
    await within(assetLibrary).findByText("视频资产");
    expect(assetLibrary.querySelector("video")?.getAttribute("src")).toBe("https://cdn/v.mp4");
  });
  ```
  (The fake `createAsset` builds a `CreationAsset` from the request, so the saved asset's `content` is the video variant; the library card renders `<video>`.)

- [ ] **Step 5: Run the desktop suite + typecheck**

  Run: `pnpm --filter @gw-link-omniai/desktop test` then `pnpm --filter @gw-link-omniai/desktop typecheck`. Both green.

- [ ] **Step 6: Commit**
  ```bash
  git add apps/desktop/src/assetModel.ts apps/desktop/src/App.tsx apps/desktop/src/__tests__/assetModel.test.ts apps/desktop/src/__tests__/App.test.tsx
  git commit -m "feat(desktop): render and save generated videos

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4: Documentation + final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`
- Modify: `.env.example`

- [ ] **Step 1: Update `.env.example`** — add after the provider-keys block:
  ```bash
  # Video generation: point the video model's provider (config/models.json) at a
  # real async video service (baseUrl + apiKeyEnv) and set its key. The provider
  # submits to {baseUrl}/videos/generations and polls until completed. Without a
  # configured key, video generation stays queued.
  ```

- [ ] **Step 2: Update `README.md`** — in the "Async Generation Lifecycle" section, add a sentence (or a short bullet) noting that video is now real:
  ```markdown
  - Video generation uses `AsyncVideoProvider` (the real async provider plugged
    into this lifecycle): with a configured video service key it submits a job and
    polls to a `result.kind === "video"` (service-hosted URL); the desktop renders
    `<video>` and saves it as an asset. Without a key, video stays `queued`.
  ```

- [ ] **Step 3: Update `docs/architecture/mvp-skeleton.md`** — append:
  ```markdown
  ## Real Video Provider Slice

  `AsyncVideoProvider` is the real async video provider (slice 11b), plugged into
  the async lifecycle as the default composite `video` slot. It submits to
  `POST {baseUrl}/videos/generations` (→ running + job ref) and polls
  `GET {baseUrl}/videos/generations/{id}` (completed → `succeeded` + a `video`
  `GenerationTaskResult` variant `{ url, durationSeconds, posterUrl }`, identical
  to the asset video content; failed → `failed`; else → running). The video URL is
  the service-hosted URL passed through (no object storage). The generation
  service, `refreshTask`, persistence, and credits are unchanged (charge
  `creditUnitCost` = 3 once on `running → succeeded`). The desktop renders
  `<video>` and saves video assets. The provider targets a generic async
  video-job shape; production points the video model's provider at a real service.
  Object storage for video bytes, a specific vendor integration, and thumbnail
  generation remain later work.
  ```

- [ ] **Step 4: Full workspace verification**

  Run from the repo root: `pnpm test` then `pnpm typecheck`. Both green.

- [ ] **Step 5: Commit**
  ```bash
  git add README.md docs/architecture/mvp-skeleton.md .env.example
  git commit -m "docs: document the real video provider slice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Final Verification (after all tasks)

- [ ] `pnpm test` + `pnpm typecheck` pass across all packages.
- [ ] `GenerationTaskResult` has a `video` variant matching the asset video content; the provider key appears only in the `Authorization` header (verified by `asyncVideoProvider.test.ts`).
- [ ] A video generation with a configured `AsyncVideoProvider` goes `running` → `succeeded` (video result) via `GET /v1/generations/:id`, charged once (balance −3); without a key it stays `queued`.
- [ ] The desktop renders `<video>` for video results and saves video assets.
- [ ] No change to the generation service / refreshTask / persistence / credit logic / `config/models.json`.
