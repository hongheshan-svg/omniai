# GW-LINK OmniAI Real Image Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image generation real end-to-end — a provider that calls the OpenAI-compatible images endpoint and returns an `image` result carried inline as a base64 data URL, displayed and saveable on the desktop.

**Architecture:** Extend `GenerationTaskResult` with an `image` variant (matching the existing image asset content). Add `OpenAiCompatibleImageProvider` (POST `/images/generations`, b64 → `data:` URL) and a `CompositeProviderAdapter` that routes `image`→image provider, else→text provider; make the composite the default adapter. The generation service / persistence / credits are unchanged (they pass the result through generically and already charge `creditUnitCost`). The desktop renders generated images and saves them as assets (reusing the text save path, since the variants match). No object storage.

**Tech Stack:** TypeScript (strict, ESM), Fastify 4, React 18, Vitest, `@electric-sql/pglite`, pnpm workspaces, Node 20.

**Spec:** `docs/superpowers/specs/2026-06-22-gw-link-omniai-real-image-provider-design.md` (approved).

## Global Constraints (apply to every task)

1. No object storage. The image result `url` is an inline `data:image/png;base64,<b64>` URL (or a passed-through provider URL).
2. `GenerationTaskResult` image variant is exactly `{ kind: "image"; url: string; alt: string }` — structurally identical to `CreationAssetContent`'s image variant.
3. Image provider: only for `mode === "image"` + provider `protocol === "openai-compatible"` + `env[apiKeyEnv]` present → POST `${baseUrl}/images/generations` `{ model: providerModelId, prompt: optimizedPrompt }`; parse `{ data: [{ b64_json?, url? }] }` (b64 → `data:image/png;base64,<b64>`; else `url`; else `ProviderAdapterError(502)`); `alt = optimizedPrompt`. Otherwise `queued` (no request). The API key appears ONLY in the `Authorization: Bearer` header — never in the result, errors, logs, or `/v1/models`.
4. Image `creditUnitCost` is 2 (from `config/models.json`); the existing credit pre-check/deduct handle it — do NOT change the generation service or credit logic.
5. Desktop save button shows for `task.status === "succeeded" && task.result != null` (text OR image).
6. Each task ends green: `pnpm --filter @gw-link-omniai/<pkg> test` + `... typecheck` (the package(s) it touches) before committing. Final task runs root `pnpm test` + `pnpm typecheck`.

## File Structure

- Modify: `packages/shared/src/models.ts` — `GenerationTaskResult` image variant (Task 1).
- Modify: `apps/api/src/services/openAiTextProvider.ts` — export `readProviderError` (Task 1).
- Create: `apps/api/src/services/openAiImageProvider.ts` (+ `__tests__/openAiImageProvider.test.ts`) (Task 1).
- Create: `apps/api/src/services/compositeProviderAdapter.ts` (+ `__tests__/compositeProviderAdapter.test.ts`) (Task 2).
- Modify: `apps/api/src/server.ts`, `apps/api/src/services/appServices.ts` — default adapter = composite (Task 2).
- Modify: `apps/api/src/__tests__/server.test.ts` — image e2e (Task 3).
- Modify: `apps/api/src/repositories/__tests__/repositoryContract.test.ts` — image result round-trip (Task 3).
- Modify: `apps/desktop/src/assetModel.ts`, `apps/desktop/src/App.tsx`, and their tests — image display + save (Task 4).
- Modify: `README.md`, `docs/architecture/mvp-skeleton.md` (Task 5).

---

## Task 1: Contract image variant + image provider

**Files:**
- Modify: `packages/shared/src/models.ts`
- Modify: `apps/api/src/services/openAiTextProvider.ts`
- Create: `apps/api/src/services/openAiImageProvider.ts`
- Test: `apps/api/src/services/__tests__/openAiImageProvider.test.ts`

**Interfaces:**
- Produces: `GenerationTaskResult` image variant `{ kind: "image"; url: string; alt: string }`; `OpenAiCompatibleImageProvider` (implements `ProviderAdapter`); exported `readProviderError`.

- [ ] **Step 1: Extend the contract** — in `packages/shared/src/models.ts`, change the `GenerationTaskResult` line (currently `export type GenerationTaskResult = { kind: "text"; text: string; format: "markdown" | "plain" };`) to:
  ```ts
  export type GenerationTaskResult =
    | { kind: "text"; text: string; format: "markdown" | "plain" }
    | { kind: "image"; url: string; alt: string };
  ```
  Run `pnpm --filter @gw-link-omniai/shared test` and `pnpm --filter @gw-link-omniai/shared typecheck` — both stay green (additive).

- [ ] **Step 2: Export `readProviderError`** — in `apps/api/src/services/openAiTextProvider.ts`, change `async function readProviderError(` to `export async function readProviderError(`.

- [ ] **Step 3: Write the failing provider tests** — create `apps/api/src/services/__tests__/openAiImageProvider.test.ts`:
  ```ts
  import { describe, expect, it, vi } from "vitest";
  import type { ProviderGenerationRequest } from "../gatewayClient";
  import { OpenAiCompatibleImageProvider } from "../openAiImageProvider";

  function imageRequest(overrides: Partial<ProviderGenerationRequest> = {}): ProviderGenerationRequest {
    return {
      mode: "image",
      productModelId: "gw-image-creative",
      provider: {
        id: "openai-main",
        displayName: "OpenAI Main",
        protocol: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY"
      },
      providerModelId: "gpt-image-1",
      optimizedPrompt: "一只在霓虹城市里的猫",
      parameters: {},
      userId: "user-a",
      ...overrides
    };
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  describe("OpenAiCompatibleImageProvider", () => {
    it("generates an image as a data URL when a key is configured", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ data: [{ b64_json: "aGVsbG8=" }] }));
      const provider = new OpenAiCompatibleImageProvider({
        fetch: fetchMock as unknown as typeof fetch,
        env: { OPENAI_API_KEY: "sk-test" }
      });

      const result = await provider.submitGeneration(imageRequest());

      expect(result.status).toBe("succeeded");
      expect(result.result).toEqual({
        kind: "image",
        url: "data:image/png;base64,aGVsbG8=",
        alt: "一只在霓虹城市里的猫"
      });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.openai.com/v1/images/generations");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
      expect(JSON.parse(init.body as string)).toEqual({ model: "gpt-image-1", prompt: "一只在霓虹城市里的猫" });
    });

    it("passes through a provider-returned url", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ data: [{ url: "https://cdn.example/img.png" }] }));
      const provider = new OpenAiCompatibleImageProvider({
        fetch: fetchMock as unknown as typeof fetch,
        env: { OPENAI_API_KEY: "sk-test" }
      });

      const result = await provider.submitGeneration(imageRequest());

      expect(result.result).toEqual({
        kind: "image",
        url: "https://cdn.example/img.png",
        alt: "一只在霓虹城市里的猫"
      });
    });

    it("queues without a key and makes no request", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({}));
      const provider = new OpenAiCompatibleImageProvider({ fetch: fetchMock as unknown as typeof fetch, env: {} });

      const result = await provider.submitGeneration(imageRequest());

      expect(result.status).toBe("queued");
      expect(result.result).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("queues a non-image request", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({}));
      const provider = new OpenAiCompatibleImageProvider({
        fetch: fetchMock as unknown as typeof fetch,
        env: { OPENAI_API_KEY: "sk-test" }
      });

      const result = await provider.submitGeneration(imageRequest({ mode: "text" }));

      expect(result.status).toBe("queued");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("throws 502 on a provider error response", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ error: { message: "boom" } }, 500));
      const provider = new OpenAiCompatibleImageProvider({
        fetch: fetchMock as unknown as typeof fetch,
        env: { OPENAI_API_KEY: "sk-test" }
      });

      await expect(provider.submitGeneration(imageRequest())).rejects.toMatchObject({ statusCode: 502 });
    });

    it("throws 502 when the response has no image data", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
      const provider = new OpenAiCompatibleImageProvider({
        fetch: fetchMock as unknown as typeof fetch,
        env: { OPENAI_API_KEY: "sk-test" }
      });

      await expect(provider.submitGeneration(imageRequest())).rejects.toMatchObject({ statusCode: 502 });
    });
  });
  ```

- [ ] **Step 4: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/openAiImageProvider.test.ts`
  Expected: FAIL (`openAiImageProvider` module does not exist).

- [ ] **Step 5: Implement the provider** — create `apps/api/src/services/openAiImageProvider.ts`:
  ```ts
  import type { GenerationTaskResult } from "@gw-link-omniai/shared";
  import {
    ProviderAdapterError,
    type ProviderAdapter,
    type ProviderGenerationRequest,
    type ProviderGenerationResult
  } from "./gatewayClient";
  import { readProviderError } from "./openAiTextProvider";

  export interface OpenAiCompatibleImageProviderOptions {
    fetch?: typeof fetch;
    env?: Record<string, string | undefined>;
    clock?: { now(): Date };
  }

  export class OpenAiCompatibleImageProvider implements ProviderAdapter {
    private readonly fetchImpl: typeof fetch;
    private readonly env: Record<string, string | undefined>;
    private readonly clock: { now(): Date };

    constructor(options: OpenAiCompatibleImageProviderOptions = {}) {
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
      if (request.mode !== "image" || request.provider.protocol !== "openai-compatible" || !apiKey) {
        return { ...base, status: "queued" };
      }

      const url = `${request.provider.baseUrl.replace(/\/$/, "")}/images/generations`;

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: request.providerModelId, prompt: request.optimizedPrompt })
        });
      } catch {
        throw new ProviderAdapterError("Provider request failed", 502);
      }

      if (!response.ok) {
        throw new ProviderAdapterError(await readProviderError(response), 502);
      }

      let payload: { data?: Array<{ b64_json?: unknown; url?: unknown }> };
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        throw new ProviderAdapterError("Provider returned an invalid response", 502);
      }

      const first = payload.data?.[0];
      let imageUrl: string | undefined;
      if (first && typeof first.b64_json === "string" && first.b64_json.length > 0) {
        imageUrl = `data:image/png;base64,${first.b64_json}`;
      } else if (first && typeof first.url === "string" && first.url.length > 0) {
        imageUrl = first.url;
      }

      if (!imageUrl) {
        throw new ProviderAdapterError("Provider returned no image", 502);
      }

      const result: GenerationTaskResult = { kind: "image", url: imageUrl, alt: request.optimizedPrompt };
      return { ...base, status: "succeeded", result };
    }
  }
  ```

- [ ] **Step 6: Run it to verify it passes**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/openAiImageProvider.test.ts`
  Expected: PASS (6 tests).

- [ ] **Step 7: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green).
  ```bash
  git add packages/shared/src/models.ts apps/api/src/services/openAiTextProvider.ts apps/api/src/services/openAiImageProvider.ts apps/api/src/services/__tests__/openAiImageProvider.test.ts
  git commit -m "feat: add image GenerationTaskResult variant and OpenAiCompatibleImageProvider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2: Composite provider adapter + default wiring

**Files:**
- Create: `apps/api/src/services/compositeProviderAdapter.ts`
- Test: `apps/api/src/services/__tests__/compositeProviderAdapter.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/services/appServices.ts`

**Interfaces:**
- Consumes: `OpenAiCompatibleImageProvider` (Task 1), `OpenAiCompatibleTextProvider` (existing), `ProviderAdapter` (existing).
- Produces: `CompositeProviderAdapter` with constructor `({ text: ProviderAdapter; image: ProviderAdapter })`.

- [ ] **Step 1: Write the failing test** — create `apps/api/src/services/__tests__/compositeProviderAdapter.test.ts`:
  ```ts
  import { describe, expect, it, vi } from "vitest";
  import type { ProviderAdapter, ProviderGenerationRequest, ProviderGenerationResult } from "../gatewayClient";
  import { CompositeProviderAdapter } from "../compositeProviderAdapter";

  function request(mode: ProviderGenerationRequest["mode"]): ProviderGenerationRequest {
    return {
      mode,
      productModelId: "m",
      provider: { id: "p", displayName: "P", protocol: "openai-compatible", baseUrl: "https://x", apiKeyEnv: "K" },
      providerModelId: "pm",
      optimizedPrompt: "p",
      parameters: {},
      userId: "u"
    };
  }

  function stub(id: string): ProviderAdapter & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      async submitGeneration(req): Promise<ProviderGenerationResult> {
        calls.push(req.mode);
        return {
          status: "queued",
          providerId: id,
          providerProtocol: "openai-compatible",
          providerModelId: "pm",
          submittedAt: "2026-06-22T00:00:00.000Z"
        };
      }
    };
  }

  describe("CompositeProviderAdapter", () => {
    it("routes image requests to the image provider", async () => {
      const text = stub("text");
      const image = stub("image");
      const adapter = new CompositeProviderAdapter({ text, image });

      const result = await adapter.submitGeneration(request("image"));

      expect(result.providerId).toBe("image");
      expect(image.calls).toEqual(["image"]);
      expect(text.calls).toEqual([]);
    });

    it("routes text and video requests to the text provider", async () => {
      const text = stub("text");
      const image = stub("image");
      const adapter = new CompositeProviderAdapter({ text, image });

      await adapter.submitGeneration(request("text"));
      await adapter.submitGeneration(request("video"));

      expect(text.calls).toEqual(["text", "video"]);
      expect(image.calls).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/compositeProviderAdapter.test.ts`
  Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement the composite** — create `apps/api/src/services/compositeProviderAdapter.ts`:
  ```ts
  import type { ProviderAdapter, ProviderGenerationRequest, ProviderGenerationResult } from "./gatewayClient";

  export interface CompositeProviders {
    text: ProviderAdapter;
    image: ProviderAdapter;
  }

  export class CompositeProviderAdapter implements ProviderAdapter {
    constructor(private readonly providers: CompositeProviders) {}

    submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
      const provider = request.mode === "image" ? this.providers.image : this.providers.text;
      return provider.submitGeneration(request);
    }
  }
  ```

- [ ] **Step 4: Run it to verify it passes**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/compositeProviderAdapter.test.ts`
  Expected: PASS.

- [ ] **Step 5: Make the composite the default adapter** — wire it where the default provider is constructed:
  - In `apps/api/src/server.ts`:
    - Add imports:
      ```ts
      import { CompositeProviderAdapter } from "./services/compositeProviderAdapter";
      import { OpenAiCompatibleImageProvider } from "./services/openAiImageProvider";
      ```
    - Replace `const providerAdapter = options.providerAdapter ?? new OpenAiCompatibleTextProvider();` with:
      ```ts
      const providerAdapter =
        options.providerAdapter ??
        new CompositeProviderAdapter({
          text: new OpenAiCompatibleTextProvider(),
          image: new OpenAiCompatibleImageProvider()
        });
      ```
  - In `apps/api/src/services/appServices.ts`:
    - Add imports:
      ```ts
      import { CompositeProviderAdapter } from "./compositeProviderAdapter";
      import { OpenAiCompatibleImageProvider } from "./openAiImageProvider";
      ```
    - In `createDbServices`, replace `providerAdapter: options.providerAdapter ?? new OpenAiCompatibleTextProvider()` with:
      ```ts
      providerAdapter:
        options.providerAdapter ??
        new CompositeProviderAdapter({
          text: new OpenAiCompatibleTextProvider(),
          image: new OpenAiCompatibleImageProvider()
        })
      ```
    - In `createServices`'s in-memory branch, replace `providerAdapter: new OpenAiCompatibleTextProvider()` with:
      ```ts
      providerAdapter: new CompositeProviderAdapter({
        text: new OpenAiCompatibleTextProvider(),
        image: new OpenAiCompatibleImageProvider()
      })
      ```
    (Keep the existing `OpenAiCompatibleTextProvider` import in both files.)

- [ ] **Step 6: Run the api suite + typecheck**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green (existing tests inject their own `providerAdapter` or assert text/queued behavior unchanged; the composite routes text exactly as before).

- [ ] **Step 7: Commit**
  ```bash
  git add apps/api/src/services/compositeProviderAdapter.ts apps/api/src/services/__tests__/compositeProviderAdapter.test.ts apps/api/src/server.ts apps/api/src/services/appServices.ts
  git commit -m "feat(api): route generation by mode via CompositeProviderAdapter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3: Image generation e2e + image result persistence

**Files:**
- Modify: `apps/api/src/__tests__/server.test.ts`
- Modify: `apps/api/src/repositories/__tests__/repositoryContract.test.ts`

**Interfaces:**
- Consumes: `CompositeProviderAdapter`, `OpenAiCompatibleImageProvider` (Tasks 1–2).

- [ ] **Step 1: Add the e2e image test** — in `apps/api/src/__tests__/server.test.ts`, add the imports (next to the existing provider imports):
  ```ts
  import { CompositeProviderAdapter } from "../services/compositeProviderAdapter";
  import { OpenAiCompatibleImageProvider } from "../services/openAiImageProvider";
  ```
  Then add a test inside the `describe("product API", ...)` block (the `authenticate` helper already exists; signup grants 100 credits, image costs 2):
  ```ts
  it("returns a succeeded image task with a data-url result when a provider key is configured", async () => {
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
              id: "gw-image-creative",
              providerModelId: "gpt-image-1",
              displayName: "OmniAI Image Creative",
              capability: "image",
              tags: ["creative"],
              visibility: "visible",
              minimumPlan: "free",
              creditUnitCost: 2
            }
          ]
        }
      ]
    };
    const imageFetch = async () =>
      new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    const server = buildServer({
      modelCatalog: new ConfigModelCatalog(modelConfig),
      providerAdapter: new CompositeProviderAdapter({
        text: new OpenAiCompatibleTextProvider(),
        image: new OpenAiCompatibleImageProvider({
          fetch: imageFetch as unknown as typeof fetch,
          env: { OPENAI_API_KEY: "sk-test" }
        })
      })
    });
    const token = await authenticate(server);

    const response = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: "image",
        prompt: "一只猫",
        optimizedPrompt: "一只在霓虹城市里的猫",
        preset: {
          modelId: "gw-image-creative",
          parameters: { quality: "high" },
          creditEstimate: { credits: 2, unit: "credit" }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      task: { status: "succeeded", result: { kind: "image", url: "data:image/png;base64,aGVsbG8=" } }
    });

    const balanceResponse = await server.inject({
      method: "GET",
      url: "/v1/credits/balance",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(balanceResponse.json()).toEqual({ balance: { credits: 98, unit: "credit" } });
  });
  ```
  (The `gw-image-creative` model uses `minimumPlan: "free"` here so the signed-up free user can generate; the catalog does not enforce `minimumPlan` today.)

- [ ] **Step 2: Add the repository image round-trip case** — in `apps/api/src/repositories/__tests__/repositoryContract.test.ts`, add a test inside the `describe.each` block (the `makeUser`/`makeTask` helpers exist):
  ```ts
  it("round-trips an image task result", async () => {
    const { users, tasks } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await tasks.insert(
      makeTask({
        id: "task-image",
        status: "succeeded",
        result: { kind: "image", url: "data:image/png;base64,aGVsbG8=", alt: "一只猫" }
      }),
      "owner-a"
    );

    const [listed] = await tasks.list("owner-a");
    expect(listed!.result).toEqual({ kind: "image", url: "data:image/png;base64,aGVsbG8=", alt: "一只猫" });
  });
  ```

- [ ] **Step 3: Run the api suite + typecheck**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green.

- [ ] **Step 4: Commit**
  ```bash
  git add apps/api/src/__tests__/server.test.ts apps/api/src/repositories/__tests__/repositoryContract.test.ts
  git commit -m "test(api): cover image generation e2e and image result persistence

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4: Desktop image display + save

**Files:**
- Modify: `apps/desktop/src/assetModel.ts`
- Modify: `apps/desktop/src/__tests__/assetModel.test.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: the `image` `GenerationTaskResult` variant (Task 1).

- [ ] **Step 1: Extend `buildAssetRequestFromTask`** — in `apps/desktop/src/assetModel.ts`, replace the body of `buildAssetRequestFromTask` so it handles both text and image (it currently throws unless `task.result?.kind === "text"`):
  ```ts
  export function buildAssetRequestFromTask(task: GenerationTask): CreationAssetRequest {
    const result = task.result;
    if (!result) {
      throw new Error("Only succeeded tasks with a result can be saved as assets");
    }

    const content: CreationAssetRequest["content"] =
      result.kind === "image"
        ? { kind: "image", url: result.url, alt: result.alt }
        : { kind: "text", text: result.text, format: result.format };

    return {
      mode: task.mode,
      title: getAssetModeLabel(task.mode),
      content,
      source: { taskId: task.id, taskStatus: "succeeded" },
      prompt: task.prompt,
      optimizedPrompt: task.optimizedPrompt,
      preset: {
        modelId: task.preset.modelId,
        parameters: { ...task.preset.parameters },
        creditEstimate: { ...task.preset.creditEstimate }
      }
    };
  }
  ```

- [ ] **Step 2: Add the image test for `buildAssetRequestFromTask`** — in `apps/desktop/src/__tests__/assetModel.test.ts`, add (alongside the existing text test):
  ```ts
  it("builds an image asset request from a succeeded image task", () => {
    const task: GenerationTask = {
      id: "task-img",
      mode: "image",
      status: "succeeded",
      prompt: "一只猫",
      optimizedPrompt: "一只在霓虹城市里的猫",
      preset: {
        modelId: "gw-image-creative",
        parameters: { quality: "high" },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      resultPreview: { title: "图片生成任务", description: "已生成。" },
      result: { kind: "image", url: "data:image/png;base64,aGVsbG8=", alt: "一只在霓虹城市里的猫" },
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    };

    const request = buildAssetRequestFromTask(task);

    expect(request).toEqual({
      mode: "image",
      title: "图片资产",
      content: { kind: "image", url: "data:image/png;base64,aGVsbG8=", alt: "一只在霓虹城市里的猫" },
      source: { taskId: "task-img", taskStatus: "succeeded" },
      prompt: "一只猫",
      optimizedPrompt: "一只在霓虹城市里的猫",
      preset: {
        modelId: "gw-image-creative",
        parameters: { quality: "high" },
        creditEstimate: { credits: 2, unit: "credit" }
      }
    });
  });
  ```
  (Match how the existing text test imports `GenerationTask`; if absent, add it to the `@gw-link-omniai/shared` import.)

- [ ] **Step 3: Wire image rendering + save into `App.tsx`:**
  - In the task-center `<article>`, after the existing text result line `{task.result?.kind === "text" ? <p>{task.result.text}</p> : null}`, add an image line:
    ```tsx
    {task.result?.kind === "image" ? <img src={task.result.url} alt={task.result.alt} /> : null}
    ```
  - Change the save-button gate from `task.status === "succeeded" && task.result?.kind === "text"` to:
    ```tsx
    {task.status === "succeeded" && task.result ? (
      <button type="button" onClick={() => handleSaveAsset(task)}>
        保存到资产库
      </button>
    ) : null}
    ```
  - In the asset-library card `<article>`, after `<p>{asset.preview.description}</p>`, add an image line:
    ```tsx
    {asset.content.kind === "image" ? <img src={asset.content.url} alt={asset.content.alt} /> : null}
    ```

- [ ] **Step 4: Make the fake support image mode + add App tests** — in `apps/desktop/src/__tests__/App.test.tsx`:
  - Add an image optimization fixture near `textOptimization`:
    ```ts
    const imageOptimization: PromptOptimization = {
      id: "o2",
      mode: "image",
      originalPrompt: "一只猫",
      optimizedPrompt: "一只在霓虹城市里的猫",
      sections: [{ label: "画面", value: "霓虹城市" }],
      preset: { modelId: "gw-image-creative", parameters: { quality: "high" }, creditEstimate: { credits: 2, unit: "credit" } },
      createdAt: "2026-06-22T00:00:00.000Z"
    };
    ```
  - In `createFakeClient`'s `createGeneration`, branch the result and credit cost by mode (replace the current text-only body):
    ```ts
    createGeneration: async (request) => {
      const result =
        request.mode === "image"
          ? { kind: "image" as const, url: "data:image/png;base64,aGVsbG8=", alt: request.optimizedPrompt }
          : { kind: "text" as const, text: "真实生成文案", format: "markdown" as const };
      const task: GenerationTask = {
        id: `task-${tasks.length + 1}`,
        mode: request.mode,
        status: "succeeded",
        prompt: request.prompt,
        optimizedPrompt: request.optimizedPrompt,
        preset: request.preset,
        resultPreview: { title: "生成任务", description: "已生成。" },
        result,
        createdAt: "2026-06-21T00:00:00.000Z",
        updatedAt: "2026-06-21T00:00:00.000Z"
      };
      tasks = [task, ...tasks];
      balance -= request.mode === "image" ? 2 : 1;
      return task;
    },
    ```
  - Add tests (after the asset-save test):
    ```ts
    it("renders a generated image in the task center", async () => {
      const client = createFakeClient({ optimizePrompt: async () => imageOptimization });
      await signIn(client);

      fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
      await screen.findByLabelText("提示词优化结果");
      fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

      const taskCenter = screen.getByLabelText("任务中心");
      const img = await within(taskCenter).findByRole("img");
      expect((img as HTMLImageElement).getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=");
    });

    it("saves a succeeded image task to the asset library", async () => {
      const client = createFakeClient({ optimizePrompt: async () => imageOptimization });
      await signIn(client);

      fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
      await screen.findByLabelText("提示词优化结果");
      fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

      const taskCenter = screen.getByLabelText("任务中心");
      fireEvent.click(await within(taskCenter).findByRole("button", { name: "保存到资产库" }));

      const assetLibrary = screen.getByLabelText("资产库");
      await within(assetLibrary).findByText("图片资产");
      expect(within(assetLibrary).getByRole("img")).toBeTruthy();
    });
    ```

- [ ] **Step 5: Run the desktop suite + typecheck**

  Run: `pnpm --filter @gw-link-omniai/desktop test` then `pnpm --filter @gw-link-omniai/desktop typecheck`. Both green (existing text tests still pass — `createGeneration`'s text branch is unchanged in behavior, and the save gate still shows for text).

- [ ] **Step 6: Commit**
  ```bash
  git add apps/desktop/src/assetModel.ts apps/desktop/src/__tests__/assetModel.test.ts apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
  git commit -m "feat(desktop): render and save generated images

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 5: Documentation + final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`
- Modify: `.env.example`

- [ ] **Step 1: Update `.env.example`** — extend the provider-keys comment block to note image generation:
  ```bash
  # Provider API keys (referenced by config/models.json `apiKeyEnv`). When set,
  # text generation calls chat/completions and image generation calls
  # images/generations synchronously; when unset, generation falls back to a
  # queued placeholder (no real call). Image results are returned inline as a
  # base64 data URL (object storage is a later slice).
  # OPENAI_API_KEY=sk-...
  ```
  (Replace the existing `# Provider API keys ...` comment block.)

- [ ] **Step 2: Update `README.md`** — add a section after "Credit Foundation":
  ```markdown
  ### Real Image Generation

  The tenth product-first slice makes image generation real.

  - With a provider key, `POST /v1/generations` for an image model calls the
    OpenAI-compatible `images/generations` endpoint and returns a `succeeded`
    task carrying `result: { kind: "image", url, alt }`, where `url` is an inline
    `data:image/png;base64,...` URL (object storage is a later slice).
  - Without a key, image generation falls back to the `queued` placeholder.
    Generation routes by mode (`CompositeProviderAdapter`); video stays `queued`.
  - The desktop renders the generated image in the task center and can save it to
    the asset library (image assets render in the library too).
  ```

- [ ] **Step 3: Update `docs/architecture/mvp-skeleton.md`** — append:
  ```markdown
  ## Real Image Provider Slice

  Image generation produces actual images. `GenerationTaskResult` gains an
  `image` variant (`{ kind, url, alt }`, identical to the image asset content).
  `OpenAiCompatibleImageProvider` calls the OpenAI-compatible `images/generations`
  endpoint and returns the image as an inline `data:` URL (b64 → data URL, or a
  passed-through provider URL); a `CompositeProviderAdapter` routes generation by
  mode (image → image provider, else → text provider) and is the default adapter.
  The generation service, persistence, and credit deduction are unchanged (the
  result passes through generically; image costs `creditUnitCost` = 2). The
  desktop renders generated images and saves them as assets. Object storage (real
  file URLs instead of inline base64), image parameters, and real video generation
  remain later slices.
  ```

- [ ] **Step 4: Full workspace verification**

  Run from the repo root: `pnpm test` then `pnpm typecheck`. Both green.

- [ ] **Step 5: Commit**
  ```bash
  git add README.md docs/architecture/mvp-skeleton.md .env.example
  git commit -m "docs: document the real image provider slice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Final Verification (after all tasks)

- [ ] `pnpm test` + `pnpm typecheck` pass across all packages.
- [ ] `GenerationTaskResult` has an `image` variant; no object storage introduced (result `url` is `data:`/passthrough).
- [ ] Image generation: with key → `succeeded` + image result + balance −2; without key → `queued`; video still `queued`.
- [ ] Provider key appears only in the `Authorization` header (verified by `openAiImageProvider.test.ts`).
- [ ] Desktop renders generated images and saves image tasks to the asset library.
- [ ] Manual check (optional): set `OPENAI_API_KEY`, `pnpm dev:api` + `pnpm dev:desktop`, switch to image mode, optimize + generate, see the image, save it.
