# GW-LINK OmniAI Text Model Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the configuration-driven text model catalog and fake OpenAI-compatible / Anthropic-compatible generation gateway slice.

**Architecture:** Add shared provider/model contracts, load `config/models.json` through the API config boundary, expose product-facing models through `ModelCatalog`, submit text generation tasks through `GenerationService`, and route protocol-specific fake gateway behavior behind a single `GatewayClient` interface. The slice returns queued tasks only and does not call real provider networks.

**Tech Stack:** TypeScript, Vitest, Fastify, Node.js fs/path APIs, pnpm workspaces.

---

## Scope Check

The design spec covers one independent backend slice: text model configuration, model catalog output, and text generation task submission through fake provider adapters. This plan excludes real HTTP provider calls, image/video adapters, task polling, task persistence, billing, auth enforcement, streaming, and admin-managed model configuration.

## File Structure

- Modify: `packages/shared/src/models.ts` - add provider protocol, model config, catalog reference, and generation submit request contracts.
- Modify: `packages/shared/src/index.ts` - export the new shared contracts.
- Create: `packages/shared/src/__tests__/models.test.ts` - compile/runtime tests for shared model contracts.
- Modify: `apps/api/src/config.ts` - add `modelConfigPath` from `GW_LINK_MODEL_CONFIG_PATH`.
- Modify: `apps/api/src/__tests__/config.test.ts` - verify default and env-overridden model config path behavior.
- Create: `config/models.json` - default local OpenAI-compatible and Anthropic-compatible text model catalog.
- Create: `apps/api/src/services/modelConfig.ts` - load and validate model configuration JSON.
- Create: `apps/api/src/services/__tests__/modelConfig.test.ts` - file loading and schema validation tests.
- Modify: `apps/api/src/services/modelCatalog.ts` - replace hardcoded model array with config-backed catalog class.
- Create: `apps/api/src/services/__tests__/modelCatalog.test.ts` - catalog filtering and lookup tests.
- Modify: `apps/api/src/services/gatewayClient.ts` - replace stub with fake provider-protocol gateway dispatch.
- Create: `apps/api/src/services/__tests__/gatewayClient.test.ts` - fake OpenAI/Anthropic gateway tests.
- Create: `apps/api/src/services/generationService.ts` - business orchestration for text generation submission.
- Create: `apps/api/src/services/__tests__/generationService.test.ts` - success and domain error tests.
- Modify: `apps/api/src/routes/models.ts` - inject `ModelCatalog`.
- Create: `apps/api/src/routes/generations.ts` - register `POST /v1/generations`.
- Create: `apps/api/src/routes/__tests__/generations.test.ts` - route tests for generation submission.
- Modify: `apps/api/src/server.ts` - wire config, catalog, gateway client, generation service, and routes.
- Modify: `apps/api/src/__tests__/server.test.ts` - update default model expectations and `ApiConfig` fixtures.
- Modify: `README.md` - document model config path and local fake gateway behavior.
- Modify: `docs/architecture/mvp-skeleton.md` - document the new backend slice boundary.

## Task 1: Shared Model Gateway Contracts

**Files:**
- Modify: `packages/shared/src/models.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/models.test.ts`

- [ ] **Step 1: Write the failing shared model contract test**

Create `packages/shared/src/__tests__/models.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CatalogModelReference, GenerationSubmitRequest, ModelCatalogConfig } from "../models";

describe("model gateway contracts", () => {
  it("represents provider-backed text model configuration", () => {
    const config: ModelCatalogConfig = {
      providers: [
        {
          id: "openai-main",
          displayName: "OpenAI Main",
          protocol: "openai-compatible",
          baseUrl: "https://api.openai.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
          models: [
            {
              id: "gw-text-gpt-4.1",
              providerModelId: "gpt-4.1",
              displayName: "GPT-4.1",
              capability: "text",
              tags: ["openai", "reasoning"],
              visibility: "visible",
              minimumPlan: "pro",
              creditUnitCost: 2
            }
          ]
        }
      ]
    };

    expect(config.providers[0]?.protocol).toBe("openai-compatible");
    expect(config.providers[0]?.models[0]?.providerModelId).toBe("gpt-4.1");
  });

  it("represents an internal catalog reference without changing product model fields", () => {
    const reference: CatalogModelReference = {
      product: {
        id: "gw-text-claude-sonnet",
        displayName: "Claude Sonnet",
        capability: "text",
        tags: ["anthropic", "writing"],
        visibility: "visible",
        minimumPlan: "pro",
        creditUnitCost: 2
      },
      provider: {
        id: "anthropic-main",
        displayName: "Anthropic Main",
        protocol: "anthropic-compatible",
        baseUrl: "https://api.anthropic.com",
        apiKeyEnv: "ANTHROPIC_API_KEY"
      },
      providerModelId: "claude-sonnet-4-5"
    };

    expect(reference.product.id).toBe("gw-text-claude-sonnet");
    expect(reference.provider.protocol).toBe("anthropic-compatible");
  });

  it("represents a text generation submit request", () => {
    const request: GenerationSubmitRequest = {
      modelId: "gw-text-gpt-4.1",
      capability: "text",
      prompt: "写一个产品介绍"
    };

    expect(request.capability).toBe("text");
  });
});
```

- [ ] **Step 2: Run the shared model contract test to verify it fails**

Run:

```bash
pnpm --filter @gw-link-omniai/shared test -- models.test.ts
```

Expected: FAIL with TypeScript errors because `ModelCatalogConfig`, `CatalogModelReference`, and `GenerationSubmitRequest` are not exported from `packages/shared/src/models.ts`.

- [ ] **Step 3: Add shared model gateway contracts**

Modify `packages/shared/src/models.ts` to this complete content:

```ts
export type ModelCapability = "text" | "image" | "video";

export type TextModelCapability = Extract<ModelCapability, "text">;

export type ModelVisibility = "visible" | "hidden" | "maintenance";

export type PlanCode = "free" | "pro" | "studio";

export type ProviderProtocol = "openai-compatible" | "anthropic-compatible";

export interface ProductModel {
  id: string;
  displayName: string;
  capability: ModelCapability;
  tags: string[];
  visibility: ModelVisibility;
  minimumPlan: PlanCode;
  creditUnitCost: number;
}

export interface ProviderModelConfig {
  id: string;
  providerModelId: string;
  displayName: string;
  capability: TextModelCapability;
  tags: string[];
  visibility: ModelVisibility;
  minimumPlan: PlanCode;
  creditUnitCost: number;
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

export interface GenerationSubmitRequest {
  modelId: string;
  capability: ModelCapability;
  prompt: string;
}

export type GenerationTaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface GenerationTask {
  id: string;
  capability: ModelCapability;
  status: GenerationTaskStatus;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  creditEstimate: CreditAmount;
}

export interface CreditAmount {
  credits: number;
  unit: "credit";
}
```

Modify `packages/shared/src/index.ts` so the model export block includes the new types:

```ts
export type {
  AuthSession,
  LoginChannel,
  LoginStartRequest,
  LoginStartResponse,
  LoginVerifyRequest,
  SessionResponse,
  UserProfile
} from "./auth";
export { inferLoginChannel, maskLoginDestination } from "./auth";
export type {
  CatalogModelReference,
  CatalogProviderReference,
  CreditAmount,
  GenerationSubmitRequest,
  GenerationTask,
  GenerationTaskStatus,
  ModelCatalogConfig,
  ModelCapability,
  ModelProviderConfig,
  ModelVisibility,
  PlanCode,
  ProductModel,
  ProviderModelConfig,
  ProviderProtocol,
  TextModelCapability
} from "./models";
export { estimateCreditCost } from "./credits";
export type { CreditEstimateInput } from "./credits";
```

- [ ] **Step 4: Run shared tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/shared test
pnpm --filter @gw-link-omniai/shared typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/models.ts packages/shared/src/index.ts packages/shared/src/__tests__/models.test.ts
git commit -m "feat: add shared model gateway contracts"
```

## Task 2: API Config Path and Default Model Config

**Files:**
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/__tests__/config.test.ts`
- Create: `config/models.json`

- [ ] **Step 1: Write the failing API config tests**

Modify `apps/api/src/__tests__/config.test.ts` to include these assertions while preserving existing port and auth dev-code tests:

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

describe("loadConfig", () => {
  it("loads defaults for local development", () => {
    expect(loadConfig({})).toEqual({
      port: 8787,
      gatewayBaseUrl: "https://gateway.gw-link.local",
      authDevCodesEnabled: true,
      modelConfigPath: expect.stringContaining("config/models.json")
    });
  });

  it("loads model config path from GW_LINK_MODEL_CONFIG_PATH", () => {
    expect(
      loadConfig({
        GW_LINK_MODEL_CONFIG_PATH: "/tmp/gw-link-models.json"
      }).modelConfigPath
    ).toBe("/tmp/gw-link-models.json");
  });

  it("disables auth dev codes by default in production", () => {
    expect(loadConfig({ NODE_ENV: "production" }).authDevCodesEnabled).toBe(false);
  });

  it("rejects invalid ports", () => {
    expect(() => loadConfig({ PORT: "70000" })).toThrow("PORT must be an integer between 1 and 65535");
  });

  it("rejects invalid auth dev code flags", () => {
    expect(() => loadConfig({ GW_LINK_AUTH_DEV_CODES_ENABLED: "yes" })).toThrow(
      'GW_LINK_AUTH_DEV_CODES_ENABLED must be "true" or "false"'
    );
  });
});
```

- [ ] **Step 2: Run config tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- config.test.ts
```

Expected: FAIL because `modelConfigPath` is not returned by `loadConfig`.

- [ ] **Step 3: Add model config path support**

Modify `apps/api/src/config.ts` to this complete content:

```ts
import { fileURLToPath } from "node:url";

export interface ApiConfig {
  port: number;
  gatewayBaseUrl: string;
  authDevCodesEnabled: boolean;
  modelConfigPath: string;
}

const defaultModelConfigPath = fileURLToPath(new URL("../../../config/models.json", import.meta.url));

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 8787;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

function parseAuthDevCodesEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.GW_LINK_AUTH_DEV_CODES_ENABLED;

  if (value === undefined) {
    return env.NODE_ENV === "production" ? false : true;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error('GW_LINK_AUTH_DEV_CODES_ENABLED must be "true" or "false"');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    port: parsePort(env.PORT),
    gatewayBaseUrl: env.GW_LINK_GATEWAY_BASE_URL ?? "https://gateway.gw-link.local",
    authDevCodesEnabled: parseAuthDevCodesEnabled(env),
    modelConfigPath: env.GW_LINK_MODEL_CONFIG_PATH ?? defaultModelConfigPath
  };
}
```

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
          "id": "gw-text-gpt-4.1",
          "providerModelId": "gpt-4.1",
          "displayName": "GPT-4.1",
          "capability": "text",
          "tags": ["openai", "reasoning"],
          "visibility": "visible",
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
          "id": "gw-text-claude-sonnet",
          "providerModelId": "claude-sonnet-4-5",
          "displayName": "Claude Sonnet",
          "capability": "text",
          "tags": ["anthropic", "writing"],
          "visibility": "visible",
          "minimumPlan": "pro",
          "creditUnitCost": 2
        }
      ]
    }
  ]
}
```

Update any existing `ApiConfig` test fixtures in `apps/api/src/__tests__/server.test.ts` so each fixture includes:

```ts
modelConfigPath: "config/models.json"
```

- [ ] **Step 4: Run API config tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- config.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/__tests__/config.test.ts apps/api/src/__tests__/server.test.ts config/models.json
git commit -m "feat: add model config path"
```

## Task 3: Model Config Loader

**Files:**
- Create: `apps/api/src/services/modelConfig.ts`
- Create: `apps/api/src/services/__tests__/modelConfig.test.ts`

- [ ] **Step 1: Write the failing model config loader tests**

Create `apps/api/src/services/__tests__/modelConfig.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModelConfigError, loadModelCatalogConfig, parseModelCatalogConfig } from "../modelConfig";

const validConfig = {
  providers: [
    {
      id: "openai-main",
      displayName: "OpenAI Main",
      protocol: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      models: [
        {
          id: "gw-text-gpt-4.1",
          providerModelId: "gpt-4.1",
          displayName: "GPT-4.1",
          capability: "text",
          tags: ["openai"],
          visibility: "visible",
          minimumPlan: "pro",
          creditUnitCost: 2
        }
      ]
    }
  ]
};

describe("modelConfig", () => {
  it("loads model catalog config from a JSON file", () => {
    const directory = mkdtempSync(join(tmpdir(), "gw-link-models-"));
    const path = join(directory, "models.json");
    writeFileSync(path, JSON.stringify(validConfig), "utf8");

    expect(loadModelCatalogConfig(path)).toEqual(validConfig);
  });

  it("rejects malformed JSON", () => {
    const directory = mkdtempSync(join(tmpdir(), "gw-link-models-"));
    const path = join(directory, "models.json");
    writeFileSync(path, "{", "utf8");

    expect(() => loadModelCatalogConfig(path)).toThrow(ModelConfigError);
    expect(() => loadModelCatalogConfig(path)).toThrow("Model config JSON is invalid");
  });

  it("rejects duplicate product model ids across providers", () => {
    expect(() =>
      parseModelCatalogConfig({
        providers: [
          validConfig.providers[0],
          {
            ...validConfig.providers[0],
            id: "anthropic-main",
            protocol: "anthropic-compatible"
          }
        ]
      })
    ).toThrow('Duplicate model id "gw-text-gpt-4.1"');
  });

  it("rejects unsupported protocols", () => {
    expect(() =>
      parseModelCatalogConfig({
        providers: [
          {
            ...validConfig.providers[0],
            protocol: "other-compatible"
          }
        ]
      })
    ).toThrow("Provider protocol must be supported");
  });

  it("rejects non-text model config in this phase", () => {
    expect(() =>
      parseModelCatalogConfig({
        providers: [
          {
            ...validConfig.providers[0],
            models: [
              {
                ...validConfig.providers[0].models[0],
                capability: "image"
              }
            ]
          }
        ]
      })
    ).toThrow("Model capability must be text");
  });
});
```

- [ ] **Step 2: Run model config loader tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- modelConfig.test.ts
```

Expected: FAIL because `apps/api/src/services/modelConfig.ts` does not exist.

- [ ] **Step 3: Implement the model config loader**

Create `apps/api/src/services/modelConfig.ts`:

```ts
import { readFileSync } from "node:fs";
import type {
  ModelCatalogConfig,
  ModelProviderConfig,
  ModelVisibility,
  PlanCode,
  ProviderModelConfig,
  ProviderProtocol
} from "@gw-link-omniai/shared";

export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigError";
  }
}

export function loadModelCatalogConfig(path: string): ModelCatalogConfig {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ModelConfigError("Model config JSON is invalid");
    }

    throw error;
  }

  return parseModelCatalogConfig(parsed);
}

export function parseModelCatalogConfig(raw: unknown): ModelCatalogConfig {
  const root = readRecord(raw, "Model config must be an object");
  const providersRaw = root.providers;

  if (!Array.isArray(providersRaw) || providersRaw.length === 0) {
    throw new ModelConfigError("Model config providers must be a non-empty array");
  }

  const seenModelIds = new Set<string>();
  const providers = providersRaw.map((providerRaw) => parseProvider(providerRaw, seenModelIds));

  return { providers };
}

function parseProvider(raw: unknown, seenModelIds: Set<string>): ModelProviderConfig {
  const provider = readRecord(raw, "Provider config must be an object");
  const id = readNonEmptyString(provider.id, "Provider id is required");
  const displayName = readNonEmptyString(provider.displayName, "Provider display name is required");
  const protocol = readProtocol(provider.protocol);
  const baseUrl = readNonEmptyString(provider.baseUrl, "Provider base URL is required");
  const apiKeyEnv = readNonEmptyString(provider.apiKeyEnv, "Provider API key env is required");

  if (!Array.isArray(provider.models)) {
    throw new ModelConfigError("Provider models must be an array");
  }

  return {
    id,
    displayName,
    protocol,
    baseUrl,
    apiKeyEnv,
    models: provider.models.map((modelRaw) => parseModel(modelRaw, seenModelIds))
  };
}

function parseModel(raw: unknown, seenModelIds: Set<string>): ProviderModelConfig {
  const model = readRecord(raw, "Model config must be an object");
  const id = readNonEmptyString(model.id, "Model id is required");

  if (seenModelIds.has(id)) {
    throw new ModelConfigError(`Duplicate model id "${id}"`);
  }

  seenModelIds.add(id);

  return {
    id,
    providerModelId: readNonEmptyString(model.providerModelId, "Provider model id is required"),
    displayName: readNonEmptyString(model.displayName, "Model display name is required"),
    capability: readTextCapability(model.capability),
    tags: readStringArray(model.tags, "Model tags must be a string array"),
    visibility: readVisibility(model.visibility),
    minimumPlan: readPlanCode(model.minimumPlan),
    creditUnitCost: readPositiveNumber(model.creditUnitCost, "Model credit unit cost must be greater than 0")
  };
}

function readRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ModelConfigError(message);
  }

  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ModelConfigError(message);
  }

  return value;
}

function readStringArray(value: unknown, message: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ModelConfigError(message);
  }

  return value;
}

function readProtocol(value: unknown): ProviderProtocol {
  if (value === "openai-compatible" || value === "anthropic-compatible") {
    return value;
  }

  throw new ModelConfigError("Provider protocol must be supported");
}

function readTextCapability(value: unknown): "text" {
  if (value === "text") {
    return value;
  }

  throw new ModelConfigError("Model capability must be text");
}

function readVisibility(value: unknown): ModelVisibility {
  if (value === "visible" || value === "hidden" || value === "maintenance") {
    return value;
  }

  throw new ModelConfigError("Model visibility must be supported");
}

function readPlanCode(value: unknown): PlanCode {
  if (value === "free" || value === "pro" || value === "studio") {
    return value;
  }

  throw new ModelConfigError("Model minimum plan must be supported");
}

function readPositiveNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ModelConfigError(message);
  }

  return value;
}
```

- [ ] **Step 4: Run model config loader tests**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- modelConfig.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/modelConfig.ts apps/api/src/services/__tests__/modelConfig.test.ts
git commit -m "feat: load model catalog config"
```

## Task 4: Config-Backed Model Catalog

**Files:**
- Modify: `apps/api/src/services/modelCatalog.ts`
- Create: `apps/api/src/services/__tests__/modelCatalog.test.ts`

- [ ] **Step 1: Write the failing model catalog tests**

Create `apps/api/src/services/__tests__/modelCatalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ModelCatalogConfig } from "@gw-link-omniai/shared";
import { ConfigModelCatalog } from "../modelCatalog";

const config: ModelCatalogConfig = {
  providers: [
    {
      id: "openai-main",
      displayName: "OpenAI Main",
      protocol: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      models: [
        {
          id: "gw-text-visible",
          providerModelId: "gpt-4.1",
          displayName: "Visible Text",
          capability: "text",
          tags: ["visible"],
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
          minimumPlan: "free",
          creditUnitCost: 1
        },
        {
          id: "gw-text-maintenance",
          providerModelId: "gpt-maintenance",
          displayName: "Maintenance Text",
          capability: "text",
          tags: ["maintenance"],
          visibility: "maintenance",
          minimumPlan: "studio",
          creditUnitCost: 3
        }
      ]
    }
  ]
};

describe("ConfigModelCatalog", () => {
  it("lists only visible product models without provider internals", () => {
    const catalog = new ConfigModelCatalog(config);

    expect(catalog.listVisibleModels()).toEqual([
      {
        id: "gw-text-visible",
        displayName: "Visible Text",
        capability: "text",
        tags: ["visible"],
        visibility: "visible",
        minimumPlan: "pro",
        creditUnitCost: 2
      }
    ]);
    expect(catalog.listVisibleModels()[0]).not.toHaveProperty("providerModelId");
    expect(catalog.listVisibleModels()[0]).not.toHaveProperty("baseUrl");
  });

  it("returns an internal model reference for visible and maintenance models", () => {
    const catalog = new ConfigModelCatalog(config);

    expect(catalog.getTextModel("gw-text-visible")).toMatchObject({
      providerModelId: "gpt-4.1",
      provider: {
        id: "openai-main",
        protocol: "openai-compatible"
      },
      product: {
        id: "gw-text-visible",
        visibility: "visible"
      }
    });
    expect(catalog.getTextModel("gw-text-maintenance")).toMatchObject({
      product: {
        id: "gw-text-maintenance",
        visibility: "maintenance"
      }
    });
  });

  it("treats hidden and missing models as not found", () => {
    const catalog = new ConfigModelCatalog(config);

    expect(catalog.getTextModel("gw-text-hidden")).toBeUndefined();
    expect(catalog.getTextModel("missing")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run model catalog tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- modelCatalog.test.ts
```

Expected: FAIL because `ConfigModelCatalog` does not exist.

- [ ] **Step 3: Implement config-backed model catalog**

Modify `apps/api/src/services/modelCatalog.ts` to this complete content:

```ts
import type { CatalogModelReference, ModelCatalogConfig, ProductModel } from "@gw-link-omniai/shared";

export interface ModelCatalog {
  listVisibleModels(): ProductModel[];
  getTextModel(modelId: string): CatalogModelReference | undefined;
}

export class ConfigModelCatalog implements ModelCatalog {
  private readonly modelsById = new Map<string, CatalogModelReference>();

  constructor(config: ModelCatalogConfig) {
    for (const provider of config.providers) {
      for (const model of provider.models) {
        const reference: CatalogModelReference = {
          product: toProductModel(model),
          provider: {
            id: provider.id,
            displayName: provider.displayName,
            protocol: provider.protocol,
            baseUrl: provider.baseUrl,
            apiKeyEnv: provider.apiKeyEnv
          },
          providerModelId: model.providerModelId
        };

        this.modelsById.set(model.id, reference);
      }
    }
  }

  listVisibleModels(): ProductModel[] {
    return Array.from(this.modelsById.values())
      .map((reference) => reference.product)
      .filter((model) => model.visibility === "visible")
      .map(cloneProductModel);
  }

  getTextModel(modelId: string): CatalogModelReference | undefined {
    const reference = this.modelsById.get(modelId);

    if (!reference || reference.product.visibility === "hidden" || reference.product.capability !== "text") {
      return undefined;
    }

    return {
      product: cloneProductModel(reference.product),
      provider: { ...reference.provider },
      providerModelId: reference.providerModelId
    };
  }
}

function toProductModel(model: CatalogModelReference["product"] & { providerModelId?: string }): ProductModel {
  return {
    id: model.id,
    displayName: model.displayName,
    capability: model.capability,
    tags: [...model.tags],
    visibility: model.visibility,
    minimumPlan: model.minimumPlan,
    creditUnitCost: model.creditUnitCost
  };
}

function cloneProductModel(model: ProductModel): ProductModel {
  return {
    ...model,
    tags: [...model.tags]
  };
}
```

- [ ] **Step 4: Run model catalog tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- modelCatalog.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/modelCatalog.ts apps/api/src/services/__tests__/modelCatalog.test.ts
git commit -m "feat: add config backed model catalog"
```

## Task 5: Fake Provider Gateway Client

**Files:**
- Modify: `apps/api/src/services/gatewayClient.ts`
- Create: `apps/api/src/services/__tests__/gatewayClient.test.ts`

- [ ] **Step 1: Write the failing gateway client tests**

Create `apps/api/src/services/__tests__/gatewayClient.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CatalogModelReference, CreditAmount } from "@gw-link-omniai/shared";
import { FakeGatewayClient, GatewayClientError } from "../gatewayClient";

const creditEstimate: CreditAmount = { credits: 2, unit: "credit" };

function buildReference(protocol: "openai-compatible" | "anthropic-compatible"): CatalogModelReference {
  return {
    product: {
      id: protocol === "openai-compatible" ? "gw-text-gpt-4.1" : "gw-text-claude-sonnet",
      displayName: protocol === "openai-compatible" ? "GPT-4.1" : "Claude Sonnet",
      capability: "text",
      tags: [protocol],
      visibility: "visible",
      minimumPlan: "pro",
      creditUnitCost: 2
    },
    provider: {
      id: protocol === "openai-compatible" ? "openai-main" : "anthropic-main",
      displayName: protocol,
      protocol,
      baseUrl: "https://provider.example.test",
      apiKeyEnv: "PROVIDER_API_KEY"
    },
    providerModelId: protocol === "openai-compatible" ? "gpt-4.1" : "claude-sonnet-4-5"
  };
}

describe("FakeGatewayClient", () => {
  it("submits an OpenAI-compatible text task", async () => {
    const client = new FakeGatewayClient({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      taskIdGenerator: () => "task_openai_1"
    });

    await expect(
      client.submitGeneration({
        model: buildReference("openai-compatible"),
        prompt: "Write a launch post",
        userId: "user-dev",
        creditEstimate
      })
    ).resolves.toEqual({
      id: "task_openai_1",
      capability: "text",
      status: "queued",
      modelId: "gw-text-gpt-4.1",
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
      creditEstimate
    });
  });

  it("submits an Anthropic-compatible text task", async () => {
    const client = new FakeGatewayClient({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      taskIdGenerator: () => "task_anthropic_1"
    });

    const task = await client.submitGeneration({
      model: buildReference("anthropic-compatible"),
      prompt: "Write a launch post",
      userId: "user-dev",
      creditEstimate
    });

    expect(task).toMatchObject({
      id: "task_anthropic_1",
      capability: "text",
      status: "queued",
      modelId: "gw-text-claude-sonnet",
      creditEstimate
    });
  });

  it("rejects unsupported provider protocols", async () => {
    const client = new FakeGatewayClient();
    const model = buildReference("openai-compatible");
    model.provider.protocol = "unsupported-compatible" as "openai-compatible";

    await expect(
      client.submitGeneration({
        model,
        prompt: "Write a launch post",
        userId: "user-dev",
        creditEstimate
      })
    ).rejects.toMatchObject({
      code: "unsupported_protocol"
    });
  });
});
```

- [ ] **Step 2: Run gateway client tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- gatewayClient.test.ts
```

Expected: FAIL because `FakeGatewayClient` and `GatewayClientError` do not exist.

- [ ] **Step 3: Implement fake provider gateway dispatch**

Modify `apps/api/src/services/gatewayClient.ts` to this complete content:

```ts
import type { CatalogModelReference, CreditAmount, GenerationTask } from "@gw-link-omniai/shared";

export interface GatewayGenerationRequest {
  model: CatalogModelReference;
  prompt: string;
  userId: string;
  creditEstimate: CreditAmount;
}

export interface GatewayClient {
  submitGeneration(request: GatewayGenerationRequest): Promise<GenerationTask>;
}

export type GatewayClientErrorCode = "unsupported_protocol" | "submit_failed";

export class GatewayClientError extends Error {
  constructor(
    message: string,
    public readonly code: GatewayClientErrorCode
  ) {
    super(message);
    this.name = "GatewayClientError";
  }
}

export interface GatewayClock {
  now(): Date;
}

export interface FakeGatewayClientOptions {
  clock?: GatewayClock;
  taskIdGenerator?: (request: GatewayGenerationRequest, sequence: number) => string;
}

export class FakeGatewayClient implements GatewayClient {
  private readonly clock: GatewayClock;
  private readonly taskIdGenerator?: (request: GatewayGenerationRequest, sequence: number) => string;
  private sequence = 0;

  constructor(options: FakeGatewayClientOptions = {}) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.taskIdGenerator = options.taskIdGenerator;
  }

  async submitGeneration(request: GatewayGenerationRequest): Promise<GenerationTask> {
    if (request.model.provider.protocol === "openai-compatible") {
      return this.submitFakeTask(request);
    }

    if (request.model.provider.protocol === "anthropic-compatible") {
      return this.submitFakeTask(request);
    }

    throw new GatewayClientError("Provider protocol is not supported", "unsupported_protocol");
  }

  private submitFakeTask(request: GatewayGenerationRequest): GenerationTask {
    this.sequence += 1;
    const now = this.clock.now().toISOString();

    return {
      id: this.taskIdGenerator?.(request, this.sequence) ?? buildTaskId(request, this.sequence),
      capability: request.model.product.capability,
      status: "queued",
      modelId: request.model.product.id,
      createdAt: now,
      updatedAt: now,
      creditEstimate: request.creditEstimate
    };
  }
}

function buildTaskId(request: GatewayGenerationRequest, sequence: number): string {
  return `task_${request.model.product.capability}_${request.model.product.id}_${sequence.toString().padStart(6, "0")}`;
}
```

- [ ] **Step 4: Run gateway client tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- gatewayClient.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/gatewayClient.ts apps/api/src/services/__tests__/gatewayClient.test.ts
git commit -m "feat: add fake provider gateway client"
```

## Task 6: Generation Service

**Files:**
- Create: `apps/api/src/services/generationService.ts`
- Create: `apps/api/src/services/__tests__/generationService.test.ts`

- [ ] **Step 1: Write the failing generation service tests**

Create `apps/api/src/services/__tests__/generationService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GatewayClient } from "../gatewayClient";
import { ConfigModelCatalog } from "../modelCatalog";
import { GenerationError, GenerationService } from "../generationService";

function buildCatalog() {
  return new ConfigModelCatalog({
    providers: [
      {
        id: "openai-main",
        displayName: "OpenAI Main",
        protocol: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
        models: [
          {
            id: "gw-text-gpt-4.1",
            providerModelId: "gpt-4.1",
            displayName: "GPT-4.1",
            capability: "text",
            tags: ["openai"],
            visibility: "visible",
            minimumPlan: "pro",
            creditUnitCost: 2
          },
          {
            id: "gw-text-maintenance",
            providerModelId: "gpt-maintenance",
            displayName: "Maintenance",
            capability: "text",
            tags: ["maintenance"],
            visibility: "maintenance",
            minimumPlan: "studio",
            creditUnitCost: 3
          }
        ]
      }
    ]
  });
}

describe("GenerationService", () => {
  it("submits a text generation request through the gateway", async () => {
    const gateway: GatewayClient = {
      async submitGeneration(request) {
        return {
          id: "task_1",
          capability: request.model.product.capability,
          status: "queued",
          modelId: request.model.product.id,
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
          creditEstimate: request.creditEstimate
        };
      }
    };
    const service = new GenerationService(buildCatalog(), gateway);

    await expect(
      service.submitGeneration(
        {
          modelId: "gw-text-gpt-4.1",
          capability: "text",
          prompt: "Write a launch post"
        },
        "user-dev"
      )
    ).resolves.toEqual({
      id: "task_1",
      capability: "text",
      status: "queued",
      modelId: "gw-text-gpt-4.1",
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
      creditEstimate: { credits: 2, unit: "credit" }
    });
  });

  it("rejects unsupported capabilities", async () => {
    const service = new GenerationService(buildCatalog(), {
      async submitGeneration() {
        throw new Error("gateway should not be called");
      }
    });

    await expect(
      service.submitGeneration(
        {
          modelId: "gw-text-gpt-4.1",
          capability: "image",
          prompt: "Draw something"
        },
        "user-dev"
      )
    ).rejects.toMatchObject({
      message: "Unsupported generation capability",
      statusCode: 400
    });
  });

  it("rejects missing models", async () => {
    const service = new GenerationService(buildCatalog(), {
      async submitGeneration() {
        throw new Error("gateway should not be called");
      }
    });

    await expect(
      service.submitGeneration(
        {
          modelId: "missing",
          capability: "text",
          prompt: "Write a launch post"
        },
        "user-dev"
      )
    ).rejects.toMatchObject({
      message: "Model was not found",
      statusCode: 404
    });
  });

  it("rejects maintenance models", async () => {
    const service = new GenerationService(buildCatalog(), {
      async submitGeneration() {
        throw new Error("gateway should not be called");
      }
    });

    await expect(
      service.submitGeneration(
        {
          modelId: "gw-text-maintenance",
          capability: "text",
          prompt: "Write a launch post"
        },
        "user-dev"
      )
    ).rejects.toMatchObject({
      message: "Model is temporarily unavailable",
      statusCode: 409
    });
  });

  it("maps gateway failures to generation errors", async () => {
    const service = new GenerationService(buildCatalog(), {
      async submitGeneration() {
        throw new Error("network unavailable");
      }
    });

    await expect(
      service.submitGeneration(
        {
          modelId: "gw-text-gpt-4.1",
          capability: "text",
          prompt: "Write a launch post"
        },
        "user-dev"
      )
    ).rejects.toMatchObject({
      message: "Generation gateway failed",
      statusCode: 502
    });
  });
});
```

- [ ] **Step 2: Run generation service tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- generationService.test.ts
```

Expected: FAIL because `apps/api/src/services/generationService.ts` does not exist.

- [ ] **Step 3: Implement the generation service**

Create `apps/api/src/services/generationService.ts`:

```ts
import type { GenerationSubmitRequest, GenerationTask } from "@gw-link-omniai/shared";
import { GatewayClientError, type GatewayClient } from "./gatewayClient";
import type { ModelCatalog } from "./modelCatalog";

export class GenerationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

export class GenerationService {
  constructor(
    private readonly modelCatalog: ModelCatalog,
    private readonly gatewayClient: GatewayClient
  ) {}

  async submitGeneration(request: GenerationSubmitRequest, userId: string): Promise<GenerationTask> {
    if (request.capability !== "text") {
      throw new GenerationError("Unsupported generation capability", 400);
    }

    if (request.prompt.trim() === "") {
      throw new GenerationError("Invalid generation request", 400);
    }

    const model = this.modelCatalog.getTextModel(request.modelId);

    if (!model) {
      throw new GenerationError("Model was not found", 404);
    }

    if (model.product.visibility === "maintenance") {
      throw new GenerationError("Model is temporarily unavailable", 409);
    }

    try {
      return await this.gatewayClient.submitGeneration({
        model,
        prompt: request.prompt,
        userId,
        creditEstimate: {
          credits: model.product.creditUnitCost,
          unit: "credit"
        }
      });
    } catch (error) {
      if (error instanceof GatewayClientError && error.code === "unsupported_protocol") {
        throw new GenerationError("Provider protocol is not supported", 502);
      }

      throw new GenerationError("Generation gateway failed", 502);
    }
  }
}
```

- [ ] **Step 4: Run generation service tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- generationService.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/generationService.ts apps/api/src/services/__tests__/generationService.test.ts
git commit -m "feat: add text generation service"
```

## Task 7: API Routes and Server Wiring

**Files:**
- Modify: `apps/api/src/routes/models.ts`
- Create: `apps/api/src/routes/generations.ts`
- Create: `apps/api/src/routes/__tests__/generations.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/server.test.ts`

- [ ] **Step 1: Write the failing generation route tests**

Create `apps/api/src/routes/__tests__/generations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import { ConfigModelCatalog } from "../../services/modelCatalog";

function buildRouteTestServer() {
  return buildServer({
    modelCatalog: new ConfigModelCatalog({
      providers: [
        {
          id: "openai-main",
          displayName: "OpenAI Main",
          protocol: "openai-compatible",
          baseUrl: "https://api.openai.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
          models: [
            {
              id: "gw-text-gpt-4.1",
              providerModelId: "gpt-4.1",
              displayName: "GPT-4.1",
              capability: "text",
              tags: ["openai"],
              visibility: "visible",
              minimumPlan: "pro",
              creditUnitCost: 2
            },
            {
              id: "gw-text-maintenance",
              providerModelId: "gpt-maintenance",
              displayName: "Maintenance",
              capability: "text",
              tags: ["maintenance"],
              visibility: "maintenance",
              minimumPlan: "studio",
              creditUnitCost: 3
            }
          ]
        }
      ]
    })
  });
}

describe("generation routes", () => {
  it("submits a text generation task", async () => {
    const server = buildRouteTestServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        modelId: "gw-text-gpt-4.1",
        capability: "text",
        prompt: "Write a launch post"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      task: {
        capability: "text",
        status: "queued",
        modelId: "gw-text-gpt-4.1",
        creditEstimate: { credits: 2, unit: "credit" }
      }
    });
    expect(response.json().task.id).toMatch(/^task_text_gw-text-gpt-4\.1_\d{6}$/);
  });

  it("rejects malformed generation requests", async () => {
    const server = buildRouteTestServer();
    const invalidPayloads = [
      {},
      { modelId: "gw-text-gpt-4.1", capability: "text" },
      { modelId: "gw-text-gpt-4.1", capability: "audio", prompt: "Speak" },
      ["gw-text-gpt-4.1"]
    ];

    for (const payload of invalidPayloads) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/generations",
        payload
      });

      expect(response.statusCode).toBe(400);
    }
  });

  it("maps unsupported generation capabilities to a stable error", async () => {
    const server = buildRouteTestServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        modelId: "gw-text-gpt-4.1",
        capability: "image",
        prompt: "Draw something"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Unsupported generation capability"
    });
  });

  it("maps missing and maintenance models to stable errors", async () => {
    const server = buildRouteTestServer();
    const missing = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        modelId: "missing",
        capability: "text",
        prompt: "Write a launch post"
      }
    });
    const maintenance = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        modelId: "gw-text-maintenance",
        capability: "text",
        prompt: "Write a launch post"
      }
    });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Model was not found" });
    expect(maintenance.statusCode).toBe(409);
    expect(maintenance.json()).toEqual({ error: "Model is temporarily unavailable" });
  });
});
```

- [ ] **Step 2: Run route tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- generations.test.ts
```

Expected: FAIL because `POST /v1/generations` is not registered and `BuildServerOptions.modelCatalog` does not exist.

- [ ] **Step 3: Implement generation route**

Create `apps/api/src/routes/generations.ts`:

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import type { GenerationSubmitRequest } from "@gw-link-omniai/shared";
import { GenerationError, type GenerationService } from "../services/generationService";

const developmentUserId = "user-dev";

export function registerGenerationRoutes(server: FastifyInstance, generationService: GenerationService): void {
  server.post("/v1/generations", async (request, reply) => {
    const generationRequest = readGenerationSubmitRequest(request.body);

    if (!generationRequest) {
      return sendBadRequest(reply);
    }

    try {
      const task = await generationService.submitGeneration(generationRequest, developmentUserId);
      return { task };
    } catch (error) {
      return sendGenerationError(reply, error);
    }
  });
}

function readGenerationSubmitRequest(body: unknown): GenerationSubmitRequest | undefined {
  if (!isRequestBody(body)) {
    return undefined;
  }

  if (typeof body.modelId !== "string" || typeof body.prompt !== "string") {
    return undefined;
  }

  if (!isModelCapability(body.capability)) {
    return undefined;
  }

  return {
    modelId: body.modelId,
    capability: body.capability,
    prompt: body.prompt
  };
}

function isRequestBody(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

function isModelCapability(value: unknown): value is GenerationSubmitRequest["capability"] {
  return value === "text" || value === "image" || value === "video";
}

function sendBadRequest(reply: FastifyReply) {
  return reply.status(400).send({
    error: "Invalid generation request"
  });
}

function sendGenerationError(reply: FastifyReply, error: unknown) {
  if (error instanceof GenerationError) {
    return reply.status(error.statusCode).send({
      error: error.message
    });
  }

  return reply.status(500).send({
    error: "Unexpected generation error"
  });
}
```

- [ ] **Step 4: Wire catalog and generation routes into the server**

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

Modify `apps/api/src/server.ts`:

```ts
import Fastify from "fastify";
import { loadConfig, type ApiConfig } from "./config";
import { registerAuthRoutes } from "./routes/auth";
import { registerGenerationRoutes } from "./routes/generations";
import { registerHealthRoute } from "./routes/health";
import { registerModelRoutes } from "./routes/models";
import { InMemoryAuthService, type AuthService } from "./services/authService";
import { GenerationService } from "./services/generationService";
import { FakeGatewayClient, type GatewayClient } from "./services/gatewayClient";
import { loadModelCatalogConfig } from "./services/modelConfig";
import { ConfigModelCatalog, type ModelCatalog } from "./services/modelCatalog";

export interface BuildServerOptions {
  authService?: AuthService;
  config?: ApiConfig;
  modelCatalog?: ModelCatalog;
  gatewayClient?: GatewayClient;
  generationService?: GenerationService;
}

export function buildServer(options: BuildServerOptions = {}) {
  const config = options.config ?? loadConfig();
  const server = Fastify({
    logger: false
  });
  const authService =
    options.authService ??
    new InMemoryAuthService({
      devCodesEnabled: config.authDevCodesEnabled
    });
  const modelCatalog = options.modelCatalog ?? new ConfigModelCatalog(loadModelCatalogConfig(config.modelConfigPath));
  const gatewayClient = options.gatewayClient ?? new FakeGatewayClient();
  const generationService = options.generationService ?? new GenerationService(modelCatalog, gatewayClient);

  registerHealthRoute(server);
  registerModelRoutes(server, modelCatalog);
  registerGenerationRoutes(server, generationService);
  registerAuthRoutes(server, authService);

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const server = buildServer({ config });

  await server.listen({
    port: config.port,
    host: "0.0.0.0"
  });

  console.log(`GW-LINK OmniAI API listening on ${config.port}`);
}
```

- [ ] **Step 5: Update product API server tests**

Modify the `/v1/models` expectation in `apps/api/src/__tests__/server.test.ts` to expect default config models:

```ts
expect(response.statusCode).toBe(200);
expect(response.json()).toEqual({
  models: [
    {
      id: "gw-text-gpt-4.1",
      displayName: "GPT-4.1",
      capability: "text",
      tags: ["openai", "reasoning"],
      visibility: "visible",
      minimumPlan: "pro",
      creditUnitCost: 2
    },
    {
      id: "gw-text-claude-sonnet",
      displayName: "Claude Sonnet",
      capability: "text",
      tags: ["anthropic", "writing"],
      visibility: "visible",
      minimumPlan: "pro",
      creditUnitCost: 2
    }
  ]
});
```

Update existing `config` fixtures in the same file so they include:

```ts
modelConfigPath: "config/models.json"
```

- [ ] **Step 6: Run route and API tests**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- generations.test.ts
pnpm --filter @gw-link-omniai/api test
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/models.ts apps/api/src/routes/generations.ts apps/api/src/routes/__tests__/generations.test.ts apps/api/src/server.ts apps/api/src/__tests__/server.test.ts
git commit -m "feat: expose text generation API"
```

## Task 8: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update README with local model configuration behavior**

Add this section to `README.md` near the API documentation:

````md
### Model Catalog and Fake Gateway

The API loads text model provider configuration from `config/models.json` by default. Set `GW_LINK_MODEL_CONFIG_PATH=/absolute/path/to/models.json` to use another catalog.

The current gateway implementation is local and deterministic:

- OpenAI-compatible and Anthropic-compatible providers are selected from model config.
- No real provider HTTP requests are sent.
- API keys named by `apiKeyEnv` are not read by the fake gateway.
- `POST /v1/generations` returns a queued task with the configured model credit cost.

Example:

```bash
curl -s http://localhost:8787/v1/models
curl -s -X POST http://localhost:8787/v1/generations \
  -H 'content-type: application/json' \
  -d '{"modelId":"gw-text-gpt-4.1","capability":"text","prompt":"Write a launch post"}'
```
````

- [ ] **Step 2: Update architecture docs**

Add this subsection to `docs/architecture/mvp-skeleton.md` under API boundaries:

```md
### Text Model Gateway Slice

The text model slice is configuration-driven. `config/models.json` declares provider records, OpenAI-compatible or Anthropic-compatible protocol, provider model IDs, product-facing model IDs, visibility, minimum plan, tags, and credit unit cost.

The API exposes only product-facing models through `/v1/models`. Provider internals such as `providerModelId`, `baseUrl`, and `apiKeyEnv` remain server-side.

`POST /v1/generations` validates a text model, estimates credits from `creditUnitCost`, and submits through the fake gateway client. The fake gateway returns a queued `GenerationTask` and does not read API keys or send network traffic.
```

- [ ] **Step 3: Run full workspace verification**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document text model gateway slice"
```

## Final Review Checklist

- [ ] `config/models.json` contains both OpenAI-compatible and Anthropic-compatible visible text models.
- [ ] `/v1/models` returns product-facing fields only.
- [ ] `/v1/generations` accepts only text capability and returns `{ task }`.
- [ ] hidden models behave as not found.
- [ ] maintenance models return `409`.
- [ ] fake gateway sends no network traffic and does not read API keys.
- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
