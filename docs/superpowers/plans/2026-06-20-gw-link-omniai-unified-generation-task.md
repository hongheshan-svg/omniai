# GW-LINK OmniAI Unified Generation Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Stage 2 unified generation task MVP so text, image, and video Studio modes can submit queued generation tasks and show them in a desktop task center.

**Architecture:** Extend shared contracts from prompt-only output to product-level generation tasks. Add an in-memory API generation service and `/v1/generations` routes with stable errors. Keep desktop submission local for this stage, using the same shared contracts without adding HTTP client/auth-token coupling yet.

**Tech Stack:** TypeScript, Fastify, React, Vitest, Testing Library, pnpm workspaces.

---

## File Structure

- Modify: `packages/shared/src/models.ts` - replace provider-shaped `GenerationTask` with product-shaped request/task/preview contracts.
- Modify: `packages/shared/src/index.ts` - export new generation request and preview contracts.
- Create: `packages/shared/src/__tests__/generation.test.ts` - shared generation contract tests.
- Modify: `apps/api/src/services/gatewayClient.ts` - keep the legacy gateway stub compiling against the new task contract.
- Create: `apps/api/src/services/generationService.ts` - in-memory generation task service with validation and defensive copies.
- Create: `apps/api/src/services/__tests__/generationService.test.ts` - service unit tests.
- Create: `apps/api/src/routes/generations.ts` - `POST /v1/generations` and `GET /v1/generations`.
- Create: `apps/api/src/routes/__tests__/generations.test.ts` - route tests.
- Modify: `apps/api/src/server.ts` - inject and register generation service/routes.
- Modify: `apps/api/src/__tests__/server.test.ts` - server integration tests for generation route registration and injection behavior.
- Create: `apps/desktop/src/generationModel.ts` - local desktop task helper, preview and status labels.
- Create: `apps/desktop/src/__tests__/generationModel.test.ts` - desktop generation model tests.
- Modify: `apps/desktop/src/App.tsx` - enable submit and render task center.
- Modify: `apps/desktop/src/__tests__/App.test.tsx` - UI tests for task submission.
- Modify: `README.md` - document Stage 2 generation task slice.
- Modify: `docs/architecture/mvp-skeleton.md` - document product-level task slice.

---

## Task 1: Shared Generation Task Contracts

**Files:**
- Modify: `packages/shared/src/models.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/generation.test.ts`
- Modify: `apps/api/src/services/gatewayClient.ts`

- [ ] **Step 1: Write the failing shared generation contract tests**

Create `packages/shared/src/__tests__/generation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GenerationTask, GenerationTaskRequest, PresetSuggestion } from "..";

const imagePreset: PresetSuggestion = {
  modelId: "gw-image-creative",
  parameters: {
    aspectRatio: "4:3",
    quality: "high",
    count: 1
  },
  creditEstimate: { credits: 2, unit: "credit" }
};

describe("generation task contracts", () => {
  it("represents a generation task request for each creation mode", () => {
    const requests: GenerationTaskRequest[] = [
      {
        mode: "text",
        prompt: "帮我写一个新品发布文案",
        optimizedPrompt: "请生成一段可发布的新品推广文案。",
        preset: {
          modelId: "gw-text-balanced",
          parameters: { outputFormat: "markdown", tone: "clear" },
          creditEstimate: { credits: 1, unit: "credit" }
        }
      },
      {
        mode: "image",
        prompt: "做一张咖啡店新品海报",
        optimizedPrompt: "制作一张咖啡店新品商业海报。",
        preset: imagePreset
      },
      {
        mode: "video",
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
    expect(requests.map((request) => request.preset.modelId)).toEqual([
      "gw-text-balanced",
      "gw-image-creative",
      "gw-video-motion"
    ]);
  });

  it("represents a queued product generation task", () => {
    const task: GenerationTask = {
      id: "generation_task_000001",
      mode: "image",
      status: "queued",
      prompt: "做一张咖啡店新品海报",
      optimizedPrompt: "制作一张咖啡店新品商业海报。",
      preset: imagePreset,
      resultPreview: {
        title: "图片生成任务",
        description: "任务已排队，后续阶段将接入真实图片生成结果。"
      },
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z"
    };

    expect(task).toMatchObject({
      mode: "image",
      status: "queued",
      preset: {
        modelId: "gw-image-creative",
        creditEstimate: { credits: 2, unit: "credit" }
      },
      resultPreview: {
        title: "图片生成任务"
      }
    });
  });
});
```

- [ ] **Step 2: Run the shared test to verify it fails**

Run:

```bash
pnpm --filter @gw-link-omniai/shared test -- generation.test.ts
```

Expected: FAIL because `GenerationTaskRequest` and `GenerationTaskResultPreview` do not exist, and `GenerationTask` still has the old provider-shaped fields.

- [ ] **Step 3: Update shared models**

In `packages/shared/src/models.ts`, replace the existing `GenerationTask` interface with this block:

```ts
export type GenerationTaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface GenerationTaskRequest {
  mode: CreationMode;
  prompt: string;
  optimizedPrompt: string;
  preset: PresetSuggestion;
}

export interface GenerationTaskResultPreview {
  title: string;
  description: string;
}

export interface GenerationTask {
  id: string;
  mode: CreationMode;
  status: GenerationTaskStatus;
  prompt: string;
  optimizedPrompt: string;
  preset: PresetSuggestion;
  resultPreview: GenerationTaskResultPreview;
  createdAt: string;
  updatedAt: string;
}
```

Keep `ModelCapability` and `CreditAmount` unchanged because model catalog and credit estimation still use them.

- [ ] **Step 4: Export new generation contracts**

In `packages/shared/src/index.ts`, add `GenerationTaskRequest` and `GenerationTaskResultPreview` to the existing type export list:

```ts
  GenerationTask,
  GenerationTaskRequest,
  GenerationTaskResultPreview,
  GenerationTaskStatus,
```

- [ ] **Step 5: Keep the gateway stub compiling**

Modify `apps/api/src/services/gatewayClient.ts` so its stub return value matches the new product task contract:

```ts
import type { GenerationTask, ModelCapability } from "@gw-link-omniai/shared";

export interface GatewayGenerationRequest {
  capability: ModelCapability;
  modelId: string;
  prompt: string;
  userId: string;
}

export interface GatewayClient {
  submitGeneration(request: GatewayGenerationRequest): Promise<GenerationTask>;
}

export class GwLinkGatewayClient implements GatewayClient {
  constructor(private readonly baseUrl: string) {}

  async submitGeneration(request: GatewayGenerationRequest): Promise<GenerationTask> {
    const now = new Date().toISOString();

    return {
      id: `task_${request.capability}_${request.modelId}`,
      mode: request.capability,
      status: "queued",
      prompt: request.prompt,
      optimizedPrompt: request.prompt,
      preset: {
        modelId: request.modelId,
        parameters: {},
        creditEstimate: {
          credits: 1,
          unit: "credit"
        }
      },
      resultPreview: {
        title: "生成任务",
        description: "任务已排队，后续阶段将接入真实生成结果。"
      },
      createdAt: now,
      updatedAt: now
    };
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
```

- [ ] **Step 6: Run shared and API type verification**

Run:

```bash
pnpm --filter @gw-link-omniai/shared test -- generation.test.ts
pnpm --filter @gw-link-omniai/shared typecheck
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/models.ts packages/shared/src/index.ts packages/shared/src/__tests__/generation.test.ts apps/api/src/services/gatewayClient.ts
git commit -m "feat: add generation task contracts"
```

---

## Task 2: In-Memory Generation Service

**Files:**
- Create: `apps/api/src/services/generationService.ts`
- Create: `apps/api/src/services/__tests__/generationService.test.ts`

- [ ] **Step 1: Write the failing service tests**

Create `apps/api/src/services/__tests__/generationService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GenerationTaskRequest } from "@gw-link-omniai/shared";
import { GenerationTaskError, InMemoryGenerationService } from "../generationService";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function createService() {
  return new InMemoryGenerationService({
    clock: { now: () => fixedNow },
    idGenerator: () => "generation_task_000001"
  });
}

function createImageRequest(): GenerationTaskRequest {
  return {
    mode: "image",
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

function expectGenerationError(action: () => unknown, message: string, statusCode: number) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(GenerationTaskError);
    expect(error).toMatchObject({ message, statusCode });
    return;
  }

  throw new Error("Expected generation task error");
}

describe("InMemoryGenerationService", () => {
  it("creates a queued image generation task", () => {
    const service = createService();

    expect(service.createTask(createImageRequest())).toEqual({
      id: "generation_task_000001",
      mode: "image",
      status: "queued",
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
      resultPreview: {
        title: "图片生成任务",
        description: "任务已排队，后续阶段将接入真实图片生成结果。"
      },
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z"
    });
  });

  it("creates mode-specific text and video previews", () => {
    const service = createService();
    const textTask = service.createTask({
      mode: "text",
      prompt: "帮我写一个新品发布文案",
      optimizedPrompt: "请生成一段新品推广文案。",
      preset: {
        modelId: "gw-text-balanced",
        parameters: { outputFormat: "markdown", tone: "clear" },
        creditEstimate: { credits: 1, unit: "credit" }
      }
    });
    const videoTask = service.createTask({
      mode: "video",
      prompt: "生成一段咖啡拉花短视频",
      optimizedPrompt: "生成一段展示咖啡拉花过程的短视频。",
      preset: {
        modelId: "gw-video-motion",
        parameters: { durationSeconds: 6, aspectRatio: "16:9", resolution: "1080p" },
        creditEstimate: { credits: 18, unit: "credit" }
      }
    });

    expect(textTask.resultPreview).toEqual({
      title: "文本生成任务",
      description: "任务已排队，后续阶段将接入真实文本生成结果。"
    });
    expect(videoTask.resultPreview).toEqual({
      title: "视频生成任务",
      description: "任务已排队，后续阶段将接入真实视频生成结果。"
    });
  });

  it("lists created tasks with defensive copies", () => {
    const service = createService();
    const task = service.createTask(createImageRequest());
    task.preset.parameters.quality = "mutated";
    task.preset.creditEstimate.credits = 999;
    task.resultPreview.title = "mutated";

    const [listedTask] = service.listTasks();
    expect(listedTask).toMatchObject({
      preset: {
        parameters: {
          quality: "high"
        },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      resultPreview: {
        title: "图片生成任务"
      }
    });

    listedTask!.preset.parameters.quality = "changed again";
    expect(service.listTasks()[0]!.preset.parameters.quality).toBe("high");
  });

  it("rejects unsupported modes", () => {
    const service = createService();
    expectGenerationError(
      () =>
        service.createTask({
          ...createImageRequest(),
          mode: "audio" as "image"
        }),
      "Unsupported creation mode",
      400
    );
  });

  it("rejects empty prompts", () => {
    const service = createService();
    expectGenerationError(
      () =>
        service.createTask({
          ...createImageRequest(),
          prompt: " "
        }),
      "Prompt is required",
      400
    );
  });

  it("rejects empty optimized prompts", () => {
    const service = createService();
    expectGenerationError(
      () =>
        service.createTask({
          ...createImageRequest(),
          optimizedPrompt: " "
        }),
      "Optimized prompt is required",
      400
    );
  });

  it("rejects invalid preset suggestions", () => {
    const service = createService();
    expectGenerationError(
      () =>
        service.createTask({
          ...createImageRequest(),
          preset: {
            modelId: "",
            parameters: { quality: "high" },
            creditEstimate: { credits: 2, unit: "credit" }
          }
        }),
      "Invalid preset suggestion",
      400
    );
  });
});
```

- [ ] **Step 2: Run the service tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- generationService.test.ts
```

Expected: FAIL because `apps/api/src/services/generationService.ts` does not exist.

- [ ] **Step 3: Implement the in-memory generation service**

Create `apps/api/src/services/generationService.ts`:

```ts
import type {
  CreationMode,
  GenerationTask,
  GenerationTaskRequest,
  GenerationTaskResultPreview,
  PresetSuggestion
} from "@gw-link-omniai/shared";

export class GenerationTaskError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "GenerationTaskError";
  }
}

export interface GenerationServiceClock {
  now(): Date;
}

export interface GenerationServiceOptions {
  clock?: GenerationServiceClock;
  idGenerator?: () => string;
}

export interface GenerationService {
  createTask(request: GenerationTaskRequest): GenerationTask;
  listTasks(): GenerationTask[];
}

const resultPreviewByMode: Record<CreationMode, GenerationTaskResultPreview> = {
  text: {
    title: "文本生成任务",
    description: "任务已排队，后续阶段将接入真实文本生成结果。"
  },
  image: {
    title: "图片生成任务",
    description: "任务已排队，后续阶段将接入真实图片生成结果。"
  },
  video: {
    title: "视频生成任务",
    description: "任务已排队，后续阶段将接入真实视频生成结果。"
  }
};

export class InMemoryGenerationService implements GenerationService {
  private readonly clock: GenerationServiceClock;
  private readonly idGenerator: () => string;
  private readonly tasks: GenerationTask[] = [];

  constructor(options: GenerationServiceOptions = {}) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.idGenerator = options.idGenerator ?? createGenerationTaskId;
  }

  createTask(request: GenerationTaskRequest): GenerationTask {
    if (!isCreationMode(request.mode)) {
      throw new GenerationTaskError("Unsupported creation mode", 400);
    }

    const prompt = request.prompt.trim();
    if (!prompt) {
      throw new GenerationTaskError("Prompt is required", 400);
    }

    const optimizedPrompt = request.optimizedPrompt.trim();
    if (!optimizedPrompt) {
      throw new GenerationTaskError("Optimized prompt is required", 400);
    }

    if (!isValidPresetSuggestion(request.preset)) {
      throw new GenerationTaskError("Invalid preset suggestion", 400);
    }

    const now = this.clock.now().toISOString();
    const task: GenerationTask = {
      id: this.idGenerator(),
      mode: request.mode,
      status: "queued",
      prompt,
      optimizedPrompt,
      preset: clonePreset(request.preset),
      resultPreview: { ...resultPreviewByMode[request.mode] },
      createdAt: now,
      updatedAt: now
    };

    this.tasks.push(cloneTask(task));
    return cloneTask(task);
  }

  listTasks(): GenerationTask[] {
    return this.tasks.map(cloneTask);
  }
}

function isCreationMode(value: unknown): value is CreationMode {
  return value === "text" || value === "image" || value === "video";
}

function isValidPresetSuggestion(value: unknown): value is PresetSuggestion {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.modelId !== "string" || value.modelId.trim() === "") {
    return false;
  }

  if (!isRecord(value.parameters)) {
    return false;
  }

  if (!Object.values(value.parameters).every(isPresetParameterValue)) {
    return false;
  }

  if (!isRecord(value.creditEstimate)) {
    return false;
  }

  return (
    typeof value.creditEstimate.credits === "number" &&
    Number.isFinite(value.creditEstimate.credits) &&
    value.creditEstimate.credits > 0 &&
    value.creditEstimate.unit === "credit"
  );
}

function isPresetParameterValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneTask(task: GenerationTask): GenerationTask {
  return {
    ...task,
    preset: clonePreset(task.preset),
    resultPreview: { ...task.resultPreview }
  };
}

function clonePreset(preset: PresetSuggestion): PresetSuggestion {
  return {
    ...preset,
    parameters: { ...preset.parameters },
    creditEstimate: { ...preset.creditEstimate }
  };
}

function createGenerationTaskId(): string {
  return `generation_task_${Date.now().toString(36)}`;
}
```

- [ ] **Step 4: Run service tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- generationService.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/generationService.ts apps/api/src/services/__tests__/generationService.test.ts
git commit -m "feat: add in-memory generation service"
```

---

## Task 3: Generation API Routes

**Files:**
- Create: `apps/api/src/routes/generations.ts`
- Create: `apps/api/src/routes/__tests__/generations.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/server.test.ts`

- [ ] **Step 1: Write the failing route tests**

Create `apps/api/src/routes/__tests__/generations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import { InMemoryGenerationService, type GenerationService } from "../../services/generationService";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function buildGenerationTestServer() {
  return buildServer({
    generationService: new InMemoryGenerationService({
      clock: { now: () => fixedNow },
      idGenerator: () => "generation_task_000001"
    })
  });
}

function createImagePayload() {
  return {
    mode: "image",
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

describe("generation routes", () => {
  it("creates and lists generation tasks", async () => {
    const server = buildGenerationTestServer();
    const createResponse = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: createImagePayload()
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toEqual({
      task: {
        id: "generation_task_000001",
        mode: "image",
        status: "queued",
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
        resultPreview: {
          title: "图片生成任务",
          description: "任务已排队，后续阶段将接入真实图片生成结果。"
        },
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z"
      }
    });

    const listResponse = await server.inject({
      method: "GET",
      url: "/v1/generations"
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({
      tasks: [createResponse.json().task]
    });
  });

  it("rejects malformed generation task requests", async () => {
    const server = buildGenerationTestServer();
    const invalidPayloads = [
      {},
      { mode: "image" },
      { mode: "image", prompt: "做一张海报" },
      { mode: "image", prompt: "做一张海报", optimizedPrompt: "优化结果" },
      { mode: "image", prompt: 123, optimizedPrompt: "优化结果", preset: {} },
      ["image", "做一张海报"]
    ];

    for (const payload of invalidPayloads) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/generations",
        payload
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "Invalid generation task request"
      });
    }
  });

  it("maps generation domain errors to HTTP responses", async () => {
    const server = buildGenerationTestServer();
    const unsupportedMode = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        ...createImagePayload(),
        mode: "audio"
      }
    });
    const emptyPrompt = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        ...createImagePayload(),
        prompt: " "
      }
    });
    const emptyOptimizedPrompt = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        ...createImagePayload(),
        optimizedPrompt: " "
      }
    });
    const invalidPreset = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        ...createImagePayload(),
        preset: {
          modelId: "",
          parameters: {},
          creditEstimate: { credits: 2, unit: "credit" }
        }
      }
    });

    expect(unsupportedMode.statusCode).toBe(400);
    expect(unsupportedMode.json()).toEqual({ error: "Unsupported creation mode" });
    expect(emptyPrompt.statusCode).toBe(400);
    expect(emptyPrompt.json()).toEqual({ error: "Prompt is required" });
    expect(emptyOptimizedPrompt.statusCode).toBe(400);
    expect(emptyOptimizedPrompt.json()).toEqual({ error: "Optimized prompt is required" });
    expect(invalidPreset.statusCode).toBe(400);
    expect(invalidPreset.json()).toEqual({ error: "Invalid preset suggestion" });
  });

  it("maps unexpected generation service errors to a 500 response", async () => {
    const generationService = {
      createTask: () => {
        throw new Error("boom");
      },
      listTasks: () => []
    } satisfies GenerationService;
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
});
```

Modify `apps/api/src/__tests__/server.test.ts` by adding this test after the prompt route registration test:

```ts
  it("registers the generation routes", async () => {
    const server = buildServer();
    const createResponse = await server.inject({
      method: "POST",
      url: "/v1/generations",
      payload: {
        mode: "text",
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
      url: "/v1/generations"
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({
      task: {
        mode: "text",
        status: "queued",
        preset: {
          modelId: "gw-text-balanced",
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      tasks: [
        {
          mode: "text",
          status: "queued"
        }
      ]
    });
  });
```

Also update the existing invalid env injection test in `server.test.ts` so it injects a fake generation service:

```ts
    const fakeGenerationService = {
      createTask: () => {
        throw new Error("not implemented");
      },
      listTasks: () => []
    };
```

and change the assertion to:

```ts
      expect(() =>
        buildServer({
          authService: fakeAuthService,
          generationService: fakeGenerationService
        })
      ).not.toThrow();
```

- [ ] **Step 2: Run route tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- generations.test.ts server.test.ts
```

Expected: FAIL because generation routes and `BuildServerOptions.generationService` do not exist.

- [ ] **Step 3: Implement generation routes**

Create `apps/api/src/routes/generations.ts`:

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import type { GenerationTaskRequest } from "@gw-link-omniai/shared";
import { GenerationTaskError, type GenerationService } from "../services/generationService";

export function registerGenerationRoutes(server: FastifyInstance, generationService: GenerationService): void {
  server.post("/v1/generations", async (request, reply) => {
    const taskRequest = readGenerationTaskRequest(request.body);

    if (!taskRequest) {
      return sendBadRequest(reply);
    }

    try {
      const task = generationService.createTask(taskRequest);
      return { task };
    } catch (error) {
      return sendGenerationTaskError(reply, error);
    }
  });

  server.get("/v1/generations", async () => ({
    tasks: generationService.listTasks()
  }));
}

function readGenerationTaskRequest(body: unknown): GenerationTaskRequest | undefined {
  if (
    !isRequestBody(body) ||
    typeof body.mode !== "string" ||
    typeof body.prompt !== "string" ||
    typeof body.optimizedPrompt !== "string" ||
    !isRequestBody(body.preset)
  ) {
    return undefined;
  }

  return {
    mode: body.mode as GenerationTaskRequest["mode"],
    prompt: body.prompt,
    optimizedPrompt: body.optimizedPrompt,
    preset: body.preset as GenerationTaskRequest["preset"]
  };
}

function isRequestBody(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

function sendBadRequest(reply: FastifyReply) {
  return reply.status(400).send({
    error: "Invalid generation task request"
  });
}

function sendGenerationTaskError(reply: FastifyReply, error: unknown) {
  if (error instanceof GenerationTaskError) {
    return reply.status(error.statusCode).send({
      error: error.message
    });
  }

  return reply.status(500).send({
    error: "Unexpected generation task error"
  });
}
```

- [ ] **Step 4: Register generation routes in the server**

Modify `apps/api/src/server.ts`:

```ts
import Fastify from "fastify";
import { loadConfig, type ApiConfig } from "./config";
import { registerAuthRoutes } from "./routes/auth";
import { registerGenerationRoutes } from "./routes/generations";
import { registerHealthRoute } from "./routes/health";
import { registerModelRoutes } from "./routes/models";
import { registerPromptRoutes } from "./routes/prompt";
import { InMemoryAuthService, type AuthService } from "./services/authService";
import { InMemoryGenerationService, type GenerationService } from "./services/generationService";
import { LocalPromptOptimizer, type PromptOptimizer } from "./services/promptOptimizer";

export interface BuildServerOptions {
  authService?: AuthService;
  config?: ApiConfig;
  generationService?: GenerationService;
  promptOptimizer?: PromptOptimizer;
}

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({
    logger: false
  });
  const authService =
    options.authService ??
    new InMemoryAuthService({
      devCodesEnabled: (options.config ?? loadConfig()).authDevCodesEnabled
    });
  const generationService = options.generationService ?? new InMemoryGenerationService();
  const promptOptimizer = options.promptOptimizer ?? new LocalPromptOptimizer();

  registerHealthRoute(server);
  registerModelRoutes(server);
  registerPromptRoutes(server, promptOptimizer);
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

- [ ] **Step 5: Run API route tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- generations.test.ts server.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/generations.ts apps/api/src/routes/__tests__/generations.test.ts apps/api/src/server.ts apps/api/src/__tests__/server.test.ts
git commit -m "feat: expose generation task API"
```

---

## Task 4: Desktop Generation Model

**Files:**
- Create: `apps/desktop/src/generationModel.ts`
- Create: `apps/desktop/src/__tests__/generationModel.test.ts`

- [ ] **Step 1: Write the failing desktop generation model tests**

Create `apps/desktop/src/__tests__/generationModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PromptOptimization } from "@gw-link-omniai/shared";
import {
  createLocalGenerationTask,
  getGenerationStatusLabel,
  summarizeGenerationPrompt
} from "../generationModel";

const fixedNow = new Date("2026-06-20T00:00:00.000Z");

function createOptimization(mode: PromptOptimization["mode"]): PromptOptimization {
  return {
    id: `optimization_${mode}`,
    mode,
    originalPrompt:
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
    sections: [],
    preset:
      mode === "text"
        ? {
            modelId: "gw-text-balanced",
            parameters: { outputFormat: "markdown", tone: "clear" },
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
    createdAt: "2026-06-20T00:00:00.000Z"
  };
}

describe("generationModel", () => {
  it("creates a queued local generation task from an optimization", () => {
    const task = createLocalGenerationTask(createOptimization("image"), {
      clock: { now: () => fixedNow },
      idGenerator: () => "desktop_generation_task_000001"
    });

    expect(task).toEqual({
      id: "desktop_generation_task_000001",
      mode: "image",
      status: "queued",
      prompt: "做一张咖啡店新品海报",
      optimizedPrompt: "制作一张咖啡店新品商业海报。",
      preset: {
        modelId: "gw-image-creative",
        parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      resultPreview: {
        title: "图片生成任务",
        description: "任务已排队，后续阶段将接入真实图片生成结果。"
      },
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z"
    });
  });

  it("creates mode-specific previews", () => {
    expect(createLocalGenerationTask(createOptimization("text")).resultPreview.title).toBe("文本生成任务");
    expect(createLocalGenerationTask(createOptimization("image")).resultPreview.title).toBe("图片生成任务");
    expect(createLocalGenerationTask(createOptimization("video")).resultPreview.title).toBe("视频生成任务");
  });

  it("returns status labels", () => {
    expect(getGenerationStatusLabel("queued")).toBe("排队中");
    expect(getGenerationStatusLabel("running")).toBe("生成中");
    expect(getGenerationStatusLabel("succeeded")).toBe("已完成");
    expect(getGenerationStatusLabel("failed")).toBe("失败");
  });

  it("summarizes long prompts", () => {
    const task = createLocalGenerationTask({
      ...createOptimization("text"),
      originalPrompt: "这是一段非常长的创作需求，用来验证任务中心里面的摘要不会无限增长影响界面展示"
    });

    expect(summarizeGenerationPrompt(task, 18)).toBe("这是一段非常长的创作需求，用来验证任...");
  });

  it("returns defensive copies of preset data", () => {
    const optimization = createOptimization("video");
    const task = createLocalGenerationTask(optimization);

    optimization.preset.parameters.resolution = "720p";
    optimization.preset.creditEstimate.credits = 999;

    expect(task.preset.parameters.resolution).toBe("1080p");
    expect(task.preset.creditEstimate).toEqual({ credits: 18, unit: "credit" });
  });
});
```

- [ ] **Step 2: Run the desktop generation model tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- generationModel.test.ts
```

Expected: FAIL because `apps/desktop/src/generationModel.ts` does not exist.

- [ ] **Step 3: Implement the desktop generation model**

Create `apps/desktop/src/generationModel.ts`:

```ts
import type {
  GenerationTask,
  GenerationTaskResultPreview,
  GenerationTaskStatus,
  PresetSuggestion,
  PromptOptimization
} from "@gw-link-omniai/shared";

export interface LocalGenerationTaskClock {
  now(): Date;
}

export interface LocalGenerationTaskOptions {
  clock?: LocalGenerationTaskClock;
  idGenerator?: () => string;
}

const resultPreviewByMode: Record<PromptOptimization["mode"], GenerationTaskResultPreview> = {
  text: {
    title: "文本生成任务",
    description: "任务已排队，后续阶段将接入真实文本生成结果。"
  },
  image: {
    title: "图片生成任务",
    description: "任务已排队，后续阶段将接入真实图片生成结果。"
  },
  video: {
    title: "视频生成任务",
    description: "任务已排队，后续阶段将接入真实视频生成结果。"
  }
};

const statusLabels: Record<GenerationTaskStatus, string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败"
};

export function createLocalGenerationTask(
  optimization: PromptOptimization,
  options: LocalGenerationTaskOptions = {}
): GenerationTask {
  const now = (options.clock ?? { now: () => new Date() }).now().toISOString();
  const idGenerator = options.idGenerator ?? createLocalGenerationTaskId;

  return {
    id: idGenerator(),
    mode: optimization.mode,
    status: "queued",
    prompt: optimization.originalPrompt,
    optimizedPrompt: optimization.optimizedPrompt,
    preset: clonePreset(optimization.preset),
    resultPreview: { ...resultPreviewByMode[optimization.mode] },
    createdAt: now,
    updatedAt: now
  };
}

export function getGenerationStatusLabel(status: GenerationTaskStatus): string {
  return statusLabels[status];
}

export function summarizeGenerationPrompt(task: GenerationTask, maxLength = 48): string {
  const prompt = task.prompt.trim();

  if (prompt.length <= maxLength) {
    return prompt;
  }

  return `${prompt.slice(0, maxLength)}...`;
}

function clonePreset(preset: PresetSuggestion): PresetSuggestion {
  return {
    ...preset,
    parameters: { ...preset.parameters },
    creditEstimate: { ...preset.creditEstimate }
  };
}

function createLocalGenerationTaskId(): string {
  return `desktop_generation_task_${Date.now().toString(36)}`;
}
```

- [ ] **Step 4: Run desktop generation model tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- generationModel.test.ts
pnpm --filter @gw-link-omniai/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/generationModel.ts apps/desktop/src/__tests__/generationModel.test.ts
git commit -m "feat: add desktop generation model"
```

---

## Task 5: Desktop Task Center UI

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/__tests__/App.test.tsx`

- [ ] **Step 1: Write the failing desktop task center tests**

Modify `apps/desktop/src/__tests__/App.test.tsx` with these changes:

1. In the video Studio test, rename it to remove "disabled" and assert the submit button is enabled:

```ts
  it("switches to the Video Studio optimization fixture", () => {
    render(<App />);

    const modeNavigation = screen.getByRole("navigation", { name: "Studio modes" });
    fireEvent.click(within(modeNavigation).getByRole("button", { name: "视频创作" }));

    const optimizationResult = screen.getByLabelText("提示词优化结果");
    expect(within(optimizationResult).getByText("镜头运动")).toBeTruthy();
    expect(within(optimizationResult).getByText("gw-video-motion")).toBeTruthy();
    expect(within(optimizationResult).getByText("预计点数：18 credits")).toBeTruthy();
    const submitButton = screen.getByRole<HTMLButtonElement>("button", { name: "提交生成" });
    expect(submitButton.disabled).toBe(false);
  });
```

2. Add these tests before the authenticated session test:

```ts
  it("submits the default Text Studio task into the task center", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

    const taskCenter = screen.getByLabelText("任务中心");
    expect(within(taskCenter).getByText("文本创作")).toBeTruthy();
    expect(within(taskCenter).getByText("排队中")).toBeTruthy();
    expect(within(taskCenter).getByText("gw-text-balanced")).toBeTruthy();
    expect(within(taskCenter).getByText("预计点数：1 credit")).toBeTruthy();
    expect(within(taskCenter).getByText("帮我写一个咖啡店新品发布文案")).toBeTruthy();
  });

  it("keeps submitted tasks when switching modes and appends video tasks", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

    const modeNavigation = screen.getByRole("navigation", { name: "Studio modes" });
    fireEvent.click(within(modeNavigation).getByRole("button", { name: "视频创作" }));
    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

    const taskCenter = screen.getByLabelText("任务中心");
    expect(within(taskCenter).getByText("文本创作")).toBeTruthy();
    expect(within(taskCenter).getByText("视频创作")).toBeTruthy();
    expect(within(taskCenter).getByText("gw-video-motion")).toBeTruthy();
    expect(within(taskCenter).getByText("预计点数：18 credits")).toBeTruthy();
    expect(within(taskCenter).getAllByText("排队中")).toHaveLength(2);
  });
```

- [ ] **Step 2: Run desktop app tests to verify they fail**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test -- App.test.tsx
```

Expected: FAIL because the submit button is still disabled and no task center exists.

- [ ] **Step 3: Implement the desktop task center UI**

Modify `apps/desktop/src/App.tsx` to this complete content:

```tsx
import { useMemo, useState } from "react";
import type { CreationMode, GenerationTask } from "@gw-link-omniai/shared";
import {
  createLocalGenerationTask,
  getGenerationStatusLabel,
  summarizeGenerationPrompt
} from "./generationModel";
import { getDesktopSessionCta } from "./sessionModel";
import {
  getFixtureOptimization,
  getStudioModeContent,
  getStudioModes,
  getStudioTemplates
} from "./studioModel";

const anonymousSession = {
  authenticated: false,
  user: null,
  expiresAt: null
} as const;

export function App() {
  const [selectedMode, setSelectedMode] = useState<CreationMode>("text");
  const [generationTasks, setGenerationTasks] = useState<GenerationTask[]>([]);
  const studioModes = useMemo(() => getStudioModes(), []);
  const content = useMemo(() => getStudioModeContent(selectedMode), [selectedMode]);
  const templates = useMemo(() => getStudioTemplates(selectedMode), [selectedMode]);
  const optimization = useMemo(() => getFixtureOptimization(selectedMode), [selectedMode]);
  const promptInputId = `${selectedMode}-studio-prompt`;
  const creditCount = optimization.preset.creditEstimate.credits;
  const creditLabel = creditCount === 1 ? "credit" : "credits";

  function handleSubmitGeneration() {
    setGenerationTasks((currentTasks) => {
      const taskNumber = currentTasks.length + 1;
      const task = createLocalGenerationTask(optimization, {
        idGenerator: () => `desktop_generation_task_${taskNumber.toString().padStart(6, "0")}`,
        clock: { now: () => new Date("2026-06-20T00:00:00.000Z") }
      });

      return [task, ...currentTasks];
    });
  }

  return (
    <main>
      <header>
        <h1>GW-LINK OmniAI</h1>
        <button type="button">{getDesktopSessionCta(anonymousSession)}</button>
      </header>

      <section aria-labelledby="studio-shell-title">
        <h2 id="studio-shell-title">全域智能创作台</h2>
        <p>围绕文字、图片、视频生产流程优化提示词，再进入生成任务和资产库。</p>
      </section>

      <nav aria-label="Studio modes">
        {studioModes.map((mode) => (
          <button
            key={mode.mode}
            type="button"
            aria-pressed={selectedMode === mode.mode}
            onClick={() => setSelectedMode(mode.mode)}
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
            key={selectedMode}
            id={promptInputId}
            name={`${selectedMode}Prompt`}
            placeholder={content.promptPlaceholder}
            defaultValue={optimization.originalPrompt}
          />
        </div>

        <section aria-label="提示词模板">
          <h3>提示词模板</h3>
          <ul>
            {templates.map((template) => (
              <li key={template.id}>
                <h4>{template.name}</h4>
                <p>{template.description}</p>
                <ul>
                  {template.tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <button type="button">优化提示词</button>
      </section>

      <section aria-label="提示词优化结果">
        <h2>优化结果</h2>
        <p>{optimization.optimizedPrompt}</p>

        <dl>
          {optimization.sections.map((section) => (
            <div key={section.label}>
              <dt>{section.label}</dt>
              <dd>{section.value}</dd>
            </div>
          ))}
        </dl>

        <section aria-labelledby="preset-suggestion-title">
          <h3 id="preset-suggestion-title">推荐参数</h3>
          <dl>
            <div>
              <dt>modelId</dt>
              <dd>{optimization.preset.modelId}</dd>
            </div>
            <div>
              <dt>parameters</dt>
              <dd>
                <dl>
                  {Object.entries(optimization.preset.parameters).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </dd>
            </div>
            <div>
              <dt>点数估算</dt>
              <dd>
                预计点数：{creditCount} {creditLabel}
              </dd>
            </div>
          </dl>
        </section>

        <button type="button" onClick={handleSubmitGeneration}>
          提交生成
        </button>
      </section>

      <section aria-label="任务中心">
        <h2>任务中心</h2>
        {generationTasks.length === 0 ? (
          <p>暂无生成任务</p>
        ) : (
          <ol>
            {generationTasks.map((task) => {
              const taskMode = getStudioModeContent(task.mode);
              const taskCreditCount = task.preset.creditEstimate.credits;
              const taskCreditLabel = taskCreditCount === 1 ? "credit" : "credits";

              return (
                <li key={task.id}>
                  <article>
                    <h3>{taskMode.title}</h3>
                    <p>{getGenerationStatusLabel(task.status)}</p>
                    <p>{summarizeGenerationPrompt(task)}</p>
                    <dl>
                      <div>
                        <dt>modelId</dt>
                        <dd>{task.preset.modelId}</dd>
                      </div>
                      <div>
                        <dt>预计点数</dt>
                        <dd>
                          预计点数：{taskCreditCount} {taskCreditLabel}
                        </dd>
                      </div>
                    </dl>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run desktop app tests and typecheck**

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
git commit -m "feat: render desktop generation task center"
```

---

## Task 6: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update README**

Add this section after `Studio Shell and Prompt Optimizer` in `README.md`:

````md
### Unified Generation Task MVP

The second product-first slice connects prompt optimization to generation task submission.

- Text, image, and video use one shared `GenerationTask` contract.
- `POST /v1/generations` creates a queued in-memory task.
- `GET /v1/generations` lists queued tasks in the current API process.
- Desktop can submit the current Studio result into a local task center.
- This stage still does not call real AI providers, persist tasks, store assets, or deduct credits.

Example:

```bash
curl -s -X POST http://localhost:8787/v1/generations \
  -H 'content-type: application/json' \
  -d '{"mode":"image","prompt":"做一张咖啡店新品海报","optimizedPrompt":"制作一张咖啡店新品商业海报。","preset":{"modelId":"gw-image-creative","parameters":{"aspectRatio":"4:3","quality":"high","count":1},"creditEstimate":{"credits":2,"unit":"credit"}}}'
```
````

- [ ] **Step 2: Update architecture documentation**

Add this section after `Product-First Studio Slice` in `docs/architecture/mvp-skeleton.md`:

```md
## Unified Generation Task Slice

The unified generation task slice connects Studio prompt optimization to product-level task submission. Text, image, and video tasks share `GenerationTaskRequest` and `GenerationTask`, so later provider adapters can implement one stable product contract instead of shaping the product API.

The API exposes `/v1/generations` through an in-memory task service. Tasks are queued and listable inside the current API process, but this slice intentionally does not persist tasks, create assets, call real providers, or mutate credits.

Desktop submission remains local in this slice. The UI proves the user workflow from optimized prompt to task center while keeping HTTP client, auth token handling, persistence, and provider execution for later stages.
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
git commit -m "docs: document unified generation task slice"
```

---

## Final Review Checklist

- [ ] `GenerationTask` uses product `mode`, not provider `capability`.
- [ ] `GenerationTaskRequest` carries prompt, optimizedPrompt, and full preset suggestion.
- [ ] `InMemoryGenerationService` creates queued text/image/video tasks without external calls.
- [ ] Generation service and desktop model both return defensive copies of nested preset data.
- [ ] `POST /v1/generations` and `GET /v1/generations` use stable response shapes.
- [ ] Error responses match the Stage 2 spec.
- [ ] Existing auth and prompt optimizer injection behavior remains unchanged.
- [ ] Desktop submit button is enabled and adds tasks to the task center.
- [ ] Switching Studio modes does not clear submitted tasks.
- [ ] README and architecture docs state that real providers, persistence, assets, and credit mutation are later slices.
- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
