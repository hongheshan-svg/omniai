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

function createCatalog() {
  return new ConfigModelCatalog(createConfig());
}

function expectCatalogError(action: () => unknown, message: string, statusCode: number) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ModelCatalogError);
    expect(error).toMatchObject({ message, statusCode, name: "ModelCatalogError" });
    return;
  }

  throw new Error("Expected model catalog error");
}

describe("ConfigModelCatalog", () => {
  it("lists visible product models without provider internals", () => {
    const catalog = createCatalog();

    const models = catalog.listVisibleModels();

    expect(models).toEqual([
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
    expect(models).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerModelId: expect.any(String),
          provider: expect.anything(),
          baseUrl: expect.any(String),
          apiKeyEnv: expect.any(String)
        })
      ])
    );
  });

  it("returns internal provider references for matching models", () => {
    const catalog = createCatalog();

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
    const catalog = createCatalog();

    expectCatalogError(() => catalog.getModelReference("missing-model", "text"), "Model was not found", 404);
    expectCatalogError(() => catalog.getModelReference("gw-text-hidden", "text"), "Model was not found", 404);
  });

  it("rejects model mode mismatches", () => {
    const catalog = createCatalog();

    expectCatalogError(
      () => catalog.getModelReference("gw-image-creative", "text"),
      "Model does not support this creation mode",
      400
    );
  });

  it("returns maintenance references for service-level handling", () => {
    const catalog = createCatalog();

    expect(catalog.getModelReference("gw-text-maintenance", "text")).toMatchObject({
      product: {
        id: "gw-text-maintenance",
        visibility: "maintenance"
      },
      provider: {
        id: "anthropic-main"
      },
      providerModelId: "claude-maintenance"
    });
  });

  it("returns defensive copies", () => {
    const catalog = createCatalog();

    const [model] = catalog.listVisibleModels();
    model!.tags.push("mutated");
    const reference = catalog.getModelReference("gw-video-motion", "video");
    reference.product.tags.push("mutated");
    reference.provider.displayName = "Mutated";

    expect(catalog.listVisibleModels()[0]!.tags).toEqual(["recommended", "balanced"]);
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
});
