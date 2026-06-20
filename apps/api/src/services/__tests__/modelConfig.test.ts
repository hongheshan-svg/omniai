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

const validConfig = (): ModelCatalogConfig => ({
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
});

function writeJsonFixture(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "model-config-"));
  const filePath = join(dir, "models.json");
  writeFileSync(filePath, JSON.stringify(value), "utf8");
  return filePath;
}

describe("model catalog config", () => {
  it("loads model catalog configuration from JSON", () => {
    const config = validConfig();
    const filePath = writeJsonFixture(config);

    expect(loadModelCatalogConfig(filePath)).toEqual(config);
  });

  it("validates OpenAI-compatible and Anthropic-compatible providers", () => {
    const config = validateModelCatalogConfig(validConfig());

    expect(config.providers.map((provider) => provider.protocol)).toEqual([
      "openai-compatible",
      "anthropic-compatible"
    ]);
  });

  it("returns defensive copies", () => {
    const input = validConfig();
    const config = validateModelCatalogConfig(input);

    config.providers[0]!.models[0]!.tags.push("mutated");
    config.providers[0]!.models[0]!.displayName = "Mutated";

    expect(input.providers[0]!.models[0]!.tags).toEqual(["recommended", "balanced"]);
    expect(input.providers[0]!.models[0]!.displayName).toBe("OmniAI Text Balanced");
  });

  it.each([
    ["empty providers", { providers: [] }, "Model providers are required"],
    [
      "invalid protocol",
      {
        ...validConfig(),
        providers: [{ ...validConfig().providers[0]!, protocol: "unknown" }]
      },
      "Unsupported provider protocol"
    ],
    [
      "invalid capability",
      {
        ...validConfig(),
        providers: [
          {
            ...validConfig().providers[0]!,
            models: [{ ...validConfig().providers[0]!.models[0]!, capability: "audio" }]
          }
        ]
      },
      "Unsupported model capability"
    ],
    [
      "zero credit unit cost",
      {
        ...validConfig(),
        providers: [
          {
            ...validConfig().providers[0]!,
            models: [{ ...validConfig().providers[0]!.models[0]!, creditUnitCost: 0 }]
          }
        ]
      },
      "Invalid model credit unit cost"
    ]
  ])("rejects invalid provider and model configuration: %s", (_label, config, message) => {
    expect(() => validateModelCatalogConfig(config)).toThrow(new ModelConfigError(message));
  });

  it("rejects duplicate product model ids across providers", () => {
    const config = validConfig();
    config.providers[1]!.models[0]!.id = config.providers[0]!.models[0]!.id;

    expect(() => validateModelCatalogConfig(config)).toThrow(new ModelConfigError("Duplicate model id"));
  });
});
