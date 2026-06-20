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

describe("model routes", () => {
  it("returns only visible product-facing models without provider internals", async () => {
    const server = buildServer({
      modelCatalog: new ConfigModelCatalog(createConfig())
    });
    const response = await server.inject({
      method: "GET",
      url: "/v1/models"
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({
      models: [
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
      ]
    });
    expect(JSON.stringify(body)).not.toContain("providerModelId");
    expect(JSON.stringify(body)).not.toContain("apiKeyEnv");
    expect(JSON.stringify(body)).not.toContain("baseUrl");
  });
});
