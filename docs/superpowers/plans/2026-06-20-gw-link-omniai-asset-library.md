# GW-LINK OmniAI Asset Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Stage 3 Asset Library MVP so text, image, and video generation tasks can be represented as reusable product assets.

**Architecture:** Extend shared contracts with `CreationAsset` and a create request type. Add an in-memory API asset service plus `/v1/assets` routes with stable validation errors. Keep desktop asset saving local for this stage, using the same shared contracts without HTTP client, auth-token, persistence, real provider, or real file-storage coupling.

**Tech Stack:** TypeScript, Fastify, React, Vitest, Testing Library, pnpm workspaces.

---

## File Structure

- Modify: `packages/shared/src/models.ts` - add creation asset content, preview, source, request, and asset contracts.
- Modify: `packages/shared/src/index.ts` - export new asset contracts.
- Create: `packages/shared/src/__tests__/asset.test.ts` - shared asset contract tests.
- Create: `apps/api/src/services/assetService.ts` - in-memory asset service with validation and defensive copies.
- Create: `apps/api/src/services/__tests__/assetService.test.ts` - service unit tests.
- Create: `apps/api/src/routes/assets.ts` - `POST /v1/assets` and `GET /v1/assets`.
- Create: `apps/api/src/routes/__tests__/assets.test.ts` - route tests.
- Modify: `apps/api/src/server.ts` - inject and register asset service/routes.
- Modify: `apps/api/src/__tests__/server.test.ts` - server integration tests for asset route registration and injection behavior.
- Create: `apps/desktop/src/assetModel.ts` - local desktop asset helper, fake content generation, filtering, labels, prompt summary.
- Create: `apps/desktop/src/__tests__/assetModel.test.ts` - desktop asset model tests.
- Modify: `apps/desktop/src/App.tsx` - save generation tasks as local assets and render asset library.
- Modify: `apps/desktop/src/__tests__/App.test.tsx` - UI tests for asset saving and filtering.
- Modify: `README.md` - document Stage 3 asset library slice.
- Modify: `docs/architecture/mvp-skeleton.md` - document product-level asset slice.

---

## Task 1: Shared Creation Asset Contracts

**Files:**
- Modify: `packages/shared/src/models.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/asset.test.ts`

- [ ] **Step 1: Write the failing shared asset contract tests**

Create `packages/shared/src/__tests__/asset.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CreationAsset, CreationAssetRequest, PresetSuggestion } from "..";

const imagePreset: PresetSuggestion = {
  modelId: "gw-image-creative",
  parameters: {
    aspectRatio: "4:3",
    quality: "high",
    count: 1
  },
  creditEstimate: { credits: 2, unit: "credit" }
};

describe("creation asset contracts", () => {
  it("represents asset creation requests for text, image, and video", () => {
    const requests: CreationAssetRequest[] = [
      {
        mode: "text",
        title: "文本资产",
        content: {
          kind: "text",
          text: "这是一段可复用的新品推广文案。",
          format: "markdown"
        },
        source: {
          taskId: "generation_task_text",
          taskStatus: "succeeded"
        },
        prompt: "帮我写一个咖啡店新品发布文案",
        optimizedPrompt: "请生成一段新品推广文案。",
        preset: {
          modelId: "gw-text-balanced",
          parameters: { outputFormat: "markdown", tone: "warm" },
          creditEstimate: { credits: 1, unit: "credit" }
        }
      },
      {
        mode: "image",
        title: "图片资产",
        content: {
          kind: "image",
          url: "https://assets.gw-link.local/placeholders/image-generation.png",
          alt: "咖啡店新品海报占位图"
        },
        source: {
          taskId: "generation_task_image",
          taskStatus: "succeeded"
        },
        prompt: "做一张咖啡店新品海报",
        optimizedPrompt: "制作一张咖啡店新品商业海报。",
        preset: imagePreset
      },
      {
        mode: "video",
        title: "视频资产",
        content: {
          kind: "video",
          url: "https://assets.gw-link.local/placeholders/video-generation.mp4",
          durationSeconds: 6,
          posterUrl: "https://assets.gw-link.local/placeholders/video-poster.png"
        },
        source: {
          taskId: "generation_task_video",
          taskStatus: "succeeded"
        },
        prompt: "生成一段咖啡拉花短视频",
        optimizedPrompt: "生成一段展示咖啡拉花过程的短视频。",
        preset: {
          modelId: "gw-video-motion",
          parameters: { durationSeconds: 6, aspectRatio: "16:9", resolution: "1080p" },
          creditEstimate: { credits: 18, unit: "credit" }
        }
      }
    ];

    expect(requests.map((request) => request.mode)).toEqual(["text", "image", "video"]);
    expect(requests.map((request) => request.content.kind)).toEqual(["text", "image", "video"]);
    expect(requests.map((request) => request.source.taskStatus)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded"
    ]);
  });

  it("represents a reusable product creation asset", () => {
    const asset: CreationAsset = {
      id: "creation_asset_000001",
      mode: "image",
      title: "图片资产",
      content: {
        kind: "image",
        url: "https://assets.gw-link.local/placeholders/image-generation.png",
        alt: "咖啡店新品海报占位图"
      },
      preview: {
        title: "图片资产",
        description: "占位图片资产，后续阶段将接入真实图片文件。"
      },
      source: {
        taskId: "generation_task_000001",
        taskStatus: "succeeded"
      },
      prompt: "做一张咖啡店新品海报",
      optimizedPrompt: "制作一张咖啡店新品商业海报。",
      preset: imagePreset,
      createdAt: "2026-06-20T00:00:00.000Z"
    };

    expect(asset).toMatchObject({
      mode: "image",
      title: "图片资产",
      content: {
        kind: "image"
      },
      source: {
        taskId: "generation_task_000001"
      },
      preset: {
        modelId: "gw-image-creative",
        creditEstimate: { credits: 2, unit: "credit" }
      }
    });
  });
});
```

- [ ] **Step 2: Run the shared asset tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/shared test -- asset.test.ts
```

Expected: FAIL because `CreationAsset`, `CreationAssetRequest`, and related asset contracts do not exist.

- [ ] **Step 3: Add asset contracts to shared models**

In `packages/shared/src/models.ts`, add this block after `GenerationTask` and before `CreditAmount`:

```ts
export type CreationAssetContent =
  | {
      kind: "text";
      text: string;
      format: "markdown" | "plain";
    }
  | {
      kind: "image";
      url: string;
      alt: string;
    }
  | {
      kind: "video";
      url: string;
      durationSeconds: number;
      posterUrl: string;
    };

export interface CreationAssetPreview {
  title: string;
  description: string;
}

export interface CreationAssetSource {
  taskId: string;
  taskStatus: GenerationTaskStatus;
}

export interface CreationAssetRequest {
  mode: CreationMode;
  title: string;
  content: CreationAssetContent;
  source: CreationAssetSource;
  prompt: string;
  optimizedPrompt: string;
  preset: PresetSuggestion;
}

export interface CreationAsset extends CreationAssetRequest {
  id: string;
  preview: CreationAssetPreview;
  createdAt: string;
}
```

- [ ] **Step 4: Export the asset contracts**

In `packages/shared/src/index.ts`, add these names to the existing type export list:

```ts
  CreationAsset,
  CreationAssetContent,
  CreationAssetPreview,
  CreationAssetRequest,
  CreationAssetSource,
```

- [ ] **Step 5: Run shared verification**

Run:

```bash
pnpm --filter @gw-link-omniai/shared test -- asset.test.ts
pnpm --filter @gw-link-omniai/shared typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/models.ts packages/shared/src/index.ts packages/shared/src/__tests__/asset.test.ts
git commit -m "feat: add creation asset contracts"
```

---

## Task 2: In-Memory Asset Service

**Files:**
- Create: `apps/api/src/services/assetService.ts`
- Create: `apps/api/src/services/__tests__/assetService.test.ts`

- [ ] **Step 1: Write the failing asset service tests**

Create `apps/api/src/services/__tests__/assetService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CreationAssetRequest } from "@gw-link-omniai/shared";
import { AssetError, InMemoryAssetService } from "../assetService";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function createService() {
  return new InMemoryAssetService({
    clock: { now: () => fixedNow },
    idGenerator: () => "creation_asset_000001"
  });
}

function createImageRequest(): CreationAssetRequest {
  return {
    mode: "image",
    title: "图片资产",
    content: {
      kind: "image",
      url: "https://assets.gw-link.local/placeholders/image-generation.png",
      alt: "咖啡店新品海报占位图"
    },
    source: {
      taskId: "generation_task_000001",
      taskStatus: "succeeded"
    },
    prompt: "做一张咖啡店新品海报",
    optimizedPrompt: "制作一张咖啡店新品商业海报。",
    preset: {
      modelId: "gw-image-creative",
      parameters: {
        aspectRatio: "4:3",
        quality: "high",
        count: 1
      },
      creditEstimate: { credits: 2, unit: "credit" }
    }
  };
}

function expectAssetError(action: () => unknown, message: string, statusCode: number) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(AssetError);
    expect(error).toMatchObject({ message, statusCode });
    return;
  }

  throw new Error("Expected asset error");
}

describe("InMemoryAssetService", () => {
  it("creates an image asset", () => {
    const service = createService();

    expect(service.createAsset(createImageRequest())).toEqual({
      id: "creation_asset_000001",
      mode: "image",
      title: "图片资产",
      content: {
        kind: "image",
        url: "https://assets.gw-link.local/placeholders/image-generation.png",
        alt: "咖啡店新品海报占位图"
      },
      preview: {
        title: "图片资产",
        description: "占位图片资产，后续阶段将接入真实图片文件。"
      },
      source: {
        taskId: "generation_task_000001",
        taskStatus: "succeeded"
      },
      prompt: "做一张咖啡店新品海报",
      optimizedPrompt: "制作一张咖啡店新品商业海报。",
      preset: {
        modelId: "gw-image-creative",
        parameters: {
          aspectRatio: "4:3",
          quality: "high",
          count: 1
        },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      createdAt: "2026-06-20T00:00:00.000Z"
    });
  });

  it("creates mode-specific text and video previews", () => {
    const service = createService();
    const textAsset = service.createAsset({
      mode: "text",
      title: "文本资产",
      content: {
        kind: "text",
        text: "这是一段可复用的新品推广文案。",
        format: "markdown"
      },
      source: {
        taskId: "generation_task_text",
        taskStatus: "succeeded"
      },
      prompt: "帮我写一个咖啡店新品发布文案",
      optimizedPrompt: "请生成一段新品推广文案。",
      preset: {
        modelId: "gw-text-balanced",
        parameters: { outputFormat: "markdown", tone: "warm" },
        creditEstimate: { credits: 1, unit: "credit" }
      }
    });
    const videoAsset = service.createAsset({
      mode: "video",
      title: "视频资产",
      content: {
        kind: "video",
        url: "https://assets.gw-link.local/placeholders/video-generation.mp4",
        durationSeconds: 6,
        posterUrl: "https://assets.gw-link.local/placeholders/video-poster.png"
      },
      source: {
        taskId: "generation_task_video",
        taskStatus: "succeeded"
      },
      prompt: "生成一段咖啡拉花短视频",
      optimizedPrompt: "生成一段展示咖啡拉花过程的短视频。",
      preset: {
        modelId: "gw-video-motion",
        parameters: { durationSeconds: 6, aspectRatio: "16:9", resolution: "1080p" },
        creditEstimate: { credits: 18, unit: "credit" }
      }
    });

    expect(textAsset.preview).toEqual({
      title: "文本资产",
      description: "占位文本资产，后续阶段将接入真实文本生成结果。"
    });
    expect(videoAsset.preview).toEqual({
      title: "视频资产",
      description: "占位视频资产，后续阶段将接入真实视频文件。"
    });
  });

  it("lists created assets with defensive copies", () => {
    const service = createService();
    const asset = service.createAsset(createImageRequest());
    asset.preset.parameters.quality = "mutated";
    asset.preset.creditEstimate.credits = 999;
    asset.preview.title = "mutated";
    if (asset.content.kind === "image") {
      asset.content.alt = "mutated";
    }

    const [listedAsset] = service.listAssets();
    expect(listedAsset).toMatchObject({
      preset: {
        parameters: {
          quality: "high"
        },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      preview: {
        title: "图片资产"
      },
      content: {
        kind: "image",
        alt: "咖啡店新品海报占位图"
      }
    });

    listedAsset!.preset.parameters.quality = "changed again";
    expect(service.listAssets()[0]!.preset.parameters.quality).toBe("high");
  });

  it("rejects unsupported modes", () => {
    const service = createService();
    expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          mode: "audio" as "image"
        }),
      "Unsupported asset mode",
      400
    );
  });

  it("rejects empty titles and prompts", () => {
    const service = createService();
    expectAssetError(() => service.createAsset({ ...createImageRequest(), title: " " }), "Asset title is required", 400);
    expectAssetError(() => service.createAsset({ ...createImageRequest(), prompt: " " }), "Prompt is required", 400);
    expectAssetError(
      () => service.createAsset({ ...createImageRequest(), optimizedPrompt: " " }),
      "Optimized prompt is required",
      400
    );
  });

  it("rejects invalid preset suggestions", () => {
    const service = createService();
    expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          preset: {
            modelId: "",
            parameters: {},
            creditEstimate: { credits: 2, unit: "credit" }
          }
        }),
      "Invalid preset suggestion",
      400
    );
  });

  it("rejects invalid asset content", () => {
    const service = createService();
    expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          content: {
            kind: "text",
            text: "wrong mode",
            format: "plain"
          }
        }),
      "Invalid asset content",
      400
    );
    expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          content: {
            kind: "image",
            url: "",
            alt: "missing url"
          }
        }),
      "Invalid asset content",
      400
    );
  });

  it("rejects invalid asset sources", () => {
    const service = createService();
    expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          source: {
            taskId: "",
            taskStatus: "succeeded"
          }
        }),
      "Invalid asset source",
      400
    );
    expectAssetError(
      () =>
        service.createAsset({
          ...createImageRequest(),
          source: {
            taskId: "generation_task_000001",
            taskStatus: "queued"
          }
        }),
      "Invalid asset source",
      400
    );
  });
});
```

- [ ] **Step 2: Run asset service tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- assetService.test.ts
```

Expected: FAIL because `apps/api/src/services/assetService.ts` does not exist.

- [ ] **Step 3: Implement the in-memory asset service**

Create `apps/api/src/services/assetService.ts`:

```ts
import type {
  CreationAsset,
  CreationAssetContent,
  CreationAssetPreview,
  CreationAssetRequest,
  CreationMode,
  GenerationTaskStatus,
  PresetSuggestion
} from "@gw-link-omniai/shared";

export class AssetError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "AssetError";
  }
}

export interface AssetServiceClock {
  now(): Date;
}

export interface AssetServiceOptions {
  clock?: AssetServiceClock;
  idGenerator?: () => string;
}

export interface AssetService {
  createAsset(request: CreationAssetRequest): CreationAsset;
  listAssets(): CreationAsset[];
}

const previews: Record<CreationMode, CreationAssetPreview> = {
  text: {
    title: "文本资产",
    description: "占位文本资产，后续阶段将接入真实文本生成结果。"
  },
  image: {
    title: "图片资产",
    description: "占位图片资产，后续阶段将接入真实图片文件。"
  },
  video: {
    title: "视频资产",
    description: "占位视频资产，后续阶段将接入真实视频文件。"
  }
};

export class InMemoryAssetService implements AssetService {
  private readonly clock: AssetServiceClock;
  private readonly idGenerator: () => string;
  private readonly assets: CreationAsset[] = [];

  constructor(options: AssetServiceOptions = {}) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.idGenerator = options.idGenerator ?? createAssetId;
  }

  createAsset(request: CreationAssetRequest): CreationAsset {
    const value: unknown = request;

    if (!isRecord(value)) {
      throw new AssetError("Invalid asset request", 400);
    }

    const mode = value.mode;
    if (!isCreationMode(mode)) {
      throw new AssetError("Unsupported asset mode", 400);
    }

    if (typeof value.title !== "string" || value.title.trim().length === 0) {
      throw new AssetError("Asset title is required", 400);
    }

    if (typeof value.prompt !== "string" || value.prompt.trim().length === 0) {
      throw new AssetError("Prompt is required", 400);
    }

    if (typeof value.optimizedPrompt !== "string" || value.optimizedPrompt.trim().length === 0) {
      throw new AssetError("Optimized prompt is required", 400);
    }

    if (!isValidPresetSuggestion(value.preset)) {
      throw new AssetError("Invalid preset suggestion", 400);
    }

    if (!isValidAssetContent(mode, value.content)) {
      throw new AssetError("Invalid asset content", 400);
    }

    if (!isValidAssetSource(value.source)) {
      throw new AssetError("Invalid asset source", 400);
    }

    const asset: CreationAsset = {
      id: this.idGenerator(),
      mode,
      title: value.title.trim(),
      content: cloneContent(value.content),
      preview: clonePreview(previews[mode]),
      source: {
        taskId: value.source.taskId.trim(),
        taskStatus: value.source.taskStatus
      },
      prompt: value.prompt.trim(),
      optimizedPrompt: value.optimizedPrompt.trim(),
      preset: clonePreset(value.preset),
      createdAt: this.clock.now().toISOString()
    };

    this.assets.push(asset);
    return cloneAsset(asset);
  }

  listAssets(): CreationAsset[] {
    return this.assets.map(cloneAsset);
  }
}

function isCreationMode(value: unknown): value is CreationMode {
  return value === "text" || value === "image" || value === "video";
}

function isGenerationTaskStatus(value: unknown): value is GenerationTaskStatus {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed";
}

function isValidAssetSource(value: unknown): value is CreationAssetRequest["source"] {
  return (
    isRecord(value) &&
    typeof value.taskId === "string" &&
    value.taskId.trim().length > 0 &&
    isGenerationTaskStatus(value.taskStatus) &&
    value.taskStatus === "succeeded"
  );
}

function isValidAssetContent(mode: CreationMode, value: unknown): value is CreationAssetContent {
  if (!isRecord(value) || value.kind !== mode) {
    return false;
  }

  if (value.kind === "text") {
    return (
      typeof value.text === "string" &&
      value.text.trim().length > 0 &&
      (value.format === "markdown" || value.format === "plain")
    );
  }

  if (value.kind === "image") {
    return (
      typeof value.url === "string" &&
      value.url.trim().length > 0 &&
      typeof value.alt === "string" &&
      value.alt.trim().length > 0
    );
  }

  return (
    typeof value.url === "string" &&
    value.url.trim().length > 0 &&
    typeof value.durationSeconds === "number" &&
    Number.isFinite(value.durationSeconds) &&
    value.durationSeconds > 0 &&
    typeof value.posterUrl === "string" &&
    value.posterUrl.trim().length > 0
  );
}

function isValidPresetSuggestion(value: unknown): value is PresetSuggestion {
  if (!isRecord(value)) {
    return false;
  }

  const { modelId, parameters, creditEstimate } = value;

  if (typeof modelId !== "string" || modelId.trim().length === 0) {
    return false;
  }

  if (!isRecord(parameters) || !Object.values(parameters).every(isPresetParameterValue)) {
    return false;
  }

  return (
    isRecord(creditEstimate) &&
    typeof creditEstimate.credits === "number" &&
    Number.isFinite(creditEstimate.credits) &&
    creditEstimate.credits > 0 &&
    creditEstimate.unit === "credit"
  );
}

function isPresetParameterValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneAsset(asset: CreationAsset): CreationAsset {
  return {
    ...asset,
    content: cloneContent(asset.content),
    preview: clonePreview(asset.preview),
    source: { ...asset.source },
    preset: clonePreset(asset.preset)
  };
}

function cloneContent(content: CreationAssetContent): CreationAssetContent {
  return { ...content };
}

function clonePreview(preview: CreationAssetPreview): CreationAssetPreview {
  return { ...preview };
}

function clonePreset(preset: PresetSuggestion): PresetSuggestion {
  return {
    modelId: preset.modelId,
    parameters: { ...preset.parameters },
    creditEstimate: { ...preset.creditEstimate }
  };
}

function createAssetId(): string {
  return `creation_asset_${Date.now().toString(36)}`;
}
```

- [ ] **Step 4: Run asset service verification**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- assetService.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/assetService.ts apps/api/src/services/__tests__/assetService.test.ts
git commit -m "feat: add in-memory asset service"
```

---

## Task 3: Asset API Routes

**Files:**
- Create: `apps/api/src/routes/assets.ts`
- Create: `apps/api/src/routes/__tests__/assets.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/server.test.ts`

- [ ] **Step 1: Write the failing asset route tests**

Create `apps/api/src/routes/__tests__/assets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import { AssetError, InMemoryAssetService, type AssetService } from "../../services/assetService";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function buildAssetTestServer() {
  return buildServer({
    assetService: new InMemoryAssetService({
      clock: { now: () => fixedNow },
      idGenerator: () => "creation_asset_000001"
    })
  });
}

function createImagePayload() {
  return {
    mode: "image",
    title: "图片资产",
    content: {
      kind: "image",
      url: "https://assets.gw-link.local/placeholders/image-generation.png",
      alt: "咖啡店新品海报占位图"
    },
    source: {
      taskId: "generation_task_000001",
      taskStatus: "succeeded"
    },
    prompt: "做一张咖啡店新品海报",
    optimizedPrompt: "制作一张咖啡店新品商业海报。",
    preset: {
      modelId: "gw-image-creative",
      parameters: {
        aspectRatio: "4:3",
        quality: "high",
        count: 1
      },
      creditEstimate: { credits: 2, unit: "credit" }
    }
  };
}

describe("asset routes", () => {
  it("creates and lists creation assets", async () => {
    const server = buildAssetTestServer();
    const createResponse = await server.inject({
      method: "POST",
      url: "/v1/assets",
      payload: createImagePayload()
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toEqual({
      asset: {
        id: "creation_asset_000001",
        mode: "image",
        title: "图片资产",
        content: {
          kind: "image",
          url: "https://assets.gw-link.local/placeholders/image-generation.png",
          alt: "咖啡店新品海报占位图"
        },
        preview: {
          title: "图片资产",
          description: "占位图片资产，后续阶段将接入真实图片文件。"
        },
        source: {
          taskId: "generation_task_000001",
          taskStatus: "succeeded"
        },
        prompt: "做一张咖啡店新品海报",
        optimizedPrompt: "制作一张咖啡店新品商业海报。",
        preset: {
          modelId: "gw-image-creative",
          parameters: {
            aspectRatio: "4:3",
            quality: "high",
            count: 1
          },
          creditEstimate: { credits: 2, unit: "credit" }
        },
        createdAt: "2026-06-20T00:00:00.000Z"
      }
    });

    const listResponse = await server.inject({
      method: "GET",
      url: "/v1/assets"
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({
      assets: [createResponse.json().asset]
    });
  });

  it("rejects malformed asset requests", async () => {
    const server = buildAssetTestServer();
    const invalidPayloads = [
      {},
      { mode: "image" },
      { mode: "image", title: "图片资产" },
      { mode: "image", title: "图片资产", content: createImagePayload().content },
      { mode: "image", title: 123, content: createImagePayload().content, source: createImagePayload().source },
      ["image", "图片资产"]
    ];

    for (const payload of invalidPayloads) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/assets",
        payload
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "Invalid asset request"
      });
    }
  });

  it("maps asset domain errors to HTTP responses", async () => {
    const server = buildAssetTestServer();
    const unsupportedMode = await server.inject({
      method: "POST",
      url: "/v1/assets",
      payload: {
        ...createImagePayload(),
        mode: "audio"
      }
    });
    const emptyTitle = await server.inject({
      method: "POST",
      url: "/v1/assets",
      payload: {
        ...createImagePayload(),
        title: " "
      }
    });
    const invalidContent = await server.inject({
      method: "POST",
      url: "/v1/assets",
      payload: {
        ...createImagePayload(),
        content: {
          kind: "image",
          url: "",
          alt: "missing url"
        }
      }
    });
    const invalidSource = await server.inject({
      method: "POST",
      url: "/v1/assets",
      payload: {
        ...createImagePayload(),
        source: {
          taskId: "",
          taskStatus: "succeeded"
        }
      }
    });

    expect(unsupportedMode.statusCode).toBe(400);
    expect(unsupportedMode.json()).toEqual({ error: "Unsupported asset mode" });
    expect(emptyTitle.statusCode).toBe(400);
    expect(emptyTitle.json()).toEqual({ error: "Asset title is required" });
    expect(invalidContent.statusCode).toBe(400);
    expect(invalidContent.json()).toEqual({ error: "Invalid asset content" });
    expect(invalidSource.statusCode).toBe(400);
    expect(invalidSource.json()).toEqual({ error: "Invalid asset source" });
  });

  it("maps unexpected asset service errors to a 500 response", async () => {
    const assetService = {
      createAsset: () => {
        throw new Error("boom");
      },
      listAssets: () => []
    } satisfies AssetService;
    const server = buildServer({ assetService });
    const response = await server.inject({
      method: "POST",
      url: "/v1/assets",
      payload: createImagePayload()
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "Unexpected asset error"
    });
  });

  it("maps asset errors from injected services", async () => {
    const assetService = {
      createAsset: () => {
        throw new AssetError("Invalid asset source", 400);
      },
      listAssets: () => []
    } satisfies AssetService;
    const server = buildServer({ assetService });
    const response = await server.inject({
      method: "POST",
      url: "/v1/assets",
      payload: createImagePayload()
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Invalid asset source"
    });
  });
});
```

Modify `apps/api/src/__tests__/server.test.ts`:

1. Add `import type { AssetService } from "../services/assetService";`.
2. Add this test after the generation route registration test:

```ts
  it("registers the asset routes", async () => {
    const server = buildServer();
    const createResponse = await server.inject({
      method: "POST",
      url: "/v1/assets",
      payload: {
        mode: "text",
        title: "文本资产",
        content: {
          kind: "text",
          text: "这是一段可复用的新品推广文案。",
          format: "markdown"
        },
        source: {
          taskId: "generation_task_000001",
          taskStatus: "succeeded"
        },
        prompt: "帮我写一个新品发布文案",
        optimizedPrompt: "请生成一段新品推广文案。",
        preset: {
          modelId: "gw-text-balanced",
          parameters: {
            outputFormat: "markdown",
            tone: "clear"
          },
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });
    const listResponse = await server.inject({
      method: "GET",
      url: "/v1/assets"
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({
      asset: {
        mode: "text",
        title: "文本资产",
        content: {
          kind: "text"
        },
        preset: {
          modelId: "gw-text-balanced",
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      assets: [
        {
          mode: "text",
          title: "文本资产"
        }
      ]
    });
  });
```

3. In the invalid env injection test, define a fake asset service:

```ts
    const fakeAssetService = {
      createAsset: () => {
        throw new Error("not implemented");
      },
      listAssets: () => []
    } satisfies AssetService;
```

4. Pass `assetService: fakeAssetService` into `buildServer`.

- [ ] **Step 2: Run asset route tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- assets.test.ts server.test.ts
```

Expected: FAIL because asset routes and `BuildServerOptions.assetService` do not exist.

- [ ] **Step 3: Implement asset routes**

Create `apps/api/src/routes/assets.ts`:

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import type { CreationAssetRequest } from "@gw-link-omniai/shared";
import { AssetError, type AssetService } from "../services/assetService";

export function registerAssetRoutes(server: FastifyInstance, assetService: AssetService): void {
  server.post("/v1/assets", async (request, reply) => {
    const assetRequest = readCreationAssetRequest(request.body);

    if (!assetRequest) {
      return sendBadRequest(reply);
    }

    try {
      const asset = assetService.createAsset(assetRequest);
      return { asset };
    } catch (error) {
      return sendAssetError(reply, error);
    }
  });

  server.get("/v1/assets", async () => ({
    assets: assetService.listAssets()
  }));
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

- [ ] **Step 4: Register asset routes in the server**

Modify `apps/api/src/server.ts`:

1. Add imports:

```ts
import { registerAssetRoutes } from "./routes/assets";
import { InMemoryAssetService, type AssetService } from "./services/assetService";
```

2. Add `assetService?: AssetService;` to `BuildServerOptions`.
3. Add `const assetService = options.assetService ?? new InMemoryAssetService();` in `buildServer`.
4. Call `registerAssetRoutes(server, assetService);` before `registerAuthRoutes(server, authService);`.

- [ ] **Step 5: Run API route verification**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- assets.test.ts server.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/assets.ts apps/api/src/routes/__tests__/assets.test.ts apps/api/src/server.ts apps/api/src/__tests__/server.test.ts
git commit -m "feat: expose asset library API"
```

---

## Task 4: Desktop Asset Model

**Files:**
- Create: `apps/desktop/src/assetModel.ts`
- Create: `apps/desktop/src/__tests__/assetModel.test.ts`

- [ ] **Step 1: Write the failing desktop asset model tests**

Create `apps/desktop/src/__tests__/assetModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GenerationTask } from "@gw-link-omniai/shared";
import {
  createLocalCreationAsset,
  filterCreationAssets,
  getAssetModeLabel,
  getAssetFilterLabel,
  summarizeAssetPrompt
} from "../assetModel";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function createTask(mode: GenerationTask["mode"]): GenerationTask {
  return {
    id: `generation_task_${mode}`,
    mode,
    status: "queued",
    prompt:
      mode === "text"
        ? "帮我写一个咖啡店新品发布文案"
        : mode === "image"
          ? "做一张咖啡店新品海报"
          : "生成一段咖啡拉花短视频",
    optimizedPrompt:
      mode === "text"
        ? "请生成一段新品推广文案。"
        : mode === "image"
          ? "制作一张咖啡店新品商业海报。"
          : "生成一段展示咖啡拉花过程的短视频。",
    preset:
      mode === "text"
        ? {
            modelId: "gw-text-balanced",
            parameters: { outputFormat: "markdown", tone: "warm" },
            creditEstimate: { credits: 1, unit: "credit" }
          }
        : mode === "image"
          ? {
              modelId: "gw-image-creative",
              parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
              creditEstimate: { credits: 2, unit: "credit" }
            }
          : {
              modelId: "gw-video-motion",
              parameters: { durationSeconds: 6, aspectRatio: "16:9", resolution: "1080p" },
              creditEstimate: { credits: 18, unit: "credit" }
            },
    resultPreview: {
      title: `${mode} task`,
      description: `${mode} task description`
    },
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z"
  };
}

describe("assetModel", () => {
  it("creates an image asset from a generation task", () => {
    const asset = createLocalCreationAsset(createTask("image"), {
      clock: { now: () => fixedNow },
      idGenerator: () => "desktop_creation_asset_000001"
    });

    expect(asset).toEqual({
      id: "desktop_creation_asset_000001",
      mode: "image",
      title: "图片资产",
      content: {
        kind: "image",
        url: "https://assets.gw-link.local/placeholders/image-generation.png",
        alt: "做一张咖啡店新品海报"
      },
      preview: {
        title: "图片资产",
        description: "占位图片资产，后续阶段将接入真实图片文件。"
      },
      source: {
        taskId: "generation_task_image",
        taskStatus: "succeeded"
      },
      prompt: "做一张咖啡店新品海报",
      optimizedPrompt: "制作一张咖啡店新品商业海报。",
      preset: {
        modelId: "gw-image-creative",
        parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      createdAt: "2026-06-20T00:00:00.000Z"
    });
  });

  it("creates mode-specific fake content", () => {
    expect(createLocalCreationAsset(createTask("text")).content).toEqual({
      kind: "text",
      text: "请生成一段新品推广文案。",
      format: "markdown"
    });
    expect(createLocalCreationAsset(createTask("image")).content).toMatchObject({
      kind: "image",
      url: "https://assets.gw-link.local/placeholders/image-generation.png"
    });
    expect(createLocalCreationAsset(createTask("video")).content).toEqual({
      kind: "video",
      url: "https://assets.gw-link.local/placeholders/video-generation.mp4",
      durationSeconds: 6,
      posterUrl: "https://assets.gw-link.local/placeholders/video-poster.png"
    });
  });

  it("filters assets by mode", () => {
    const textAsset = createLocalCreationAsset(createTask("text"));
    const imageAsset = createLocalCreationAsset(createTask("image"));
    const videoAsset = createLocalCreationAsset(createTask("video"));
    const assets = [textAsset, imageAsset, videoAsset];

    expect(filterCreationAssets(assets, "all")).toEqual(assets);
    expect(filterCreationAssets(assets, "text")).toEqual([textAsset]);
    expect(filterCreationAssets(assets, "image")).toEqual([imageAsset]);
    expect(filterCreationAssets(assets, "video")).toEqual([videoAsset]);
  });

  it("returns localized labels", () => {
    expect(getAssetFilterLabel("all")).toBe("全部");
    expect(getAssetFilterLabel("text")).toBe("文本");
    expect(getAssetFilterLabel("image")).toBe("图片");
    expect(getAssetFilterLabel("video")).toBe("视频");
    expect(getAssetModeLabel("text")).toBe("文本资产");
    expect(getAssetModeLabel("image")).toBe("图片资产");
    expect(getAssetModeLabel("video")).toBe("视频资产");
  });

  it("summarizes long asset prompts", () => {
    const asset = createLocalCreationAsset({
      ...createTask("text"),
      prompt: "这是一段非常长的创作需求，用来验证资产库里面的摘要不会无限增长影响界面展示"
    });

    expect(summarizeAssetPrompt(asset, 18)).toBe("这是一段非常长的创作需求，用来验证资...");
  });

  it("returns defensive copies of task data", () => {
    const task = createTask("video");
    const asset = createLocalCreationAsset(task);

    task.preset.parameters.resolution = "720p";
    task.preset.creditEstimate.credits = 999;
    task.resultPreview.title = "mutated";

    expect(asset.preset.parameters.resolution).toBe("1080p");
    expect(asset.preset.creditEstimate).toEqual({ credits: 18, unit: "credit" });
    expect(asset.preview.title).toBe("视频资产");
  });
});
```

- [ ] **Step 2: Run desktop asset model tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- assetModel.test.ts
```

Expected: FAIL because `apps/desktop/src/assetModel.ts` does not exist.

- [ ] **Step 3: Implement the desktop asset model**

Create `apps/desktop/src/assetModel.ts`:

```ts
import type {
  CreationAsset,
  CreationAssetContent,
  CreationAssetPreview,
  CreationMode,
  GenerationTask,
  PresetSuggestion
} from "@gw-link-omniai/shared";

export type AssetFilter = "all" | CreationMode;

export interface LocalCreationAssetClock {
  now(): Date;
}

export interface LocalCreationAssetOptions {
  clock?: LocalCreationAssetClock;
  idGenerator?: () => string;
}

const previews: Record<CreationMode, CreationAssetPreview> = {
  text: {
    title: "文本资产",
    description: "占位文本资产，后续阶段将接入真实文本生成结果。"
  },
  image: {
    title: "图片资产",
    description: "占位图片资产，后续阶段将接入真实图片文件。"
  },
  video: {
    title: "视频资产",
    description: "占位视频资产，后续阶段将接入真实视频文件。"
  }
};

const filterLabels: Record<AssetFilter, string> = {
  all: "全部",
  text: "文本",
  image: "图片",
  video: "视频"
};

const modeLabels: Record<CreationMode, string> = {
  text: "文本资产",
  image: "图片资产",
  video: "视频资产"
};

export function createLocalCreationAsset(
  task: GenerationTask,
  options: LocalCreationAssetOptions = {}
): CreationAsset {
  const now = (options.clock ?? { now: () => new Date() }).now().toISOString();
  const idGenerator = options.idGenerator ?? createLocalCreationAssetId;

  return {
    id: idGenerator(),
    mode: task.mode,
    title: modeLabels[task.mode],
    content: createContent(task),
    preview: { ...previews[task.mode] },
    source: {
      taskId: task.id,
      taskStatus: "succeeded"
    },
    prompt: task.prompt,
    optimizedPrompt: task.optimizedPrompt,
    preset: clonePreset(task.preset),
    createdAt: now
  };
}

export function filterCreationAssets(assets: CreationAsset[], filter: AssetFilter): CreationAsset[] {
  if (filter === "all") {
    return assets;
  }

  return assets.filter((asset) => asset.mode === filter);
}

export function getAssetFilterLabel(filter: AssetFilter): string {
  return filterLabels[filter];
}

export function getAssetModeLabel(mode: CreationMode): string {
  return modeLabels[mode];
}

export function summarizeAssetPrompt(asset: CreationAsset, maxLength = 48): string {
  const prompt = asset.prompt.trim();

  if (prompt.length <= maxLength) {
    return prompt;
  }

  return `${prompt.slice(0, maxLength)}...`;
}

function createContent(task: GenerationTask): CreationAssetContent {
  if (task.mode === "text") {
    return {
      kind: "text",
      text: task.optimizedPrompt,
      format: "markdown"
    };
  }

  if (task.mode === "image") {
    return {
      kind: "image",
      url: "https://assets.gw-link.local/placeholders/image-generation.png",
      alt: task.prompt
    };
  }

  return {
    kind: "video",
    url: "https://assets.gw-link.local/placeholders/video-generation.mp4",
    durationSeconds: Number(task.preset.parameters.durationSeconds ?? 6),
    posterUrl: "https://assets.gw-link.local/placeholders/video-poster.png"
  };
}

function clonePreset(preset: PresetSuggestion): PresetSuggestion {
  return {
    ...preset,
    parameters: { ...preset.parameters },
    creditEstimate: { ...preset.creditEstimate }
  };
}

function createLocalCreationAssetId(): string {
  return `desktop_creation_asset_${Date.now().toString(36)}`;
}
```

- [ ] **Step 4: Run desktop asset model verification**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- assetModel.test.ts
pnpm --filter @gw-link-omniai/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/assetModel.ts apps/desktop/src/__tests__/assetModel.test.ts
git commit -m "feat: add desktop asset model"
```

---

## Task 5: Desktop Asset Library UI

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/__tests__/App.test.tsx`

- [ ] **Step 1: Write failing desktop asset library tests**

Modify `apps/desktop/src/__tests__/App.test.tsx` by adding these tests before the authenticated session test:

```ts
  it("saves a submitted text task into the asset library", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));
    fireEvent.click(screen.getByRole("button", { name: "保存到资产库" }));

    const assetLibrary = screen.getByLabelText("资产库");
    expect(within(assetLibrary).getByText("文本资产")).toBeTruthy();
    expect(within(assetLibrary).getByText("gw-text-balanced")).toBeTruthy();
    expect(within(assetLibrary).getByText("预计点数：1 credit")).toBeTruthy();
    expect(within(assetLibrary).getByText("帮我写一个咖啡店新品发布文案")).toBeTruthy();
    expect(within(assetLibrary).getByText("占位文本资产，后续阶段将接入真实文本生成结果。")).toBeTruthy();
    expect(within(assetLibrary).getByText("复用参数")).toBeTruthy();
  });

  it("filters saved assets by creation mode", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));
    fireEvent.click(screen.getByRole("button", { name: "保存到资产库" }));

    const modeNavigation = screen.getByRole("navigation", { name: "Studio modes" });
    fireEvent.click(within(modeNavigation).getByRole("button", { name: "图片创作" }));
    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));
    fireEvent.click(screen.getAllByRole("button", { name: "保存到资产库" })[0]);

    const assetLibrary = screen.getByLabelText("资产库");
    expect(within(assetLibrary).getByText("文本资产")).toBeTruthy();
    expect(within(assetLibrary).getByText("图片资产")).toBeTruthy();

    fireEvent.click(within(assetLibrary).getByRole("button", { name: "图片" }));
    expect(within(assetLibrary).queryByText("文本资产")).toBeNull();
    expect(within(assetLibrary).getByText("图片资产")).toBeTruthy();

    fireEvent.click(within(assetLibrary).getByRole("button", { name: "文本" }));
    expect(within(assetLibrary).getByText("文本资产")).toBeTruthy();
    expect(within(assetLibrary).queryByText("图片资产")).toBeNull();

    fireEvent.click(within(assetLibrary).getByRole("button", { name: "全部" }));
    expect(within(assetLibrary).getByText("文本资产")).toBeTruthy();
    expect(within(assetLibrary).getByText("图片资产")).toBeTruthy();
  });

  it("keeps saved assets when switching modes and saves video assets", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));
    fireEvent.click(screen.getByRole("button", { name: "保存到资产库" }));

    const modeNavigation = screen.getByRole("navigation", { name: "Studio modes" });
    fireEvent.click(within(modeNavigation).getByRole("button", { name: "视频创作" }));
    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));
    fireEvent.click(screen.getAllByRole("button", { name: "保存到资产库" })[0]);

    const assetLibrary = screen.getByLabelText("资产库");
    expect(within(assetLibrary).getByText("文本资产")).toBeTruthy();
    expect(within(assetLibrary).getByText("视频资产")).toBeTruthy();
    expect(within(assetLibrary).getByText("gw-video-motion")).toBeTruthy();
    expect(within(assetLibrary).getByText("预计点数：18 credits")).toBeTruthy();
  });
```

- [ ] **Step 2: Run desktop app tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- App.test.tsx
```

Expected: FAIL because task rows do not have “保存到资产库” and no asset library exists.

- [ ] **Step 3: Implement the desktop asset library UI**

Modify `apps/desktop/src/App.tsx`:

1. Update imports:

```tsx
import type { CreationAsset, CreationMode, GenerationTask } from "@gw-link-omniai/shared";
import {
  createLocalCreationAsset,
  filterCreationAssets,
  getAssetFilterLabel,
  summarizeAssetPrompt,
  type AssetFilter
} from "./assetModel";
```

2. Add local state:

```tsx
  const [creationAssets, setCreationAssets] = useState<CreationAsset[]>([]);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
```

3. Add derived values and handlers after the credit label constants:

```tsx
  const assetFilters: AssetFilter[] = ["all", "text", "image", "video"];
  const filteredAssets = useMemo(
    () => filterCreationAssets(creationAssets, assetFilter),
    [creationAssets, assetFilter]
  );

  function handleSaveAsset(task: GenerationTask) {
    setCreationAssets((currentAssets) => {
      const assetNumber = currentAssets.length + 1;
      const asset = createLocalCreationAsset(task, {
        idGenerator: () => `desktop_creation_asset_${assetNumber.toString().padStart(6, "0")}`,
        clock: { now: () => new Date("2026-06-20T00:00:00.000Z") }
      });

      return [asset, ...currentAssets];
    });
  }
```

4. In each task article, add a save button after the task `<dl>`:

```tsx
                    <button type="button" onClick={() => handleSaveAsset(task)}>
                      保存到资产库
                    </button>
```

5. After the task center section, add this asset library section:

```tsx
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
            {filteredAssets.map((asset) => {
              const assetCreditCount = asset.preset.creditEstimate.credits;
              const assetCreditLabel = assetCreditCount === 1 ? "credit" : "credits";

              return (
                <li key={asset.id}>
                  <article>
                    <h3>{asset.title}</h3>
                    <p>{asset.preview.description}</p>
                    <p>{summarizeAssetPrompt(asset)}</p>
                    <dl>
                      <div>
                        <dt>modelId</dt>
                        <dd>{asset.preset.modelId}</dd>
                      </div>
                      <div>
                        <dt>预计点数</dt>
                        <dd>
                          预计点数：{assetCreditCount} {assetCreditLabel}
                        </dd>
                      </div>
                    </dl>
                    <button type="button">复用参数</button>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>
```

- [ ] **Step 4: Run desktop app verification**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- App.test.tsx
pnpm --filter @gw-link-omniai/desktop test
pnpm --filter @gw-link-omniai/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
git commit -m "feat: render desktop asset library"
```

---

## Task 6: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update README**

Add this section after `Unified Generation Task MVP` in `README.md`:

````md
### Asset Library MVP

The third product-first slice turns generation task output into reusable creation assets.

- Text, image, and video use one shared `CreationAsset` contract.
- `POST /v1/assets` creates an in-memory asset with fake text, image, or video content.
- `GET /v1/assets` lists assets in the current API process.
- Desktop can save submitted tasks into a local asset library.
- The asset library can filter all, text, image, and video assets.
- This stage still does not call real AI providers, persist assets, store files, sync across devices, or deduct credits.

Example:

```bash
curl -s -X POST http://localhost:8787/v1/assets \
  -H 'content-type: application/json' \
  -d '{"mode":"image","title":"图片资产","content":{"kind":"image","url":"https://assets.gw-link.local/placeholders/image-generation.png","alt":"咖啡店新品海报占位图"},"source":{"taskId":"generation_task_000001","taskStatus":"succeeded"},"prompt":"做一张咖啡店新品海报","optimizedPrompt":"制作一张咖啡店新品商业海报。","preset":{"modelId":"gw-image-creative","parameters":{"aspectRatio":"4:3","quality":"high","count":1},"creditEstimate":{"credits":2,"unit":"credit"}}}'
```
````

- [ ] **Step 2: Update architecture documentation**

Add this section after `Unified Generation Task Slice` in `docs/architecture/mvp-skeleton.md`:

```md
## Asset Library Slice

The asset library slice turns generated task output into reusable product assets. Text, image, and video assets share `CreationAssetRequest` and `CreationAsset`, keeping provider responses and storage details behind later adapter and persistence stages.

The API exposes `/v1/assets` through an in-memory asset service. Assets are listable inside the current API process, but this slice intentionally does not persist assets, upload files, call real providers, sync across devices, or mutate credits.

Desktop asset saving remains local in this slice. The UI proves the workflow from task center to filtered asset library while keeping HTTP client, auth token handling, persistent storage, file lifecycle, and real provider output for later stages.
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
git commit -m "docs: document asset library slice"
```

---

## Final Review Checklist

- [ ] `CreationAsset` uses product `mode`, not provider capability or adapter fields.
- [ ] `CreationAssetRequest` carries title, content, source, prompt, optimizedPrompt, and full preset suggestion.
- [ ] `CreationAssetContent` expresses text, image, and video display content.
- [ ] `InMemoryAssetService` creates text/image/video assets without external calls.
- [ ] Asset service and desktop model both return defensive copies of nested preset/content/preview data.
- [ ] `POST /v1/assets` and `GET /v1/assets` use stable response shapes.
- [ ] Error responses match the Stage 3 spec.
- [ ] Existing auth, prompt optimizer, and generation service injection behavior remains unchanged.
- [ ] Desktop task rows can be saved into the asset library.
- [ ] Desktop asset library filters all/text/image/video assets.
- [ ] Switching Studio modes does not clear saved assets.
- [ ] README and architecture docs state that real providers, persistence, file storage, sync, and credit mutation are later slices.
- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
