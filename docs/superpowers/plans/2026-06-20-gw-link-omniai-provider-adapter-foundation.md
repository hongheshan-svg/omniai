# GW-LINK OmniAI Provider Adapter Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a product-first provider adapter foundation so text, image, and video generation tasks can validate configured OpenAI-compatible and Anthropic-compatible model adapters without exposing provider details to product APIs.

**Architecture:** Keep `GenerationTaskRequest` and `GenerationTask` as product contracts. Add API-internal model configuration, config-backed catalog lookup, fake provider protocol dispatch, and generation service validation behind the existing `/v1/models` and `/v1/generations` routes. Do not call real provider networks, read API keys, persist tasks, or change desktop into an HTTP client.

**Tech Stack:** TypeScript, Fastify, Vitest, Node.js fs/path APIs, pnpm workspaces.

---

## Scope Check

This plan implements one backend foundation slice plus documentation. It deliberately does not implement real OpenAI/Anthropic HTTP calls, streaming text, generated media files, persistence, billing, admin model management, desktop HTTP client, or automatic provider model discovery.

The old `docs/superpowers/plans/2026-06-20-gw-link-omniai-text-model-gateway.md` is not an execution source. It is older than Stage 1/2/3 on `main`, is text-only, and uses a gateway-first request contract. Use only its durable ideas: config-driven catalog, product model IDs separated from provider model IDs, provider protocol dispatch, and fake adapters.

## File Structure

- Create: `config/models.json` - default local model catalog with visible text/image/video models and hidden/maintenance examples for tests.
- Modify: `apps/api/src/config.ts` - add `modelConfigPath` to API config.
- Modify: `apps/api/src/__tests__/config.test.ts` - cover default and env override for model config path.
- Create: `apps/api/src/services/modelConfig.ts` - API-internal config types, file loading, and runtime validation.
- Create: `apps/api/src/services/__tests__/modelConfig.test.ts` - config loader and schema validation tests.
- Modify: `apps/api/src/services/modelCatalog.ts` - replace hardcoded function with `ConfigModelCatalog`, errors, and internal references.
- Create: `apps/api/src/services/__tests__/modelCatalog.test.ts` - catalog filtering, lookup, hidden, maintenance, and mode mismatch tests.
- Modify: `apps/api/src/services/gatewayClient.ts` - reshape current gateway stub into fake provider adapter boundary.
- Create: `apps/api/src/services/__tests__/gatewayClient.test.ts` - fake openai/anthropic adapter dispatch tests.
- Modify: `apps/api/src/services/generationService.ts` - validate configured model and call fake provider adapter before storing queued tasks.
- Modify: `apps/api/src/services/__tests__/generationService.test.ts` - update service tests for catalog/adapter validation.
- Modify: `apps/api/src/routes/models.ts` - inject catalog instead of using hardcoded model list.
- Create: `apps/api/src/routes/__tests__/models.test.ts` - verify product-facing model route and provider field hiding.
- Modify: `apps/api/src/routes/generations.ts` - await async generation service and map new errors.
- Modify: `apps/api/src/routes/__tests__/generations.test.ts` - route tests for async errors and new generation errors.
- Modify: `apps/api/src/server.ts` - wire lazy config, catalog, fake adapter, and generation service while preserving injection behavior.
- Modify: `apps/api/src/__tests__/server.test.ts` - update default model expectations and lazy injection test.
- Modify: `README.md` - document provider adapter foundation behavior.
- Modify: `docs/architecture/mvp-skeleton.md` - document Stage 4 provider adapter foundation.

## Task 1: API Config and Model Config Loader

**Files:**
- Create: `config/models.json`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/__tests__/config.test.ts`
- Create: `apps/api/src/services/modelConfig.ts`
- Create: `apps/api/src/services/__tests__/modelConfig.test.ts`

- [ ] **Step 1: Write the failing API config tests**

Modify `apps/api/src/__tests__/config.test.ts` so the existing default and supplied config expectations include `modelConfigPath`:

```ts
expect(loadConfig({})).toEqual({
  port: 8787,
  gatewayBaseUrl: "https://gateway.gw-link.local",
  authDevCodesEnabled: true,
  modelConfigPath: "config/models.json"
});

expect(
  loadConfig({
    PORT: "9000",
    GW_LINK_GATEWAY_BASE_URL: "https://gateway.example",
    GW_LINK_AUTH_DEV_CODES_ENABLED: "false",
    GW_LINK_MODEL_CONFIG_PATH: "/tmp/custom-models.json"
  })
).toEqual({
  port: 9000,
  gatewayBaseUrl: "https://gateway.example",
  authDevCodesEnabled: false,
  modelConfigPath: "/tmp/custom-models.json"
});
```

Add a focused override test:

```ts
it("returns the supplied model config path", () => {
  expect(loadConfig({ GW_LINK_MODEL_CONFIG_PATH: "fixtures/models.json" })).toMatchObject({
    modelConfigPath: "fixtures/models.json"
  });
});
```

- [ ] **Step 2: Run config tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- config.test.ts
```

Expected: FAIL because `ApiConfig` does not include `modelConfigPath`.

- [ ] **Step 3: Update API config**

Modify `apps/api/src/config.ts`:

```ts
export interface ApiConfig {
  port: number;
  gatewayBaseUrl: string;
  authDevCodesEnabled: boolean;
  modelConfigPath: string;
}
```

In `loadConfig`, return:

```ts
modelConfigPath: env.GW_LINK_MODEL_CONFIG_PATH ?? "config/models.json"
```

- [ ] **Step 4: Add default model catalog config file**

Create `config/models.json`:

```json
{
  "providers": [
    {
      "id": "openai-main",
      "displayName": "OpenAI Main",
      "protocol": "openai-compatible",
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyEnv": "OPENAI_API_KEY",
      "models": [
        {
          "id": "gw-text-balanced",
          "providerModelId": "gpt-4.1-mini",
          "displayName": "OmniAI Text Balanced",
          "capability": "text",
          "tags": ["recommended", "balanced"],
          "visibility": "visible",
          "minimumPlan": "free",
          "creditUnitCost": 1
        },
        {
          "id": "gw-image-creative",
          "providerModelId": "gpt-image-1",
          "displayName": "OmniAI Image Creative",
          "capability": "image",
          "tags": ["creative", "high-quality"],
          "visibility": "visible",
          "minimumPlan": "pro",
          "creditUnitCost": 2
        },
        {
          "id": "gw-text-hidden",
          "providerModelId": "gpt-hidden",
          "displayName": "Hidden Text",
          "capability": "text",
          "tags": ["hidden"],
          "visibility": "hidden",
          "minimumPlan": "pro",
          "creditUnitCost": 2
        }
      ]
    },
    {
      "id": "anthropic-main",
      "displayName": "Anthropic Main",
      "protocol": "anthropic-compatible",
      "baseUrl": "https://api.anthropic.com",
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "models": [
        {
          "id": "gw-video-motion",
          "providerModelId": "claude-compatible-video-motion",
          "displayName": "OmniAI Video Motion",
          "capability": "video",
          "tags": ["motion", "async-task"],
          "visibility": "visible",
          "minimumPlan": "studio",
          "creditUnitCost": 3
        },
        {
          "id": "gw-text-maintenance",
          "providerModelId": "claude-maintenance",
          "displayName": "Maintenance Text",
          "capability": "text",
          "tags": ["maintenance"],
          "visibility": "maintenance",
          "minimumPlan": "pro",
          "creditUnitCost": 2
        }
      ]
    }
  ]
}
```

- [ ] **Step 5: Write failing model config loader tests**

Create `apps/api/src/services/__tests__/modelConfig.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ModelConfigError,
  loadModelCatalogConfig,
  validateModelCatalogConfig,
  type ModelCatalogConfig
} from "../modelConfig";

function writeConfig(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "gw-link-models-"));
  const file = join(dir, "models.json");
  writeFileSync(file, JSON.stringify(config), "utf8");
  return file;
}

function createConfig(): ModelCatalogConfig {
  return {
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
      },
      {
        id: "anthropic-main",
        displayName: "Anthropic Main",
        protocol: "anthropic-compatible",
        baseUrl: "https://api.anthropic.com",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        models: [
          {
            id: "gw-video-motion",
            providerModelId: "claude-compatible-video-motion",
            displayName: "OmniAI Video Motion",
            capability: "video",
            tags: ["motion", "async-task"],
            visibility: "visible",
            minimumPlan: "studio",
            creditUnitCost: 3
          }
        ]
      }
    ]
  };
}

function expectModelConfigError(action: () => unknown, message: string) {
  expect(action).toThrow(ModelConfigError);
  expect(action).toThrow(message);
}

describe("modelConfig", () => {
  it("loads model catalog configuration from JSON", () => {
    const config = createConfig();
    const file = writeConfig(config);

    expect(loadModelCatalogConfig(file)).toEqual(config);
  });

  it("validates OpenAI-compatible and Anthropic-compatible providers", () => {
    const config = validateModelCatalogConfig(createConfig());

    expect(config.providers.map((provider) => provider.protocol)).toEqual([
      "openai-compatible",
      "anthropic-compatible"
    ]);
    expect(config.providers.flatMap((provider) => provider.models.map((model) => model.capability))).toEqual([
      "text",
      "video"
    ]);
  });

  it("rejects invalid provider and model configuration", () => {
    expectModelConfigError(() => validateModelCatalogConfig({ providers: [] }), "Model providers are required");
    expectModelConfigError(
      () =>
        validateModelCatalogConfig({
          providers: [{ ...createConfig().providers[0]!, protocol: "legacy" as "openai-compatible" }]
        }),
      "Unsupported provider protocol"
    );
    expectModelConfigError(
      () =>
        validateModelCatalogConfig({
          providers: [
            {
              ...createConfig().providers[0]!,
              models: [{ ...createConfig().providers[0]!.models[0]!, capability: "audio" as "text" }]
            }
          ]
        }),
      "Unsupported model capability"
    );
    expectModelConfigError(
      () =>
        validateModelCatalogConfig({
          providers: [
            {
              ...createConfig().providers[0]!,
              models: [{ ...createConfig().providers[0]!.models[0]!, creditUnitCost: 0 }]
            }
          ]
        }),
      "Invalid model credit unit cost"
    );
  });

  it("rejects duplicate product model ids across providers", () => {
    const config = createConfig();
    config.providers[1]!.models.push({
      ...config.providers[0]!.models[0]!,
      providerModelId: "claude-duplicate"
    });

    expectModelConfigError(() => validateModelCatalogConfig(config), "Duplicate model id");
  });
});
```

- [ ] **Step 6: Run model config tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- modelConfig.test.ts
```

Expected: FAIL because `apps/api/src/services/modelConfig.ts` does not exist.

- [ ] **Step 7: Implement `modelConfig.ts`**

Create `apps/api/src/services/modelConfig.ts` with these exported API-internal contracts and functions:

```ts
import { readFileSync } from "node:fs";
import type { CreationMode, ModelVisibility, PlanCode, ProductModel } from "@gw-link-omniai/shared";

export type ProviderProtocol = "openai-compatible" | "anthropic-compatible";

export interface ProviderModelConfig extends ProductModel {
  providerModelId: string;
}

export interface ModelProviderConfig {
  id: string;
  displayName: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKeyEnv: string;
  models: ProviderModelConfig[];
}

export interface ModelCatalogConfig {
  providers: ModelProviderConfig[];
}

export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigError";
  }
}
```

Implement:

```ts
export function loadModelCatalogConfig(path: string): ModelCatalogConfig {
  const raw = readFileSync(path, "utf8");
  return validateModelCatalogConfig(JSON.parse(raw));
}
```

Runtime validation helpers must enforce the rules from the spec:

- `providers` is a non-empty array, else `"Model providers are required"`.
- provider strings are non-empty.
- protocol is `"openai-compatible"` or `"anthropic-compatible"`, else `"Unsupported provider protocol"`.
- `models` is an array.
- model strings are non-empty.
- capability is `text | image | video`, else `"Unsupported model capability"`.
- visibility is `visible | hidden | maintenance`.
- minimumPlan is `free | pro | studio`.
- creditUnitCost is finite and `> 0`, else `"Invalid model credit unit cost"`.
- tags is an array of strings.
- product model IDs are unique across all providers, else `"Duplicate model id"`.

Return cloned objects so callers cannot mutate the raw parsed object through the returned config.

- [ ] **Step 8: Run Task 1 verification**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- config.test.ts modelConfig.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add config/models.json apps/api/src/config.ts apps/api/src/__tests__/config.test.ts apps/api/src/services/modelConfig.ts apps/api/src/services/__tests__/modelConfig.test.ts
git commit -m "feat: add provider model config loader"
```

## Task 2: Config-Backed Model Catalog

**Files:**
- Modify: `apps/api/src/services/modelCatalog.ts`
- Create: `apps/api/src/services/__tests__/modelCatalog.test.ts`

- [ ] **Step 1: Write failing model catalog tests**

Create `apps/api/src/services/__tests__/modelCatalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConfigModelCatalog, ModelCatalogError } from "../modelCatalog";
import type { ModelCatalogConfig } from "../modelConfig";

function createConfig(): ModelCatalogConfig {
  return {
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
          },
          {
            id: "gw-image-creative",
            providerModelId: "gpt-image-1",
            displayName: "OmniAI Image Creative",
            capability: "image",
            tags: ["creative", "high-quality"],
            visibility: "visible",
            minimumPlan: "pro",
            creditUnitCost: 2
          },
          {
            id: "gw-text-hidden",
            providerModelId: "gpt-hidden",
            displayName: "Hidden Text",
            capability: "text",
            tags: ["hidden"],
            visibility: "hidden",
            minimumPlan: "pro",
            creditUnitCost: 2
          }
        ]
      },
      {
        id: "anthropic-main",
        displayName: "Anthropic Main",
        protocol: "anthropic-compatible",
        baseUrl: "https://api.anthropic.com",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        models: [
          {
            id: "gw-video-motion",
            providerModelId: "claude-compatible-video-motion",
            displayName: "OmniAI Video Motion",
            capability: "video",
            tags: ["motion", "async-task"],
            visibility: "visible",
            minimumPlan: "studio",
            creditUnitCost: 3
          },
          {
            id: "gw-text-maintenance",
            providerModelId: "claude-maintenance",
            displayName: "Maintenance Text",
            capability: "text",
            tags: ["maintenance"],
            visibility: "maintenance",
            minimumPlan: "pro",
            creditUnitCost: 2
          }
        ]
      }
    ]
  };
}

function expectCatalogError(action: () => unknown, message: string, statusCode: number) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ModelCatalogError);
    expect(error).toMatchObject({ message, statusCode });
    return;
  }

  throw new Error("Expected model catalog error");
}

describe("ConfigModelCatalog", () => {
  it("lists visible product models without provider internals", () => {
    const catalog = new ConfigModelCatalog(createConfig());

    expect(catalog.listVisibleModels()).toEqual([
      {
        id: "gw-text-balanced",
        displayName: "OmniAI Text Balanced",
        capability: "text",
        tags: ["recommended", "balanced"],
        visibility: "visible",
        minimumPlan: "free",
        creditUnitCost: 1
      },
      {
        id: "gw-image-creative",
        displayName: "OmniAI Image Creative",
        capability: "image",
        tags: ["creative", "high-quality"],
        visibility: "visible",
        minimumPlan: "pro",
        creditUnitCost: 2
      },
      {
        id: "gw-video-motion",
        displayName: "OmniAI Video Motion",
        capability: "video",
        tags: ["motion", "async-task"],
        visibility: "visible",
        minimumPlan: "studio",
        creditUnitCost: 3
      }
    ]);
    expect(catalog.listVisibleModels()[0]).not.toHaveProperty("providerModelId");
  });

  it("returns internal provider references for matching models", () => {
    const catalog = new ConfigModelCatalog(createConfig());

    expect(catalog.getModelReference("gw-video-motion", "video")).toEqual({
      product: {
        id: "gw-video-motion",
        displayName: "OmniAI Video Motion",
        capability: "video",
        tags: ["motion", "async-task"],
        visibility: "visible",
        minimumPlan: "studio",
        creditUnitCost: 3
      },
      provider: {
        id: "anthropic-main",
        displayName: "Anthropic Main",
        protocol: "anthropic-compatible",
        baseUrl: "https://api.anthropic.com",
        apiKeyEnv: "ANTHROPIC_API_KEY"
      },
      providerModelId: "claude-compatible-video-motion"
    });
  });

  it("treats missing and hidden models as not found", () => {
    const catalog = new ConfigModelCatalog(createConfig());

    expectCatalogError(() => catalog.getModelReference("missing", "text"), "Model was not found", 404);
    expectCatalogError(() => catalog.getModelReference("gw-text-hidden", "text"), "Model was not found", 404);
  });

  it("rejects model mode mismatches", () => {
    const catalog = new ConfigModelCatalog(createConfig());

    expectCatalogError(
      () => catalog.getModelReference("gw-image-creative", "text"),
      "Model does not support this creation mode",
      400
    );
  });

  it("returns maintenance references for service-level handling", () => {
    const catalog = new ConfigModelCatalog(createConfig());

    expect(catalog.getModelReference("gw-text-maintenance", "text").product.visibility).toBe("maintenance");
  });

  it("returns defensive copies", () => {
    const catalog = new ConfigModelCatalog(createConfig());
    const [model] = catalog.listVisibleModels();
    model!.tags.push("mutated");

    expect(catalog.listVisibleModels()[0]!.tags).toEqual(["recommended", "balanced"]);
  });
});
```

- [ ] **Step 2: Run catalog tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- modelCatalog.test.ts
```

Expected: FAIL because `ConfigModelCatalog` and `ModelCatalogError` do not exist.

- [ ] **Step 3: Implement config-backed catalog**

Replace `apps/api/src/services/modelCatalog.ts` with exports:

```ts
import type { CreationMode, ProductModel } from "@gw-link-omniai/shared";
import type { ModelCatalogConfig, ModelProviderConfig, ProviderProtocol } from "./modelConfig";

export interface CatalogProviderReference {
  id: string;
  displayName: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKeyEnv: string;
}

export interface CatalogModelReference {
  product: ProductModel;
  provider: CatalogProviderReference;
  providerModelId: string;
}

export interface ModelCatalog {
  listVisibleModels(): ProductModel[];
  getModelReference(modelId: string, mode: CreationMode): CatalogModelReference;
}

export class ModelCatalogError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "ModelCatalogError";
  }
}
```

Implement `ConfigModelCatalog`:

- Constructor accepts `ModelCatalogConfig`.
- Store cloned providers.
- `listVisibleModels()` returns visible product models only.
- Product model clone includes `id`, `displayName`, `capability`, cloned `tags`, `visibility`, `minimumPlan`, `creditUnitCost`.
- `getModelReference(modelId, mode)` searches all provider models.
- Missing or hidden throws `new ModelCatalogError("Model was not found", 404)`.
- Capability mismatch throws `new ModelCatalogError("Model does not support this creation mode", 400)`.
- Maintenance returns the reference; `GenerationService` handles maintenance.
- References return cloned product/provider data.

- [ ] **Step 4: Run Task 2 verification**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- modelCatalog.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/api/src/services/modelCatalog.ts apps/api/src/services/__tests__/modelCatalog.test.ts
git commit -m "feat: add config backed model catalog"
```

## Task 3: Fake Provider Adapter Boundary

**Files:**
- Modify: `apps/api/src/services/gatewayClient.ts`
- Create: `apps/api/src/services/__tests__/gatewayClient.test.ts`

- [ ] **Step 1: Write failing fake adapter tests**

Create `apps/api/src/services/__tests__/gatewayClient.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeProviderAdapter, ProviderAdapterError, type ProviderGenerationRequest } from "../gatewayClient";

function createRequest(protocol: ProviderGenerationRequest["provider"]["protocol"]): ProviderGenerationRequest {
  return {
    mode: "text",
    productModelId: "gw-text-balanced",
    provider: {
      id: protocol === "openai-compatible" ? "openai-main" : "anthropic-main",
      displayName: protocol === "openai-compatible" ? "OpenAI Main" : "Anthropic Main",
      protocol,
      baseUrl: protocol === "openai-compatible" ? "https://api.openai.com/v1" : "https://api.anthropic.com",
      apiKeyEnv: protocol === "openai-compatible" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"
    },
    providerModelId: protocol === "openai-compatible" ? "gpt-4.1-mini" : "claude-sonnet",
    optimizedPrompt: "Write a launch post.",
    parameters: {
      tone: "clear"
    },
    userId: "development-user"
  };
}

describe("FakeProviderAdapter", () => {
  it("dry-runs OpenAI-compatible provider generations without reading API keys", async () => {
    delete process.env.OPENAI_API_KEY;
    const adapter = new FakeProviderAdapter({ clock: { now: () => new Date("2026-06-20T00:00:00.000Z") } });

    await expect(adapter.submitGeneration(createRequest("openai-compatible"))).resolves.toEqual({
      status: "queued",
      providerId: "openai-main",
      providerProtocol: "openai-compatible",
      providerModelId: "gpt-4.1-mini",
      submittedAt: "2026-06-20T00:00:00.000Z"
    });
  });

  it("dry-runs Anthropic-compatible provider generations", async () => {
    const adapter = new FakeProviderAdapter({ clock: { now: () => new Date("2026-06-20T00:00:00.000Z") } });

    await expect(adapter.submitGeneration(createRequest("anthropic-compatible"))).resolves.toMatchObject({
      status: "queued",
      providerId: "anthropic-main",
      providerProtocol: "anthropic-compatible",
      providerModelId: "claude-sonnet"
    });
  });

  it("rejects unsupported provider protocols", async () => {
    const adapter = new FakeProviderAdapter();
    const request = createRequest("openai-compatible");
    request.provider.protocol = "legacy" as "openai-compatible";

    await expect(adapter.submitGeneration(request)).rejects.toMatchObject({
      message: "Provider protocol is not supported",
      statusCode: 502
    });
    await expect(adapter.submitGeneration(request)).rejects.toBeInstanceOf(ProviderAdapterError);
  });
});
```

- [ ] **Step 2: Run adapter tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- gatewayClient.test.ts
```

Expected: FAIL because `FakeProviderAdapter` and related types do not exist.

- [ ] **Step 3: Implement fake provider adapter**

Replace `apps/api/src/services/gatewayClient.ts` with provider adapter exports:

```ts
import type { CreationMode, PresetSuggestion } from "@gw-link-omniai/shared";
import type { CatalogProviderReference } from "./modelCatalog";

export interface ProviderGenerationRequest {
  mode: CreationMode;
  productModelId: string;
  provider: CatalogProviderReference;
  providerModelId: string;
  optimizedPrompt: string;
  parameters: PresetSuggestion["parameters"];
  userId: string;
}

export interface ProviderGenerationResult {
  status: "queued";
  providerId: string;
  providerProtocol: CatalogProviderReference["protocol"];
  providerModelId: string;
  submittedAt: string;
}

export interface ProviderAdapter {
  submitGeneration(request: ProviderGenerationRequest): Promise<ProviderGenerationResult>;
}

export class ProviderAdapterError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "ProviderAdapterError";
  }
}

export interface FakeProviderAdapterClock {
  now(): Date;
}

export interface FakeProviderAdapterOptions {
  clock?: FakeProviderAdapterClock;
}
```

Implement `FakeProviderAdapter`:

- Constructor takes optional clock, default `new Date()`.
- `submitGeneration` checks protocol.
- For `"openai-compatible"` and `"anthropic-compatible"`, return queued result with provider ID, protocol, model ID, timestamp.
- For any other runtime protocol, throw `ProviderAdapterError("Provider protocol is not supported", 502)`.
- Do not read `process.env`.
- Do not call `fetch`, `http`, or any network API.

- [ ] **Step 4: Run Task 3 verification**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- gatewayClient.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/api/src/services/gatewayClient.ts apps/api/src/services/__tests__/gatewayClient.test.ts
git commit -m "feat: add fake provider adapter"
```

## Task 4: Generation Service Catalog and Adapter Integration

**Files:**
- Modify: `apps/api/src/services/generationService.ts`
- Modify: `apps/api/src/services/__tests__/generationService.test.ts`

- [ ] **Step 1: Write failing generation service tests**

Modify `apps/api/src/services/__tests__/generationService.test.ts` so `createService()` injects a `ConfigModelCatalog` and `FakeProviderAdapter`, and all `service.createTask(...)` calls are awaited.

Add this helper:

```ts
import { FakeProviderAdapter, ProviderAdapterError, type ProviderAdapter } from "../gatewayClient";
import { ConfigModelCatalog } from "../modelCatalog";
import type { ModelCatalogConfig } from "../modelConfig";
```

Use this config:

```ts
function createModelConfig(): ModelCatalogConfig {
  return {
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
          },
          {
            id: "gw-image-creative",
            providerModelId: "gpt-image-1",
            displayName: "OmniAI Image Creative",
            capability: "image",
            tags: ["creative", "high-quality"],
            visibility: "visible",
            minimumPlan: "pro",
            creditUnitCost: 2
          },
          {
            id: "gw-text-hidden",
            providerModelId: "gpt-hidden",
            displayName: "Hidden Text",
            capability: "text",
            tags: ["hidden"],
            visibility: "hidden",
            minimumPlan: "pro",
            creditUnitCost: 2
          }
        ]
      },
      {
        id: "anthropic-main",
        displayName: "Anthropic Main",
        protocol: "anthropic-compatible",
        baseUrl: "https://api.anthropic.com",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        models: [
          {
            id: "gw-video-motion",
            providerModelId: "claude-compatible-video-motion",
            displayName: "OmniAI Video Motion",
            capability: "video",
            tags: ["motion", "async-task"],
            visibility: "visible",
            minimumPlan: "studio",
            creditUnitCost: 3
          },
          {
            id: "gw-text-maintenance",
            providerModelId: "claude-maintenance",
            displayName: "Maintenance Text",
            capability: "text",
            tags: ["maintenance"],
            visibility: "maintenance",
            minimumPlan: "pro",
            creditUnitCost: 2
          }
        ]
      }
    ]
  };
}

function createService(providerAdapter: ProviderAdapter = new FakeProviderAdapter()) {
  return new InMemoryGenerationService({
    clock: { now: () => fixedNow },
    idGenerator: () => "generation_task_000001",
    modelCatalog: new ConfigModelCatalog(createModelConfig()),
    providerAdapter
  });
}
```

Add tests:

```ts
it("validates text, image, and video models through the catalog", async () => {
  const service = createService();

  await expect(
    service.createTask({
      mode: "text",
      prompt: "帮我写一个新品发布文案",
      optimizedPrompt: "请生成一段新品推广文案。",
      preset: {
        modelId: "gw-text-balanced",
        parameters: { outputFormat: "markdown", tone: "clear" },
        creditEstimate: { credits: 1, unit: "credit" }
      }
    })
  ).resolves.toMatchObject({ mode: "text", status: "queued" });
  await expect(service.createTask(createImageRequest())).resolves.toMatchObject({
    mode: "image",
    preset: { modelId: "gw-image-creative" }
  });
  await expect(
    service.createTask({
      mode: "video",
      prompt: "生成一段咖啡拉花短视频",
      optimizedPrompt: "生成一段展示咖啡拉花过程的短视频。",
      preset: {
        modelId: "gw-video-motion",
        parameters: { durationSeconds: 6, aspectRatio: "16:9", resolution: "1080p" },
        creditEstimate: { credits: 18, unit: "credit" }
      }
    })
  ).resolves.toMatchObject({ mode: "video", status: "queued" });
});

it("rejects missing, hidden, maintenance, and mode-mismatched models", async () => {
  const service = createService();

  await expect(service.createTask({ ...createImageRequest(), preset: { ...createImageRequest().preset, modelId: "missing" } })).rejects.toMatchObject({
    message: "Model was not found",
    statusCode: 404
  });
  await expect(service.createTask({ ...createImageRequest(), mode: "text", preset: { ...createImageRequest().preset, modelId: "gw-text-hidden" } })).rejects.toMatchObject({
    message: "Model was not found",
    statusCode: 404
  });
  await expect(service.createTask({ ...createImageRequest(), mode: "text", preset: { ...createImageRequest().preset, modelId: "gw-text-maintenance" } })).rejects.toMatchObject({
    message: "Model is temporarily unavailable",
    statusCode: 409
  });
  await expect(service.createTask({ ...createImageRequest(), mode: "text" })).rejects.toMatchObject({
    message: "Model does not support this creation mode",
    statusCode: 400
  });
});

it("maps provider adapter failures", async () => {
  const service = createService({
    submitGeneration: async () => {
      throw new ProviderAdapterError("Provider adapter failed", 502);
    }
  });

  await expect(service.createTask(createImageRequest())).rejects.toMatchObject({
    message: "Provider adapter failed",
    statusCode: 502
  });
});
```

- [ ] **Step 2: Run generation service tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- generationService.test.ts
```

Expected: FAIL because `InMemoryGenerationService` does not accept catalog/adapter and `createTask` is not async.

- [ ] **Step 3: Implement generation service integration**

Modify `apps/api/src/services/generationService.ts`:

- Import `ProviderAdapter`, `ProviderAdapterError`, `FakeProviderAdapter`.
- Import `ModelCatalog`, `ModelCatalogError`.
- Update `GenerationService`:

```ts
export interface GenerationService {
  createTask(request: GenerationTaskRequest): GenerationTask | Promise<GenerationTask>;
  listTasks(): GenerationTask[];
}
```

- Update `GenerationServiceOptions`:

```ts
modelCatalog?: ModelCatalog;
providerAdapter?: ProviderAdapter;
userId?: string;
```

- Require a `modelCatalog` and `providerAdapter` when constructing `InMemoryGenerationService` for provider-backed generation. Update all service tests to inject `ConfigModelCatalog` and `FakeProviderAdapter`; do not add a legacy fallback catalog.
- In `createTask`, after validating preset, call:

```ts
const modelReference = this.modelCatalog.getModelReference(preset.modelId, mode);
if (modelReference.product.visibility === "maintenance") {
  throw new GenerationTaskError("Model is temporarily unavailable", 409);
}
await this.providerAdapter.submitGeneration({
  mode,
  productModelId: modelReference.product.id,
  provider: modelReference.provider,
  providerModelId: modelReference.providerModelId,
  optimizedPrompt,
  parameters: { ...preset.parameters },
  userId: this.userId
});
```

- Catch and remap:
  - `ModelCatalogError` to `GenerationTaskError(error.message, error.statusCode)`.
  - `ProviderAdapterError` to `GenerationTaskError(error.message, error.statusCode)`.
  - Unknown adapter errors to `GenerationTaskError("Provider adapter failed", 502)`.
- Keep task shape unchanged and keep defensive copies.

- [ ] **Step 4: Run Task 4 verification**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- generationService.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/api/src/services/generationService.ts apps/api/src/services/__tests__/generationService.test.ts
git commit -m "feat: validate generation models through provider adapter"
```

## Task 5: Model and Generation Routes plus Server Wiring

**Files:**
- Modify: `apps/api/src/routes/models.ts`
- Create: `apps/api/src/routes/__tests__/models.test.ts`
- Modify: `apps/api/src/routes/generations.ts`
- Modify: `apps/api/src/routes/__tests__/generations.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/server.test.ts`

- [ ] **Step 1: Write failing model route tests**

Create `apps/api/src/routes/__tests__/models.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import { ConfigModelCatalog } from "../../services/modelCatalog";
import type { ModelCatalogConfig } from "../../services/modelConfig";

function createConfig(): ModelCatalogConfig {
  return {
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
          },
          {
            id: "gw-text-hidden",
            providerModelId: "gpt-hidden",
            displayName: "Hidden Text",
            capability: "text",
            tags: ["hidden"],
            visibility: "hidden",
            minimumPlan: "pro",
            creditUnitCost: 2
          }
        ]
      }
    ]
  };
}

describe("model routes", () => {
  it("returns visible product-facing models from the injected catalog", async () => {
    const server = buildServer({
      modelCatalog: new ConfigModelCatalog(createConfig())
    });
    const response = await server.inject({ method: "GET", url: "/v1/models" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      models: [
        {
          id: "gw-text-balanced",
          displayName: "OmniAI Text Balanced",
          capability: "text",
          tags: ["recommended", "balanced"],
          visibility: "visible",
          minimumPlan: "free",
          creditUnitCost: 1
        }
      ]
    });
    expect(JSON.stringify(response.json())).not.toContain("providerModelId");
    expect(JSON.stringify(response.json())).not.toContain("apiKeyEnv");
  });
});
```

- [ ] **Step 2: Write failing generation route tests**

Modify `apps/api/src/routes/__tests__/generations.test.ts`:

- Make fake async service test:

```ts
it("maps async rejected generation service errors to a 500 response", async () => {
  const generationService = {
    createTask: async () => {
      throw new Error("boom");
    },
    listTasks: () => []
  } as unknown as GenerationService;
  const server = buildServer({ generationService });
  const response = await server.inject({
    method: "POST",
    url: "/v1/generations",
    payload: createImagePayload()
  });

  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({
    error: "Unexpected generation task error"
  });
});
```

- Add domain errors for new model validation:

```ts
it("maps model catalog generation errors to HTTP responses", async () => {
  const server = buildGenerationTestServer();
  const missingModel = await server.inject({
    method: "POST",
    url: "/v1/generations",
    payload: {
      ...createImagePayload(),
      preset: { ...createImagePayload().preset, modelId: "missing" }
    }
  });
  const mismatch = await server.inject({
    method: "POST",
    url: "/v1/generations",
    payload: {
      ...createImagePayload(),
      mode: "text"
    }
  });

  expect(missingModel.statusCode).toBe(404);
  expect(missingModel.json()).toEqual({ error: "Model was not found" });
  expect(mismatch.statusCode).toBe(400);
  expect(mismatch.json()).toEqual({ error: "Model does not support this creation mode" });
});
```

Update `buildGenerationTestServer()` so it injects `modelCatalog` / `providerAdapter` or uses the updated service helper from Task 4.

- [ ] **Step 3: Update server tests to fail for new wiring**

Modify `apps/api/src/__tests__/server.test.ts`:

- Include `modelConfigPath` in any explicit `config` object:

```ts
modelConfigPath: "config/models.json"
```

- Update the invalid env injection test to inject a fake model catalog:

```ts
const fakeModelCatalog = {
  listVisibleModels: () => [],
  getModelReference: () => {
    throw new Error("not implemented");
  }
};
```

Call:

```ts
buildServer({
  authService: fakeAuthService,
  generationService: fakeGenerationService,
  assetService: fakeAssetService,
  modelCatalog: fakeModelCatalog
})
```

- Keep default `/v1/models` expectation at the current three visible product models.

- [ ] **Step 4: Run route/server tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- models.test.ts generations.test.ts server.test.ts
```

Expected: FAIL because model route does not accept catalog injection, generation route does not await async service, and server does not wire config-backed catalog.

- [ ] **Step 5: Implement route and server wiring**

Modify `apps/api/src/routes/models.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { ModelCatalog } from "../services/modelCatalog";

export function registerModelRoutes(server: FastifyInstance, modelCatalog: ModelCatalog): void {
  server.get("/v1/models", async () => ({
    models: modelCatalog.listVisibleModels()
  }));
}
```

Modify `apps/api/src/routes/generations.ts`:

- Add semicolons to match current code style if touching lines.
- In POST handler use:

```ts
const task = await generationService.createTask(generationRequest);
```

- Optionally wrap GET list errors with `sendGenerationTaskError` for stable response shape.

Modify `apps/api/src/server.ts`:

- Add imports:

```ts
import { FakeProviderAdapter, type ProviderAdapter } from "./services/gatewayClient";
import { loadModelCatalogConfig } from "./services/modelConfig";
import { ConfigModelCatalog, type ModelCatalog } from "./services/modelCatalog";
```

- Extend `BuildServerOptions`:

```ts
modelCatalog?: ModelCatalog;
providerAdapter?: ProviderAdapter;
```

- Use lazy config and lazy catalog:

```ts
let loadedConfig = options.config;
function getConfig() {
  loadedConfig ??= loadConfig();
  return loadedConfig;
}

let loadedModelCatalog = options.modelCatalog;
function getModelCatalog() {
  loadedModelCatalog ??= new ConfigModelCatalog(loadModelCatalogConfig(getConfig().modelConfigPath));
  return loadedModelCatalog;
}
```

- Auth service uses `getConfig().authDevCodesEnabled`.
- Generation service default:

```ts
const providerAdapter = options.providerAdapter ?? new FakeProviderAdapter();
const generationService =
  options.generationService ??
  new InMemoryGenerationService({
    modelCatalog: getModelCatalog(),
    providerAdapter
  });
```

- Register:

```ts
registerModelRoutes(server, {
  listVisibleModels: () => getModelCatalog().listVisibleModels(),
  getModelReference: (modelId, mode) => getModelCatalog().getModelReference(modelId, mode)
});
```

This preserves lazy construction when tests inject services and never hit `/v1/models`.

- [ ] **Step 6: Run Task 5 verification**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- models.test.ts generations.test.ts server.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add apps/api/src/routes/models.ts apps/api/src/routes/__tests__/models.test.ts apps/api/src/routes/generations.ts apps/api/src/routes/__tests__/generations.test.ts apps/api/src/server.ts apps/api/src/__tests__/server.test.ts
git commit -m "feat: wire provider catalog into generation API"
```

## Task 6: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update README**

Add this section after `### Asset Library MVP` and before `## Validation`:

```md
### Provider Adapter Foundation

The fourth product-first slice adds the model catalog and provider adapter foundation behind the existing creation workflow.

- `config/models.json` declares product-facing text, image, and video models.
- OpenAI-compatible and Anthropic-compatible providers can use any configured `providerModelId`.
- `/v1/models` returns product fields only and does not expose provider model IDs, base URLs, or API key env names.
- `/v1/generations` still accepts the product `mode`, prompt, optimized prompt, and preset contract.
- The current provider adapter is a fake dry-run adapter. It does not read provider API keys and does not send network requests.
- Real provider HTTP clients, streaming, persistence, file storage, credit mutation, and automatic asset creation remain later slices.

Set `GW_LINK_MODEL_CONFIG_PATH=/absolute/path/to/models.json` to load another model catalog.
```

- [ ] **Step 2: Update architecture documentation**

Add this section after `## Asset Library Slice` and before `## First Implementation Slice` in `docs/architecture/mvp-skeleton.md`:

```md
## Provider Adapter Foundation Slice

The provider adapter foundation keeps provider configuration behind the product API. Product requests still use `GenerationTaskRequest`, while the API resolves `preset.modelId` through an internal model catalog before submitting a fake provider dry-run.

`config/models.json` declares product model IDs, provider model IDs, provider protocol, provider base URL, API key environment names, visibility, plan level, tags, and credit unit cost. `/v1/models` exposes only product-facing fields; provider details stay server-side.

The fake provider adapter supports OpenAI-compatible and Anthropic-compatible protocol dispatch without reading API keys or making network calls. This prepares the codebase for real provider HTTP clients without turning GW-LINK OmniAI into a gateway product or changing the text, image, and video creation workflow.
```

- [ ] **Step 3: Run full workspace verification**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit Task 6**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document provider adapter foundation"
```

## Final Review Checklist

- [ ] `GenerationTaskRequest` remains product-first and unchanged.
- [ ] Provider fields do not appear in shared task or asset contracts.
- [ ] `config/models.json` includes visible text/image/video models.
- [ ] OpenAI-compatible and Anthropic-compatible protocols are both validated and dispatched.
- [ ] Provider model IDs are configurable and not hardcoded as a fixed supplier list.
- [ ] `/v1/models` exposes only product-facing fields.
- [ ] `GenerationService` validates `preset.modelId` through `ModelCatalog`.
- [ ] hidden/missing/maintenance/mode mismatch/provider failure errors are stable.
- [ ] Fake provider adapter does not read API keys or send network requests.
- [ ] Server injection behavior remains testable without forcing environment config loads.
- [ ] Desktop fixture model IDs match default visible model IDs.
- [ ] README and architecture docs state that this is not a gateway product and real HTTP provider calls are later.
- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
