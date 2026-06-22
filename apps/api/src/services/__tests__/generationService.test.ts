import { describe, expect, it } from "vitest";
import type { CreationMode, GenerationTaskRequest } from "@gw-link-omniai/shared";
import { FakeProviderAdapter, ProviderAdapterError, type ProviderAdapter, type ProviderPollRequest } from "../gatewayClient";
import { GenerationTaskError, InMemoryGenerationService } from "../generationService";
import type { CreditService } from "../creditService";
import { ConfigModelCatalog, type ModelCatalog } from "../modelCatalog";
import type { ModelCatalogConfig } from "../modelConfig";

class StubCreditService implements CreditService {
  public readonly deductions: Array<{ userId: string; amount: number; reference: string }> = [];

  constructor(private readonly creditsByUser: Record<string, number> = {}) {}

  async getBalance(userId: string) {
    return { credits: this.creditsByUser[userId] ?? 0, unit: "credit" as const };
  }

  async grantInitial() {}

  async deduct(userId: string, amount: number, reference: string) {
    this.deductions.push({ userId, amount, reference });
    this.creditsByUser[userId] = (this.creditsByUser[userId] ?? 0) - amount;
  }

  async topUp(userId: string, amount: number) {
    this.creditsByUser[userId] = (this.creditsByUser[userId] ?? 0) + amount;
  }
}

function createTextRequest(modelId = "gw-text-balanced"): GenerationTaskRequest {
  return {
    mode: "text" as CreationMode,
    prompt: "帮我写一个新品发布文案",
    optimizedPrompt: "请生成一段新品推广文案。",
    preset: {
      modelId,
      parameters: { outputFormat: "markdown", tone: "clear" },
      creditEstimate: { credits: 1, unit: "credit" as const }
    }
  };
}

const fixedNow = new Date("2026-06-20T00:00:00.000Z");
const TEST_USER_ID = "user_email_testowner000000";

function createService() {
  return new InMemoryGenerationService({
    clock: { now: () => fixedNow },
    idGenerator: () => "generation_task_000001",
    modelCatalog: new ConfigModelCatalog(createModelConfig()),
    providerAdapter: new FakeProviderAdapter()
  });
}

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
            displayName: "OmniAI Text Hidden",
            capability: "text",
            tags: ["hidden"],
            visibility: "hidden",
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
          },
          {
            id: "gw-text-maintenance",
            providerModelId: "claude-maintenance",
            displayName: "OmniAI Text Maintenance",
            capability: "text",
            tags: ["maintenance"],
            visibility: "maintenance",
            minimumPlan: "pro",
            creditUnitCost: 1
          }
        ]
      }
    ]
  };
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

async function expectGenerationError(
  action: () => GenerationTaskRequest | Promise<unknown> | unknown,
  message: string,
  statusCode: number
) {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(GenerationTaskError);
    expect(error).toMatchObject({ message, statusCode });
    return;
  }

  throw new Error("Expected generation task error");
}

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
        status: status as "succeeded" | "running",
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

describe("InMemoryGenerationService", () => {
  it("creates a queued image generation task", async () => {
    const service = createService();

    await expect(service.createTask(createImageRequest(), TEST_USER_ID)).resolves.toEqual({
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

  it("creates text, image, and video tasks after catalog validation", async () => {
    const service = createService();
    const textTask = await service.createTask({
      mode: "text",
      prompt: "帮我写一个新品发布文案",
      optimizedPrompt: "请生成一段新品推广文案。",
      preset: {
        modelId: "gw-text-balanced",
        parameters: { outputFormat: "markdown", tone: "clear" },
        creditEstimate: { credits: 1, unit: "credit" }
      }
    }, TEST_USER_ID);
    const imageTask = await service.createTask(createImageRequest(), TEST_USER_ID);
    const videoTask = await service.createTask({
      mode: "video",
      prompt: "生成一段咖啡拉花短视频",
      optimizedPrompt: "生成一段展示咖啡拉花过程的短视频。",
      preset: {
        modelId: "gw-video-motion",
        parameters: { durationSeconds: 6, aspectRatio: "16:9", resolution: "1080p" },
        creditEstimate: { credits: 18, unit: "credit" }
      }
    }, TEST_USER_ID);

    expect([textTask.status, imageTask.status, videoTask.status]).toEqual(["queued", "queued", "queued"]);
    expect(textTask.resultPreview).toEqual({
      title: "文本生成任务",
      description: "任务已排队，后续阶段将接入真实文本生成结果。"
    });
    expect(videoTask.resultPreview).toEqual({
      title: "视频生成任务",
      description: "任务已排队，后续阶段将接入真实视频生成结果。"
    });
  });

  it("rejects missing models as not found", async () => {
    const service = createService();
    const request = createImageRequest();

    await expect(service.createTask({
      ...request,
      preset: {
        ...request.preset,
        modelId: "missing-model"
      }
    }, TEST_USER_ID)).rejects.toMatchObject({
      message: "Model was not found",
      statusCode: 404
    });
  });

  it("rejects hidden models as not found", async () => {
    const service = createService();

    await expect(service.createTask({
      mode: "text",
      prompt: "帮我写一个新品发布文案",
      optimizedPrompt: "请生成一段新品推广文案。",
      preset: {
        modelId: "gw-text-hidden",
        parameters: { outputFormat: "markdown", tone: "clear" },
        creditEstimate: { credits: 1, unit: "credit" }
      }
    }, TEST_USER_ID)).rejects.toMatchObject({
      message: "Model was not found",
      statusCode: 404
    });
  });

  it("rejects maintenance models as temporarily unavailable", async () => {
    const service = createService();

    await expect(service.createTask({
      mode: "text",
      prompt: "帮我写一个新品发布文案",
      optimizedPrompt: "请生成一段新品推广文案。",
      preset: {
        modelId: "gw-text-maintenance",
        parameters: { outputFormat: "markdown", tone: "clear" },
        creditEstimate: { credits: 1, unit: "credit" }
      }
    }, TEST_USER_ID)).rejects.toMatchObject({
      message: "Model is temporarily unavailable",
      statusCode: 409
    });
  });

  it("rejects mode mismatches", async () => {
    const service = createService();
    const request = createImageRequest();

    await expect(service.createTask({
      ...request,
      mode: "text"
    }, TEST_USER_ID)).rejects.toMatchObject({
      message: "Model does not support this creation mode",
      statusCode: 400
    });
  });

  it("maps provider adapter errors to generation task errors", async () => {
    const providerAdapter: ProviderAdapter = {
      async submitGeneration() {
        throw new ProviderAdapterError("Provider adapter failed", 502);
      }
    };
    const service = new InMemoryGenerationService({
      clock: { now: () => fixedNow },
      idGenerator: () => "generation_task_000001",
      modelCatalog: new ConfigModelCatalog(createModelConfig()),
      providerAdapter
    });

    await expect(service.createTask(createImageRequest(), TEST_USER_ID)).rejects.toMatchObject({
      message: "Provider adapter failed",
      statusCode: 502
    });
    expect(await service.listTasks(TEST_USER_ID)).toEqual([]);
  });

  it("maps unexpected provider adapter errors to provider failures", async () => {
    const providerAdapter: ProviderAdapter = {
      async submitGeneration() {
        throw new Error("transport exploded");
      }
    };
    const service = new InMemoryGenerationService({
      clock: { now: () => fixedNow },
      idGenerator: () => "generation_task_000001",
      modelCatalog: new ConfigModelCatalog(createModelConfig()),
      providerAdapter
    });

    await expect(service.createTask(createImageRequest(), TEST_USER_ID)).rejects.toMatchObject({
      message: "Provider adapter failed",
      statusCode: 502
    });
    expect(await service.listTasks(TEST_USER_ID)).toEqual([]);
  });

  it("does not map unexpected catalog errors as provider failures", async () => {
    const modelCatalog: ModelCatalog = {
      listVisibleModels: () => [],
      getModelReference: () => {
        throw new Error("Catalog lookup failed");
      }
    };
    const service = new InMemoryGenerationService({
      clock: { now: () => fixedNow },
      idGenerator: () => "generation_task_000001",
      modelCatalog,
      providerAdapter: new FakeProviderAdapter()
    });

    try {
      await service.createTask(createImageRequest(), TEST_USER_ID);
    } catch (error) {
      expect(error).not.toBeInstanceOf(GenerationTaskError);
      expect(error).toMatchObject({ message: "Catalog lookup failed" });
      expect(await service.listTasks(TEST_USER_ID)).toEqual([]);
      return;
    }

    throw new Error("Expected catalog error");
  });

  it("lists created tasks with defensive copies", async () => {
    const service = createService();
    const task = await service.createTask(createImageRequest(), TEST_USER_ID);
    task.preset.parameters.quality = "mutated";
    task.preset.creditEstimate.credits = 999;
    task.resultPreview.title = "mutated";

    const [listedTask] = await service.listTasks(TEST_USER_ID);
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
    expect((await service.listTasks(TEST_USER_ID))[0]!.preset.parameters.quality).toBe("high");
  });

  it("rejects unsupported modes", async () => {
    const service = createService();
    await expectGenerationError(
      () =>
        service.createTask({
          ...createImageRequest(),
          mode: "audio" as "image"
        }, TEST_USER_ID),
      "Unsupported creation mode",
      400
    );
  });

  it("rejects empty prompts", async () => {
    const service = createService();
    await expectGenerationError(
      () =>
        service.createTask({
          ...createImageRequest(),
          prompt: " "
        }, TEST_USER_ID),
      "Prompt is required",
      400
    );
  });

  it.each([
    [
      "non-string prompt",
      () =>
        ({
          ...createImageRequest(),
          prompt: 123
        }) as unknown as GenerationTaskRequest
    ],
    [
      "missing prompt",
      () => {
        const requestWithoutPrompt = createImageRequest() as Partial<GenerationTaskRequest>;
        delete requestWithoutPrompt.prompt;
        return requestWithoutPrompt as unknown as GenerationTaskRequest;
      }
    ],
    ["null request", () => null as unknown as GenerationTaskRequest]
  ])("rejects %s", async (_label, createRequest) => {
    const service = createService();
    await expectGenerationError(() => service.createTask(createRequest(), TEST_USER_ID), "Prompt is required", 400);
  });

  it("rejects empty optimized prompts", async () => {
    const service = createService();
    await expectGenerationError(
      () =>
        service.createTask({
          ...createImageRequest(),
          optimizedPrompt: " "
        }, TEST_USER_ID),
      "Optimized prompt is required",
      400
    );
  });

  it.each([
    [
      "non-string optimized prompt",
      () =>
        ({
          ...createImageRequest(),
          optimizedPrompt: 123
        }) as unknown as GenerationTaskRequest
    ],
    [
      "missing optimized prompt",
      () => {
        const requestWithoutOptimizedPrompt = createImageRequest() as Partial<GenerationTaskRequest>;
        delete requestWithoutOptimizedPrompt.optimizedPrompt;
        return requestWithoutOptimizedPrompt as unknown as GenerationTaskRequest;
      }
    ]
  ])("rejects %s", async (_label, createRequest) => {
    const service = createService();
    await expectGenerationError(
      () => service.createTask(createRequest(), TEST_USER_ID),
      "Optimized prompt is required",
      400
    );
  });

  it("rejects invalid preset suggestions", async () => {
    const service = createService();
    await expectGenerationError(
      () =>
        service.createTask({
          ...createImageRequest(),
          preset: {
            modelId: "",
            parameters: { quality: "high" },
            creditEstimate: { credits: 2, unit: "credit" }
          }
        }, TEST_USER_ID),
      "Invalid preset suggestion",
      400
    );
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY]
  ])("rejects %s preset parameter values", async (_label, value) => {
    const service = createService();
    const request = createImageRequest();
    await expectGenerationError(
      () =>
        service.createTask({
          ...request,
          preset: {
            ...request.preset,
            parameters: {
              ...request.preset.parameters,
              count: value
            }
          }
        }, TEST_USER_ID),
      "Invalid preset suggestion",
      400
    );
  });

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

  it("lists only the requesting user's tasks", async () => {
    const service = createService();
    await service.createTask(createImageRequest(), "user-a");

    expect(await service.listTasks("user-a")).toHaveLength(1);
    expect(await service.listTasks("user-b")).toEqual([]);
  });

  it("rejects generation when the balance is below the model cost", async () => {
    const credit = new StubCreditService({ "user-a": 0 });
    let submitted = false;
    const spyAdapter: ProviderAdapter = {
      async submitGeneration(req) {
        submitted = true;
        return new FakeProviderAdapter().submitGeneration(req);
      }
    };
    const service = new InMemoryGenerationService({
      clock: { now: () => fixedNow },
      idGenerator: () => "generation_task_000001",
      modelCatalog: new ConfigModelCatalog(createModelConfig()),
      providerAdapter: spyAdapter,
      creditService: credit
    });

    await expect(service.createTask(createImageRequest(), "user-a")).rejects.toMatchObject({
      message: "Insufficient credits",
      statusCode: 402
    });
    expect(submitted).toBe(false);
    expect(await service.listTasks("user-a")).toEqual([]);
    expect(credit.deductions).toEqual([]);
  });

  it("deducts the model credit cost after a succeeded generation", async () => {
    const credit = new StubCreditService({ "user-a": 100 });
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
      providerAdapter,
      creditService: credit
    });

    const task = await service.createTask(createTextRequest(), "user-a");

    expect(task.status).toBe("succeeded");
    expect(credit.deductions).toEqual([
      { userId: "user-a", amount: 1, reference: "generation_task_000001" }
    ]);
    expect((await credit.getBalance("user-a")).credits).toBe(99);
  });

  it("does not deduct when the provider keeps the task queued", async () => {
    const credit = new StubCreditService({ "user-a": 100 });
    const service = new InMemoryGenerationService({
      clock: { now: () => fixedNow },
      idGenerator: () => "generation_task_000001",
      modelCatalog: new ConfigModelCatalog(createModelConfig()),
      providerAdapter: new FakeProviderAdapter(),
      creditService: credit
    });

    const task = await service.createTask(createImageRequest(), "user-a");

    expect(task.status).toBe("queued");
    expect(credit.deductions).toEqual([]);
    expect((await credit.getBalance("user-a")).credits).toBe(100);
  });

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
});
